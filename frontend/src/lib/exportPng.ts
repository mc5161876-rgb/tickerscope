// Share-card export helpers (MAR-50 AC-9, AC-10): filename builder + DOM node -> PNG (2x).
import { toPng } from "html-to-image";

export type ChartKey =
  | "price"
  | "revenue"
  | "ebitda"
  | "segments"
  // MAR-56: cash flow & earnings
  | "ocf"
  | "fcf"
  | "capex"
  | "netincome";

/** `{TICKER}-{chart}-{YYYY-MM-DD}.png` */
export function exportFilename(ticker: string, chart: ChartKey | string, date: Date = new Date()): string {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  const c = String(chart).toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${t}-${c}-${y}-${m}-${d}.png`;
}

/** "Annual · FY2016–FY2025" | "Quarterly · Q3 '21–Q2 '26" | "Daily close · 10Y" */
export function periodLabel(kind: ChartKey, opts: { freq?: "annual" | "quarterly"; range?: string; first?: string; last?: string }): string {
  if (kind === "price") return `Daily close · ${(opts.range ?? "").toUpperCase() || "10Y"}`;
  const f = opts.freq === "quarterly" ? "Quarterly" : "Annual";
  if (opts.first && opts.last) return `${f} · ${opts.first}–${opts.last}`;
  return f;
}

export async function nodeToPng(node: HTMLElement, opts: { pixelRatio?: number; backgroundColor?: string } = {}): Promise<string> {
  return toPng(node, {
    pixelRatio: opts.pixelRatio ?? 2,
    backgroundColor: opts.backgroundColor,
    cacheBust: true,
    // html-to-image inlines computed styles; skip nothing so CSS variables resolve to colours
    filter: (n) => !(n instanceof HTMLElement && n.dataset.exportSkip === "true"),
  });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Width in CSS px of a data URL PNG (used by the smoke harness / tests). */
export function pngWidth(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
