// Number / date formatting (AC-7) and explainer example rendering (AC-8, AC-10).
import type { MetricDef, MetricFormat } from "./metrics";

export const DASH = "—"; // em dash for nulls

export type RangeValue = { low: number | null; high: number | null };
export type MetricValue = number | string | RangeValue | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 1.23T / 456.7B / 12.3M style abbreviation (no currency symbol). */
export function abbreviate(v: number, opts: { keepTrailing?: boolean } = {}): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const n = abs / size;
      const dp = n < 10 ? 2 : 1;
      let s = n.toFixed(dp);
      if (!opts.keepTrailing) s = trimZeros(s);
      // guard "1000.0B" -> "1.0T" style overflow after rounding
      if (parseFloat(s) >= 1000 && suffix !== "T") continue;
      return `${sign}${s}${suffix}`;
    }
  }
  return `${sign}${abs < 10 ? trimZeros(abs.toFixed(2)) : Math.round(abs).toLocaleString("en-US")}`;
}

export function fmtCurrency(v: number | null | undefined, symbol = "$"): string {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${symbol}${abbreviate(abs)}`;
  if (abs >= 1e3) return `${sign}${symbol}${Math.round(abs).toLocaleString("en-US")}`;
  return `${sign}${symbol}${abs.toFixed(2)}`;
}

/** Per-share / price style: $8.71, $1,234.56 */
export function fmtPrice(v: number | null | undefined, symbol = "$"): string {
  if (!isNum(v)) return DASH;
  const sign = v < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtRatio(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return `${v.toFixed(2)}×`;
}

export function fmtDecimal(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return DASH;
  return v.toFixed(dp);
}

/** Input is a fraction (0.124 -> 12.4%). */
export function fmtPercent(v: number | null | undefined, signed = false): string {
  if (!isNum(v)) return DASH;
  const pct = v * 100;
  // round half away from zero at 1 dp; plain toFixed turns 48.65 into "48.6" via binary drift
  const rounded = Math.round(Math.abs(pct) * 10 + 1e-7) / 10;
  const s = `${rounded.toFixed(1)}%`;
  if (pct < 0) return `-${s}`;
  return signed && pct > 0 ? `+${s}` : s;
}

export function fmtNumber(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return abbreviate(v);
}

export function fmtInteger(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return Math.round(v).toLocaleString("en-US");
}

export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** "Oct 30, 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = parseIsoDate(iso);
  if (!d) return DASH;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Oct 30, 2026 · in 73 days" */
export function fmtDateRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return DASH;
  const d = parseIsoDate(iso);
  if (!d) return DASH;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((d.getTime() - today) / 86_400_000);
  let rel: string;
  if (days === 0) rel = "today";
  else if (days === 1) rel = "tomorrow";
  else if (days === -1) rel = "yesterday";
  else if (days > 0) rel = `in ${days} days`;
  else rel = `${-days} days ago`;
  return `${fmtDate(iso)} · ${rel}`;
}

export function fmtRange(v: RangeValue | null | undefined, symbol = "$"): string {
  if (!v || !isNum(v.low) || !isNum(v.high)) return DASH;
  return `${fmtPrice(v.low, symbol)} – ${fmtPrice(v.high, symbol)}`;
}

/** "Sep 30, 2025" style short date for chart tooltips */
export function fmtShortDate(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Day change: "+$4.65 (+1.5%)" */
export function fmtChange(change: number | null | undefined, pct: number | null | undefined): string {
  if (!isNum(change) && !isNum(pct)) return DASH;
  const parts: string[] = [];
  if (isNum(change)) parts.push(`${change > 0 ? "+" : change < 0 ? "-" : ""}$${Math.abs(change).toFixed(2)}`);
  if (isNum(pct)) parts.push(`(${fmtPercent(pct, true)})`);
  return parts.join(" ");
}

export function isRange(v: MetricValue): v is RangeValue {
  return !!v && typeof v === "object" && "low" in v && "high" in v;
}

export function isNull(format: MetricFormat, v: MetricValue): boolean {
  if (v === null || v === undefined) return true;
  if (format === "range") return !isRange(v) || !isNum(v.low) || !isNum(v.high);
  if (format === "date" || format === "date_relative") return typeof v !== "string" || !v;
  return !isNum(v);
}

/** Format any metric value by its registry format. Null -> em dash. */
export function fmtMetric(format: MetricFormat, v: MetricValue, now: Date = new Date()): string {
  if (isNull(format, v)) return DASH;
  switch (format) {
    case "currency":
      return fmtCurrency(v as number);
    case "currency_share":
      return fmtPrice(v as number);
    case "ratio":
      return fmtRatio(v as number);
    case "percent":
      return fmtPercent(v as number, false);
    case "percent_signed":
      return fmtPercent(v as number, true);
    case "number":
      return fmtNumber(v as number);
    case "decimal":
      return fmtDecimal(v as number);
    case "date":
      return fmtDate(v as string);
    case "date_relative":
      return fmtDateRelative(v as string, now);
    case "range":
      return fmtRange(v as RangeValue);
    default:
      return String(v);
  }
}

/** Whole-number companion for example sentences: ratios -> 41, percents -> 49 (of 100). */
export function valueInt(format: MetricFormat, v: MetricValue): string {
  if (!isNum(v)) return "";
  switch (format) {
    case "percent":
    case "percent_signed":
      return String(Math.round(v * 100));
    case "ratio":
    case "decimal": {
      const abs = Math.abs(v);
      return abs < 10 ? trimZeros(abs.toFixed(1)) : String(Math.round(abs));
    }
    default:
      return String(Math.round(v));
  }
}

/** Should this value be painted red? Only for directional metrics with a negative value. */
export function isNegativeDirectional(metric: MetricDef, v: MetricValue): boolean {
  return metric.directional && isNum(v) && v < 0;
}

/** Render the live example sentence (AC-8) or the null message (AC-10). */
export function renderExample(metric: MetricDef, ticker: string, v: MetricValue, now?: Date): string {
  if (isNull(metric.format, v)) return `Not reported for ${ticker}.`;
  const value = fmtMetric(metric.format, v, now);
  return metric.example_template
    .replaceAll("{ticker}", ticker)
    .replaceAll("{value_int}", valueInt(metric.format, v))
    .replaceAll("{value}", value);
}

/** Position 0..1 of the current price inside the 52-week range. */
export function rangePosition(range: RangeValue | null | undefined, price: number | null | undefined): number | null {
  if (!range || !isNum(range.low) || !isNum(range.high) || !isNum(price)) return null;
  if (range.high <= range.low) return null;
  return Math.min(1, Math.max(0, (price - range.low) / (range.high - range.low)));
}

/** "As of Aug 18, 2026, 1:36 PM · delayed" from an ISO timestamp. */
export function fmtAsOf(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}
