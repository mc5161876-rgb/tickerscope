// "Revenue by Segment" card (MAR-49 AC-4, AC-5, AC-9): chart + legend + honest state messaging.
// MAR-50: `segmentMeta` + `SegmentBody` are shared with the fullscreen modal and the PNG export.
import { useMemo } from "react";
import type { CoverageState, Freq, SegmentsPayload, ViewKind } from "../../lib/api";
import { fmtCurrency } from "../../lib/format";
import type { Resource } from "../../lib/useResource";
import { Sk } from "../Bits";
import { ChartCard, ChartEmpty } from "./ChartCard";
import { SegmentChart, SegmentLegend, buildLegend, cardView, type LegendItem } from "./SegmentChart";

export interface SegmentMeta {
  title: string;
  subtitle: string;
  view: { kind: ViewKind; label: string };
  legend: LegendItem[];
  latest: SegmentsPayload["periods"][number] | undefined;
  drawable: boolean;
}

export function segmentMeta(payload: SegmentsPayload, freq: Freq): SegmentMeta {
  const view = cardView(payload);
  const legend = buildLegend(payload, view.kind);
  const latest = [...payload.periods].reverse().find((p) => p.render_mode !== "unavailable") ?? payload.periods.at(-1);
  const title = view.kind !== "business" ? view.label : "Revenue by Segment";
  let subtitle = freq === "quarterly" ? "Filed 10-Q quarters (Q4 needs the annual filing)" : "From 10-K filings, per fiscal year";
  if (view.kind !== "business") subtitle = `Reconciled filed breakdown${freq === "quarterly" ? ", by quarter" : ", per fiscal year"} - see note`;
  const drawable = payload.periods.some((p) => p.render_mode === "stacked" || p.alternative || p.consolidated_total !== null);
  return { title, subtitle, view, legend, latest, drawable };
}

/** State banner + chart (+ legend). Used by the card, fullscreen and export. */
export function SegmentBody({
  payload,
  meta,
  detail = false,
  hideTooltip = false,
  withLegend = false,
}: {
  payload: SegmentsPayload;
  meta: SegmentMeta;
  detail?: boolean;
  hideTooltip?: boolean;
  withLegend?: boolean;
}) {
  const stateLine = meta.latest
    ? stateBanner(meta.latest.coverage_state, meta.latest.message, meta.latest.consolidated_total, meta.latest.label, meta.view.kind)
    : null;
  return (
    <>
      {stateLine}
      {meta.drawable ? <SegmentChart payload={payload} detail={detail} hideTooltip={hideTooltip} /> : <ChartEmpty>Not available</ChartEmpty>}
      {withLegend && <SegmentLegend items={meta.legend} resegmentations={payload.resegmentations} periods={payload.periods} />}
    </>
  );
}

export function SegmentCard({
  res,
  freq,
  onExpand,
  onSave,
  saving,
}: {
  res: Resource<SegmentsPayload>;
  freq: Freq;
  onExpand?: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  const payload = res.data;
  const meta = useMemo(() => (payload && payload.status === "ok" ? segmentMeta(payload, freq) : null), [payload, freq]);

  // ---- states -----------------------------------------------------------------
  if (res.status === "loading" && !payload) {
    return (
      <ChartCard title="Revenue by Segment" subtitle="Reading SEC filings…" tall>
        <div className="chart-empty reading" aria-busy="true">
          <Sk h={12} w="40%" />
          <span className="sk" />
        </div>
      </ChartCard>
    );
  }
  if (!payload || payload.status === "not_configured") {
    return (
      <ChartCard title="Revenue by Segment" subtitle="SEC EDGAR" tall>
        <ChartEmpty>
          <div>
            <b>SEC access not configured</b>
            <div className="muted" style={{ marginTop: 4 }}>
              Set <code>SEC_USER_AGENT</code> in <code>.env</code> and restart. See Settings.
            </div>
          </div>
        </ChartEmpty>
      </ChartCard>
    );
  }
  if (payload.status !== "ok" || payload.periods.length === 0 || !meta) {
    return (
      <ChartCard title="Revenue by Segment" subtitle="SEC EDGAR" tall>
        <ChartEmpty>Not available</ChartEmpty>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={meta.title}
      subtitle={meta.subtitle}
      tall
      footRight={payload.filings_read.length ? `${payload.filings_read.length} filings read` : null}
      below={<SegmentLegend items={meta.legend} resegmentations={payload.resegmentations} periods={payload.periods} />}
      onExpand={meta.drawable ? onExpand : undefined}
      onSave={meta.drawable ? onSave : undefined}
      saving={saving}
    >
      <SegmentBody payload={payload} meta={meta} />
    </ChartCard>
  );
}

function stateBanner(state: CoverageState, message: string | undefined, total: number | null, label: string, kind: string | undefined) {
  switch (state) {
    case "single_segment":
      return (
        <div className="seg-state" data-state={state}>
          <span>
            <b>Reports as one segment</b> — {message ?? "no breakdown to chart."}
          </span>
          <span className="num">{label}: {fmtCurrency(total)}</span>
        </div>
      );
    case "needs_review":
      return (
        <div className="seg-state" data-state={state}>
          <span>
            <b>Segment breakdown withheld</b> — didn't reconcile to filed total.{message ? ` ${message.replace(/^Segment breakdown withheld - the filed segments did not reconcile to the filed total\.?/, "").trim()}` : ""}
          </span>
          <span className="num">{label}: {fmtCurrency(total)}</span>
        </div>
      );
    case "withheld_alternative":
      return (
        <div className="seg-state" data-state={state}>
          <span>
            <b>Business-segment view withheld</b> — it didn't reconcile to the filed total; showing the reconciled alternative under its real name.
          </span>
        </div>
      );
    case "unavailable":
      return (
        <div className="seg-state" data-state={state}>
          <span>
            <b>Not available</b> — {message ?? "no reconciled breakdown in the latest filing."}
          </span>
        </div>
      );
    default:
      if (kind && kind !== "business") {
        return (
          <div className="seg-state" data-state="alt_view">
            <span>
              <b>No business-segment breakdown filed</b> — showing the reconciled filed alternative under its real name.
            </span>
          </div>
        );
      }
      return null;
  }
}
