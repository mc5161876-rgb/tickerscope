"""Cache-aware orchestration between the API and the Yahoo fetcher (AC-17, AC-18).

The fetcher is injected so tests can swap in fixtures and count calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from . import config
from .cache import DiskCache
from .yahoo import DataSourceError, NotFoundError


class Fetcher(Protocol):
    def fetch_profile_and_metrics(self, symbol: str) -> dict[str, Any]: ...
    def fetch_prices(self, symbol: str, range_key: str) -> dict[str, Any]: ...
    def fetch_financials(self, symbol: str, freq: str) -> dict[str, Any]: ...
    def fetch_quotes(self, symbols: list[str]) -> dict[str, dict[str, Any] | None]: ...


@dataclass
class ServiceResult:
    payload: dict[str, Any]
    cache: str  # "hit" | "miss"


class UpstreamDown(Exception):
    """Raised when Yahoo fails; carries the last good payload if the cache has one."""

    def __init__(self, message: str, stale: dict[str, Any] | None, stale_stored_at: float | None):
        super().__init__(message)
        self.stale = stale
        self.stale_stored_at = stale_stored_at


class TickerService:
    def __init__(self, cache: DiskCache, fetcher: Fetcher):
        self.cache = cache
        self.fetcher = fetcher

    def _cached(self, namespace: str, key: str, ttl: float, loader) -> ServiceResult:
        hit = self.cache.get(namespace, key, ttl)
        if hit and hit.fresh:
            return ServiceResult(payload=hit.payload, cache="hit")
        try:
            payload = loader()
        except NotFoundError:
            raise
        except DataSourceError as exc:
            raise UpstreamDown(
                str(exc),
                stale=hit.payload if hit else None,
                stale_stored_at=hit.stored_at if hit else None,
            ) from exc
        except Exception as exc:  # noqa: BLE001 - anything unexpected from upstream is a 503 too
            raise UpstreamDown(
                f"{type(exc).__name__}: {exc}",
                stale=hit.payload if hit else None,
                stale_stored_at=hit.stored_at if hit else None,
            ) from exc
        self.cache.set(namespace, key, payload)
        return ServiceResult(payload=payload, cache="miss")

    def ticker(self, symbol: str) -> ServiceResult:
        sym = symbol.upper().strip()
        return self._cached(
            "ticker", sym, config.TTL_QUOTE, lambda: self.fetcher.fetch_profile_and_metrics(sym)
        )

    def prices(self, symbol: str, range_key: str) -> ServiceResult:
        sym = symbol.upper().strip()
        return self._cached(
            "prices",
            f"{sym}_{range_key}",
            config.TTL_PRICES,
            lambda: self.fetcher.fetch_prices(sym, range_key),
        )

    def financials(self, symbol: str, freq: str) -> ServiceResult:
        sym = symbol.upper().strip()
        return self._cached(
            "financials",
            f"{sym}_{freq}",
            config.TTL_FINANCIALS,
            lambda: self.fetcher.fetch_financials(sym, freq),
        )

    def quotes(self, symbols: list[str]) -> dict[str, Any]:
        """Batched watchlist quotes (MAR-50 AC-2). Fresh `ticker` cache entries are reused (and
        warmed for the ticker page); everything else goes to the fetcher in ONE batched call.
        Returns {'quotes': {SYM: payload|None}, 'cache': 'hit'|'miss'|'partial', 'stale': [..]}.
        """
        syms: list[str] = []
        for s in symbols:
            t = (s or "").upper().strip()
            if t and t not in syms:
                syms.append(t)
        out: dict[str, Any] = {}
        stale_hits: dict[str, Any] = {}
        missing: list[str] = []
        for sym in syms:
            hit = self.cache.get("ticker", sym, config.TTL_QUOTE)
            if hit and hit.fresh:
                out[sym] = hit.payload
            else:
                missing.append(sym)
                if hit:
                    stale_hits[sym] = hit.payload
        status = "hit" if not missing else ("partial" if out else "miss")
        stale: list[str] = []
        if missing:
            try:
                fetched = self.fetcher.fetch_quotes(missing)
            except DataSourceError as exc:
                if not out and not stale_hits:
                    raise UpstreamDown(str(exc), stale=None, stale_stored_at=None) from exc
                fetched = {}
                for sym in missing:
                    if sym in stale_hits:
                        out[sym] = stale_hits[sym]
                        stale.append(sym)
                    else:
                        out[sym] = None
            for sym, payload in fetched.items():
                if payload is not None:
                    self.cache.set("ticker", sym, payload)
                    out[sym] = payload
                elif sym in stale_hits:
                    out[sym] = stale_hits[sym]
                    stale.append(sym)
                else:
                    out[sym] = None
        return {"quotes": {s: out.get(s) for s in syms}, "cache": status, "stale": stale}
