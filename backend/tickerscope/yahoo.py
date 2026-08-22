"""The ONLY module that imports yfinance. If Yahoo changes, this is the one-file fix.

Public surface (all raise DataSourceError on upstream failure, NotFoundError on unknown ticker):
    fetch_profile_and_metrics(symbol) -> {profile, quote, metrics, as_of}
    fetch_prices(symbol, range_key)   -> {symbol, range, currency, points:[{date, close}], sampled}
    fetch_financials(symbol, freq)    -> {symbol, freq, currency, revenue, ebitda, ebitda_method}
    yfinance_version()               -> str
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

import pandas as pd
import yfinance as yf

from . import config
from .metrics import registry

RANGE_TO_PERIOD = {"1y": "1y", "5y": "5y", "10y": "10y", "max": "max"}
MAX_POINTS = 2600  # keep the Max range from shipping 11k daily points to the browser


class DataSourceError(Exception):
    """Yahoo unreachable / errored / timed out."""


class NotFoundError(Exception):
    """Ticker unknown to Yahoo."""


def yfinance_version() -> str:
    return getattr(yf, "__version__", "unknown")


# --------------------------------------------------------------------------- helpers
def _num(v: Any) -> float | None:
    """Coerce numpy/pandas scalars to plain float; NaN/inf/None -> None."""
    if v is None:
        return None
    try:
        if isinstance(v, bool):
            return float(v)
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _int(v: Any) -> int | None:
    f = _num(v)
    return int(f) if f is not None else None


def _epoch_to_date(v: Any) -> str | None:
    f = _num(v)
    if f is None:
        return None
    try:
        return dt.datetime.fromtimestamp(f, tz=dt.UTC).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _epoch_to_iso(v: Any) -> str | None:
    f = _num(v)
    if f is None:
        return None
    try:
        return dt.datetime.fromtimestamp(f, tz=dt.UTC).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def _date_to_iso(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        v = v[0] if v else None
        if v is None:
            return None
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, str):
        return v[:10]
    return None


def _guard() -> None:
    if config.force_fail():
        raise DataSourceError("TICKERSCOPE_FORCE_FAIL is set")


def _ticker(symbol: str) -> Any:
    return yf.Ticker(symbol.upper().strip())


def _load_info(symbol: str) -> dict[str, Any]:
    _guard()
    try:
        info = _ticker(symbol).info or {}
    except Exception as exc:  # noqa: BLE001 - yfinance raises many things
        msg = str(exc)
        if "404" in msg or "not found" in msg.lower() or "delisted" in msg.lower():
            raise NotFoundError(symbol) from exc
        raise DataSourceError(msg) from exc
    if not isinstance(info, dict):
        raise DataSourceError("unexpected info payload")
    has_price = _num(info.get("regularMarketPrice") or info.get("currentPrice")) is not None
    has_name = bool(info.get("shortName") or info.get("longName"))
    if not has_price and not has_name:
        raise NotFoundError(symbol)
    return info


# --------------------------------------------------------------------------- metrics
def build_metrics(info: dict[str, Any], calendar: dict[str, Any] | None = None) -> dict[str, Any]:
    """Map yfinance `info` onto the shared/metrics.json ids. Every id is present, nullable."""
    calendar = calendar or {}
    out: dict[str, Any] = {}
    market_cap = _num(info.get("marketCap"))
    fcf = _num(info.get("freeCashflow"))
    for m in registry()["metrics"]:
        mid = m["id"]
        src = m["source_key"]
        if mid == "fifty_two_week_range":
            out[mid] = {
                "low": _num(info.get("fiftyTwoWeekLow")),
                "high": _num(info.get("fiftyTwoWeekHigh")),
            }
        elif mid == "peg":
            out[mid] = _num(info.get("trailingPegRatio"))
            if out[mid] is None:
                out[mid] = _num(info.get("pegRatio"))
        elif mid == "fcf_yield":
            out[mid] = (fcf / market_cap) if (fcf is not None and market_cap) else None
        elif mid == "debt_to_equity":
            # Yahoo reports this as a percentage (78.4 == 0.784x)
            v = _num(info.get("debtToEquity"))
            out[mid] = (v / 100.0) if v is not None else None
        elif mid == "dividend_yield":
            # yfinance 0.2.6x: `dividendYield` is a percent number (0.35 == 0.35%).
            # Store every percent-format metric as a fraction so the frontend formats uniformly.
            v = _num(info.get("dividendYield"))
            if v is not None:
                out[mid] = v / 100.0
            else:
                out[mid] = _num(info.get("trailingAnnualDividendYield"))
        elif mid == "next_earnings_date":
            d = _date_to_iso(calendar.get("Earnings Date"))
            if d is None:
                d = _epoch_to_date(
                    info.get("earningsTimestampStart") or info.get("earningsTimestamp")
                )
            out[mid] = d
        elif mid == "ex_dividend_date":
            d = _date_to_iso(calendar.get("Ex-Dividend Date"))
            if d is None:
                d = _epoch_to_date(info.get("exDividendDate"))
            out[mid] = d
        elif mid in {"shares_outstanding", "avg_volume_3m"}:
            out[mid] = _int(info.get(src.split(",")[0]))
        else:
            out[mid] = _num(info.get(src.split(",")[0]))
    return out


def build_profile(info: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": (info.get("symbol") or "").upper() or None,
        "name": info.get("longName") or info.get("shortName"),
        "short_name": info.get("shortName"),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "exchange_code": info.get("exchange"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "description": info.get("longBusinessSummary"),
        "employees": _int(info.get("fullTimeEmployees")),
        "city": info.get("city"),
        "state": info.get("state"),
        "country": info.get("country"),
        "website": info.get("website"),
        "currency": info.get("currency") or info.get("financialCurrency"),
        "quote_type": info.get("quoteType"),
    }


def build_quote(info: dict[str, Any]) -> dict[str, Any]:
    price = _num(info.get("currentPrice"))
    if price is None:
        price = _num(info.get("regularMarketPrice"))
    prev = _num(info.get("regularMarketPreviousClose"))
    if prev is None:
        prev = _num(info.get("previousClose"))
    change = _num(info.get("regularMarketChange"))
    change_pct = _num(info.get("regularMarketChangePercent"))
    if change is None and price is not None and prev is not None:
        change = price - prev
    if change_pct is not None:
        change_pct = change_pct / 100.0  # Yahoo gives percent number
    elif change is not None and prev:
        change_pct = change / prev
    return {
        "price": price,
        "previous_close": prev,
        "change": change,
        "change_percent": change_pct,
        "currency": info.get("currency"),
        "market_time": _epoch_to_iso(info.get("regularMarketTime")),
        "market_state": info.get("marketState"),
    }


def fetch_profile_and_metrics(symbol: str) -> dict[str, Any]:
    info = _load_info(symbol)
    try:
        cal = _ticker(symbol).calendar or {}
    except Exception:  # noqa: BLE001 - calendar is optional
        cal = {}
    now = dt.datetime.now(tz=dt.UTC).isoformat().replace("+00:00", "Z")
    quote = build_quote(info)
    return {
        "symbol": symbol.upper(),
        "profile": build_profile(info),
        "quote": quote,
        "metrics": build_metrics(info, cal),
        "as_of": quote["market_time"] or now,
        "fetched_at": now,
    }


# --------------------------------------------------------------------------- batched quotes
def fetch_quotes(symbols: list[str], max_workers: int = 6) -> dict[str, dict[str, Any] | None]:
    """One batched call for a watchlist (MAR-50 AC-2): a single `yf.Tickers` object, per-symbol
    payloads pulled concurrently. Returns {SYMBOL: ticker payload | None (unknown / failed)}.
    Raises DataSourceError only when *every* symbol fails (Yahoo down), so one bad ticker never
    blanks the list.
    """
    _guard()
    syms = [s.upper().strip() for s in symbols if s and s.strip()]
    if not syms:
        return {}
    try:
        batch = yf.Tickers(" ".join(syms))
    except Exception as exc:  # noqa: BLE001
        raise DataSourceError(str(exc)) from exc

    def one(sym: str) -> tuple[str, dict[str, Any] | None, Exception | None]:
        try:
            t = batch.tickers.get(sym) or yf.Ticker(sym)
            info = t.info or {}
            has_price = _num(info.get("regularMarketPrice") or info.get("currentPrice")) is not None
            has_name = bool(info.get("shortName") or info.get("longName"))
            if not has_price and not has_name:
                return sym, None, None
            try:
                cal = t.calendar or {}
            except Exception:  # noqa: BLE001
                cal = {}
            now = dt.datetime.now(tz=dt.UTC).isoformat().replace("+00:00", "Z")
            quote = build_quote(info)
            return (
                sym,
                {
                    "symbol": sym,
                    "profile": build_profile(info),
                    "quote": quote,
                    "metrics": build_metrics(info, cal),
                    "as_of": quote["market_time"] or now,
                    "fetched_at": now,
                },
                None,
            )
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "404" in msg or "not found" in msg.lower():
                return sym, None, None
            return sym, None, exc

    from concurrent.futures import ThreadPoolExecutor

    out: dict[str, dict[str, Any] | None] = {}
    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for sym, payload, err in pool.map(one, syms):
            out[sym] = payload
            if err is not None:
                errors.append(err)
    if errors and len(errors) == len(syms):
        raise DataSourceError(str(errors[0]))
    return out


# --------------------------------------------------------------------------- prices
def fetch_prices(symbol: str, range_key: str) -> dict[str, Any]:
    _guard()
    period = RANGE_TO_PERIOD.get(range_key, "10y")
    try:
        t = _ticker(symbol)
        hist = t.history(period=period, auto_adjust=True)
        currency = None
        try:
            currency = t.fast_info.get("currency")
        except Exception:  # noqa: BLE001
            currency = None
    except Exception as exc:  # noqa: BLE001
        raise DataSourceError(str(exc)) from exc
    if hist is None or hist.empty:
        # a real ticker with no price history is treated as unknown for the price panel
        raise NotFoundError(symbol)
    closes = hist["Close"].dropna()
    points = [
        {"date": idx.date().isoformat(), "close": round(float(v), 4)} for idx, v in closes.items()
    ]
    sampled = False
    if len(points) > MAX_POINTS:
        step = math.ceil(len(points) / MAX_POINTS)
        last = points[-1]
        points = points[::step]
        if points[-1] is not last:
            points.append(last)
        sampled = True
    return {
        "symbol": symbol.upper(),
        "range": range_key,
        "currency": currency,
        "points": points,
        "sampled": sampled,
    }


# --------------------------------------------------------------------------- financials
def _row(df: pd.DataFrame | None, *names: str) -> pd.Series | None:
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            s = df.loc[n]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[0]
            if s.notna().any():
                return s
    return None


def period_label(period_end: dt.date, freq: str) -> str:
    if freq == "quarterly":
        q = (period_end.month - 1) // 3 + 1
        return f"Q{q} '{period_end.strftime('%y')}"
    return f"FY{period_end.year}"


def _series_points(s: pd.Series | None, freq: str) -> list[dict[str, Any]]:
    if s is None:
        return []
    out = []
    for col, v in s.items():
        val = _num(v)
        if val is None:
            continue
        pe = pd.Timestamp(col).date()
        out.append({"period_end": pe.isoformat(), "label": period_label(pe, freq), "value": val})
    out.sort(key=lambda p: p["period_end"])
    return out


def compute_financials(
    income: pd.DataFrame | None, cashflow: pd.DataFrame | None, freq: str
) -> dict[str, Any]:
    """Pure function so tests can feed frames without the network."""
    revenue = _series_points(_row(income, "Total Revenue", "Operating Revenue"), freq)
    ebitda_row = _row(income, "EBITDA")
    method: str | None = None
    ebitda: list[dict[str, Any]] = []
    if ebitda_row is not None:
        method = "reported"
        ebitda = _series_points(ebitda_row, freq)
    else:
        op = _row(income, "Operating Income", "Total Operating Income As Reported")
        da = _row(income, "Reconciled Depreciation")
        if da is None:
            da = _row(
                cashflow, "Depreciation And Amortization", "Depreciation Amortization Depletion"
            )
        if op is not None and da is not None:
            method = "calculated"
            common = [c for c in op.index if c in da.index]
            if common:
                summed = op[common].astype(float) + da[common].astype(float)
                ebitda = _series_points(summed, freq)
        if not ebitda:
            method = None

    ocf = _series_points(
        _row(cashflow, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities"),
        freq,
    )
    # yfinance reports capex as a negative outflow. The chart reads as "cash spent", so flip
    # the sign here and say so in the card subtitle -- a red bar would imply capex is a loss.
    capex_row = _row(cashflow, "Capital Expenditure", "Purchase Of PPE")
    capex = [{**pt, "value": abs(pt["value"])} for pt in _series_points(capex_row, freq)]

    fcf_row = _row(cashflow, "Free Cash Flow")
    fcf_method: str | None = None
    fcf: list[dict[str, Any]] = []
    if fcf_row is not None:
        fcf_method = "reported"
        fcf = _series_points(fcf_row, freq)
    elif ocf and capex:
        # operating cash flow less capital expenditure, matched period by period
        spend = {pt["period_end"]: pt["value"] for pt in capex}
        fcf = [
            {**pt, "value": pt["value"] - spend[pt["period_end"]]}
            for pt in ocf
            if pt["period_end"] in spend
        ]
        if fcf:
            fcf_method = "calculated"
    if not fcf:
        fcf_method = None

    net_income = _series_points(
        _row(
            income,
            "Net Income",
            "Net Income Common Stockholders",
            "Net Income From Continuing Operations",
        ),
        freq,
    )

    return {
        "revenue": revenue,
        "ebitda": ebitda,
        "ebitda_method": method,
        "operating_cash_flow": ocf,
        "free_cash_flow": fcf,
        "free_cash_flow_method": fcf_method,
        "capital_expenditure": capex,
        "net_income": net_income,
    }


def fetch_financials(symbol: str, freq: str) -> dict[str, Any]:
    _guard()
    freq = "quarterly" if freq == "quarterly" else "annual"
    try:
        t = _ticker(symbol)
        if freq == "quarterly":
            income = t.quarterly_income_stmt
            cashflow = t.quarterly_cashflow
        else:
            income = t.income_stmt
            cashflow = t.cashflow
        currency = None
        try:
            currency = t.fast_info.get("currency")
        except Exception:  # noqa: BLE001
            currency = None
    except Exception as exc:  # noqa: BLE001
        raise DataSourceError(str(exc)) from exc
    body = compute_financials(income, cashflow, freq)
    if not body["revenue"] and (income is None or income.empty):
        # yfinance returns an empty frame for unknown symbols
        try:
            _load_info(symbol)  # raises NotFoundError for unknown tickers
        except NotFoundError:
            raise
        except DataSourceError:
            pass
    return {"symbol": symbol.upper(), "freq": freq, "currency": currency, **body}
