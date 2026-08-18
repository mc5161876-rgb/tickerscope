"""API-level SEC behaviour: 503 when unconfigured, financials merge, health flags (MAR-49)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tickerscope.main import create_app
from tickerscope.sec.client import SecNotConfigured, sec_configured
from tickerscope.sec.service import SecService

from ..conftest import FixtureFetcher


def _unconfigured():
    raise SecNotConfigured("SEC access not configured: set SEC_USER_AGENT in .env")


class FakeSec(SecService):
    """Serves canned SEC series so the merge path is testable offline."""

    def __init__(self, cache):
        super().__init__(cache, lambda s: "0000320193", fetcher_factory=_unconfigured)

    def series(self, symbol, freq):
        if freq != "annual":
            return {"status": "ok", "cik": "0000320193", "revenue": [], "ebitda": []}
        pts = [
            {
                "period_end": f"{y}-09-30",
                "period_start": f"{y - 1}-10-01",
                "label": f"FY{y}",
                "value": float(y),
                "source": "sec",
                "accession": f"acc-{y}",
                "filed": f"{y}-11-01",
                "form": "10-K",
                "method": "as_filed",
                "tag": "Revenues",
            }
            for y in range(2016, 2026)
        ]
        return {"status": "ok", "cik": "0000320193", "revenue": pts, "ebitda": []}


def test_segments_503_when_sec_user_agent_unset(cache, fetcher, search_index, monkeypatch):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    assert sec_configured() is False
    sec = SecService(cache, lambda s: "1", fetcher_factory=_unconfigured)
    app = create_app(
        cache=cache,
        fetcher=fetcher,
        search_index=search_index,
        load_index_on_startup=False,
        sec_service=sec,
    )
    with TestClient(app) as c:
        r = c.get("/api/ticker/AAPL/segments")
        assert r.status_code == 503
        body = r.json()
        assert body["status"] == "not_configured"
        assert "SEC_USER_AGENT" in body["message"]
        assert body["periods"] == []
        h = c.get("/api/health").json()
        assert h["sec_configured"] is False


def test_health_reports_sec_configured_when_env_set(cache, fetcher, search_index, monkeypatch):
    monkeypatch.setenv("SEC_USER_AGENT", "TickerScope test (test@example.com)")
    app = create_app(
        cache=cache, fetcher=fetcher, search_index=search_index, load_index_on_startup=False
    )
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["sec_configured"] is True
        assert h["sec_user_agent_hint"].startswith("TickerScope test")


def test_financials_merges_sec_history_with_yfinance_fallback(cache, fetcher, search_index):
    app = create_app(
        cache=cache,
        fetcher=fetcher,
        search_index=search_index,
        load_index_on_startup=False,
        sec_service=FakeSec(cache),
    )
    with TestClient(app) as c:
        body = c.get("/api/ticker/AAPL/financials?freq=annual").json()
        rev = body["revenue"]
        assert len(rev) == 10  # capped at SEC_ANNUAL_YEARS
        assert body["sec"]["status"] == "ok"
        sec_pts = [p for p in rev if p["source"] == "sec"]
        assert sec_pts and all(
            p["accession"] and p["filed"] and p["form"] == "10-K" for p in sec_pts
        )
        # yfinance rows for AAPL: FY2022..FY2025 -> all covered by SEC (same period end) so none survive
        assert not [p for p in rev if p["source"] == "yfinance"]
        # EBITDA had no SEC data -> yfinance rows, marked
        assert body["ebitda"] and all(p["source"] == "yfinance" for p in body["ebitda"])
        assert body["ebitda_method"] == "reported"


def test_financials_unconfigured_sec_falls_back_to_yfinance_only(cache, fetcher, search_index):
    sec = SecService(cache, lambda s: "1", fetcher_factory=_unconfigured)
    app = create_app(
        cache=cache,
        fetcher=fetcher,
        search_index=search_index,
        load_index_on_startup=False,
        sec_service=sec,
    )
    with TestClient(app) as c:
        body = c.get("/api/ticker/AAPL/financials?freq=annual").json()
        assert body["sec"]["status"] == "not_configured"
        assert all(p["source"] == "yfinance" for p in body["revenue"])
        assert len(body["revenue"]) >= 4


def test_financials_503_only_when_both_sources_fail(cache, search_index):
    sec = SecService(cache, lambda s: "1", fetcher_factory=_unconfigured)
    app = create_app(
        cache=cache,
        fetcher=FixtureFetcher(fail=True),
        search_index=search_index,
        load_index_on_startup=False,
        sec_service=sec,
    )
    with TestClient(app) as c:
        r = c.get("/api/ticker/AAPL/financials?freq=annual")
        assert r.status_code == 503
        assert r.json()["error"] == "data_source_unavailable"
