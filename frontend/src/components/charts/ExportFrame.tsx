// The share card (MAR-50 AC-9/AC-10): rendered offscreen at a fixed size, captured at 2x, downloaded.
// No UI chrome — just title, ticker + company, period, the chart, watermark, date, source line.
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { downloadDataUrl, nodeToPng } from "../../lib/exportPng";
import { Mark } from "../Mark";

export interface ExportSpec {
  filename: string;
  title: string;
  ticker: string;
  company: string | null;
  period: string;
  source: string; // "Source: yfinance" | "Source: SEC EDGAR + yfinance"
  /** render the chart at the given size (explicit width/height so Recharts draws offscreen) */
  render: (width: number, height: number) => ReactNode;
  theme: "dark" | "light";
  width?: number; // CSS px, default 1200 (2x -> 2400)
  height?: number; // chart area, default 560
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function today(): string {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Mount this while an export is pending; it captures itself and calls onDone. */
export function ExportStage({ spec, onDone, onError }: { spec: ExportSpec; onDone: (dataUrl: string) => void; onError: (e: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const width = spec.width ?? 1200;
  const chartH = spec.height ?? 560;

  // give the charts two frames + fonts a moment to lay out before capturing
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  useEffect(() => {
    if (!armed || !ref.current) return;
    const node = ref.current;
    const t = setTimeout(async () => {
      try {
        const bg = getComputedStyle(node).backgroundColor || (spec.theme === "light" ? "#ffffff" : "#0b0d10");
        const url = await nodeToPng(node, { pixelRatio: 2, backgroundColor: bg });
        onDone(url);
      } catch (e) {
        onError(e);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [armed, spec.theme, onDone, onError]);

  return createPortal(
    <div className="export-stage" aria-hidden="true">
      <div ref={ref} className="export-frame" data-theme={spec.theme} style={{ width }}>
        <div className="export-head">
          <div>
            <div className="export-title">{spec.title}</div>
            <div className="export-sub">
              <b>{spec.ticker}</b>
              {spec.company ? <span> · {spec.company}</span> : null}
              <span className="export-period"> · {spec.period}</span>
            </div>
          </div>
          <div className="export-brand">
            <Mark size={22} /> TickerScope
          </div>
        </div>
        <div className="export-chart" style={{ height: chartH }}>
          {spec.render(width - 56, chartH)}
        </div>
        <div className="export-foot">
          <span className="export-brand">
            <Mark size={14} /> TickerScope
          </span>
          <span className="export-meta">
            {spec.source} · generated {today()} · not investment advice
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Small controller: exportChart(spec) → renders the stage, downloads, resolves. */
export function useChartExport() {
  const [pending, setPending] = useState<{ spec: ExportSpec; resolve: (ok: boolean) => void } | null>(null);
  const exportChart = (spec: ExportSpec) =>
    new Promise<boolean>((resolve) => {
      setPending({ spec, resolve });
    });
  const stage = pending ? (
    <ExportStage
      spec={pending.spec}
      onDone={(url) => {
        downloadDataUrl(url, pending.spec.filename);
        window.dispatchEvent(new CustomEvent("tickerscope:exported", { detail: { filename: pending.spec.filename, dataUrl: url } }));
        pending.resolve(true);
        setPending(null);
      }}
      onError={(e) => {
        console.error("export failed", e);
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;
  return { exportChart, stage, exporting: pending !== null };
}
