// Click-to-reveal explainer popover (AC-8, AC-10, Design Direction §4).
// One open at a time is enforced by the ExplainerProvider; Esc / click-outside closes.
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { renderExample, type MetricValue } from "../lib/format";
import type { MetricDef } from "../lib/metrics";

interface Ctx {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}
const ExplainerCtx = createContext<Ctx>({ openId: null, setOpenId: () => {} });

export function ExplainerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-explainer-root]")) return;
      setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [openId]);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <ExplainerCtx.Provider value={value}>{children}</ExplainerCtx.Provider>;
}

export function useExplainer(id: string) {
  const { openId, setOpenId } = useContext(ExplainerCtx);
  const open = openId === id;
  const toggle = useCallback(() => setOpenId(open ? null : id), [open, id, setOpenId]);
  const close = useCallback(() => setOpenId(null), [setOpenId]);
  return { open, toggle, close };
}

export function ExplainerPopover({
  metric,
  ticker,
  value,
  onClose,
  now,
}: {
  metric: MetricDef;
  ticker: string;
  value: MetricValue;
  onClose: () => void;
  now?: Date;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 12) setAlignRight(true);
  }, []);
  const example = renderExample(metric, ticker, value, now);
  const isNull = example.startsWith("Not reported for");
  return (
    <div
      ref={ref}
      className={`popover${alignRight ? " right" : ""}`}
      role="dialog"
      aria-label={`${metric.label} explained`}
      data-explainer-root
    >
      <button type="button" className="close" aria-label="Close" onClick={onClose}>
        <X size={14} />
      </button>
      <h4>What it is</h4>
      <p>{metric.what}</p>
      <h4>How to read it</h4>
      <p>{metric.how_to_read}</p>
      <h4>For {ticker}</h4>
      <p className={`example${isNull ? " null" : ""}`}>{example}</p>
    </div>
  );
}
