"""SEC companyfacts 10-year series builder (MAR-49 AC-1) - fixture-backed, no network."""

import json
from pathlib import Path

import pytest

from tickerscope.sec.companyfacts import build_series, merge_with_yfinance

FIX = Path(__file__).parent / "fixtures"


def load(sym: str) -> dict:
    return json.loads((FIX / f"companyfacts_{sym}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("sym", ["AMZN", "MSFT", "JPM", "NFLX"])
def test_annual_revenue_has_at_least_nine_fiscal_years(sym):
    s = build_series(load(sym), "annual", 10)
    assert len(s["revenue"]) >= 9, sym
    ends = [p["period_end"] for p in s["revenue"]]
    assert ends == sorted(ends)
    for p in s["revenue"]:
        assert p["source"] == "sec" and p["method"] == "as_filed"
        assert p["accession"] and p["filed"] and p["form"] in {"10-K", "10-K/A", "20-F"}
        assert p["label"].startswith("FY")


def test_quarterly_series_is_capped_at_40_and_labelled():
    s = build_series(load("AMZN"), "quarterly", 40)
    assert 30 <= len(s["revenue"]) <= 40
    assert all(p["label"][0] == "Q" for p in s["revenue"])


def test_dedup_prefers_latest_filed_10k_for_a_period():
    facts = {
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 100,
                                "accn": "A-1",
                                "form": "10-K",
                                "filed": "2025-02-01",
                            },
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 105,
                                "accn": "A-2",
                                "form": "10-K",
                                "filed": "2026-02-01",
                            },  # restated, newer
                            {
                                "start": "2024-10-01",
                                "end": "2024-12-31",
                                "val": 30,
                                "accn": "A-1",
                                "form": "10-K",
                                "filed": "2025-02-01",
                            },  # a quarter, ignored for annual
                        ]
                    }
                }
            }
        }
    }
    s = build_series(facts, "annual", 10)
    assert [p["value"] for p in s["revenue"]] == [105.0]
    assert s["revenue"][0]["accession"] == "A-2"


def test_revenue_tag_priority_revenues_first():
    facts = {
        "facts": {
            "us-gaap": {
                "SalesRevenueNet": {
                    "units": {
                        "USD": [
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 1,
                                "accn": "S",
                                "form": "10-K",
                                "filed": "2025-02-01",
                            }
                        ]
                    }
                },
                "Revenues": {
                    "units": {
                        "USD": [
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 2,
                                "accn": "R",
                                "form": "10-K",
                                "filed": "2025-02-01",
                            }
                        ]
                    }
                },
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 3,
                                "accn": "C",
                                "form": "10-K",
                                "filed": "2025-02-01",
                            }
                        ]
                    }
                },
            }
        }
    }
    s = build_series(facts, "annual", 10)
    assert s["revenue"][0]["tag"] == "Revenues" and s["revenue"][0]["value"] == 2.0


def test_ebitda_is_calculated_operating_income_plus_da():
    base = {
        "start": "2024-01-01",
        "end": "2024-12-31",
        "accn": "X",
        "form": "10-K",
        "filed": "2025-02-01",
    }
    facts = {
        "facts": {
            "us-gaap": {
                "OperatingIncomeLoss": {"units": {"USD": [{**base, "val": 50}]}},
                "DepreciationDepletionAndAmortization": {"units": {"USD": [{**base, "val": 8}]}},
            }
        }
    }
    s = build_series(facts, "annual", 10)
    assert s["ebitda"] == [
        {
            "period_end": "2024-12-31",
            "period_start": "2024-01-01",
            "label": "FY2024",
            "value": 58.0,
            "source": "sec",
            "accession": "X",
            "filed": "2025-02-01",
            "form": "10-K",
            "method": "calculated",
            "tag": "OperatingIncomeLoss",
        }
    ]


def test_ebitda_split_da_needs_both_halves():
    base = {
        "start": "2024-01-01",
        "end": "2024-12-31",
        "accn": "X",
        "form": "10-K",
        "filed": "2025-02-01",
    }
    only_dep = {
        "facts": {
            "us-gaap": {
                "OperatingIncomeLoss": {"units": {"USD": [{**base, "val": 50}]}},
                "Depreciation": {"units": {"USD": [{**base, "val": 5}]}},
            }
        }
    }
    assert build_series(only_dep, "annual", 10)["ebitda"] == []
    both = {
        "facts": {
            "us-gaap": {
                "OperatingIncomeLoss": {"units": {"USD": [{**base, "val": 50}]}},
                "Depreciation": {"units": {"USD": [{**base, "val": 5}]}},
                "AmortizationOfIntangibleAssets": {"units": {"USD": [{**base, "val": 2}]}},
            }
        }
    }
    assert build_series(both, "annual", 10)["ebitda"][0]["value"] == 57.0


def test_bank_without_operating_income_has_no_sec_ebitda():
    assert build_series(load("JPM"), "annual", 10)["ebitda"] == []


def test_merge_sec_wins_and_yfinance_fills_gaps_marked():
    sec = [
        {
            "period_end": "2024-12-31",
            "label": "FY2024",
            "value": 100.0,
            "source": "sec",
            "method": "as_filed",
            "accession": "A",
            "filed": "2025-02-01",
            "form": "10-K",
            "tag": "Revenues",
            "period_start": "2024-01-01",
        }
    ]
    yf = [
        {"period_end": "2024-12-31", "label": "FY2024", "value": 99.0},  # same period -> SEC wins
        {
            "period_end": "2025-12-28",
            "label": "FY2025",
            "value": 120.0,
        },  # newer -> filled from yfinance
        {
            "period_end": "2024-12-28",
            "label": "FY2024",
            "value": 98.0,
        },  # 3 days off -> treated as same period
    ]
    merged = merge_with_yfinance(sec, yf, "as_filed")
    assert [(p["period_end"], p["value"], p["source"]) for p in merged] == [
        ("2024-12-31", 100.0, "sec"),
        ("2025-12-28", 120.0, "yfinance"),
    ]
    assert merged[1]["accession"] is None
