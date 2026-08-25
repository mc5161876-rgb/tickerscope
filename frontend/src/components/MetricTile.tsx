// Mercury-style label-over-value tile (AC-6, AC-7) with the explainer trigger on the label (AC-8).
import {
  fmtMetric,
  fmtPrice,
  isNegativeDirectional,
  isNull,
  isRange,
  rangePosition,
  type MetricValue,
} from "../lib/format";
import type { MetricDef } from "../lib/metrics";
import { ExplainerPopover, useExplainer } from "./Explainer";

export function MetricTile({
  metric,
  value,
  ticker,
  price,
  now,
}: {
  metric: MetricDef;
  value: MetricValue;
  ticker: string;
  price?: number | null;
  now?: Date;
}) {
  const { open, toggle, close } = useExplainer(metric.id);
  const nul = isNull(metric.format, value);
  const text = fmtMetric(metric.format, value, now);
  const neg = isNegativeDirectional(metric, value);
  const isRangeTile = metric.format === "range" && isRange(value);
  const pos = isRangeTile ? rangePosition(value, price) : null;

  return (
    <div className="card tile" data-metric={metric.id} data-explainer-root>
      <button
        type="button"
        className="tile-label"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        title="Click to explain"
      >
        {metric.label}
      </button>
      {isRangeTile ? (
        <>
          <div className="range-bar" aria-hidden="true">
            {pos !== null && <b style={{ width: `${pos * 100}%` }} />}
            {pos !== null && <i style={{ left: `${pos * 100}%` }} />}
          </div>
          <div className="range-ends">
            <span>{nul ? "—" : fmtPrice(value.low)}</span>
            <span>{nul ? "—" : fmtPrice(value.high)}</span>
          </div>
        </>
      ) : (
        <div className={`tile-value num${nul ? " null" : ""}${neg ? " neg" : ""}`}>{text}</div>
      )}
      {open && <ExplainerPopover metric={metric} ticker={ticker} value={value} onClose={close} now={now} />}
    </div>
  );
}

export function MetricTileSkeleton({ label }: { label: string }) {
  return (
    <div className="card tile" aria-hidden="true">
      <span className="tile-label" style={{ cursor: "default" }}>
        {label}
      </span>
      <div className="tile-value">
        <span className="sk" style={{ width: "62%", height: 18 }} />
      </div>
    </div>
  );
}
