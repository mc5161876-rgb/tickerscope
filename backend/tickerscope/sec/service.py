"""SEC-facing service: computed series + segments payloads, cached in the app DiskCache (6h)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from .. import config
from ..cache import DiskCache
from .client import Fetcher, SecError, SecNotConfigured, get_fetcher
from .companyfacts import build_series, companyfacts_url
from .segments import build_segments, not_configured_envelope, unavailable_envelope

log = logging.getLogger("tickerscope.sec")


class SecService:
    def __init__(
        self,
        cache: DiskCache,
        cik_resolver: Callable[[str], str | None],
        fetcher_factory: Callable[[], Fetcher] = get_fetcher,
    ):
        self.cache = cache
        self.cik_resolver = cik_resolver
        self.fetcher_factory = fetcher_factory

    # ---- helpers -------------------------------------------------------------------
    def _fetcher(self) -> Fetcher:
        return self.fetcher_factory()

    def configured(self) -> bool:
        try:
            self._fetcher()
            return True
        except SecNotConfigured:
            return False

    # ---- 10-year series (AC-1) ------------------------------------------------------
    def series(self, symbol: str, freq: str) -> dict[str, Any]:
        """{status: ok|not_configured|not_found|error, revenue: [...], ebitda: [...]}"""
        sym = symbol.upper()
        key = f"{sym}_{freq}"
        hit = self.cache.get("sec_series", key, config.TTL_SEC_DERIVED)
        if hit and hit.fresh:
            return hit.payload
        try:
            fetcher = self._fetcher()
        except SecNotConfigured as exc:
            return {"status": "not_configured", "message": str(exc), "revenue": [], "ebitda": []}
        cik = self.cik_resolver(sym)
        if not cik:
            return {
                "status": "not_found",
                "message": "not an SEC filer",
                "revenue": [],
                "ebitda": [],
            }
        try:
            facts = fetcher.get_json(companyfacts_url(cik))
        except SecError as exc:
            if hit:
                return hit.payload
            return {"status": "error", "message": str(exc), "revenue": [], "ebitda": []}
        limit = config.SEC_ANNUAL_YEARS if freq == "annual" else config.SEC_QUARTERS
        out = {"status": "ok", "cik": str(cik).zfill(10), **build_series(facts, freq, limit)}
        self.cache.set("sec_series", key, out)
        return out

    # ---- segments (AC-3) -----------------------------------------------------------
    def segments(self, symbol: str, freq: str) -> dict[str, Any]:
        sym = symbol.upper()
        freq = "quarterly" if freq == "quarterly" else "annual"
        key = f"{sym}_{freq}"
        hit = self.cache.get("segments", key, config.TTL_SEC_DERIVED)
        if hit and hit.fresh:
            return hit.payload
        try:
            fetcher = self._fetcher()
        except SecNotConfigured as exc:
            return not_configured_envelope(sym, freq, str(exc))
        cik = self.cik_resolver(sym)
        if not cik:
            return unavailable_envelope(sym, freq, "not_found", "Not an SEC filer")
        try:
            env = build_segments(
                fetcher, sym, str(cik), freq, diagnostics_dir=config.sec_diagnostics_dir()
            )
        except SecError as exc:
            log.warning("segments %s %s: %s", sym, freq, exc)
            if hit:
                return hit.payload
            return unavailable_envelope(sym, freq, "error", f"SEC unavailable: {exc}")
        except Exception as exc:  # noqa: BLE001 - never crash the page for one filing
            log.exception("segments %s %s failed", sym, freq)
            if hit:
                return hit.payload
            return unavailable_envelope(sym, freq, "error", f"{type(exc).__name__}: {exc}")
        self.cache.set("segments", key, env)
        return env
