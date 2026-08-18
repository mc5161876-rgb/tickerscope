"""Record yfinance-derived fixtures for the offline test suite.

Run once from the repo root (needs network):  uv run python scripts/record_fixtures.py
Writes backend/tests/fixtures/<SYM>.json with the normalized fetcher outputs plus the
raw income-statement / cashflow rows the EBITDA fallback tests need.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import pandas as pd  # noqa: E402
import yfinance as yf  # noqa: E402

from tickerscope import yahoo  # noqa: E402

FIXTURES = ROOT / "backend" / "tests" / "fixtures"
SYMBOLS = sys.argv[1:] or ["AAPL", "NVDA", "JPM"]

RAW_ROWS = [
    "Total Revenue",
    "Operating Revenue",
    "EBITDA",
    "Operating Income",
    "Total Operating Income As Reported",
    "Reconciled Depreciation",
    "Depreciation And Amortization",
    "Depreciation Amortization Depletion",
]


def frame_rows(df: pd.DataFrame | None) -> dict:
    """Serialize only the rows we care about: {row: {iso_date: value}}."""
    out: dict = {}
    if df is None or df.empty:
        return out
    for name in RAW_ROWS:
        if name in df.index:
            s = df.loc[name]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[0]
            out[name] = {
                pd.Timestamp(c).date().isoformat(): (None if pd.isna(v) else float(v))
                for c, v in s.items()
            }
    return out


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for sym in SYMBOLS:
        print(f"recording {sym} ...", flush=True)
        t = yf.Ticker(sym)
        record = {
            "symbol": sym,
            "ticker": yahoo.fetch_profile_and_metrics(sym),
            "prices_1y": yahoo.fetch_prices(sym, "1y"),
            "financials_annual": yahoo.fetch_financials(sym, "annual"),
            "financials_quarterly": yahoo.fetch_financials(sym, "quarterly"),
            "raw": {
                "income_annual": frame_rows(t.income_stmt),
                "cashflow_annual": frame_rows(t.cashflow),
                "income_quarterly": frame_rows(t.quarterly_income_stmt),
                "cashflow_quarterly": frame_rows(t.quarterly_cashflow),
            },
        }
        # trim the 1y price series to keep fixtures small
        pts = record["prices_1y"]["points"]
        record["prices_1y"]["points"] = pts[-30:]
        path = FIXTURES / f"{sym}.json"
        path.write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
        m = record["ticker"]["metrics"]
        nulls = [k for k, v in m.items() if v is None]
        print(
            f"  ok -> {path.name}: price={record['ticker']['quote']['price']} "
            f"ebitda_method={record['financials_annual']['ebitda_method']} "
            f"annual_periods={len(record['financials_annual']['revenue'])} "
            f"nulls={nulls}"
        )


if __name__ == "__main__":
    main()
