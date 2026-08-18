// Shared bar chart for Revenue and EBITDA (AC-13, AC-14): labeled by fiscal period,
// tooltip shows value + period end date + data source (MAR-49 AC-2), negative bars in red.
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { PeriodPoint } from "../../lib/api";
import { abbreviate, fmtCurrency, fmtShortDate } from "../../lib/format";
import { useSize } from "../../lib/useSize";

function yTick(v: number) {
  if (v === 0) return "$0";
  return `${v < 0 ? "-" : ""}$${abbreviate(Math.abs(v))}`;
}

/** "SEC 10-K · filed Feb 6, 2026 · 0001018724-26-000004" | "yfinance" */
export function sourceLine(p: PeriodPoint): string {
  if (p.source === "sec") {
    const bits = [`SEC ${p.form ?? "filing"}`];
    if (p.filed) bits.push(`filed ${fmtShortDate(p.filed)}`);
    if (p.accession) bits.push(p.accession);
    return bits.join(" · ");
  }
  return "yfinance";
}

function BarTooltip({ active, payload, name }: { active?: boolean; payload?: { payload: PeriodPoint }[]; name: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tt">
      <div className="row">
        <span className="dot" style={{ background: p.value < 0 ? "var(--red)" : "var(--accent)" }} />
        <span className="k">{name}:</span>
        <span className="v">{fmtCurrency(p.value)}</span>
        {p.method === "calculated" && <span className="tag">calculated</span>}
      </div>
      <div className="d">
        {p.label} · period end {fmtShortDate(p.period_end)}
      </div>
      <div className="d src" data-source={p.source ?? "yfinance"}>
        {sourceLine(p)}
      </div>
    </div>
  );
}

export function BarSeriesChart({ points, name }: { points: PeriodPoint[]; name: string }) {
  const many = points.length > 12;
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className="chart-fill">
      {size.width > 0 && size.height > 0 && (
        <BarChart
          width={size.width}
          height={size.height}
          data={points}
          margin={{ top: 12, right: 6, bottom: 0, left: 0 }}
          barCategoryGap={many ? "22%" : "34%"}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={many ? "preserveStartEnd" : 0}
            minTickGap={12}
          />
          <YAxis
            orientation="right"
            width={54}
            tickFormatter={yTick}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<BarTooltip name={name} />} cursor={{ fill: "var(--accent-soft)" }} isAnimationActive={false} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={38}>
            {points.map((p) => (
              <Cell
                key={p.period_end}
                fill={p.value < 0 ? "var(--red)" : "var(--accent)"}
                fillOpacity={p.source === "yfinance" && points.some((q) => q.source === "sec") ? 0.55 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      )}
    </div>
  );
}
