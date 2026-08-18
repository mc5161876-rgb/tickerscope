// MAR-50: bulk-import parser, reorder helpers, export filename / period label.
import { describe, expect, it } from "vitest";
import { looksLikeList, normalizeTicker, parseBulk } from "../lib/bulkImport";
import { exportFilename, periodLabel } from "../lib/exportPng";
import { moveDown, moveItem, moveUp } from "../lib/watchlist";

describe("bulk import parser (AC-6)", () => {
  it("splits on commas, spaces, newlines, semicolons and tabs", () => {
    const r = parseBulk("MSFT, AMZN NASDAQ:GOOGL\nnvda;aapl\tJPM");
    expect(r.valid).toEqual(["MSFT", "AMZN", "GOOGL", "NVDA", "AAPL", "JPM"]);
    expect(r.invalid).toEqual([]);
  });
  it("normalises exchange prefixes, cashtags and share classes", () => {
    expect(normalizeTicker("NYSE:BRK.B")).toBe("BRK-B");
    expect(normalizeTicker("$tsla")).toBe("TSLA");
    expect(normalizeTicker("aapl,")).toBe("AAPL");
    expect(normalizeTicker("1234")).toBeNull();
    expect(normalizeTicker("this-is-way-too-long")).toBeNull();
  });
  it("reports invalid tokens instead of dropping them, dedupes valid ones", () => {
    const r = parseBulk("MSFT, AMZN NASDAQ:GOOGL, ZZZZ9-way-too-long-ticker, msft, 12");
    expect(r.valid).toEqual(["MSFT", "AMZN", "GOOGL"]);
    expect(r.invalid).toEqual(["ZZZZ9-way-too-long-ticker", "12"]);
  });
  it("looksLikeList only for multi-token input", () => {
    expect(looksLikeList("AAPL")).toBe(false);
    expect(looksLikeList("AAPL, MSFT")).toBe(true);
    expect(looksLikeList("AAPL MSFT")).toBe(true);
    expect(looksLikeList("  AAPL  ")).toBe(false);
  });
});

describe("reorder helpers (AC-4)", () => {
  const L = ["NVDA", "AAPL", "JPM", "MSFT"];
  it("moves an item and clamps the target", () => {
    expect(moveItem(L, 0, 3)).toEqual(["AAPL", "JPM", "MSFT", "NVDA"]);
    expect(moveItem(L, 3, 0)).toEqual(["MSFT", "NVDA", "AAPL", "JPM"]);
    expect(moveItem(L, 1, 99)).toEqual(["NVDA", "JPM", "MSFT", "AAPL"]);
    expect(moveItem(L, 2, -5)).toEqual(["JPM", "NVDA", "AAPL", "MSFT"]);
  });
  it("is a no-op for invalid or same positions and never mutates", () => {
    expect(moveItem(L, 1, 1)).toEqual(L);
    expect(moveItem(L, 9, 0)).toEqual(L);
    const copy = L.slice();
    moveUp(copy, 2);
    expect(copy).toEqual(L);
  });
  it("moveUp / moveDown", () => {
    expect(moveUp(L, 2)).toEqual(["NVDA", "JPM", "AAPL", "MSFT"]);
    expect(moveUp(L, 0)).toEqual(L);
    expect(moveDown(L, 0)).toEqual(["AAPL", "NVDA", "JPM", "MSFT"]);
    expect(moveDown(L, 3)).toEqual(L);
  });
});

describe("export naming (AC-9)", () => {
  it("builds {TICKER}-{chart}-{YYYY-MM-DD}.png", () => {
    expect(exportFilename("nvda", "revenue", new Date(2026, 7, 19))).toBe("NVDA-revenue-2026-08-19.png");
    expect(exportFilename("BRK-B", "segments", new Date(2026, 0, 5))).toBe("BRK-B-segments-2026-01-05.png");
    expect(exportFilename("aapl", "Stock Price", new Date(2026, 11, 31))).toBe("AAPL-stockprice-2026-12-31.png");
  });
  it("period labels", () => {
    expect(periodLabel("price", { range: "10y" })).toBe("Daily close · 10Y");
    expect(periodLabel("revenue", { freq: "annual", first: "FY2016", last: "FY2025" })).toBe("Annual · FY2016–FY2025");
    expect(periodLabel("segments", { freq: "quarterly", first: "Q3 '21", last: "Q2 '26" })).toBe("Quarterly · Q3 '21–Q2 '26");
    expect(periodLabel("ebitda", { freq: "annual" })).toBe("Annual");
  });
});
