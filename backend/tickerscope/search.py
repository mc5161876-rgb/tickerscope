"""Ticker search over the SEC company list (AC-2, AC-16 /api/search).

Index source: SEC `company_tickers_exchange.json` (same free file family as
`company_tickers.json`, plus an exchange column so results can show NYSE/Nasdaq).
Falls back to `company_tickers.json` if the exchange variant is unavailable.
Cached to disk for 24h. Fuzzy match on ticker + company name via rapidfuzz.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from rapidfuzz import fuzz

from . import config
from .cache import DiskCache

SEC_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"

_EXCHANGE_LABELS = {
    "Nasdaq": "NASDAQ",
    "NYSE": "NYSE",
    "NYSE MKT": "NYSE American",
    "NYSE Arca": "NYSE Arca",
    "CBOE": "Cboe",
    "OTC": "OTC",
}


@dataclass(frozen=True)
class Company:
    ticker: str
    name: str
    exchange: str | None
    cik: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "name": self.name,
            "exchange": self.exchange,
            "cik": self.cik,
        }


def _normalize_exchange(raw: str | None) -> str | None:
    if not raw:
        return None
    return _EXCHANGE_LABELS.get(raw, raw)


def parse_sec_payload(payload: Any) -> list[Company]:
    """Accepts either SEC file shape and returns a clean company list."""
    out: list[Company] = []
    if isinstance(payload, dict) and "fields" in payload and "data" in payload:
        fields = payload["fields"]
        idx = {name: i for i, name in enumerate(fields)}
        for row in payload["data"]:
            ticker = str(row[idx["ticker"]] or "").upper().strip()
            if not ticker:
                continue
            out.append(
                Company(
                    ticker=ticker,
                    name=str(row[idx["name"]] or "").strip(),
                    exchange=_normalize_exchange(
                        row[idx.get("exchange", -1)] if "exchange" in idx else None
                    ),
                    cik=int(row[idx["cik"]]) if row[idx["cik"]] is not None else None,
                )
            )
    elif isinstance(payload, dict):
        for entry in payload.values():
            if not isinstance(entry, dict):
                continue
            ticker = str(entry.get("ticker") or "").upper().strip()
            if not ticker:
                continue
            out.append(
                Company(
                    ticker=ticker,
                    name=str(entry.get("title") or "").strip(),
                    exchange=None,
                    cik=int(entry["cik_str"]) if entry.get("cik_str") is not None else None,
                )
            )
    # de-dupe on ticker, keep first
    seen: set[str] = set()
    deduped: list[Company] = []
    for c in out:
        if c.ticker in seen:
            continue
        seen.add(c.ticker)
        deduped.append(c)
    return deduped


def download_sec_index(timeout: float = 20.0) -> list[dict[str, Any]]:
    headers = {"User-Agent": config.SEC_USER_AGENT, "Accept": "application/json"}
    with httpx.Client(timeout=timeout, headers=headers, follow_redirects=True) as client:
        try:
            resp = client.get(SEC_EXCHANGE_URL)
            resp.raise_for_status()
            companies = parse_sec_payload(resp.json())
        except (httpx.HTTPError, ValueError, KeyError):
            resp = client.get(config.SEC_TICKERS_URL)
            resp.raise_for_status()
            companies = parse_sec_payload(resp.json())
    return [c.to_dict() for c in companies]


class SearchIndex:
    """In-memory search over the SEC company list, backed by the disk cache."""

    NAMESPACE = "search"
    KEY = "sec_company_index"

    def __init__(self, cache: DiskCache, downloader=download_sec_index):
        self.cache = cache
        self.downloader = downloader
        self._companies: list[Company] = []
        self._by_ticker: dict[str, Company] = {}
        self._loaded_at: float = 0.0
        self.last_error: str | None = None

    # ---- loading -----------------------------------------------------------------
    def load(self, force: bool = False) -> None:
        hit = self.cache.get(self.NAMESPACE, self.KEY, config.TTL_SEARCH_INDEX)
        if hit and hit.fresh and not force:
            self._set(hit.payload)
            return
        try:
            rows = self.downloader()
            self.cache.set(self.NAMESPACE, self.KEY, rows)
            self._set(rows)
            self.last_error = None
        except Exception as exc:  # noqa: BLE001 - any failure falls back to stale
            self.last_error = f"{type(exc).__name__}: {exc}"
            if hit:  # stale is better than nothing
                self._set(hit.payload)
            elif not self._companies:
                self._set([])

    def set_companies(self, rows: list[dict[str, Any]]) -> None:
        """Test / offline hook."""
        self._set(rows)

    def _set(self, rows: list[dict[str, Any]]) -> None:
        self._companies = [
            Company(
                ticker=r["ticker"],
                name=r.get("name", ""),
                exchange=r.get("exchange"),
                cik=r.get("cik"),
            )
            for r in rows
        ]
        self._by_ticker = {c.ticker: c for c in self._companies}
        self._loaded_at = time.time()

    @property
    def size(self) -> int:
        return len(self._companies)

    def lookup(self, ticker: str) -> Company | None:
        return self._by_ticker.get(ticker.upper().strip())

    # ---- searching ---------------------------------------------------------------
    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        q = query.strip()
        if not q:
            return []
        q_upper = q.upper()
        q_lower = q.lower()
        # dotted / dashed share classes: "BRK.B" vs "BRK-B"
        q_ticker = re.sub(r"[.\s]", "-", q_upper)

        scored: list[tuple[float, int, Company]] = []
        for c in self._companies:
            t = c.ticker
            name_l = c.name.lower()
            score = 0.0
            if t == q_upper or t == q_ticker:
                score = 1000
            elif t.startswith(q_ticker):
                score = 800 - (len(t) - len(q_ticker)) * 4
            elif name_l.startswith(q_lower):
                score = 700 - min(len(name_l), 60)
            elif re.search(r"\b" + re.escape(q_lower), name_l):
                score = 600 - min(name_l.find(q_lower), 60)
            elif len(q) >= 3:
                fz = fuzz.WRatio(q_lower, name_l, processor=None)
                if fz >= 82:
                    score = fz * 5  # 410..500
                elif q_lower in name_l:
                    score = 400
                else:
                    tz = fuzz.ratio(q_ticker, t)
                    if tz >= 75 and len(t) <= 5:
                        score = tz * 4  # 300..400
            if score > 0:
                # prefer major exchanges when otherwise tied
                bonus = 2 if c.exchange in {"NASDAQ", "NYSE"} else 0
                scored.append((score + bonus, -len(t), c))
        scored.sort(key=lambda s: (-s[0], -s[1], s[2].ticker))
        return [c.to_dict() for _, _, c in scored[:limit]]
