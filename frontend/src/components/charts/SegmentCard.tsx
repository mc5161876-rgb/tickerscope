// "Revenue by Segment" card (MAR-49 AC-4, AC-5, AC-9): chart + legend + honest state messaging.
import { useMemo } from "react";
import type { Freq, SegmentsPayload } from "../../lib/api";
import { fmtCurrency } from "../../lib/format";
import type { Resource } from "../../lib/useResource";
import { Sk } from "../Bits";
import { ChartCard, ChartEmpty } from "./ChartCard";
import { SegmentChart, SegmentLegend, buildLegend, cardView } from "./SegmentChart";

export function SegmentCard({ res, freq }: { res: Resource<SegmentsPayload>; freq: Freq }) {
  const payload = res.data;
  const view = useMemo(() => (payload ? cardView(payload) : null), [payload]);
  const legend = useMemo(() => (payload && view ? buildLegend(payload, view.kind) : []), [payload, view]);
  const latest = payload ? [...payload.periods].reverse().find((p) => p.render_mode !== "unavailable") ?? payload.periods.at(-1) : undefined;

  const title = view && view.kind !== "business" ? view.label : "Revenue by Segment";
  let subtitle: string | null = freq === "quarterly" ? "Filed 10-Q quarters (Q4 needs the annual filing)" : "From 10-K filings, per fiscal year";
  if (view && view.kind !== "business") subtitle = `Reconciled filed breakdown${freq === "quarterly" ? ", by quarter" : ", per fiscal year"} - see note`;

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
  if (payload.status !== "ok" || payload.periods.length === 0) {
    return (
      <ChartCard title="Revenue by Segment" subtitle="SEC EDGAR" tall>
        <ChartEmpty>{payload.status === "error" ? "Not available" : "Not available"}</ChartEmpty>
      </ChartCard>
    );
  }

  const stateLine = latest ? stateBanner(latest.coverage_state, latest.message, latest.consolidated_total, latest.label, view?.kind) : null;
  const drawable = payload.periods.some((p) => p.render_mode === "stacked" || p.alternative);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      tall
      footRight={payload.filings_read.length ? `${payload.filings_read.length} filings read` : null}
      below={<SegmentLegend items={legend} resegmentations={payload.resegmentations} periods={payload.periods} />}
    >
      {stateLine}
      {drawable || payload.periods.some((p) => p.consolidated_total !== null) ? (
        <SegmentChart payload={payload} />
      ) : (
        <ChartEmpty>Not available</ChartEmpty>
      )}
    </ChartCard>
  );
}

function stateBanner(
  state: SegmentsPayload["periods"][number]["coverage_state"],
  message: string | undefined,
  total: number | null,
  label: string,
  kind: string | undefined,
) {
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
