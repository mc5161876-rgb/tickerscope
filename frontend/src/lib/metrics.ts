// Typed access to shared/metrics.json (single source of truth, see AC-9).
import registryJson from "../../../shared/metrics.json";

export type MetricFormat =
  | "currency"
  | "currency_share"
  | "ratio"
  | "percent"
  | "percent_signed"
  | "number"
  | "decimal"
  | "date"
  | "date_relative"
  | "range";

export interface MetricDef {
  id: string;
  label: string;
  group: string;
  format: MetricFormat;
  source_key: string;
  directional: boolean;
  what: string;
  how_to_read: string;
  example_template: string;
}

export interface MetricGroup {
  id: string;
  label: string;
}

interface Registry {
  groups: MetricGroup[];
  metrics: MetricDef[];
}

export const registry = registryJson as unknown as Registry;
export const METRIC_GROUPS: MetricGroup[] = registry.groups;
export const METRICS: MetricDef[] = registry.metrics;
export const METRIC_BY_ID: Record<string, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.id, m]),
);

export function metricsInGroup(groupId: string): MetricDef[] {
  return METRICS.filter((m) => m.group === groupId);
}
