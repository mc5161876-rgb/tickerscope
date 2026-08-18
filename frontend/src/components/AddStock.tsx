// Add Stock (MAR-50 AC-3, AC-6): the shared Search component in "add" mode — selecting adds
// without navigating; pasting/typing a list bulk-imports and reports invalid tokens in a toast.
import { parseBulk } from "../lib/bulkImport";
import { useWatchlist } from "../lib/watchlist";
import { Search } from "./Search";
import { useToast } from "./Toast";

export function AddStock({ autoFocus = false }: { autoFocus?: boolean }) {
  const wl = useWatchlist();
  const toast = useToast();

  const addOne = async (ticker: string, name?: string) => {
    const r = await wl.add(ticker);
    if (!r.ok) toast.push({ message: r.detail ?? `Couldn't add ${ticker}`, kind: "error" });
    else if (r.added) toast.push({ message: `${ticker}${name ? ` · ${name}` : ""} added to My Stocks`, kind: "success", duration: 2500 });
    else toast.push({ message: `${ticker} is already in My Stocks`, duration: 2500 });
  };

  const addMany = async (text: string) => {
    const { valid, invalid } = parseBulk(text);
    const already = valid.filter((t) => wl.has(t));
    const fresh = valid.filter((t) => !wl.has(t));
    if (fresh.length) {
      const ok = await wl.replace([...wl.tickers, ...fresh]);
      if (!ok) {
        toast.push({ message: "Couldn't save the list — try again", kind: "error" });
        return;
      }
    }
    const parts: string[] = [];
    if (fresh.length) parts.push(`Added ${fresh.length}: ${fresh.join(", ")}`);
    if (already.length) parts.push(`already there: ${already.join(", ")}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(", ")}`);
    if (!valid.length && !invalid.length) return;
    toast.push({ message: parts.join(" · "), kind: invalid.length ? "error" : "success", duration: invalid.length ? 8000 : 4000 });
  };

  return (
    <div className="addstock">
      <Search
        mode="inline"
        autoFocus={autoFocus}
        placeholder="Add a stock — type a name/ticker, or paste a list (AAPL, MSFT NASDAQ:GOOGL)"
        showRecentWhenEmpty={false}
        keepQueryOnSelect={false}
        onSelect={(t, name) => void addOne(t, name)}
        onBulk={(text) => void addMany(text)}
        selectLabel="Add"
      />
    </div>
  );
}
