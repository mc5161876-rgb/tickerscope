// Generic loader: abortable fetch, keeps the last good payload on upstream failure (AC-18).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "./api";

export type Status = "idle" | "loading" | "ok" | "error" | "notfound";

export interface Resource<T> {
  status: Status;
  data: T | null;
  error: string | null;
  stale: boolean;
  staleAsOf: string | null;
  reload: () => void;
}

export function useResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<ApiResult<T>>,
): Resource<T> {
  const [status, setStatus] = useState<Status>(key ? "loading" : "idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [staleAsOf, setStaleAsOf] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!key) {
      setStatus("idle");
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    if (keyChanged) {
      // fresh symbol: drop the previous ticker's data so nothing bleeds across
      setData(null);
      setStale(false);
      setStaleAsOf(null);
    }
    setStatus("loading");
    setError(null);
    loader(ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        if (res.ok) {
          setData(res.data);
          setStale(false);
          setStaleAsOf(null);
          setStatus("ok");
        } else if (res.status === 404) {
          setData(null);
          setStatus("notfound");
        } else {
          setError(res.error);
          if (res.stale) {
            setData(res.stale);
            setStale(true);
            setStaleAsOf(res.staleAsOf ?? null);
          }
          setStatus("error");
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "unknown_error");
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [key, tick, loader]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { status, data, error, stale, staleAsOf, reload };
}
