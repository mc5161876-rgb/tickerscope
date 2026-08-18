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

export interface PeriodPoint {
  period_end: string;
  label: string;
  value: number;
}
export type Freq = "annual" | "quarterly";
export interface FinancialsPayload {
  symbol: string;
  freq: Freq;
  currency: string | null;
  revenue: PeriodPoint[];
  ebitda: PeriodPoint[];
  ebitda_method: "reported" | "calculated" | null;
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
};
