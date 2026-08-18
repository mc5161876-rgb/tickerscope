// "Recent" tickers in localStorage (AC-1, AC-2). Max 8, most recent first.
import { useCallback, useEffect, useState } from "react";

const KEY = "tickerscope.recent";
const MAX = 8;
const EVENT = "tickerscope:recent";

export interface RecentEntry {
  ticker: string;
  name?: string;
}

function read(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.ticker === "string")
      .map((e) => ({ ticker: String(e.ticker).toUpperCase(), name: e.name ? String(e.name) : undefined }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function write(list: RecentEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage may be unavailable; recents are best-effort */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function getRecent(): RecentEntry[] {
  return read();
}

export function pushRecent(ticker: string, name?: string) {
  const t = ticker.toUpperCase();
  const rest = read().filter((e) => e.ticker !== t);
  const prev = read().find((e) => e.ticker === t);
  write([{ ticker: t, name: name ?? prev?.name }, ...rest]);
}

export function removeRecent(ticker: string) {
  write(read().filter((e) => e.ticker !== ticker.toUpperCase()));
}

export function clearRecent() {
  write([]);
}

export function useRecent(): [RecentEntry[], typeof pushRecent] {
  const [list, setList] = useState<RecentEntry[]>(() => (typeof window === "undefined" ? [] : read()));
  useEffect(() => {
    const onChange = () => setList(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const push = useCallback((t: string, n?: string) => pushRecent(t, n), []);
  return [list, push];
}
