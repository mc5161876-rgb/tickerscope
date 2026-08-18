// Bulk ticker import parser (MAR-50 AC-6): commas / newlines / spaces / semicolons / tabs,
// `NASDAQ:AAPL` -> `AAPL`, `brk.b` -> `BRK-B`. Never silently drops: invalid tokens are reported.
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export interface BulkParse {
  valid: string[]; // unique, normalised, in input order
  invalid: string[]; // raw tokens that did not parse
}

export function normalizeTicker(raw: string): string | null {
  let t = raw.trim().toUpperCase();
  if (!t) return null;
  if (t.includes(":")) t = t.slice(t.lastIndexOf(":") + 1); // NASDAQ:AAPL, NYSE:JPM
  t = t.replace(/^\$+/, ""); // $AAPL cashtags
  t = t.replace(/[.,;]+$/, ""); // trailing punctuation from prose
  t = t.replace(/[./]/g, "-"); // BRK.B -> BRK-B
  return TICKER_RE.test(t) ? t : null;
}

/** True when the text looks like more than one ticker (so Enter should bulk-import). */
export function looksLikeList(text: string): boolean {
  return /[\s,;]/.test(text.trim()) && text.trim().split(/[\s,;]+/).filter(Boolean).length > 1;
}

export function parseBulk(text: string): BulkParse {
  const tokens = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const tok of tokens) {
    const t = normalizeTicker(tok);
    if (!t) invalid.push(tok);
    else if (!valid.includes(t)) valid.push(t);
  }
  return { valid, invalid };
}
