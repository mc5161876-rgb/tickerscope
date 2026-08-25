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
