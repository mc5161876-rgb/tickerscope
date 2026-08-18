// My Stocks rows (MAR-50 AC-2..AC-4): name · price · day change · market cap · P/E · next earnings,
// drag handle + ↑/↓ reorder, optional remove. Rows link to /t/{TICKER}.
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fmtChange, fmtCurrency, fmtDateRelative, fmtPrice, fmtRatio } from "../lib/format";
import type { QuoteMap, WatchlistItem } from "../lib/watchlist";
import { Sk } from "./Bits";
import { avatarText } from "./Search";

export function WatchlistTable({
  items,
  quotes,
  quotesStatus,
  onMove,
  onRemove,
  compact = false,
}: {
  items: WatchlistItem[];
  quotes: QuoteMap;
  quotesStatus: "idle" | "loading" | "ok" | "error";
  onMove: (from: number, to: number) => void;
  onRemove?: (ticker: string) => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const onDragStart = (i: number) => (e: DragEvent) => {
    setDragFrom(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  };
  const onDragOver = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== i) setDragOver(i);
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
    setDragFrom(null);
    setDragOver(null);
    if (Number.isFinite(from) && from !== i) onMove(from, i);
  };
  const onDragEnd = () => {
    setDragFrom(null);
    setDragOver(null);
  };
  const rowKey = (ticker: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter") navigate(`/t/${ticker}`);
  };

  return (
    <div className={`wl${compact ? " compact" : ""}`} role="table" aria-label="My Stocks">
      <div className="wl-head" role="row">
        <span className="wl-grip" />
        <span className="caps">Company</span>
        <span className="caps r">Price</span>
        <span className="caps r">Day</span>
        <span className="caps r hide-sm">Market cap</span>
        <span className="caps r hide-sm">P/E</span>
        <span className="caps r hide-md">Next earnings</span>
        <span className="wl-actions" />
      </div>
      {items.map((it, i) => {
        const q = quotes[it.ticker];
        const loading = q === undefined && quotesStatus === "loading";
        const missing = q === null;
        const change = q?.quote.change ?? null;
        const dir = change === null ? 0 : change > 0 ? 1 : change < 0 ? -1 : 0;
        return (
          <div
            key={it.ticker}
            role="row"
            tabIndex={0}
            className={`wl-row${dragOver === i && dragFrom !== null && dragFrom !== i ? " over" : ""}${dragFrom === i ? " dragging" : ""}`}
            data-ticker={it.ticker}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={onDragOver(i)}
            onDrop={onDrop(i)}
            onDragEnd={onDragEnd}
            onClick={() => navigate(`/t/${it.ticker}`)}
            onKeyDown={rowKey(it.ticker)}
          >
            <span className="wl-grip" title="Drag to reorder" aria-hidden="true">
              <GripVertical size={14} />
            </span>
            <span className="wl-co">
              <span className="avatar">{avatarText(it.ticker)}</span>
              <span className="wl-names">
                <b>{it.ticker}</b>
                <span className="muted">
                  {loading ? <Sk w={120} h={12} /> : missing ? "Not found" : (q?.profile.name ?? q?.profile.short_name ?? "—")}
                </span>
              </span>
            </span>
            <span className="r num">{loading ? <Sk w={56} h={14} /> : fmtPrice(q?.quote.price)}</span>
            <span className={`r num ${dir > 0 ? "pos" : dir < 0 ? "neg" : "muted"}`}>
              {loading ? <Sk w={70} h={14} /> : fmtChange(change, q?.quote.change_percent)}
            </span>
            <span className="r num hide-sm">{loading ? <Sk w={50} h={14} /> : fmtCurrency(q?.metrics.market_cap as number | null | undefined)}</span>
            <span className="r num hide-sm">{loading ? <Sk w={44} h={14} /> : fmtRatio(q?.metrics.pe_ttm as number | null | undefined)}</span>
            <span className="r num hide-md muted">
              {loading ? <Sk w={110} h={14} /> : fmtDateRelative(q?.metrics.next_earnings_date as string | null | undefined)}
            </span>
            <span className="wl-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button type="button" className="icon-btn sm" aria-label={`Move ${it.ticker} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)}>
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="icon-btn sm"
                aria-label={`Move ${it.ticker} down`}
                disabled={i === items.length - 1}
                onClick={() => onMove(i, i + 1)}
              >
                <ArrowDown size={13} />
              </button>
              {onRemove && (
                <button type="button" className="icon-btn sm danger" aria-label={`Remove ${it.ticker}`} onClick={() => onRemove(it.ticker)}>
                  <X size={13} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
