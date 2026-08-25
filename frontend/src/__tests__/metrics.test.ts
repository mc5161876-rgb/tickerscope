// AC-9: every metric in the shared registry carries complete explainer copy.
import { describe, expect, it } from "vitest";
import { METRICS, METRIC_GROUPS, metricsInGroup } from "../lib/metrics";

describe("shared/metrics.json", () => {
  it("has the five AC-6 groups in order", () => {
    expect(METRIC_GROUPS.map((g) => g.id)).toEqual([
      "price_size",
      "valuation",
      "profitability",
      "cash_flow",
      "dividends_dates",
    ]);
  });

  it("every metric has non-empty what / how_to_read / example_template", () => {
    const missing: string[] = [];
    for (const m of METRICS) {
      for (const f of ["what", "how_to_read", "example_template"] as const) {
        if (!m[f] || !m[f].trim()) missing.push(`${m.id}.${f}`);
      }
      if (!m.label?.trim()) missing.push(`${m.id}.label`);
      if (!m.format?.trim()) missing.push(`${m.id}.format`);
    }
    expect(missing).toEqual([]);
  });

  it("example templates reference {ticker} and {value}", () => {
    for (const m of METRICS) {
      expect(m.example_template, m.id).toContain("{ticker}");
      expect(m.example_template, m.id).toMatch(/\{value(_int)?\}/);
    }
  });

  it("covers all 35 AC-6 fields", () => {
    expect(METRICS).toHaveLength(35);
    expect(metricsInGroup("price_size").map((m) => m.id)).toEqual([
      "market_cap",
      "enterprise_value",
      "fifty_two_week_range",
      "avg_volume_3m",
      "beta",
      "shares_outstanding",
    ]);
    expect(metricsInGroup("dividends_dates").map((m) => m.id)).toEqual([
      "dividend_yield",
      "payout_ratio",
      "next_earnings_date",
      "ex_dividend_date",
    ]);
  });
});
