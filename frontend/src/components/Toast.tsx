// Mercury-style toast with optional undo (Design Direction §2; MAR-50 AC-3, AC-6).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastSpec {
  id?: string;
  message: string;
  kind?: "info" | "error" | "success";
  /** Optional action, e.g. Undo. The toast closes after the action fires. */
  action?: { label: string; onClick: () => void };
  /** ms; default 5000, actions default 5000 (AC-3 says a 5-second undo) */
  duration?: number;
}
interface ToastItem extends ToastSpec {
  id: string;
}
interface Ctx {
  push: (t: ToastSpec) => string;
  dismiss: (id: string) => void;
}
const ToastCtx = createContext<Ctx>({ push: () => "", dismiss: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());
  const dismiss = useCallback((id: string) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) window.clearTimeout(h);
    timers.current.delete(id);
  }, []);
  const push = useCallback(
    (spec: ToastSpec) => {
      const id = spec.id ?? `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      setItems((list) => [...list.filter((t) => t.id !== id), { ...spec, id }]);
      const h = window.setTimeout(() => dismiss(id), spec.duration ?? 5000);
      timers.current.set(id, h);
      return id;
    },
    [dismiss],
  );
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? "info"}`} role="status">
            <span className="msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="act"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
