// Stock Price: split-adjusted daily close, area with soft gradient, dashed hover guide (AC-12).
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { PricePoint, PriceRange } from "../../lib/api";
import { abbreviate, fmtPrice, fmtShortDate } from "../../lib/format";
import { useSize } from "../../lib/useSize";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tickFormatter(range: PriceRange) {
  return (iso: string) => {
    const y = iso.slice(0, 4);
    const m = +iso.slice(5, 7) - 1;
    if (range === "1y") return `${MONTHS[m]} '${y.slice(2)}`;
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

export function PriceChart({ points, range }: { points: PricePoint[]; range: PriceRange }) {
  const fmt = tickFormatter(range);
  // dedupe x ticks: one per year (or per ~2 months for 1y)
  const seen = new Set<string>();
  const ticks = points
    .filter((p) => {
      const key = range === "1y" ? p.date.slice(0, 7) : p.date.slice(0, 4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => p.date);
  const stride = Math.max(1, Math.ceil(ticks.length / (range === "1y" ? 6 : 10)));
  const shownTicks = ticks.filter((_, i) => i % stride === 0);
  const [ref, size] = useSize<HTMLDivElement>();

  return (
    <div ref={ref} className="chart-fill">
      {size.width > 0 && size.height > 0 && (
      <AreaChart width={size.width} height={size.height} data={points} margin={{ top: 12, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          ticks={shownTicks}
          tickFormatter={fmt}
          tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          orientation="right"
          width={54}
          domain={["auto", "auto"]}
          tickFormatter={yTick}
          tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<PriceTooltip />}
          cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 4", strokeWidth: 1 }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="close"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#priceFill)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
      )}
    </div>
  );
}
