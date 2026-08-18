// My Stocks watchlist: API + hook with optimistic updates (MAR-50 AC-1..AC-6).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TickerPayload } from "./api";

export interface WatchlistItem {
  ticker: string;
  added_at: string;
  position: number;
}
export interface WatchlistPayload {
  items: WatchlistItem[];
  count: number;
  max: number;
  added?: boolean;
  removed?: boolean;
}
export type QuoteMap = Record<string, TickerPayload | null>;

const EVENT = "tickerscope:watchlist";

async function req<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) return { ok: true, data: body as T };
  const b = (body ?? {}) as { error?: string; detail?: string };
  return { ok: false, status: res.status, error: b.error ?? `http_${res.status}`, detail: b.detail };
}

export const watchlistApi = {
  list: () => req<WatchlistPayload>("/api/watchlist"),
  replace: (tickers: string[]) => req<WatchlistPayload>("/api/watchlist", { method: "PUT", body: JSON.stringify({ tickers }) }),
  add: (ticker: string) => req<WatchlistPayload>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "POST" }),
  remove: (ticker: string) => req<WatchlistPayload>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" }),
  quotes: (symbols: string[], signal?: AbortSignal) =>
    req<{ quotes: QuoteMap; stale: string[] }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { signal }),
};

// ---- pure helpers (unit-tested) ------------------------------------------------------
/** Move the item at `from` to index `to` (clamped). Returns a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const n = list.length;
  if (from < 0 || from >= n) return list.slice();
  const target = Math.max(0, Math.min(n - 1, to));
  if (target === from) return list.slice();
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}
export const moveUp = <T>(list: T[], index: number) => moveItem(list, index, index - 1);
export const moveDown = <T>(list: T[], index: number) => moveItem(list, index, index + 1);

// ---- module-level store so Home, /my-stocks and the ticker header stay in sync ---------
let cached: WatchlistItem[] | null = null;
function publish(items: WatchlistItem[]) {
  cached = items;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: items }));
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistItem[]>(cached ?? []);
  const [loaded, setLoaded] = useState(cached !== null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const r = await watchlistApi.list();
    if (r.ok) {
      publish(r.data.items);
      setError(null);
    } else setError(r.error);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const onChange = (e: Event) => setItems((e as CustomEvent<WatchlistItem[]>).detail);
    window.addEventListener(EVENT, onChange);
    if (cached === null) void refresh();
    return () => window.removeEventListener(EVENT, onChange);
  }, [refresh]);

  const tickers = useMemo(() => items.map((i) => i.ticker), [items]);
  const has = useCallback((t: string) => tickers.includes(t.toUpperCase()), [tickers]);

  const add = useCallback(async (ticker: string): Promise<{ ok: boolean; added?: boolean; detail?: string }> => {
    const t = ticker.toUpperCase().trim();
    const r = await watchlistApi.add(t);
    if (r.ok) {
      publish(r.data.items);
      return { ok: true, added: r.data.added };
    }
    return { ok: false, detail: r.detail ?? r.error };
  }, []);

  const remove = useCallback(async (ticker: string) => {
    const t = ticker.toUpperCase();
    const prev = cached ?? [];
    publish(prev.filter((i) => i.ticker !== t).map((i, k) => ({ ...i, position: k })));
    const r = await watchlistApi.remove(t);
    if (r.ok) publish(r.data.items);
    else publish(prev);
    return r.ok;
  }, []);

  /** Whole-list replace (used for reorder + undo). Optimistic; reverts on failure. */
  const replace = useCallback(async (next: string[]) => {
    if (busy.current) return false;
    busy.current = true;
    const prev = cached ?? [];
    const prevBy = new Map(prev.map((i) => [i.ticker, i]));
    publish(next.map((t, k) => ({ ticker: t, added_at: prevBy.get(t)?.added_at ?? new Date().toISOString(), position: k })));
    const r = await watchlistApi.replace(next);
    if (r.ok) publish(r.data.items);
    else publish(prev);
    busy.current = false;
    return r.ok;
  }, []);

  const move = useCallback((from: number, to: number) => replace(moveItem(tickers, from, to)), [replace, tickers]);

  return { items, tickers, loaded, error, has, add, remove, replace, move, refresh };
}

/** Batched quotes for the given symbols; refetches when the symbol set changes. */
export function useQuotes(symbols: string[]) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key) {
      setQuotes({});
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    watchlistApi
      .quotes(key.split(","), ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.ok) {
          setQuotes((prev) => ({ ...prev, ...r.data.quotes }));
          setStatus("ok");
          setError(null);
        } else {
          setStatus("error");
          setError(r.error);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus("error");
      });
    return () => ctrl.abort();
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { quotes, status, error, reload };
}
