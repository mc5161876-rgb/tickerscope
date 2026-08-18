"""TickerScope API (AC-16) + static hosting of the built frontend."""

from __future__ import annotations

import datetime as dt
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, yahoo
from .cache import DiskCache
from .metrics import registry
from .search import SearchIndex
from .sec.client import sec_configured, sec_user_agent
from .sec.companyfacts import merge_with_yfinance
from .sec.service import SecService
from .service import TickerService, UpstreamDown
from .watchlist import WatchlistError, WatchlistStore
from .yahoo import NotFoundError

log = logging.getLogger("tickerscope")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

VALID_RANGES = ("1y", "5y", "10y", "max")
VALID_FREQS = ("annual", "quarterly")
_BODY = Body(...)


def create_app(
    cache: DiskCache | None = None,
    fetcher: Any = yahoo,
    search_index: SearchIndex | None = None,
    load_index_on_startup: bool = True,
    sec_service: SecService | None = None,
    watchlist: WatchlistStore | None = None,
) -> FastAPI:
    cache = cache or DiskCache(config.cache_dir())
    index = search_index or SearchIndex(cache)
    service = TickerService(cache, fetcher)
    wl = watchlist or WatchlistStore(config.data_dir() / "watchlist.json")

    def resolve_cik(symbol: str) -> str | None:
        if index.size == 0:
            index.load()
        c = index.lookup(symbol)
        return str(c.cik).zfill(10) if c and c.cik else None

    sec = sec_service or SecService(cache, resolve_cik)

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
    app.state.sec = sec
    app.state.watchlist = wl

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
        ua = sec_user_agent()
        return {
            "status": "ok",
            "data_mode": "force_fail" if config.force_fail() else "live",
            "yfinance_version": yahoo.yfinance_version(),
            "search_index_size": index.size,
            "version": __version__,
            "sec_configured": sec_configured(),
            # contact string, not a secret - but only echo whether it is set + a hint
            "sec_user_agent_hint": (ua[:24] + "…") if ua and len(ua) > 24 else ua,
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
        """yfinance financials merged with SEC companyfacts history (MAR-49 AC-1).

        SEC wins per period; yfinance fills the gaps (source marked). SEC not configured /
        not a filer / SEC down -> yfinance only, with `sec.status` explaining why.
        """
        fq = freq.lower()
        if fq not in VALID_FREQS:
            raise HTTPException(400, f"freq must be one of {', '.join(VALID_FREQS)}")
        sym = symbol.upper().strip()
        yf_payload: dict[str, Any] | None = None
        yf_error: UpstreamDown | None = None
        cache_status = "miss"
        try:
            res = service.financials(sym, fq)
            yf_payload, cache_status = res.payload, res.cache
        except NotFoundError:
            return _not_found(sym)
        except UpstreamDown as exc:
            yf_error = exc

        sec_series = sec.series(sym, fq)
        sec_ok = sec_series.get("status") == "ok" and (
            sec_series["revenue"] or sec_series["ebitda"]
        )
        if yf_payload is None and not sec_ok:
            assert yf_error is not None
            return _upstream_down(yf_error)

        base = yf_payload or {
            "symbol": sym,
            "freq": fq,
            "currency": None,
            "revenue": [],
            "ebitda": [],
            "ebitda_method": None,
        }
        yf_rev = [
            {**p, "source": "yfinance", "method": "as_filed"} for p in base.get("revenue", [])
        ]
        yf_method = "calculated" if base.get("ebitda_method") == "calculated" else "as_filed"
        yf_ebitda = [
            {**p, "source": "yfinance", "method": yf_method} for p in base.get("ebitda", [])
        ]
        if sec_ok:
            revenue = merge_with_yfinance(sec_series["revenue"], yf_rev, "as_filed")
            ebitda = merge_with_yfinance(sec_series["ebitda"], yf_ebitda, yf_method)
            method = "calculated" if sec_series["ebitda"] else base.get("ebitda_method")
        else:
            revenue, ebitda, method = yf_rev, yf_ebitda, base.get("ebitda_method")
        limit = config.SEC_ANNUAL_YEARS if fq == "annual" else config.SEC_QUARTERS
        payload = {
            **base,
            "revenue": revenue[-limit:],
            "ebitda": ebitda[-limit:],
            "ebitda_method": method,
            "sec": {
                "status": sec_series.get("status"),
                "message": sec_series.get("message"),
                "cik": sec_series.get("cik"),
            },
        }
        if yf_error is not None:
            payload["warnings"] = ["yfinance unavailable; showing SEC history only"]
        return _json(payload, cache_status)

    # ------------------------------------------------------------------ watchlist (MAR-50)
    def _wl_payload(items: list[dict[str, Any]]) -> dict[str, Any]:
        return {"items": items, "count": len(items), "max": 100}

    @app.get("/api/watchlist")
    def watchlist_get() -> dict[str, Any]:
        return _wl_payload(wl.list())

    @app.put("/api/watchlist")
    def watchlist_put(body: dict[str, Any] = _BODY) -> JSONResponse:
        tickers = body.get("tickers") if isinstance(body, dict) else None
        if not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            raise HTTPException(400, 'body must be {tickers: ["AAPL", ...]}')
        try:
            items = wl.replace(tickers)
        except WatchlistError as exc:
            return JSONResponse({"error": "invalid_watchlist", "detail": str(exc)}, status_code=422)
        return JSONResponse(_wl_payload(items))

    @app.post("/api/watchlist/{ticker}")
    def watchlist_add(ticker: str) -> JSONResponse:
        try:
            items, added = wl.add(ticker)
        except WatchlistError as exc:
            return JSONResponse({"error": "invalid_ticker", "detail": str(exc)}, status_code=422)
        return JSONResponse(
            {**_wl_payload(items), "added": added}, status_code=201 if added else 200
        )

    @app.delete("/api/watchlist/{ticker}")
    def watchlist_remove(ticker: str) -> JSONResponse:
        try:
            items, removed = wl.remove(ticker)
        except WatchlistError as exc:
            return JSONResponse({"error": "invalid_ticker", "detail": str(exc)}, status_code=422)
        return JSONResponse({**_wl_payload(items), "removed": removed})

    @app.get("/api/quotes")
    def quotes(symbols: str = Query("", max_length=1200)) -> JSONResponse:
        """Batched quotes for the watchlist (AC-2): one fetcher call for every uncached symbol."""
        syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not syms:
            return _json({"quotes": {}, "stale": []}, "hit")
        if len(syms) > 100:
            raise HTTPException(400, "at most 100 symbols")
        try:
            res = service.quotes(syms)
        except UpstreamDown as exc:
            return _upstream_down(exc)
        return _json({"quotes": res["quotes"], "stale": res["stale"]}, res["cache"])

    @app.get("/api/ticker/{symbol}/segments")
    def segments(symbol: str, freq: str = Query("annual")) -> JSONResponse:
        """Revenue by Segment contract per period (MAR-49 AC-3)."""
        fq = freq.lower()
        if fq not in VALID_FREQS:
            raise HTTPException(400, f"freq must be one of {', '.join(VALID_FREQS)}")
        sym = symbol.upper().strip()
        env = sec.segments(sym, fq)
        status = env.get("status")
        if status == "not_configured":
            return _json(env, "miss", status_code=503)
        if status == "not_found":
            return _json(env, "miss", status_code=404)
        if status == "error":
            return _json(env, "miss", status_code=503)
        return _json(env, "hit" if env.get("generated_at") else "miss")

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
