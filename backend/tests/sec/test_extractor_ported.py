# Ported verbatim from traderscope backend/tests/test_extractor.py @ 1336a20 (import path only).
import unittest

from tickerscope.sec import extractor


class LinkbaseSpikeTests(unittest.TestCase):
    def test_linkbase_removes_parent_subtotal(self):
        facts = {
            "x:TotalInternationalMember": 40,
            "x:AsiaMember": 10,
            "x:EMEAMember": 20,
            "x:LatinAmericaMember": 10,
            "x:NorthAmericaMember": 60,
        }
        graph = {
            "TotalInternationalMember": {
                "AsiaMember",
                "EMEAMember",
                "LatinAmericaMember",
            }
        }
        result = extractor.linkbase_adjusted_components(facts, [graph], {}, 100)
        self.assertEqual(result["strategy"], "linkbase_leaves")
        self.assertEqual(result["sum"], 100)
        self.assertEqual(result["subtotal_members_removed"], ["x:TotalInternationalMember"])

    def test_sibling_rollup_uses_maximum_detail_reconciled_subset(self):
        facts = {
            "country:US": 80,
            "x:NonUsMember": 20,
            "x:AsiaMember": 5,
            "x:EMEAMember": 10,
            "x:LatinAmericaMember": 5,
        }
        result = extractor.linkbase_adjusted_components(facts, [], {}, 100)
        self.assertEqual(result["strategy"], "max_detail_reconciled_subset")
        self.assertEqual(result["sum"], 100)
        self.assertEqual(len(result["members"]), 4)
        self.assertNotIn("x:NonUsMember", result["members"])

    def test_subset_does_not_hide_unexplained_segment(self):
        facts = {"x:SegmentAMember": 60, "x:SegmentBMember": 40, "x:SegmentCMember": 25}
        result = extractor.linkbase_adjusted_components(facts, [], {}, 100)
        self.assertEqual(result["strategy"], "raw")
        self.assertEqual(result["sum"], 125)
        self.assertEqual(result["subset_alternatives"], [])

    def test_multi_dimension_ifrs_context_projects_to_segments(self):
        dimensions = {
            "sap:IfrsScenarioAxis": "sap:ActualCurrencyMember",
            "ifrs-full:SegmentConsolidationItemsAxis": "ifrs-full:OperatingSegmentsMember",
            "ifrs-full:SegmentsAxis": "sap:CoreServicesMember",
        }
        self.assertEqual(
            extractor.project_segment_dimension(dimensions),
            ("ifrs-full:SegmentsAxis", "sap:CoreServicesMember"),
        )

    def test_unknown_qualifier_is_rejected(self):
        dimensions = {
            "ifrs-full:SegmentsAxis": "sap:CoreServicesMember",
            "sap:UnknownAxis": "sap:UnknownMember",
        }
        self.assertIsNone(extractor.project_segment_dimension(dimensions))

    def test_axis_priority_prefers_reportable_business_segments(self):
        self.assertLess(
            extractor.axis_priority("us-gaap:StatementBusinessSegmentsAxis"),
            extractor.axis_priority("srt:StatementGeographicalAxis"),
        )

    def test_corporate_and_reconciling_bridge_improves_business_segments(self):
        adjusted = {
            "strategy": "linkbase_leaves",
            "sum": 17856,
            "delta_pct": 2.13,
        }
        bridge = {
            "us-gaap:CorporateNonSegmentMember": 703,
            "us-gaap:MaterialReconcilingItemsMember": -313,
        }
        result = extractor.add_consolidation_bridge(adjusted, bridge, 18246)
        self.assertEqual(result["sum"], 18246)
        self.assertEqual(result["delta_pct"], 0.0)
        self.assertIn("filed_consolidation_bridge", result["strategy"])

    def test_bridge_that_worsens_reconciliation_is_not_used(self):
        adjusted = {"strategy": "raw", "sum": 100, "delta_pct": 0.0}
        result = extractor.add_consolidation_bridge(
            adjusted, {"us-gaap:CorporateNonSegmentMember": 5}, 100
        )
        self.assertEqual(result["strategy"], "raw")
        self.assertEqual(result["bridge_members"], [])

    def test_only_recognized_consolidation_members_are_projected(self):
        self.assertEqual(
            extractor.project_consolidation_bridge(
                {"srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"}
            ),
            (
                "srt:ConsolidationItemsAxis",
                "us-gaap:CorporateNonSegmentMember",
            ),
        )
        self.assertIsNone(
            extractor.project_consolidation_bridge(
                {"srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"}
            )
        )

    def test_chart_contract_types_segments_corporate_and_negative_bridge(self):
        adjusted = {
            "strategy": "raw+filed_consolidation_bridge",
            "base_strategy": "raw",
            "sum": 182447,
            "delta_pct": 0.0,
            "members": ["jpm:CIBMember", "jpm:CCBMember", "jpm:AWMMember"],
            "elimination_members": [],
            "bridge_member_values": {
                "us-gaap:CorporateNonSegmentMember": 7025,
                "us-gaap:MaterialReconcilingItemsMember": -3134,
            },
        }
        raw = {
            "jpm:CIBMember": 78450,
            "jpm:CCBMember": 76030,
            "jpm:AWMMember": 24076,
        }
        result = extractor.build_chart_contract(adjusted, raw, {}, 182447)
        self.assertEqual(result["positive_stack_total"], 185581)
        self.assertEqual(result["signed_bridge_total"], -3134)
        self.assertEqual(result["calculated_total"], 182447)
        self.assertEqual(result["reportable_segment_count"], 3)
        self.assertEqual(result["rows"][-1]["type"], "corporate_nonsegment")
        self.assertEqual(
            result["consolidation_bridge"][0]["type"],
            "filed_reconciling_item",
        )
        self.assertEqual(result["rows"][-1]["label"], "Corporate")
        self.assertEqual(
            result["consolidation_bridge"][0]["label"],
            "Material reconciling items",
        )

    def test_one_member_business_axis_is_single_segment(self):
        segmented = {
            "Revenues": {
                "us-gaap:StatementBusinessSegmentsAxis": {
                    ("2025-01-01", "2025-12-31"): {"nflx:ReportableSegmentMember": 45183036000}
                }
            }
        }
        result = extractor.select_single_segment_candidate(
            segmented,
            ("2025-01-01", "2025-12-31"),
            45183036000,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result[3], "nflx:ReportableSegmentMember")

    def test_one_member_geography_axis_is_not_single_segment(self):
        segmented = {
            "Revenues": {
                "srt:StatementGeographicalAxis": {("2025-01-01", "2025-12-31"): {"x:USMember": 100}}
            }
        }
        self.assertIsNone(
            extractor.select_single_segment_candidate(segmented, ("2025-01-01", "2025-12-31"), 100)
        )

    def test_failed_business_view_exposes_reconciled_geography_rows(self):
        primary_adjusted = {
            "strategy": "raw",
            "delta_pct": 33.4569,
            "members": ["intc:ClientMember", "intc:FoundryMember"],
            "elimination_members": [],
            "bridge_member_values": {},
        }
        geography_adjusted = {
            "strategy": "raw",
            "delta_pct": 0.0,
            "members": ["country:US", "intc:ChinaMember"],
            "elimination_members": [],
            "bridge_member_values": {},
        }
        candidates = [
            (
                33.4569,
                0,
                "Revenues",
                "us-gaap:StatementBusinessSegmentsAxis",
                {"intc:ClientMember": 70, "intc:FoundryMember": 30},
                primary_adjusted,
            ),
            (
                0.0,
                1,
                "Revenues",
                "srt:StatementGeographicalAxis",
                {"country:US": 60, "intc:ChinaMember": 40},
                geography_adjusted,
            ),
        ]
        result = extractor.reconciled_alternative_contract(
            candidates, selected_priority=0, labels={}, consolidated=100
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["kind"], "geography")
        self.assertEqual(result["label"], "Revenue by Region")
        self.assertEqual(result["render_mode"], "stacked")
        self.assertEqual(result["positive_stack_total"], 100)
        self.assertEqual(result["consolidated_total"], 100)
        self.assertEqual(len(result["rows"]), 2)
        self.assertTrue(all(row["type"] == "geographic_region" for row in result["rows"]))
        self.assertEqual(result["component_count"], 2)
        self.assertNotIn("reportable_segment_count", result)
        self.assertEqual(result["reconciliation_delta_pct"], 0.0)


if __name__ == "__main__":
    unittest.main()
