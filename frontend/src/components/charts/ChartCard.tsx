// Card chrome shared by the Insights charts (AC-11): title, actions, watermark footer.
// MAR-50: expand opens fullscreen (onExpand) and Save image exports a PNG (onSave).
import { Download, Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { Mark } from "../Mark";

export function ChartCard({
  title,
  subtitle,
  controls,
  children,
  footRight,
  below,
  tall = false,
  onExpand,
  onSave,
  saving = false,
}: {
  title: string;
  subtitle?: string | null;
  controls?: ReactNode;
  children: ReactNode;
  footRight?: ReactNode;
  below?: ReactNode;
  tall?: boolean;
  onExpand?: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <section className="card chart-card" aria-label={title}>
      <div className="chart-head">
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle ? <p className="chart-sub">{subtitle}</p> : null}
        </div>
        <div className="chart-actions" data-export-skip="true">
          {controls}
          <button
            type="button"
            className="icon-btn"
            disabled={!onSave || saving}
            onClick={onSave}
            title="Save image (PNG, 2×)"
            aria-label={`Save ${title} as image`}
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!onExpand}
            onClick={onExpand}
            title={onExpand ? "Fullscreen" : "Fullscreen (not available)"}
            aria-label={`Open ${title} fullscreen`}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <div className={`chart-body${tall ? " tall" : ""}`}>{children}</div>
      {below}
      <div className="chart-foot">
        <span className="watermark">
          <Mark size={14} /> TickerScope
        </span>
        <span>{footRight}</span>
      </div>
    </section>
  );
}

export function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="chart-empty">{children}</div>;
}

export function ChartSkeleton() {
  return (
    <div className="chart-empty" aria-hidden="true">
      <span className="sk" style={{ width: "100%", height: "78%", borderRadius: 10 }} />
    </div>
  );
}
