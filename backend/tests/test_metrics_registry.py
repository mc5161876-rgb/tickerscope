"""AC-9: the registry is complete and every metric carries explainer copy."""

import re

from tickerscope.metrics import registry

REQUIRED_TEXT = ("what", "how_to_read", "example_template")
REQUIRED_FIELDS = ("id", "label", "group", "format", "source_key", *REQUIRED_TEXT)
KNOWN_FORMATS = {
    "currency",
    "currency_share",
    "ratio",
    "percent",
    "percent_signed",
    "number",
    "decimal",
    "date",
    "date_relative",
    "range",
}

# AC-6 order, exactly
EXPECTED_ORDER = [
    (
        "price_size",
        [
            "market_cap",
            "enterprise_value",
            "fifty_two_week_range",
            "avg_volume_3m",
            "beta",
            "shares_outstanding",
        ],
    ),
    (
        "valuation",
        [
            "pe_ttm",
            "forward_pe",
            "peg",
            "price_to_sales",
            "price_to_book",
            "ev_ebitda",
            "ev_revenue",
        ],
    ),
    (
        "profitability",
        [
            "revenue_ttm",
            "revenue_growth",
            "gross_margin",
            "operating_margin",
            "net_margin",
            "ebitda_ttm",
            "net_income_ttm",
            "eps_ttm",
            "forward_eps",
            "roe",
            "roa",
        ],
    ),
    (
        "cash_flow",
        [
            "operating_cash_flow",
            "free_cash_flow",
            "fcf_yield",
            "total_cash",
            "total_debt",
            "debt_to_equity",
            "current_ratio",
        ],
    ),
    (
        "dividends_dates",
        ["dividend_yield", "payout_ratio", "next_earnings_date", "ex_dividend_date"],
    ),
]


def test_every_metric_has_all_fields_non_empty():
    problems = []
    for m in registry()["metrics"]:
        for f in REQUIRED_FIELDS:
            if not str(m.get(f, "")).strip():
                problems.append(f"{m.get('id', '?')}.{f}")
    assert problems == [], f"missing/empty fields: {problems}"


def test_formats_are_known_and_groups_exist():
    reg = registry()
    group_ids = {g["id"] for g in reg["groups"]}
    for m in reg["metrics"]:
        assert m["format"] in KNOWN_FORMATS, m["id"]
        assert m["group"] in group_ids, m["id"]


def test_ac6_groups_and_order():
    reg = registry()
    by_group: dict[str, list[str]] = {}
    for m in reg["metrics"]:
        by_group.setdefault(m["group"], []).append(m["id"])
    assert [g["id"] for g in reg["groups"]] == [g for g, _ in EXPECTED_ORDER]
    for g, ids in EXPECTED_ORDER:
        assert by_group[g] == ids, g


def test_example_templates_use_ticker_and_value_and_are_sentences():
    for m in registry()["metrics"]:
        t = m["example_template"]
        assert "{ticker}" in t, m["id"]
        assert "{value" in t, m["id"]
        assert t.rstrip().endswith("."), m["id"]
        # only the three documented placeholders
        assert set(re.findall(r"\{(\w+)\}", t)) <= {"ticker", "value", "value_int"}, m["id"]


def test_ids_are_unique_snake_case():
    ids = [m["id"] for m in registry()["metrics"]]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z][a-z0-9_]*", i) for i in ids)
