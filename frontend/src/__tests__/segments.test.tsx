// MAR-49: SegmentCard renders every coverage state honestly; legend + re-segmentation note.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentCard } from "../components/charts/SegmentCard";
import { buildLegend, cardView, labelKey } from "../components/charts/SegmentChart";
import type { SegmentPeriod, SegmentsPayload } from "../lib/api";
import type { Resource } from "../lib/useResource";

function period(over: Partial<SegmentPeriod> & { period_end: string; label: string }): SegmentPeriod {
  return {
    period_start: null,
    coverage_state: "as_filed",
    render_mode: "stacked",
    view: { kind: "business", label: "Revenue by Segment" },
    rows: [
      { label: "AWS", value: 40, type: "reportable_segment", concept: "a:AWS" },
      { label: "North America", value: 60, type: "reportable_segment", concept: "a:NA" },
    ],
    consolidation_bridge: [],
    signed_bridge_total: 0,
    positive_stack_total: 100,
    calculated_total: 100,
    consolidated_total: 100,
    reconciliation_delta_pct: 0,
    reportable_segment_count: 2,
    provenance: { form: "10-K", accession: "0001-26-1", filed: "2026-02-06", axis: "StatementBusinessSegmentsAxis", cik: "1", edgar_url: "https://www.sec.gov/Archives/edgar/data/1/000126/" },
    ...over,
  };
}

function payload(periods: SegmentPeriod[], over: Partial<SegmentsPayload> = {}): SegmentsPayload {
  return {
    symbol: "TEST",
    freq: "annual",
    cik: "1",
    company_name: "Test Co",
    currency: "USD",
    status: "ok",
    periods,
    legend: [],
    resegmentations: [],
    filings_read: [{ form: "10-K", accession: "x", filed: "2026-01-01" }],
    generated_at: "2026-08-18T00:00:00Z",
    ...over,
  };
}

function res(data: SegmentsPayload | null, status: Resource<SegmentsPayload>["status"] = "ok"): Resource<SegmentsPayload> {
  return { status, data, error: null, stale: false, staleAsOf: null, reload: () => {} };
}

describe("SegmentCard states", () => {
  it("loading shows 'Reading SEC filings…' without blocking anything else", () => {
    render(<SegmentCard res={res(null, "loading")} freq="annual" />);
    expect(screen.getByText("Reading SEC filings…")).toBeInTheDocument();
  });

  it("not configured", () => {
    render(<SegmentCard res={res(payload([], { status: "not_configured", message: "set SEC_USER_AGENT" }))} freq="annual" />);
    expect(screen.getByText("SEC access not configured")).toBeInTheDocument();
  });

  it("as_filed draws the business view with a legend and no state banner", () => {
    render(<SegmentCard res={res(payload([period({ period_end: "2024-12-31", label: "FY2024" }), period({ period_end: "2025-12-31", label: "FY2025" })]))} freq="annual" />);
    expect(screen.getByRole("region", { name: "Revenue by Segment" })).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeInTheDocument();
    expect(screen.getByText("North America")).toBeInTheDocument();
    expect(screen.getByText("consolidated total")).toBeInTheDocument();
    expect(document.querySelector(".seg-state")).toBeNull();
  });

  it("single_segment says so and shows the consolidated total", () => {
    const p = period({ period_end: "2025-12-31", label: "FY2025", coverage_state: "single_segment", render_mode: "single_segment", rows: [], consolidated_total: 45.18e9, message: "Netflix reports one operating segment, so there is no segment breakdown to chart." });
    render(<SegmentCard res={res(payload([p]))} freq="annual" />);
    expect(screen.getByText(/Reports as one segment/)).toBeInTheDocument();
    expect(screen.getByText(/FY2025: \$45\.2B/)).toBeInTheDocument();
    expect(document.querySelector(".seg-state")?.getAttribute("data-state")).toBe("single_segment");
  });

  it("needs_review withholds and explains", () => {
    const p = period({ period_end: "2025-12-31", label: "FY2025", coverage_state: "needs_review", render_mode: "withheld", rows: [], consolidated_total: 447.6e9, message: "Segment breakdown withheld - the filed segments did not reconcile to the filed total. It accounts for 99.1% of total revenue." });
    render(<SegmentCard res={res(payload([p]))} freq="annual" />);
    expect(screen.getByText(/Segment breakdown withheld/)).toBeInTheDocument();
    expect(screen.getByText(/didn't reconcile to filed total/)).toBeInTheDocument();
    expect(screen.getByText(/99\.1% of total revenue/)).toBeInTheDocument();
  });

  it("withheld_alternative draws the alternative under its real title", () => {
    const p = period({
      period_end: "2025-12-27",
      label: "FY2025",
      coverage_state: "withheld_alternative",
      render_mode: "withheld",
      rows: [],
      alternative: {
        kind: "geography",
        label: "Revenue by Region",
        available: true,
        axis: "srt:StatementGeographicalAxis",
        render_mode: "stacked",
        rows: [
          { label: "United States", value: 15.7e9, type: "geographic_region", concept: "country:US" },
          { label: "China", value: 12.7e9, type: "geographic_region", concept: "intc:China" },
        ],
        positive_stack_total: 28.4e9,
        consolidated_total: 52.8e9,
        reconciliation_delta_pct: 0,
        component_count: 2,
      },
    });
    render(<SegmentCard res={res(payload([p]))} freq="annual" />);
    expect(screen.getByRole("region", { name: "Revenue by Region" })).toBeInTheDocument();
    expect(screen.getByText(/Business-segment view withheld/)).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.queryByText("AWS")).toBeNull();
  });

  it("unavailable renders 'Not available'", () => {
    const p = period({ period_end: "2025-12-31", label: "FY2025", coverage_state: "unavailable", render_mode: "unavailable", rows: [], consolidated_total: null, message: "no XBRL instance in filing directory" });
    render(<SegmentCard res={res(payload([p]))} freq="annual" />);
    expect(screen.getAllByText(/Not available/).length).toBeGreaterThan(0);
  });

  it("re-segmentation is called out in the legend note", () => {
    const a = period({ period_end: "2022-12-31", label: "FY2022" });
    const b = period({
      period_end: "2023-12-31",
      label: "FY2023",
      rows: [
        { label: "AWS", value: 40, type: "reportable_segment", concept: "a:AWS" },
        { label: "Everything else", value: 60, type: "reportable_segment", concept: "a:EE" },
      ],
    });
    render(<SegmentCard res={res(payload([a, b], { resegmentations: ["2023-12-31"] }))} freq="annual" />);
    expect(screen.getByText("re-segmented at FY2023")).toBeInTheDocument();
    expect(screen.getByText("Everything else")).toBeInTheDocument();
    expect(screen.getByText("North America")).toBeInTheDocument(); // old and new names both in the legend
  });
});

describe("legend helpers", () => {
  it("labelKey unifies case, punctuation and & vs and", () => {
    expect(labelKey("Corporate & Investment Bank")).toBe(labelKey("corporate and investment bank"));
    expect(labelKey("Productivity and Business Processes")).toBe(labelKey("Productivity And Business Processes"));
    expect(labelKey("AWS")).not.toBe(labelKey("International"));
  });

  it("buildLegend merges renamed concepts with the same label, corporate last, newest label wins", () => {
    const old = period({ period_end: "2024-12-31", label: "FY2024", rows: [
      { label: "Corporate & Investment Bank", value: 1, type: "reportable_segment", concept: "j:CIB" },
      { label: "Corporate", value: 1, type: "corporate_nonsegment", concept: "us:Corp" },
    ] });
    const nu = period({ period_end: "2025-12-31", label: "FY2025", rows: [
      { label: "Corporate and Investment Bank", value: 1, type: "reportable_segment", concept: "j:CorporateAndIB" },
    ] });
    const legend = buildLegend(payload([old, nu]), "business");
    expect(legend.map((l) => l.label)).toEqual(["Corporate and Investment Bank", "Corporate"]);
    expect(legend[0].concepts.sort()).toEqual(["j:CIB", "j:CorporateAndIB"]);
    expect(legend[1].type).toBe("corporate_nonsegment");
  });

  it("cardView follows the newest drawable period", () => {
    const alt = period({ period_end: "2025-12-31", label: "FY2025", coverage_state: "withheld_alternative", render_mode: "withheld", rows: [], alternative: { kind: "geography", label: "Revenue by Region", available: true, axis: "x", render_mode: "stacked", rows: [{ label: "US", value: 1, type: "geographic_region", concept: "c:US" }], positive_stack_total: 1, consolidated_total: 1, reconciliation_delta_pct: 0, component_count: 1 } });
    expect(cardView(payload([period({ period_end: "2024-12-31", label: "FY2024" }), alt]))).toEqual({ kind: "geography", label: "Revenue by Region" });
    expect(cardView(payload([period({ period_end: "2024-12-31", label: "FY2024" })]))).toEqual({ kind: "business", label: "Revenue by Segment" });
  });
});
