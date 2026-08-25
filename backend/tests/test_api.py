from tickerscope import __version__
from tickerscope.metrics import metric_ids

from .conftest import FixtureFetcher


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["data_mode"] in {"live", "force_fail"}
    assert body["yfinance_version"]
    assert body["version"] == __version__


def test_ticker_payload_shape_and_metric_keys(client):
    r = client.get("/api/ticker/AAPL")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"profile", "quote", "metrics", "as_of"}
    # every registry id is present as a key (AC-16 / AC-9 contract)
    missing = [mid for mid in metric_ids() if mid not in body["metrics"]]
    assert missing == []
    assert body["profile"]["name"] == "Apple Inc."
    assert body["quote"]["price"] is not None
    # snake_case keys only
    for k in list(body) + list(body["profile"]) + list(body["quote"]) + list(body["metrics"]):
        assert k == k.lower() and " " not in k


def test_ticker_metric_null_is_preserved_not_dropped(client):
    r = client.get("/api/ticker/JPM")
    body = r.json()
    assert "ebitda_ttm" in body["metrics"]
    assert body["metrics"]["ebitda_ttm"] is None


def test_unknown_ticker_404(client):
    r = client.get("/api/ticker/ZZZZ9")
    assert r.status_code == 404
    assert r.json() == {"error": "not_found", "symbol": "ZZZZ9"}


def test_cache_hit_performs_zero_fetches(client, fetcher: FixtureFetcher):
    r1 = client.get("/api/ticker/NVDA")
    assert r1.headers["x-cache"] == "miss"
    n = len(fetcher.calls)
    r2 = client.get("/api/ticker/NVDA")
    assert r2.status_code == 200
    assert r2.headers["x-cache"] == "hit"
    assert len(fetcher.calls) == n  # zero Yahoo calls on the second request
    assert r2.json() == r1.json()


def test_cache_key_isolates_ranges_and_freqs(client, fetcher: FixtureFetcher):
    client.get("/api/ticker/AAPL/prices?range=1y")
    client.get("/api/ticker/AAPL/prices?range=5y")
    client.get("/api/ticker/AAPL/financials?freq=annual")
    client.get("/api/ticker/AAPL/financials?freq=quarterly")
    kinds = [(c[0], c[2]) for c in fetcher.calls]
    assert kinds == [
        ("prices", "1y"),
        ("prices", "5y"),
        ("financials", "annual"),
        ("financials", "quarterly"),
    ]


def test_upstream_failure_returns_503(cache, search_index):
    from fastapi.testclient import TestClient

    from tickerscope.main import create_app

    app = create_app(
        cache=cache,
        fetcher=FixtureFetcher(fail=True),
        search_index=search_index,
        load_index_on_startup=False,
    )
    with TestClient(app) as c:
        r = c.get("/api/ticker/AAPL")
        assert r.status_code == 503
        assert r.json()["error"] == "data_source_unavailable"
        assert "stale" not in r.json()


def test_upstream_failure_serves_stale_payload_when_cached(cache, search_index, monkeypatch):
    from fastapi.testclient import TestClient

    from tickerscope import config
    from tickerscope.main import create_app

    good = FixtureFetcher()
    app = create_app(
        cache=cache, fetcher=good, search_index=search_index, load_index_on_startup=False
    )
    with TestClient(app) as c:
        assert c.get("/api/ticker/AAPL").status_code == 200

    # expire the entry, then fail upstream: 503 must still carry the last good payload
    monkeypatch.setattr(config, "TTL_QUOTE", 0)
    bad = FixtureFetcher(fail=True)
    app2 = create_app(
        cache=cache, fetcher=bad, search_index=search_index, load_index_on_startup=False
    )
    with TestClient(app2) as c:
        r = c.get("/api/ticker/AAPL")
        assert r.status_code == 503
        body = r.json()
        assert body["error"] == "data_source_unavailable"
        assert body["stale"]["profile"]["name"] == "Apple Inc."
        assert r.headers["x-cache"] == "stale"


def test_prices_endpoint_shape_and_validation(client):
    r = client.get("/api/ticker/AAPL/prices?range=1y")
    assert r.status_code == 200
    body = r.json()
    assert body["range"] == "1y"
    assert body["points"] and {"date", "close"} <= set(body["points"][0])
    assert client.get("/api/ticker/AAPL/prices?range=2y").status_code == 400


def test_financials_endpoint_shape_and_labels(client):
    r = client.get("/api/ticker/AAPL/financials?freq=annual")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"revenue", "ebitda", "ebitda_method"}
    assert body["ebitda_method"] in {"reported", "calculated", None}
    assert len(body["revenue"]) >= 4
    assert all(p["label"].startswith("FY") for p in body["revenue"])
    q = client.get("/api/ticker/AAPL/financials?freq=quarterly").json()
    assert len(q["revenue"]) >= 4
    assert all(p["label"].startswith("Q") and "'" in p["label"] for p in q["revenue"])
    assert client.get("/api/ticker/AAPL/financials?freq=monthly").status_code == 400


def test_bank_without_ebitda_reports_null_method(client):
    body = client.get("/api/ticker/JPM/financials?freq=annual").json()
    assert body["ebitda_method"] is None
    assert body["ebitda"] == []
    assert len(body["revenue"]) >= 4
