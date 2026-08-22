// Thin fetch layer over the FastAPI backend (AC-16, AC-18).
import type { MetricValue } from "./format";

export interface Profile {
  symbol: string | null;
  name: string | null;
  short_name: string | null;
  exchange: string | null;
  exchange_code: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  employees: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  currency: string | null;
  quote_type: string | null;
}

export interface Quote {
  price: number | null;
  previous_close: number | null;
  change: number | null;
  change_percent: number | null;
  currency: string | null;
  market_time: string | null;
  market_state: string | null;
}

export interface TickerPayload {
  symbol: string;
  profile: Profile;
  quote: Quote;
  metrics: Record<string, MetricValue>;
  as_of: string;
  fetched_at: string;
}

export interface PricePoint {
  date: string;
  close: number;
}
export type PriceRange = "1y" | "5y" | "10y" | "max";
export interface PricesPayload {
  symbol: string;
  range: PriceRange;
  currency: string | null;
  points: PricePoint[];
  sampled: boolean;
}

export type PointSource = "sec" | "yfinance";
export interface PeriodPoint {
  period_end: string;
  period_start?: string | null;
  label: string;
  value: number;
  /** MAR-49: provenance. Older payloads / yfinance-only rows carry nulls. */
  source?: PointSource;
  accession?: string | null;
  filed?: string | null;
  form?: string | null;
  method?: "as_filed" | "calculated";
  tag?: string | null;
}
export type Freq = "annual" | "quarterly";
export interface FinancialsPayload {
  symbol: string;
  freq: Freq;
  currency: string | null;
  revenue: PeriodPoint[];
  ebitda: PeriodPoint[];
  ebitda_method: "reported" | "calculated" | null;
  /** MAR-56 cash-flow + earnings series. yfinance only - SEC backfills revenue/EBITDA, not these. */
  operating_cash_flow: PeriodPoint[];
  free_cash_flow: PeriodPoint[];
  free_cash_flow_method: "reported" | "calculated" | null;
  capital_expenditure: PeriodPoint[];
  net_income: PeriodPoint[];
  sec?: { status: SecStatus | null; message?: string | null; cik?: string | null };
  warnings?: string[];
}

// ---- Revenue by Segment (MAR-49, contract ported from traderscope API_CONTRACT_V1) ----
export type SecStatus = "ok" | "not_configured" | "not_found" | "error";
export type CoverageState =
  | "as_filed"
  | "as_filed_with_bridge"
  | "needs_review"
  | "withheld_alternative"
  | "single_segment"
  | "unavailable";
export type RenderMode = "stacked" | "withheld" | "single_segment" | "unavailable";
export type RowType =
  | "reportable_segment"
  | "corporate_nonsegment"
  | "geographic_region"
  | "product_service"
  | "breakdown_component"
  | "filed_elimination"
  | "filed_reconciling_item";
export type ViewKind = "business" | "geography" | "product_service" | "other";

export interface SegmentRow {
  label: string;
  value: number;
  type: RowType;
  concept: string;
}
export interface SegmentAlternative {
  kind: ViewKind;
  label: string;
  available: boolean;
  axis: string;
  render_mode: "stacked";
  rows: SegmentRow[];
  positive_stack_total: number | null;
  consolidated_total: number | null;
  reconciliation_delta_pct: number | null;
  component_count: number;
}
export interface SegmentProvenance {
  form: string | null;
  accession: string | null;
  filed: string | null;
  axis: string | null;
  cik: string | null;
  edgar_url: string | null;
}
export interface SegmentPeriod {
  period_start: string | null;
  period_end: string;
  label: string;
  coverage_state: CoverageState;
  render_mode: RenderMode;
  view: { kind: ViewKind; label: string };
  rows: SegmentRow[];
  consolidation_bridge: SegmentRow[];
  signed_bridge_total: number;
  positive_stack_total: number | null;
  calculated_total: number | null;
  consolidated_total: number | null;
  reconciliation_delta_pct: number | null;
  reportable_segment_count: number;
  provenance: SegmentProvenance;
  message?: string;
  alternative?: SegmentAlternative;
  single_segment_fact?: { concept: string; value: number; source_label: string };
}
export interface SegmentsPayload {
  symbol: string;
  freq: Freq;
  cik: string | null;
  company_name: string | null;
  currency: string | null;
  status: SecStatus;
  message?: string;
  periods: SegmentPeriod[];
  legend: { concept: string; label: string; type: RowType }[];
  resegmentations: string[];
  filings_read: { form: string; accession: string; filed: string }[];
  generated_at?: string;
}

export interface SearchResult {
  ticker: string;
  name: string;
  exchange: string | null;
  cik: number | null;
}

export interface HealthPayload {
  status: string;
  data_mode: string;
  yfinance_version: string;
  search_index_size: number;
  version: string;
  sec_configured?: boolean;
  sec_user_agent_hint?: string | null;
}

export type ApiResult<T> =
  | { ok: true; data: T; cache: string }
  | { ok: false; status: number; error: string; stale?: T; staleAsOf?: string };

export class NotFound extends Error {}

async function get<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, status: 0, error: "network_error" };
  }
  const cache = res.headers.get("x-cache") ?? "";
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) return { ok: true, data: body as T, cache };
  const b = (body ?? {}) as { error?: string; stale?: T; stale_as_of?: string };
  return {
    ok: false,
    status: res.status,
    error: b.error ?? `http_${res.status}`,
    stale: b.stale,
    staleAsOf: b.stale_as_of,
  };
}

export const api = {
  health: (signal?: AbortSignal) => get<HealthPayload>("/api/health", signal),
  search: (q: string, signal?: AbortSignal) =>
    get<{ query: string; results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  ticker: (symbol: string, signal?: AbortSignal) =>
    get<TickerPayload>(`/api/ticker/${encodeURIComponent(symbol)}`, signal),
  prices: (symbol: string, range: PriceRange, signal?: AbortSignal) =>
    get<PricesPayload>(`/api/ticker/${encodeURIComponent(symbol)}/prices?range=${range}`, signal),
  financials: (symbol: string, freq: Freq, signal?: AbortSignal) =>
    get<FinancialsPayload>(`/api/ticker/${encodeURIComponent(symbol)}/financials?freq=${freq}`, signal),
  segments: (symbol: string, freq: Freq, signal?: AbortSignal) =>
    get<SegmentsPayload>(`/api/ticker/${encodeURIComponent(symbol)}/segments?freq=${freq}`, signal),
};
