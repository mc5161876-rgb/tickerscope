// /my-stocks (MAR-50 AC-3, AC-4): full-width watchlist + Add Stock + remove with undo.
import { AddStock } from "../components/AddStock";
import { Banner } from "../components/Bits";
import { useToast } from "../components/Toast";
import { WatchlistTable } from "../components/WatchlistTable";
import { useQuotes, useWatchlist } from "../lib/watchlist";

export function MyStocks() {
  const wl = useWatchlist();
  const q = useQuotes(wl.tickers);
  const toast = useToast();

  const remove = async (ticker: string) => {
    const before = wl.tickers.slice();
    const ok = await wl.remove(ticker);
    if (!ok) {
      toast.push({ message: `Couldn't remove ${ticker}`, kind: "error" });
      return;
    }
    toast.push({
      message: `${ticker} removed from My Stocks`,
      duration: 5000,
      action: { label: "Undo", onClick: () => void wl.replace(before) },
    });
  };

  return (
    <div className="mystocks">
      <div className="section-head">
        <h1 className="section-title" style={{ margin: 0 }}>
          My Stocks
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {wl.items.length} of 100
        </span>
      </div>
      <AddStock autoFocus />
      {q.status === "error" && <Banner message="Data source unavailable — try again." onDismiss={() => {}} onRetry={q.reload} />}
      {wl.loaded && wl.items.length === 0 ? (
        <div className="card placeholder" style={{ maxWidth: "none" }}>
          <p className="muted" style={{ margin: 0 }}>
            No stocks yet — add one above, or paste a list from anywhere (commas, spaces or new lines; “NASDAQ:AAPL” works too).
          </p>
        </div>
      ) : (
        <div className="card wl-card">
          <WatchlistTable items={wl.items} quotes={q.quotes} quotesStatus={q.status} onMove={(a, b) => void wl.move(a, b)} onRemove={(t) => void remove(t)} />
        </div>
      )}
      <p className="footnote">Drag the handle or use ↑ ↓ to reorder. Order is saved on the server and shared with the Dashboard.</p>
    </div>
  );
}
