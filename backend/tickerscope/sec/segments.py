"""Revenue by Segment: walk a decade of filings and emit the ported contract per period (AC-3).

Coverage-state contract (traderscope docs/API_CONTRACT_V1.md, reused verbatim):
  as_filed | as_filed_with_bridge -> stacked ; needs_review | withheld_alternative -> withheld ;
  single_segment -> single_segment ; plus `unavailable` for anything else.
Never draw a fabricated or one-slice stack; never let a geography/product view silently
replace a failed business-segment view (it is offered under its real label in `alternative`).
"""

from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any

from .. import config
from .client import Fetcher, edgar_filing_url
from .extractor import (
    ANNUAL_DAYS,
    QUARTER_DAYS,
    FilingFacts,
    FilingRef,
    alternative_kind,
    axis_priority,
    concept_local,
    evaluate_period,
    filings_since,
    parse_filing,
)


def axis_priority_local(axis_local: str) -> int:
    """axis_priority() accepts either a QName or a local name; keep the call site readable."""
    return axis_priority(axis_local)


DEFINITIVE = {"AS_FILED", "SINGLE_SEGMENT", "NEEDS_REVIEW"}
STATE_RENDER = {
    "as_filed": "stacked",
    "as_filed_with_bridge": "stacked",
    "needs_review": "withheld",
    "withheld_alternative": "withheld",
    "single_segment": "single_segment",
    "unavailable": "unavailable",
}


def coverage_state(row: dict) -> str:
    status = row.get("status")
    if status == "AS_FILED":
        return (
            "as_filed_with_bridge"
            if row.get("chart", {}).get("consolidation_bridge")
            else "as_filed"
        )
    if status == "NEEDS_REVIEW":
        return "withheld_alternative" if row.get("alternative") else "needs_review"
    if status == "SINGLE_SEGMENT":
        return "single_segment"
    return "unavailable"


def state_message(row: dict, state: str, company: str | None) -> str | None:
    if state == "single_segment":
        who = company or "This company"
        return f"{who} reports one operating segment, so there is no segment breakdown to chart."
    if state == "withheld_alternative":
        label = row["alternative"]["label"]
        return (
            "The filed business-segment breakdown did not reconcile to total revenue, so it is "
            f"withheld. A reconciled {label.lower()} view is shown instead."
        )
    if state == "needs_review":
        delta = row.get("delta_pct")
        coverage = 100 - delta if isinstance(delta, int | float) else None
        tail = f" It accounts for {coverage:.1f}% of total revenue." if coverage is not None else ""
        return (
            "Segment breakdown withheld - the filed segments did not reconcile to the filed total."
            + tail
        )
    if state == "unavailable":
        return row.get("reason") or "Not available"
    return None


def period_entry(row: dict, freq: str, company: str | None, cik: str) -> dict[str, Any]:
    """Map one evaluated extractor row to a contract period entry."""
    from ..yahoo import period_label  # local import to keep module import light

    state = coverage_state(row)
    chart = dict(row.get("chart") or {})
    end = row.get("period_end")
    label = period_label(dt.date.fromisoformat(end), freq) if end else None
    rows = list(chart.get("rows", [])) if STATE_RENDER[state] == "stacked" else []
    # Which view is being drawn? Business segments normally; but when an issuer files no
    # reportable-business axis for a period and a geography/product axis reconciles instead, the
    # extractor selects that axis as primary. Never let it pass as "segments": retype the rows to
    # the axis's real semantics and label the view honestly (accuracy rule in the issue).
    axis = row.get("axis") or ""
    view_kind, view_label = "business", "Revenue by Segment"
    if state in {"as_filed", "as_filed_with_bridge"} and axis and axis_priority_local(axis) > 0:
        view_kind, view_label, row_type = alternative_kind(axis)
        rows = [{**r, "type": row_type} if r["type"] == "reportable_segment" else r for r in rows]
    entry: dict[str, Any] = {
        "period_start": row.get("period_start"),
        "period_end": end,
        "label": label,
        "coverage_state": state,
        "render_mode": STATE_RENDER[state],
        "view": {"kind": view_kind, "label": view_label},
        "rows": rows,
        "consolidation_bridge": chart.get("consolidation_bridge", []),
        "signed_bridge_total": chart.get("signed_bridge_total", 0),
        "positive_stack_total": chart.get("positive_stack_total"),
        "calculated_total": chart.get("calculated_total"),
        "consolidated_total": chart.get("consolidated_total", row.get("consolidated")),
        "reconciliation_delta_pct": chart.get("reconciliation_delta_pct", row.get("delta_pct")),
        "reportable_segment_count": chart.get("reportable_segment_count", 0),
        "provenance": {
            "form": row.get("form"),
            "accession": row.get("accn"),
            "filed": row.get("filed"),
            "axis": row.get("axis"),
            "cik": cik,
            "edgar_url": edgar_filing_url(cik, row["accn"]) if row.get("accn") else None,
        },
    }
    msg = state_message(row, state, company)
    if view_kind != "business" and not msg:
        msg = (
            "No reportable business-segment breakdown was filed for this period; "
            f"showing the filed {view_label.lower()} instead."
        )
    if msg:
        entry["message"] = msg
    if row.get("alternative"):
        entry["alternative"] = row["alternative"]
    if row.get("single_segment_fact"):
        entry["single_segment_fact"] = row["single_segment_fact"]
    return entry


def _norm(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (label or "").lower().replace("&", "and"))


def detect_resegmentation(periods: list[dict]) -> list[str]:
    """period_end of every drawable period whose reportable-segment member set differs from the
    previous drawable period of the same view kind (ascending order). Corporate / bridge rows and
    view switches (business -> geography) are not re-segmentations."""
    marks: list[str] = []
    prev: set[str] | None = None
    prev_kind: str | None = None
    for p in periods:
        if p["render_mode"] != "stacked":
            continue
        kind = p.get("view", {}).get("kind", "business")
        # compare on normalised labels, not concepts: issuers rename member concepts across
        # filings ("CorporateInvestmentBankMember" -> "CorporateAndInvestmentBankMember") while
        # the segment itself is unchanged; a real re-segmentation changes the labels too.
        members = {_norm(r["label"]) for r in p["rows"] if r["type"] == "reportable_segment"}
        if kind != "business":
            prev, prev_kind = None, kind
            continue
        if prev is not None and prev_kind == "business" and members != prev:
            marks.append(p["period_end"])
        prev, prev_kind = members, kind
    return marks


def build_legend(periods: list[dict]) -> list[dict]:
    """Union of stack concepts across periods (newest label wins); corporate rows last."""
    seen: dict[str, dict] = {}
    for p in reversed(periods):  # newest first so its label wins
        rows = p["rows"] if p["render_mode"] == "stacked" else []
        if p.get("alternative"):
            rows = rows + p["alternative"].get("rows", [])
        for r in rows:
            if r["concept"] not in seen:
                seen[r["concept"]] = {
                    "concept": r["concept"],
                    "label": r["label"],
                    "type": r["type"],
                }
    order = {
        "reportable_segment": 0,
        "geographic_region": 1,
        "product_service": 1,
        "breakdown_component": 1,
        "corporate_nonsegment": 2,
    }
    return sorted(seen.values(), key=lambda x: (order.get(x["type"], 3), x["label"]))


def _since(years: int) -> str:
    return (dt.date.today() - dt.timedelta(days=int(365.25 * years) + 45)).isoformat()


def build_segments(
    fetcher: Fetcher,
    symbol: str,
    cik: str,
    freq: str,
    *,
    annual_years: int = config.SEC_ANNUAL_YEARS,
    quarter_years: int = config.SEC_SEGMENT_QUARTER_YEARS,
    diagnostics_dir=None,
) -> dict[str, Any]:
    """Segments envelope for one ticker. Raises SecError/SecNotConfigured from the fetcher."""
    freq = "quarterly" if freq == "quarterly" else "annual"
    cik10 = str(cik).zfill(10)
    submissions = fetcher.get_json(f"https://data.sec.gov/submissions/CIK{cik10}.json")
    company = submissions.get("name")
    if freq == "annual":
        forms: tuple[str, ...] = ("10-K", "20-F")
        refs = filings_since(submissions, fetcher, forms, _since(annual_years))
        day_range = ANNUAL_DAYS
        target = annual_years
    else:
        forms = ("10-Q",)
        refs = filings_since(submissions, fetcher, forms, _since(quarter_years))
        day_range = QUARTER_DAYS
        target = quarter_years * 4

    cutoff = _since(annual_years if freq == "annual" else quarter_years)
    results: dict[str, dict] = {}  # period_end -> evaluated row
    filings_read: list[dict] = []
    diagnostics: list[dict] = []

    def resolved(period_end: str) -> bool:
        """Is a period within +-10 days of `period_end` already definitively resolved?"""
        d = dt.date.fromisoformat(period_end)
        for end, row in results.items():
            if row.get("status") in DEFINITIVE and abs((dt.date.fromisoformat(end) - d).days) <= 10:
                return True
        return False

    def filing_fully_covered(ref: FilingRef) -> bool:
        """A 10-K carries its own year + two comparatives (a 10-Q its quarter + prior-year quarter).

        Newest filings are read first, so a period we already hold came from a *newer* filing
        (the "prefer the latest filing" rule, NG-1). Skip a filing only when every period it could
        contribute is already held that way; otherwise read it for the restated comparatives.
        """
        if not ref.report_date:
            return False
        d = dt.date.fromisoformat(ref.report_date)
        if freq == "annual":
            candidates = [d, d.replace(year=d.year - 1), d.replace(year=d.year - 2)]
        else:
            candidates = [d, d.replace(year=d.year - 1)]
        return all(resolved(c.isoformat()) or c.isoformat() < cutoff for c in candidates)

    for ref in refs:
        if filing_fully_covered(ref):
            continue
        ff: FilingFacts = parse_filing(fetcher, cik10, ref.form, ref.accession, ref.filed)
        filings_read.append({"form": ref.form, "accession": ref.accession, "filed": ref.filed})
        for period in ff.periods(day_range):
            end = period[1]
            if end < cutoff:
                continue
            existing = results.get(end)
            if existing is not None and existing.get("status") in DEFINITIVE:
                continue
            row = evaluate_period(ff, period)
            if existing is None or row.get("status") in DEFINITIVE:
                results[end] = row
                diagnostics.append(
                    {k: v for k, v in row.items() if k not in {"chart", "alternative"}}
                    | {"chart_rows": len((row.get("chart") or {}).get("rows", []))}
                )
        if len([r for r in results.values() if r.get("status") in DEFINITIVE]) >= target and all(
            filing_fully_covered(r) for r in refs
        ):
            break  # every remaining filing is fully covered by newer ones

    ordered = sorted(results.values(), key=lambda r: r["period_end"])
    periods = [period_entry(r, freq, company, cik10) for r in ordered][-target:]
    currency = next(
        (r.get("currency") for r in reversed(ordered) if r.get("currency") not in (None, "?")), None
    )

    envelope = {
        "symbol": symbol.upper(),
        "freq": freq,
        "cik": cik10,
        "company_name": company,
        "currency": currency,
        "status": "ok",
        "periods": periods,
        "legend": build_legend(periods),
        "resegmentations": detect_resegmentation(periods),
        "filings_read": filings_read,
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat().replace("+00:00", "Z"),
    }
    if diagnostics_dir is not None:
        try:
            diagnostics_dir.mkdir(parents=True, exist_ok=True)
            (diagnostics_dir / f"{symbol.upper()}_{freq}.json").write_text(
                json.dumps(
                    {
                        "symbol": symbol.upper(),
                        "freq": freq,
                        "filings_read": filings_read,
                        "rows": diagnostics,
                    },
                    indent=1,
                ),
                encoding="utf-8",
            )
        except OSError:
            pass
    return envelope


def not_configured_envelope(symbol: str, freq: str, message: str) -> dict[str, Any]:
    return {
        "symbol": symbol.upper(),
        "freq": freq,
        "cik": None,
        "company_name": None,
        "currency": None,
        "status": "not_configured",
        "message": message,
        "periods": [],
        "legend": [],
        "resegmentations": [],
        "filings_read": [],
    }


def unavailable_envelope(symbol: str, freq: str, status: str, message: str) -> dict[str, Any]:
    return {
        "symbol": symbol.upper(),
        "freq": freq,
        "cik": None,
        "company_name": None,
        "currency": None,
        "status": status,
        "message": message,
        "periods": [],
        "legend": [],
        "resegmentations": [],
        "filings_read": [],
    }


__all__ = [
    "FilingRef",
    "build_segments",
    "build_legend",
    "coverage_state",
    "concept_local",
    "detect_resegmentation",
    "not_configured_envelope",
    "period_entry",
    "unavailable_envelope",
]
