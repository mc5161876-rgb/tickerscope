"""Pure-function tests for the yfinance mapping layer (no network)."""

import datetime as dt

import pandas as pd

from tickerscope.metrics import metric_ids
from tickerscope.yahoo import (
    build_metrics,
    build_quote,
    compute_financials,
    period_label,
)

from .conftest import load_fixture


def _frame(rows: dict[str, dict[str, float | None]]) -> pd.DataFrame:
    """rows: {row_name: {iso_date: value}} -> DataFrame with Timestamp columns like yfinance."""
    if not rows:
        return pd.DataFrame()
    cols = sorted({d for r in rows.values() for d in r}, reverse=True)
    data = {pd.Timestamp(c): [rows[r].get(c) for r in rows] for c in cols}
    return pd.DataFrame(data, index=list(rows))


def test_build_metrics_has_every_registry_id_even_when_info_is_empty():
    m = build_metrics({}, {})
    assert set(m) == set(metric_ids())
    assert m["pe_ttm"] is None
    assert m["fifty_two_week_range"] == {"low": None, "high": None}


def test_build_metrics_scales_percent_style_fields():
    info = {
        "debtToEquity": 78.445,  # Yahoo percent -> 0.78445x
        "dividendYield": 0.35,  # Yahoo percent number -> 0.0035 fraction
        "freeCashflow": 100.0,
        "marketCap": 4000.0,  # fcf_yield = 0.025
        "trailingPegRatio": None,
        "pegRatio": 2.47,  # fallback when trailingPegRatio is null
        "exDividendDate": 1786320000,  # 2026-08-10 UTC
    }
    m = build_metrics(info, {"Earnings Date": [dt.date(2026, 10, 29)]})
    assert abs(m["debt_to_equity"] - 0.78445) < 1e-9
    assert abs(m["dividend_yield"] - 0.0035) < 1e-9
    assert abs(m["fcf_yield"] - 0.025) < 1e-9
    assert m["peg"] == 2.47
    assert m["next_earnings_date"] == "2026-10-29"
    assert m["ex_dividend_date"] == "2026-08-10"


def test_build_quote_derives_change_when_missing():
    q = build_quote({"currentPrice": 110.0, "previousClose": 100.0, "currency": "USD"})
    assert q["change"] == 10.0
    assert abs(q["change_percent"] - 0.10) < 1e-9


def test_period_labels():
    assert period_label(dt.date(2025, 9, 30), "annual") == "FY2025"
    assert period_label(dt.date(2026, 6, 30), "quarterly") == "Q2 '26"
    assert period_label(dt.date(2026, 12, 31), "quarterly") == "Q4 '26"


def test_ebitda_reported_when_row_present():
    income = _frame(
        {
            "Total Revenue": {"2025-12-31": 100.0, "2024-12-31": 90.0},
            "EBITDA": {"2025-12-31": 30.0, "2024-12-31": 25.0},
            "Operating Income": {"2025-12-31": 20.0, "2024-12-31": 18.0},
        }
    )
    out = compute_financials(income, None, "annual")
    assert out["ebitda_method"] == "reported"
    assert [p["value"] for p in out["ebitda"]] == [25.0, 30.0]  # ascending by period_end
    assert [p["label"] for p in out["revenue"]] == ["FY2024", "FY2025"]


def test_ebitda_calculated_fallback_operating_income_plus_da():
    income = _frame(
        {
            "Total Revenue": {"2025-12-31": 100.0, "2024-12-31": 90.0},
            "Operating Income": {"2025-12-31": 20.0, "2024-12-31": 18.0},
        }
    )
    cashflow = _frame({"Depreciation And Amortization": {"2025-12-31": 5.0, "2024-12-31": 4.0}})
    out = compute_financials(income, cashflow, "annual")
    assert out["ebitda_method"] == "calculated"
    assert [p["value"] for p in out["ebitda"]] == [22.0, 25.0]


def test_ebitda_null_when_neither_available():
    income = _frame({"Total Revenue": {"2025-12-31": 100.0}})
    out = compute_financials(income, pd.DataFrame(), "annual")
    assert out["ebitda_method"] is None
    assert out["ebitda"] == []
    assert out["revenue"][0]["value"] == 100.0


def test_recorded_jpm_raw_rows_produce_null_ebitda_method():
    raw = load_fixture("JPM")["raw"]
    out = compute_financials(_frame(raw["income_annual"]), _frame(raw["cashflow_annual"]), "annual")
    assert out["ebitda_method"] is None
    assert len(out["revenue"]) >= 4


def test_recorded_aapl_raw_rows_reproduce_reported_ebitda():
    raw = load_fixture("AAPL")["raw"]
    out = compute_financials(_frame(raw["income_annual"]), _frame(raw["cashflow_annual"]), "annual")
    assert out["ebitda_method"] == "reported"
    fixture = load_fixture("AAPL")["financials_annual"]
    assert [p["value"] for p in out["ebitda"]] == [p["value"] for p in fixture["ebitda"]]
