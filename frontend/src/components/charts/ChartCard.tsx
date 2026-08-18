// Card chrome shared by the Insights charts (AC-11): title, actions, watermark footer,
// expand icon present-but-disabled (fullscreen ships in issue #3). `below` renders under the
// chart body (legends); `tall` gives the segment card a little more room.
import { Maximize2 } from "lucide-react";
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
}: {
  title: string;
  subtitle?: string | null;
  controls?: ReactNode;
  children: ReactNode;
  footRight?: ReactNode;
  below?: ReactNode;
  tall?: boolean;
}) {
  return (
    <section className="card chart-card" aria-label={title}>
      <div className="chart-head">
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle ? <p className="chart-sub">{subtitle}</p> : null}
        </div>
        <div className="chart-actions">
          {controls}
          <button type="button" className="icon-btn" disabled title="Fullscreen (coming in a later build)" aria-label="Fullscreen (coming in a later build)">
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
