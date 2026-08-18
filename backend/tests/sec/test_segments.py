"""Segments contract mapping (MAR-49 AC-3/AC-5/AC-6) - synthetic rows, no network."""

from tickerscope.sec.extractor import build_chart_contract, parse_labels, select_instance
from tickerscope.sec.segments import (
    build_legend,
    coverage_state,
    detect_resegmentation,
    period_entry,
)


def _row(status: str, **extra) -> dict:
    base = {
        "status": status,
        "period_start": "2025-01-01",
        "period_end": "2025-12-31",
        "form": "10-K",
        "accn": "0001018724-26-000004",
        "filed": "2026-02-06",
        "axis": "StatementBusinessSegmentsAxis",
        "currency": "USD",
        "consolidated": 100,
        "chart": {
            "rows": [
                {"label": "AWS", "value": 40, "type": "reportable_segment", "concept": "amzn:AWS"},
                {"label": "NA", "value": 60, "type": "reportable_segment", "concept": "amzn:NA"},
            ],
            "positive_stack_total": 100,
            "consolidation_bridge": [],
            "signed_bridge_total": 0,
            "calculated_total": 100,
            "consolidated_total": 100,
            "reconciliation_delta_pct": 0.0,
            "reportable_segment_count": 2,
        },
    }
    base.update(extra)
    return base


def test_coverage_state_mapping_matches_contract():
    assert coverage_state(_row("AS_FILED")) == "as_filed"
    bridged = _row("AS_FILED")
    bridged["chart"]["consolidation_bridge"] = [
        {"label": "Recon", "value": -3, "type": "filed_reconciling_item", "concept": "x"}
    ]
    assert coverage_state(bridged) == "as_filed_with_bridge"
    assert coverage_state(_row("NEEDS_REVIEW", delta_pct=1.2)) == "needs_review"
    assert (
        coverage_state(_row("NEEDS_REVIEW", alternative={"label": "Revenue by Region", "rows": []}))
        == "withheld_alternative"
    )
    assert coverage_state(_row("SINGLE_SEGMENT")) == "single_segment"
    assert coverage_state(_row("UNAVAILABLE", reason="no XBRL instance")) == "unavailable"
    assert coverage_state(_row("ERROR")) == "unavailable"


def test_period_entry_as_filed_has_rows_and_edgar_provenance():
    e = period_entry(_row("AS_FILED"), "annual", "Amazon", "0001018724")
    assert e["coverage_state"] == "as_filed" and e["render_mode"] == "stacked"
    assert e["label"] == "FY2025"
    assert [r["label"] for r in e["rows"]] == ["AWS", "NA"]
    assert e["view"] == {"kind": "business", "label": "Revenue by Segment"}
    assert (
        e["provenance"]["edgar_url"]
        == "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/"
    )
    assert e["provenance"]["accession"] == "0001018724-26-000004"
    assert "message" not in e


def test_period_entry_withheld_states_never_draw_rows():
    nr = period_entry(_row("NEEDS_REVIEW", delta_pct=1.3), "annual", "UNH", "1")
    assert nr["render_mode"] == "withheld" and nr["rows"] == []
    assert "did not reconcile" in nr["message"] and "98.7%" in nr["message"]
    alt = period_entry(
        _row(
            "NEEDS_REVIEW",
            delta_pct=33.4,
            alternative={
                "kind": "geography",
                "label": "Revenue by Region",
                "available": True,
                "render_mode": "stacked",
                "rows": [
                    {
                        "label": "US",
                        "value": 60,
                        "type": "geographic_region",
                        "concept": "country:US",
                    }
                ],
                "component_count": 1,
            },
        ),
        "annual",
        "Intel",
        "50863",
    )
    assert alt["coverage_state"] == "withheld_alternative" and alt["rows"] == []
    assert alt["alternative"]["label"] == "Revenue by Region"
    assert "revenue by region" in alt["message"]
    single = period_entry(
        _row(
            "SINGLE_SEGMENT",
            chart={
                "render_mode": "single_segment",
                "rows": [],
                "consolidated_total": 100,
                "reportable_segment_count": 1,
            },
        ),
        "annual",
        "Netflix",
        "1065280",
    )
    assert single["render_mode"] == "single_segment" and single["rows"] == []
    assert single["message"].startswith("Netflix reports one operating segment")
    un = period_entry(
        _row("UNAVAILABLE", reason="no fiscal-year revenue period"), "annual", None, "1"
    )
    assert (
        un["coverage_state"] == "unavailable" and un["message"] == "no fiscal-year revenue period"
    )


def test_geography_primary_axis_is_labelled_honestly_not_as_segments():
    row = _row("AS_FILED", axis="StatementGeographicalAxis")
    e = period_entry(row, "annual", "Intel", "1")
    assert e["view"] == {"kind": "geography", "label": "Revenue by Region"}
    assert all(r["type"] == "geographic_region" for r in e["rows"])
    assert "revenue by region" in e["message"]


def _entry(end: str, labels: list[str], kind: str = "business", stacked: bool = True) -> dict:
    return {
        "period_end": end,
        "render_mode": "stacked" if stacked else "withheld",
        "view": {"kind": kind, "label": "x"},
        "rows": [
            {"label": lb, "concept": f"x:{lb}", "type": "reportable_segment", "value": 1}
            for lb in labels
        ]
        + [
            {
                "label": "Corporate",
                "concept": "us-gaap:CorporateNonSegmentMember",
                "type": "corporate_nonsegment",
                "value": 1,
            }
        ],
    }


def test_resegmentation_flags_member_set_change_only():
    periods = [
        _entry("2021-12-31", ["CIB", "CB", "CCB"]),
        _entry("2022-12-31", ["CIB", "CB", "CCB"]),
        _entry("2023-12-31", ["C&IB", "CCB"]),  # merged -> flagged
        _entry("2024-12-31", ["C&IB", "CCB"]),
    ]
    assert detect_resegmentation(periods) == ["2023-12-31"]


def test_resegmentation_ignores_case_punctuation_corporate_and_view_switch():
    periods = [
        _entry("2021-12-31", ["Productivity and Business", "Cloud"]),
        _entry("2022-12-31", ["Productivity And Business", "Cloud"]),  # label case only
        _entry("2023-12-31", ["Cloud"], kind="geography"),  # different view -> ignored
        _entry("2024-12-31", ["Productivity & Business", "Cloud"]),  # & vs and -> same
        _entry(
            "2025-12-31", ["Productivity & Business", "Cloud"], stacked=False
        ),  # withheld -> ignored
    ]
    assert detect_resegmentation(periods) == []


def test_legend_union_reportable_first_corporate_last_newest_label_wins():
    periods = [
        {
            "period_end": "2024-12-31",
            "render_mode": "stacked",
            "rows": [
                {"label": "AWS old", "concept": "a:AWS", "type": "reportable_segment", "value": 1},
                {
                    "label": "Corporate",
                    "concept": "us:Corp",
                    "type": "corporate_nonsegment",
                    "value": 1,
                },
            ],
        },
        {
            "period_end": "2025-12-31",
            "render_mode": "stacked",
            "rows": [
                {"label": "AWS", "concept": "a:AWS", "type": "reportable_segment", "value": 1},
                {"label": "Intl", "concept": "a:Intl", "type": "reportable_segment", "value": 1},
            ],
        },
    ]
    legend = build_legend(periods)
    assert [x["label"] for x in legend] == ["AWS", "Intl", "Corporate"]


def test_corporate_member_on_segment_axis_is_typed_corporate_nonsegment():
    adjusted = {
        "strategy": "raw",
        "sum": 100,
        "delta_pct": 0.0,
        "members": ["jpm:CIBMember", "us-gaap:CorporateNonSegmentMember"],
        "elimination_members": [],
    }
    raw = {"jpm:CIBMember": 90, "us-gaap:CorporateNonSegmentMember": 10}
    c = build_chart_contract(adjusted, raw, {}, 100)
    assert c["reportable_segment_count"] == 1
    assert c["rows"][-1]["type"] == "corporate_nonsegment" and c["rows"][-1]["label"] == "Corporate"


def test_select_instance_prefers_inline_then_dated_never_filing_summary():
    assert (
        select_instance(["FilingSummary.xml", "msft-20170630.xml", "msft-20170630_lab.xml"])
        == "msft-20170630.xml"
    )
    assert (
        select_instance(["FilingSummary.xml", "amzn-20251231_htm.xml", "amzn-20251231.xsd"])
        == "amzn-20251231_htm.xml"
    )
    assert select_instance(["FilingSummary.xml", "R1.xml", "x_pre.xml"]) is None


def test_parse_labels_prefers_terse_over_standard_and_ignores_documentation():
    xml = b"""<?xml version="1.0"?>
<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
 <link:labelLink>
  <link:loc xlink:type="locator" xlink:href="amzn.xsd#amzn_AmazonWebServicesSegmentMember" xlink:label="loc_aws"/>
  <link:label xlink:type="resource" xlink:label="lab_aws" xlink:role="http://www.xbrl.org/2003/role/documentation">AmazonWebServicesSegment [Member]</link:label>
  <link:label xlink:type="resource" xlink:label="lab_aws" xlink:role="http://www.xbrl.org/2003/role/label">Amazon Web Services Segment [Member]</link:label>
  <link:label xlink:type="resource" xlink:label="lab_aws" xlink:role="http://www.xbrl.org/2003/role/terseLabel">AWS</link:label>
  <link:labelArc xlink:type="arc" xlink:from="loc_aws" xlink:to="lab_aws"/>
 </link:labelLink>
</link:linkbase>"""
    labels = parse_labels(xml)
    assert labels["AmazonWebServicesSegmentMember"] == [
        "AWS",
        "Amazon Web Services Segment [Member]",
    ]
