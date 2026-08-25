"""TickerScope API (AC-16) + static hosting of the built frontend."""

from __future__ import annotations

import datetime as dt
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, yahoo
from .cache import DiskCache
from .metrics import registry
from .search import SearchIndex
from .service import TickerService, UpstreamDown
from .yahoo import NotFoundError

log = logging.getLogger("tickerscope")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

VALID_RANGES = ("1y", "5y", "10y", "max")
VALID_FREQS = ("annual", "quarterly")


def create_app(
    cache: DiskCache | None = None,
    fetcher: Any = yahoo,
    search_index: SearchIndex | None = None,
    load_index_on_startup: bool = True,
) -> FastAPI:
    cache = cache or DiskCache(config.cache_dir())
    index = search_index or SearchIndex(cache)
    service = TickerService(cache, fetcher)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if load_index_on_startup:
            index.load()
            if index.last_error:
                log.warning("search index load problem: %s (size=%d)", index.last_error, index.size)
            else:
                log.info("search index ready: %d companies", index.size)
        yield

    app = FastAPI(title="TickerScope API", version=__version__, lifespan=lifespan)
    app.state.cache = cache
    app.state.search_index = index
    app.state.service = service

    # ------------------------------------------------------------------ helpers
    def _json(payload: Any, cache_status: str, status_code: int = 200) -> JSONResponse:
        resp = JSONResponse(payload, status_code=status_code)
        resp.headers["x-cache"] = cache_status
        resp.headers["cache-control"] = "no-store"
        return resp

    def _upstream_down(exc: UpstreamDown) -> JSONResponse:
        body: dict[str, Any] = {"error": "data_source_unavailable", "detail": str(exc)}
        if exc.stale is not None:
            body["stale"] = exc.stale
            body["stale_as_of"] = (
                dt.datetime.fromtimestamp(exc.stale_stored_at, tz=dt.UTC).isoformat()
                if exc.stale_stored_at
                else None
            )
        return _json(body, "stale" if exc.stale is not None else "miss", status_code=503)

    def _not_found(symbol: str) -> JSONResponse:
        return _json({"error": "not_found", "symbol": symbol.upper()}, "miss", status_code=404)

    # ------------------------------------------------------------------ routes
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "data_mode": "force_fail" if config.force_fail() else "live",
            "yfinance_version": yahoo.yfinance_version(),
            "search_index_size": index.size,
            "version": __version__,
        }

    @app.get("/api/metrics")
    def metrics_registry() -> dict[str, Any]:
        """The shared registry, so the frontend can fetch it in prod without a bundler import."""
        return registry()

    @app.get("/api/search")
    def search(
        q: str = Query("", max_length=80), limit: int = Query(8, ge=1, le=25)
    ) -> dict[str, Any]:
        if index.size == 0:
            index.load()
        return {"query": q, "results": index.search(q, limit=limit)}

    @app.get("/api/ticker/{symbol}")
    def ticker(symbol: str) -> JSONResponse:
        sym = symbol.upper().strip()
        try:
            res = service.ticker(sym)
        except NotFoundError:
            return _not_found(sym)
        except UpstreamDown as exc:
            return _upstream_down(exc)
        return _json(res.payload, res.cache)

    @app.get("/api/ticker/{symbol}/prices")
    def prices(symbol: str, range: str = Query("10y")) -> JSONResponse:  # noqa: A002
        rk = range.lower()
        if rk not in VALID_RANGES:
            raise HTTPException(400, f"range must be one of {', '.join(VALID_RANGES)}")
        sym = symbol.upper().strip()
        try:
            res = service.prices(sym, rk)
        except NotFoundError:
            return _not_found(sym)
        except UpstreamDown as exc:
            return _upstream_down(exc)
        return _json(res.payload, res.cache)

    @app.get("/api/ticker/{symbol}/financials")
    def financials(symbol: str, freq: str = Query("annual")) -> JSONResponse:
        fq = freq.lower()
        if fq not in VALID_FREQS:
            raise HTTPException(400, f"freq must be one of {', '.join(VALID_FREQS)}")
        sym = symbol.upper().strip()
        try:
            res = service.financials(sym, fq)
        except NotFoundError:
            return _not_found(sym)
        except UpstreamDown as exc:
            return _upstream_down(exc)
        return _json(res.payload, res.cache)

    # ------------------------------------------------------------------ static (prod)
    dist = config.FRONTEND_DIST
    if dist.exists() and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str, request: Request):  # noqa: ARG001
            if full_path.startswith("api/"):
                raise HTTPException(404)
            candidate = dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
