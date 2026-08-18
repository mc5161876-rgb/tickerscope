// Revenue by Segment (MAR-49 AC-4..AC-7): stacked bars per period, one colour per segment,
// muted corporate, consolidated tick, legend under the chart, re-segmentation divider,
// provenance tooltip + click-through to the filing on EDGAR. Non-drawable states render honestly.
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { SegmentPeriod, SegmentRow, SegmentsPayload, ViewKind } from "../../lib/api";
import { abbreviate, fmtCurrency, fmtShortDate } from "../../lib/format";
import { useSize } from "../../lib/useSize";

const SEG_COLORS = ["var(--seg-1)", "var(--seg-2)", "var(--seg-3)", "var(--seg-4)", "var(--seg-5)", "var(--seg-6)", "var(--seg-7)", "var(--seg-8)"];
const CORP_COLOR = "var(--seg-corp)";

export interface LegendItem {
  /** stack key: normalised label, so a renamed concept with the same label shares colour + slot */
  key: string;
  label: string;
  type: SegmentRow["type"];
  color: string;
  concepts: string[];
}

/** normalise a label for identity: case, punctuation, "&" vs "and" */
export function labelKey(label: string): string {
  return `k_${label.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "")}`;
}

/** Which breakdown does the card draw? Decided by the newest period. */
export function cardView(payload: SegmentsPayload): { kind: ViewKind; label: string } {
  const latest = [...payload.periods].reverse().find((p) => p.render_mode !== "unavailable");
  if (!latest) return { kind: "business", label: "Revenue by Segment" };
  if (latest.coverage_state === "withheld_alternative" && latest.alternative) {
    return { kind: latest.alternative.kind, label: latest.alternative.label };
  }
  return latest.view ?? { kind: "business", label: "Revenue by Segment" };
}

/** Rows a period contributes to the chosen view (or null when it has no drawable stack). */
export function rowsForView(p: SegmentPeriod, kind: ViewKind): SegmentRow[] | null {
  if (p.render_mode === "stacked" && (p.view?.kind ?? "business") === kind) return p.rows;
  if (p.alternative && p.alternative.kind === kind && p.alternative.rows.length) return p.alternative.rows;
  return null;
}

export function buildLegend(payload: SegmentsPayload, kind: ViewKind): LegendItem[] {
  const seen = new Map<string, LegendItem>();
  let i = 0;
  for (const p of [...payload.periods].reverse()) {
    // newest first so the newest label text wins
    const rows = rowsForView(p, kind);
    if (!rows) continue;
    for (const r of rows) {
      const key = labelKey(r.label);
      const existing = seen.get(key);
      if (existing) {
        if (!existing.concepts.includes(r.concept)) existing.concepts.push(r.concept);
        continue;
      }
      const corp = r.type === "corporate_nonsegment";
      seen.set(key, {
        key,
        label: r.label,
        type: r.type,
        color: corp ? CORP_COLOR : SEG_COLORS[i++ % SEG_COLORS.length],
        concepts: [r.concept],
      });
    }
  }
  const items = [...seen.values()];
  items.sort((a, b) => Number(a.type === "corporate_nonsegment") - Number(b.type === "corporate_nonsegment"));
  return items;
}

interface Datum {
  label: string;
  period: SegmentPeriod;
  drawable: boolean;
  total: number | null;
  outline: number | null; // consolidated total drawn as an outline when no stack is drawable
  [key: string]: unknown;
}

function yTick(v: number) {
  return v === 0 ? "$0" : `${v < 0 ? "-" : ""}$${abbreviate(Math.abs(v))}`;
}

function SegTooltip({
  active,
  payload,
  legend,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; payload: Datum }[];
  legend: Map<string, LegendItem>;
}) {
  if (!active || !payload?.length) return null;
  const hit = payload[0];
  const d = hit.payload;
  const p = d.period;
  const prov = p.provenance;
  const provLine = [prov.form ? `${prov.form}` : null, prov.filed ? `filed ${fmtShortDate(prov.filed)}` : null, prov.accession]
    .filter(Boolean)
    .join(" · ");
  if (!d.drawable || hit.dataKey === "outline") {
    return (
      <div className="tt">
        <div className="row">
          <span className="dot" style={{ background: "var(--text-muted)" }} />
          <span className="k">{p.label} · consolidated:</span>
          <span className="v">{fmtCurrency(p.consolidated_total)}</span>
        </div>
        <div className="d">{p.message ?? p.coverage_state}</div>
        {provLine && <div className="d src">{provLine}</div>}
      </div>
    );
  }
  const item = legend.get(String(hit.dataKey));
  const stack = d.total ?? 0;
  const value = typeof hit.value === "number" ? hit.value : 0;
  const pct = stack > 0 ? (value / stack) * 100 : null;
  return (
    <div className="tt">
      <div className="row">
        <span className="dot" style={{ background: item?.color ?? "var(--accent)" }} />
        <span className="k">{item?.label ?? String(hit.dataKey)}:</span>
        <span className="v">{fmtCurrency(value)}</span>
        {pct !== null && <span className="tag">{pct.toFixed(1)}% of stack</span>}
      </div>
      <div className="d">
        {p.label} · consolidated {fmtCurrency(p.consolidated_total)}
        {p.coverage_state === "as_filed_with_bridge" ? " · reconciled via bridge" : ""}
      </div>
      {provLine && <div className="d src">{provLine}</div>}
      {prov.edgar_url && <div className="d act">click bar to open the filing on EDGAR ↗</div>}
    </div>
  );
}

/** Custom dot for the consolidated-total line: a short horizontal tick. */
function TotalTick(props: { cx?: number; cy?: number; payload?: Datum }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload || payload.total === null || !payload.drawable) return null;
  return <line x1={cx - 9} x2={cx + 9} y1={cy} y2={cy} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" />;
}

export function SegmentChart({ payload }: { payload: SegmentsPayload }) {
  const view = useMemo(() => cardView(payload), [payload]);
  const legend = useMemo(() => buildLegend(payload, view.kind), [payload, view.kind]);
  const legendMap = useMemo(() => new Map(legend.map((l) => [l.key, l])), [legend]);
  const data: Datum[] = useMemo(
    () =>
      payload.periods.map((p) => {
        const rows = rowsForView(p, view.kind);
        const d: Datum = { label: p.label, period: p, drawable: !!rows, total: null, outline: null };
        if (rows) {
          let total = 0;
          for (const r of rows) {
            const k = labelKey(r.label);
            d[k] = ((d[k] as number | undefined) ?? 0) + r.value;
            total += r.value;
          }
          d.total = p.consolidated_total ?? total;
        } else {
          d.outline = p.consolidated_total;
        }
        return d;
      }),
    [payload, view.kind],
  );
  const resegLabels = useMemo(
    () => payload.resegmentations.map((end) => data.find((d) => d.period.period_end === end)?.label).filter(Boolean) as string[],
    [payload.resegmentations, data],
  );
  const [ref, size] = useSize<HTMLDivElement>();
  const many = data.length > 12;

  const openFiling = (d: Datum) => {
    const url = d.period.provenance.edgar_url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="segchart">
      <div ref={ref} className="chart-fill">
        {size.width > 0 && size.height > 0 && (
          <ComposedChart
            width={size.width}
            height={size.height}
            data={data}
            margin={{ top: 14, right: 6, bottom: 0, left: 0 }}
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
            <Tooltip content={<SegTooltip legend={legendMap} />} shared={false} cursor={{ fill: "var(--accent-soft)" }} isAnimationActive={false} />
            {legend.map((l) => (
              <Bar
                key={l.key}
                dataKey={l.key}
                stackId="seg"
                fill={l.color}
                isAnimationActive={false}
                maxBarSize={40}
                style={{ cursor: "pointer" }}
                onClick={(entry: unknown) => openFiling((entry as { payload: Datum }).payload)}
              />
            ))}
            {/* consolidated total for periods without a drawable stack: outline only, never a fake stack */}
            <Bar
              dataKey="outline"
              stackId="seg"
              fill="transparent"
              stroke="var(--text-faint)"
              strokeDasharray="3 3"
              isAnimationActive={false}
              maxBarSize={40}
              onClick={(entry: unknown) => openFiling((entry as { payload: Datum }).payload)}
            />
            <Line dataKey="total" stroke="none" dot={<TotalTick />} activeDot={false} isAnimationActive={false} legendType="none" />
            {/* re-segmentation boundary (AC-6): dashed divider at the start of the changed period */}
            {resegLabels.map((lbl) => (
              <ReferenceLine
                key={lbl}
                x={lbl}
                position="start"
                stroke="var(--text-muted)"
                strokeDasharray="3 4"
                className="reseg"
                label={{ value: "re-segmented", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 10, offset: 4 }}
              />
            ))}
          </ComposedChart>
        )}
      </div>
    </div>
  );
}

export function SegmentLegend({ items, resegmentations, periods }: { items: LegendItem[]; resegmentations: string[]; periods: SegmentPeriod[] }) {
  const flagged = resegmentations
    .map((end) => periods.find((p) => p.period_end === end)?.label)
    .filter(Boolean) as string[];
  const hasOutline = periods.some((p) => p.render_mode !== "stacked" && p.consolidated_total !== null);
  return (
    <div className="seg-legend" aria-label="Legend">
      {items.map((l) => (
        <span key={l.key} className={`seg-key${l.type === "corporate_nonsegment" ? " corp" : ""}`} title={l.concepts.join(", ")}>
          <i style={{ background: l.color }} /> {l.label}
        </span>
      ))}
      <span className="seg-key faint">
        <i className="tick" /> consolidated total
      </span>
      {hasOutline && (
        <span className="seg-key faint">
          <i className="outline" /> total, no breakdown
        </span>
      )}
      {flagged.length > 0 && <span className="seg-key faint reseg-note">re-segmented at {flagged.join(", ")}</span>}
    </div>
  );
}
