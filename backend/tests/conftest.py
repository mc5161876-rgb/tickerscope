"""Shared test plumbing: fixture-backed fetcher, isolated cache dir, TestClient app.

No test here touches the network. The fetcher replays backend/tests/fixtures/*.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tickerscope import config
from tickerscope.cache import DiskCache
from tickerscope.main import create_app
from tickerscope.search import SearchIndex
from tickerscope.yahoo import DataSourceError, NotFoundError

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(symbol: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{symbol}.json").read_text(encoding="utf-8"))


class FixtureFetcher:
    """Replays recorded payloads and counts calls so cache tests can assert zero fetches."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls: list[tuple[str, str, str]] = []
        self._data: dict[str, dict[str, Any]] = {}
        for p in FIXTURES.glob("*.json"):
            self._data[p.stem.upper()] = json.loads(p.read_text(encoding="utf-8"))

    def _rec(self, symbol: str) -> dict[str, Any]:
        if self.fail:
            raise DataSourceError("simulated Yahoo outage")
        sym = symbol.upper()
        if sym not in self._data:
            raise NotFoundError(sym)
        return self._data[sym]

    def fetch_profile_and_metrics(self, symbol: str) -> dict[str, Any]:
        self.calls.append(("ticker", symbol, ""))
        return self._rec(symbol)["ticker"]

    def fetch_prices(self, symbol: str, range_key: str) -> dict[str, Any]:
        self.calls.append(("prices", symbol, range_key))
        rec = self._rec(symbol)["prices_1y"]
        return {**rec, "range": range_key}

    def fetch_financials(self, symbol: str, freq: str) -> dict[str, Any]:
        self.calls.append(("financials", symbol, freq))
        rec = self._rec(symbol)
        return rec["financials_quarterly" if freq == "quarterly" else "financials_annual"]

    def fetch_quotes(self, symbols: list[str]) -> dict[str, dict[str, Any] | None]:
        """One batched call (MAR-50): unknown symbols -> None, outage -> DataSourceError."""
        self.calls.append(("quotes", ",".join(symbols), ""))
        if self.fail:
            raise DataSourceError("simulated Yahoo outage")
        out: dict[str, dict[str, Any] | None] = {}
        for s in symbols:
            rec = self._data.get(s.upper())
            out[s.upper()] = rec["ticker"] if rec else None
        return out


SAMPLE_COMPANIES = [
    {"ticker": "NVDA", "name": "NVIDIA CORP", "exchange": "NASDAQ", "cik": 1045810},
    {"ticker": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "cik": 320193},
    {"ticker": "JPM", "name": "JPMORGAN CHASE & CO", "exchange": "NYSE", "cik": 19617},
    {"ticker": "MSFT", "name": "MICROSOFT CORP", "exchange": "NASDAQ", "cik": 789019},
    {"ticker": "A", "name": "AGILENT TECHNOLOGIES, INC.", "exchange": "NYSE", "cik": 1090872},
    {"ticker": "AA", "name": "Alcoa Corp", "exchange": "NYSE", "cik": 1675149},
    {"ticker": "AAP", "name": "ADVANCE AUTO PARTS INC", "exchange": "NYSE", "cik": 1158449},
    {"ticker": "APLE", "name": "Apple Hospitality REIT, Inc.", "exchange": "NYSE", "cik": 1418121},
    {"ticker": "NVAX", "name": "NOVAVAX INC", "exchange": "NASDAQ", "cik": 1000694},
    {"ticker": "BRK-B", "name": "BERKSHIRE HATHAWAY INC", "exchange": "NYSE", "cik": 1067983},
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "exchange": "NASDAQ", "cik": 1652044},
    {"ticker": "GOOG", "name": "Alphabet Inc.", "exchange": "NASDAQ", "cik": 1652044},
    {"ticker": "TSLA", "name": "Tesla, Inc.", "exchange": "NASDAQ", "cik": 1318605},
]


@pytest.fixture
def cache(tmp_path, monkeypatch) -> DiskCache:
    monkeypatch.setenv("TICKERSCOPE_DATA_DIR", str(tmp_path / "data"))
    return DiskCache(config.cache_dir())


@pytest.fixture
def fetcher() -> FixtureFetcher:
    return FixtureFetcher()


@pytest.fixture
def search_index(cache) -> SearchIndex:
    idx = SearchIndex(cache, downloader=lambda: SAMPLE_COMPANIES)
    idx.set_companies(SAMPLE_COMPANIES)
    return idx


@pytest.fixture
def client(cache, fetcher, search_index) -> TestClient:
    app = create_app(
        cache=cache, fetcher=fetcher, search_index=search_index, load_index_on_startup=False
    )
    with TestClient(app) as c:
        yield c
