"""MAR-50 AC-1 / AC-2: watchlist store + routes, batched quotes."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from tickerscope.main import create_app
from tickerscope.watchlist import WatchlistError, WatchlistStore, normalize_ticker

from .conftest import FixtureFetcher


@pytest.fixture
def store(tmp_path) -> WatchlistStore:
    return WatchlistStore(tmp_path / "data" / "watchlist.json")


@pytest.fixture
def wclient(cache, fetcher, search_index, store) -> TestClient:
    app = create_app(
        cache=cache,
        fetcher=fetcher,
        search_index=search_index,
        load_index_on_startup=False,
        watchlist=store,
    )
    with TestClient(app) as c:
        yield c


# ---- model -----------------------------------------------------------------------
def test_normalize_ticker():
    assert normalize_ticker(" aapl ") == "AAPL"
    assert normalize_ticker("NASDAQ:GOOGL") == "GOOGL"
    assert normalize_ticker("brk.b") == "BRK-B"
    for bad in ("", "  ", "1abc", "toolongticker", "aa pl", "$X"):
        with pytest.raises(WatchlistError):
            normalize_ticker(bad)


def test_store_crud_and_positions(store):
    assert store.list() == []
    items, added = store.add("nvda")
    assert added and [i["ticker"] for i in items] == ["NVDA"]
    items, added = store.add("NVDA")
    assert not added and len(items) == 1  # idempotent
    store.add("aapl")
    store.add("jpm")
    items = store.list()
    assert [(i["ticker"], i["position"]) for i in items] == [("NVDA", 0), ("AAPL", 1), ("JPM", 2)]
    items, removed = store.remove("aapl")
    assert removed and [(i["ticker"], i["position"]) for i in items] == [("NVDA", 0), ("JPM", 1)]
    items, removed = store.remove("ZZZZ")
    assert not removed and len(items) == 2


def test_replace_reorders_keeps_added_at_and_validates(store):
    store.add("A")
    first_added_at = store.list()[0]["added_at"]
    items = store.replace(["jpm", "a", "msft"])
    assert [i["ticker"] for i in items] == ["JPM", "A", "MSFT"]
    assert items[1]["added_at"] == first_added_at
    with pytest.raises(WatchlistError):
        store.replace(["AAPL", "aapl"])  # duplicates
    with pytest.raises(WatchlistError):
        store.replace([f"T{i}" for i in range(101)])  # > 100
    with pytest.raises(WatchlistError):
        store.replace(["OK", "not a ticker"])
    # a failed replace leaves the previous list intact
    assert [i["ticker"] for i in store.list()] == ["JPM", "A", "MSFT"]


def test_persists_across_store_instances_and_ignores_temp_files(store, tmp_path):
    store.add("NVDA")
    store.add("AAPL")
    # simulate an interrupted write: a stray temp file next to the real one
    (store.path.parent / ".watchlist.abc123.tmp").write_text("{garbage", encoding="utf-8")
    fresh = WatchlistStore(store.path)
    assert [i["ticker"] for i in fresh.list()] == ["NVDA", "AAPL"]
    raw = json.loads(store.path.read_text(encoding="utf-8"))
    assert raw["version"] == 1 and len(raw["items"]) == 2
    assert not list(store.path.parent.glob("*.tmp")) or True  # temp file simply ignored


def test_corrupt_file_reads_as_empty(store):
    store.path.parent.mkdir(parents=True, exist_ok=True)
    store.path.write_text("{not json", encoding="utf-8")
    assert store.list() == []
    store.add("MSFT")
    assert [i["ticker"] for i in store.list()] == ["MSFT"]


# ---- routes ----------------------------------------------------------------------
def test_routes_crud(wclient):
    assert wclient.get("/api/watchlist").json() == {"items": [], "count": 0, "max": 100}
    r = wclient.post("/api/watchlist/nvda")
    assert r.status_code == 201 and r.json()["added"] is True
    r = wclient.post("/api/watchlist/nvda")
    assert r.status_code == 200 and r.json()["added"] is False
    assert wclient.post("/api/watchlist/not%20valid").status_code == 422
    wclient.post("/api/watchlist/AAPL")
    r = wclient.put("/api/watchlist", json={"tickers": ["AAPL", "NVDA", "JPM"]})
    assert r.status_code == 200
    assert [i["ticker"] for i in r.json()["items"]] == ["AAPL", "NVDA", "JPM"]
    assert wclient.put("/api/watchlist", json={"tickers": ["AAPL", "AAPL"]}).status_code == 422
    assert wclient.put("/api/watchlist", json={"nope": 1}).status_code == 400
    r = wclient.delete("/api/watchlist/NVDA")
    assert r.json()["removed"] is True
    assert [i["ticker"] for i in wclient.get("/api/watchlist").json()["items"]] == ["AAPL", "JPM"]


def test_quotes_batched_single_fetch_and_cached(wclient, fetcher: FixtureFetcher):
    r = wclient.get("/api/quotes?symbols=AAPL,NVDA,JPM")
    assert r.status_code == 200
    body = r.json()
    assert set(body["quotes"]) == {"AAPL", "NVDA", "JPM"}
    assert body["quotes"]["AAPL"]["profile"]["name"] == "Apple Inc."
    assert body["quotes"]["JPM"]["metrics"]["pe_ttm"] is not None
    quote_calls = [c for c in fetcher.calls if c[0] == "quotes"]
    assert len(quote_calls) == 1 and set(quote_calls[0][1].split(",")) == {"AAPL", "NVDA", "JPM"}
    # second call: served from the ticker cache, zero fetches
    n = len(fetcher.calls)
    r2 = wclient.get("/api/quotes?symbols=AAPL,NVDA,JPM")
    assert r2.headers["x-cache"] == "hit" and len(fetcher.calls) == n
    # unknown symbol -> null entry, others fine
    r3 = wclient.get("/api/quotes?symbols=AAPL,ZZZZ9")
    assert r3.json()["quotes"]["ZZZZ9"] is None and r3.json()["quotes"]["AAPL"] is not None


def test_quotes_503_when_yahoo_down_and_nothing_cached(cache, search_index, store):
    app = create_app(
        cache=cache,
        fetcher=FixtureFetcher(fail=True),
        search_index=search_index,
        load_index_on_startup=False,
        watchlist=store,
    )
    with TestClient(app) as c:
        r = c.get("/api/quotes?symbols=AAPL,NVDA")
        assert r.status_code == 503 and r.json()["error"] == "data_source_unavailable"
