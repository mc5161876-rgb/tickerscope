// Stock Price: split-adjusted daily close, area with soft gradient, dashed hover guide (AC-12).
// MAR-50 `detail` mode (fullscreen / export): finer ticks, crosshair (vertical + horizontal) with
// the date + close read-out; `hideTooltip` for static export.
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { PricePoint, PriceRange } from "../../lib/api";
import { abbreviate, fmtPrice, fmtShortDate } from "../../lib/format";
import { useSize } from "../../lib/useSize";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tickFormatter(range: PriceRange, detail: boolean) {
  return (iso: string) => {
    const y = iso.slice(0, 4);
    const m = +iso.slice(5, 7) - 1;
    if (range === "1y") return `${MONTHS[m]} '${y.slice(2)}`;
    if (detail && range === "5y") return `${MONTHS[m]} '${y.slice(2)}`;
    return y;
  };
}

function yTick(v: number) {
  if (Math.abs(v) >= 1000) return `$${abbreviate(v)}`;
  return `$${v % 1 === 0 ? v : v.toFixed(v < 10 ? 2 : 0)}`;
}

function PriceTooltip({ active, payload }: { active?: boolean; payload?: { payload: PricePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tt">
      <div className="row">
        <span className="dot" />
        <span className="k">Close:</span>
        <span className="v">{fmtPrice(p.close)}</span>
      </div>
      <div className="d">{fmtShortDate(p.date)}</div>
    </div>
  );
}

/** Detail-mode crosshair: the Tooltip cursor draws the vertical guide; this active-dot renderer
 *  adds the horizontal line through the hovered close plus a price tag at the axis. */
function CrosshairDot(props: { cx?: number; cy?: number; payload?: PricePoint; plotRight: number }) {
  const { cx, cy, payload, plotRight } = props;
  if (cx === undefined || cy === undefined) return null;
  return (
    <g className="crosshair" pointerEvents="none">
      <line x1={0} x2={plotRight} y1={cy} y2={cy} stroke="var(--text-muted)" strokeDasharray="3 4" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={4.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
      {payload && (
        <g>
          <rect x={plotRight + 2} y={cy - 10} width={58} height={20} rx={5} fill="var(--tooltip-bg)" stroke="var(--tooltip-border)" />
          <text x={plotRight + 31} y={cy + 4} textAnchor="middle" fontSize={11} fill="#fff" fontFamily="var(--mono)">
            {fmtPrice(payload.close)}
          </text>
        </g>
      )}
    </g>
  );
}

export function PriceChart({
  points,
  range,
  detail = false,
  hideTooltip = false,
}: {
  points: PricePoint[];
  range: PriceRange;
  detail?: boolean;
  hideTooltip?: boolean;
}) {
  const fmt = tickFormatter(range, detail);
  const gradId = useId();
  // dedupe x ticks: one per year (or per month for 1y / detail-5y)
  const seen = new Set<string>();
  const monthly = range === "1y" || (detail && range === "5y");
  const ticks = points
    .filter((p) => {
      const key = monthly ? p.date.slice(0, 7) : p.date.slice(0, 4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => p.date);
  const target = detail ? (range === "1y" ? 12 : range === "5y" ? 20 : 20) : range === "1y" ? 6 : 10;
  const stride = Math.max(1, Math.ceil(ticks.length / target));
  const shownTicks = ticks.filter((_, i) => i % stride === 0);
  const [ref, size] = useSize<HTMLDivElement>();

  return (
    <div ref={ref} className="chart-fill">
      {size.width > 0 && size.height > 0 && (
        <AreaChart width={size.width} height={size.height} data={points} margin={{ top: 12, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`priceFill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            ticks={shownTicks}
            tickFormatter={fmt}
            tick={{ fill: "var(--chart-axis)", fontSize: detail ? 12 : 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={detail ? 8 : 16}
          />
          <YAxis
            orientation="right"
            width={detail ? 62 : 54}
            domain={["auto", "auto"]}
            tickCount={detail ? 10 : 5}
            tickFormatter={yTick}
            tick={{ fill: "var(--chart-axis)", fontSize: detail ? 12 : 11 }}
            axisLine={false}
            tickLine={false}
          />
          {!hideTooltip && (
            <Tooltip
              content={<PriceTooltip />}
              cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 4", strokeWidth: 1 }}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="close"
            stroke="var(--accent)"
            strokeWidth={detail ? 2.25 : 2}
            fill={`url(#priceFill-${gradId})`}
            dot={false}
            activeDot={
              detail && !hideTooltip
                ? (dotProps: { cx?: number; cy?: number; payload?: PricePoint }) => (
                    <CrosshairDot key="xh" cx={dotProps.cx} cy={dotProps.cy} payload={dotProps.payload} plotRight={size.width - (detail ? 62 : 54) - 6} />
                  )
                : { r: 4, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }
            }
            isAnimationActive={false}
          />
        </AreaChart>
      )}
    </div>
  );
}
