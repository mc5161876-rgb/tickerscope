"""10-year Revenue / EBITDA history from the SEC XBRL companyfacts API (MAR-49 AC-1).

Revenue tag priority (issue decision): Revenues ->
RevenueFromContractWithCustomerExcludingAssessedTax -> SalesRevenueNet, per fiscal period.
EBITDA is *calculated* = OperatingIncomeLoss + DepreciationDepletionAndAmortization
(or DepreciationAndAmortization).
Each period keeps the value from the latest-filed 10-K/10-Q (dedup by accession, newest wins).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Any

from ..yahoo import period_label

REVENUE_PRIORITY = (
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    # extra fallbacks seen in the wild (banks / older taxonomies); lower priority
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "RevenuesNetOfInterestExpense",
    "SalesRevenueGoodsNet",
)
OPERATING_INCOME_TAGS = ("OperatingIncomeLoss",)
# combined D&A concepts (issue decision); when an issuer files the two halves separately
# (MSFT: Depreciation + AmortizationOfIntangibleAssets) both must exist for the period.
DA_TAGS = (
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
)
DA_SPLIT_TAGS = ("Depreciation", "AmortizationOfIntangibleAssets")

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F"}
QUARTER_FORMS = {"10-Q", "10-Q/A"}
ANNUAL_DAYS = (330, 380)
QUARTER_DAYS = (80, 100)


def _days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def _facts(companyfacts: dict[str, Any], tag: str) -> list[dict[str, Any]]:
    node = companyfacts.get("facts", {}).get("us-gaap", {}).get(tag)
    if not node:
        return []
    units = node.get("units", {})
    # prefer USD; fall back to whatever single unit exists (foreign filers)
    if "USD" in units:
        return units["USD"]
    for _, values in units.items():
        return values
    return []


def _period_facts(companyfacts: dict[str, Any], tags: Iterable[str], freq: str) -> dict[str, dict]:
    """period_end -> best fact {value, accn, filed, form, tag, start, fy, fp}.

    Within a tag: for each period_end keep the newest-filed fact of the right duration/form.
    Across tags: first tag in priority order that has the period wins.
    """
    lo, hi = ANNUAL_DAYS if freq == "annual" else QUARTER_DAYS
    forms = ANNUAL_FORMS if freq == "annual" else QUARTER_FORMS | ANNUAL_FORMS
    out: dict[str, dict] = {}
    for tag in tags:
        per_end: dict[str, dict] = {}
        for f in _facts(companyfacts, tag):
            start, end = f.get("start"), f.get("end")
            if not start or not end or f.get("val") is None:
                continue
            try:
                d = _days(start, end)
            except ValueError:
                continue
            if not (lo <= d <= hi):
                continue
            if f.get("form") not in forms:
                continue
            filed = f.get("filed", "")
            cur = per_end.get(end)
            if (
                cur is None
                or filed > cur["filed"]
                or (filed == cur["filed"] and f.get("accn", "") > cur["accn"])
            ):
                per_end[end] = {
                    "value": float(f["val"]),
                    "accn": f.get("accn"),
                    "filed": filed,
                    "form": f.get("form"),
                    "tag": tag,
                    "start": start,
                    "fy": f.get("fy"),
                    "fp": f.get("fp"),
                    "frame": f.get("frame"),
                }
        for end, fact in per_end.items():
            out.setdefault(end, fact)
    return out


def _point(end: str, freq: str, value: float, fact: dict, method: str) -> dict[str, Any]:
    return {
        "period_end": end,
        "period_start": fact.get("start"),
        "label": period_label(date.fromisoformat(end), freq),
        "value": value,
        "source": "sec",
        "accession": fact.get("accn"),
        "filed": fact.get("filed"),
        "form": fact.get("form"),
        "method": method,
        "tag": fact.get("tag"),
    }


def build_series(companyfacts: dict[str, Any], freq: str, limit: int) -> dict[str, list[dict]]:
    """Return {'revenue': [...], 'ebitda': [...]}: newest `limit` periods, ascending."""
    freq = "quarterly" if freq == "quarterly" else "annual"
    revenue_facts = _period_facts(companyfacts, REVENUE_PRIORITY, freq)
    op_facts = _period_facts(companyfacts, OPERATING_INCOME_TAGS, freq)
    da_facts = _period_facts(companyfacts, DA_TAGS, freq)
    dep_facts = _period_facts(companyfacts, DA_SPLIT_TAGS[:1], freq)
    amort_facts = _period_facts(companyfacts, DA_SPLIT_TAGS[1:], freq)

    revenue = [_point(end, freq, f["value"], f, "as_filed") for end, f in revenue_facts.items()]
    ebitda = []
    for end, op in op_facts.items():
        da = da_facts.get(end)
        if da is not None:
            da_value = da["value"]
        elif end in dep_facts and end in amort_facts:
            da_value = dep_facts[end]["value"] + amort_facts[end]["value"]
        else:
            continue  # no faithful D&A for this period -> leave it to yfinance
        # OperatingIncomeLoss and D&A must come from the same period; keep provenance of the
        # operating income fact (the D&A fact usually shares the filing).
        ebitda.append(_point(end, freq, op["value"] + da_value, op, "calculated"))

    revenue.sort(key=lambda p: p["period_end"])
    ebitda.sort(key=lambda p: p["period_end"])
    return {"revenue": revenue[-limit:], "ebitda": ebitda[-limit:]}


def merge_with_yfinance(sec_points: list[dict], yf_points: list[dict], method: str) -> list[dict]:
    """SEC wins per period_end; yfinance fills the gaps (marked source: yfinance)."""
    by_end: dict[str, dict] = {p["period_end"]: p for p in sec_points}
    for p in yf_points:
        end = p["period_end"]
        if end in by_end:
            continue
        # tolerate fiscal period ends that differ by a few days between sources
        near = [e for e in by_end if abs(_days(*sorted((e, end)))) <= 7]
        if near:
            continue
        by_end[end] = {
            "period_end": end,
            "period_start": None,
            "label": p["label"],
            "value": p["value"],
            "source": "yfinance",
            "accession": None,
            "filed": None,
            "form": None,
            "method": method,
            "tag": None,
        }
    return sorted(by_end.values(), key=lambda q: q["period_end"])


def companyfacts_url(cik: str | int) -> str:
    return f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"
