// AC-7 formatting + AC-8/AC-10 example rendering.
import { describe, expect, it } from "vitest";
import {
  DASH,
  fmtChange,
  fmtCurrency,
  fmtDate,
  fmtDateRelative,
  fmtMetric,
  fmtNumber,
  fmtPercent,
  fmtPrice,
  fmtRange,
  fmtRatio,
  isNegativeDirectional,
  rangePosition,
  renderExample,
  valueInt,
} from "../lib/format";
import { METRIC_BY_ID } from "../lib/metrics";

describe("currency", () => {
  it("abbreviates T/B/M per AC-7", () => {
    expect(fmtCurrency(1.23e12)).toBe("$1.23T");
    expect(fmtCurrency(4.524925e12)).toBe("$4.52T");
    expect(fmtCurrency(456.7e9)).toBe("$456.7B");
    expect(fmtCurrency(12.3e6)).toBe("$12.3M");
    expect(fmtCurrency(107721875456)).toBe("$107.7B");
  });
  it("handles small, negative and null", () => {
    expect(fmtCurrency(1234)).toBe("$1,234");
    expect(fmtCurrency(8.71)).toBe("$8.71");
    expect(fmtCurrency(-2.5e9)).toBe("-$2.5B");
    expect(fmtCurrency(null)).toBe(DASH);
    expect(fmtCurrency(undefined)).toBe(DASH);
    expect(fmtCurrency(NaN)).toBe(DASH);
  });
  it("prices keep two decimals with thousands separators", () => {
    expect(fmtPrice(310.24)).toBe("$310.24");
    expect(fmtPrice(1234.5)).toBe("$1,234.50");
    expect(fmtPrice(-0.5)).toBe("-$0.50");
  });
});

describe("ratios / percents / numbers", () => {
  it("ratios to 2 dp with ×", () => {
    expect(fmtRatio(32.14159)).toBe("32.14×");
    expect(fmtRatio(0.78445)).toBe("0.78×");
    expect(fmtRatio(null)).toBe(DASH);
  });
  it("percents to 1 dp, signed only when asked", () => {
    expect(fmtPercent(0.124)).toBe("12.4%");
    expect(fmtPercent(0.124, true)).toBe("+12.4%");
    expect(fmtPercent(-0.031, true)).toBe("-3.1%");
    expect(fmtPercent(-0.031)).toBe("-3.1%");
    expect(fmtPercent(0)).toBe("0.0%");
    expect(fmtPercent(0, true)).toBe("0.0%");
  });
  it("plain numbers abbreviate without $", () => {
    expect(fmtNumber(14594180000)).toBe("14.6B");
    expect(fmtNumber(56250820)).toBe("56.3M");
    expect(fmtNumber(950)).toBe("950");
  });
  it("day change string", () => {
    expect(fmtChange(4.65, 0.0152)).toBe("+$4.65 (+1.5%)");
    expect(fmtChange(-1.2, -0.004)).toBe("-$1.20 (-0.4%)");
    expect(fmtChange(null, null)).toBe(DASH);
  });
});

describe("dates", () => {
  it("formats ISO dates as Mon D, YYYY", () => {
    expect(fmtDate("2026-10-30")).toBe("Oct 30, 2026");
    expect(fmtDate("2026-08-09T00:00:00Z")).toBe("Aug 9, 2026");
    expect(fmtDate(null)).toBe(DASH);
    expect(fmtDate("nope")).toBe(DASH);
  });
  it("relative suffix", () => {
    const now = new Date(Date.UTC(2026, 7, 18, 15, 0, 0));
    expect(fmtDateRelative("2026-10-29", now)).toBe("Oct 29, 2026 · in 72 days");
    expect(fmtDateRelative("2026-08-18", now)).toBe("Aug 18, 2026 · today");
    expect(fmtDateRelative("2026-08-19", now)).toBe("Aug 19, 2026 · tomorrow");
    expect(fmtDateRelative("2026-08-15", now)).toBe("Aug 15, 2026 · 3 days ago");
  });
});

describe("range", () => {
  it("formats and positions the 52-week bar", () => {
    expect(fmtRange({ low: 223.78, high: 344.57 })).toBe("$223.78 – $344.57");
    expect(fmtRange({ low: null, high: 1 })).toBe(DASH);
    expect(rangePosition({ low: 100, high: 200 }, 150)).toBe(0.5);
    expect(rangePosition({ low: 100, high: 200 }, 250)).toBe(1);
    expect(rangePosition({ low: 100, high: 200 }, null)).toBeNull();
  });
});

describe("fmtMetric by registry format", () => {
  it("dispatches on format and dashes nulls", () => {
    expect(fmtMetric("currency", 466822987776)).toBe("$466.8B");
    expect(fmtMetric("ratio", 35.6188)).toBe("35.62×");
    expect(fmtMetric("percent_signed", 0.164)).toBe("+16.4%");
    expect(fmtMetric("percent", 0.4865)).toBe("48.7%");
    expect(fmtMetric("decimal", 1.086)).toBe("1.09");
    expect(fmtMetric("currency", null)).toBe(DASH);
    expect(fmtMetric("range", null)).toBe(DASH);
    expect(fmtMetric("date", null)).toBe(DASH);
  });
  it("valueInt companions", () => {
    expect(valueInt("ratio", 41.2)).toBe("41");
    expect(valueInt("ratio", 0.78)).toBe("0.8");
    expect(valueInt("percent", 0.4865)).toBe("49");
  });
});

describe("renderExample (AC-8 / AC-10)", () => {
  it("substitutes ticker and formatted value", () => {
    const pe = METRIC_BY_ID["pe_ttm"];
    const s = renderExample(pe, "NVDA", 41.2);
    expect(s).toBe("NVDA's P/E of 41.20× means you pay about $41 for every $1 of the last year's profit.");
  });
  it("uses value_int for margin sentences", () => {
    const gm = METRIC_BY_ID["gross_margin"];
    expect(renderExample(gm, "AAPL", 0.4865)).toContain("about $49 is left");
    expect(renderExample(gm, "AAPL", 0.4865)).toContain("(48.7%)");
  });
  it("null value -> Not reported", () => {
    const fcf = METRIC_BY_ID["free_cash_flow"];
    expect(renderExample(fcf, "JPM", null)).toBe("Not reported for JPM.");
    const rng = METRIC_BY_ID["fifty_two_week_range"];
    expect(renderExample(rng, "JPM", { low: null, high: null })).toBe("Not reported for JPM.");
    const d = METRIC_BY_ID["next_earnings_date"];
    expect(renderExample(d, "JPM", null)).toBe("Not reported for JPM.");
  });
  it("date metrics render formatted dates", () => {
    const d = METRIC_BY_ID["ex_dividend_date"];
    expect(renderExample(d, "AAPL", "2026-08-09")).toContain("Aug 9, 2026");
  });
});

describe("directional colouring", () => {
  it("only directional negatives are red", () => {
    expect(isNegativeDirectional(METRIC_BY_ID["revenue_growth"], -0.05)).toBe(true);
    expect(isNegativeDirectional(METRIC_BY_ID["revenue_growth"], 0.05)).toBe(false);
    expect(isNegativeDirectional(METRIC_BY_ID["beta"], -0.2)).toBe(false);
    expect(isNegativeDirectional(METRIC_BY_ID["net_margin"], null)).toBe(false);
  });
});
