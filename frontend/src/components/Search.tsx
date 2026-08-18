// One search component, two modes (AC-2): "inline" (Home) and "modal" (palette).
import { SearchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api, type SearchResult } from "../lib/api";
import { looksLikeList } from "../lib/bulkImport";
import { useRecent } from "../lib/recent";
import { useWatchlist } from "../lib/watchlist";

export interface SearchProps {
  mode: "inline" | "modal";
  autoFocus?: boolean;
  placeholder?: string;
  onSelect: (ticker: string, name?: string) => void;
  onEscape?: () => void;
  /** Show the Recent (and My Stocks) rows when the query is empty (modal palette does; Home shows its own). */
  showRecentWhenEmpty?: boolean;
  /** MAR-50: Enter/paste on a multi-ticker list ("AAPL, MSFT NASDAQ:GOOGL") calls this instead of onSelect. */
  onBulk?: (text: string) => void;
  /** MAR-50: keep the typed query after a selection (default false: clear it). */
  keepQueryOnSelect?: boolean;
  /** MAR-50: small trailing hint on each result row, e.g. "Add". */
  selectLabel?: string;
  /** Test hook / injection */
  fetcher?: (q: string, signal: AbortSignal) => Promise<SearchResult[]>;
}

const TICKER_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,7}$/;

export function avatarText(ticker: string): string {
  return ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
}

async function defaultFetcher(q: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await api.search(q, signal);
  return res.ok ? res.data.results : [];
}

export function Search({
  mode,
  autoFocus,
  placeholder = "Search a company or ticker…",
  onSelect,
  onEscape,
  showRecentWhenEmpty = mode === "modal",
  onBulk,
  keepQueryOnSelect = false,
  selectLabel,
  fetcher = defaultFetcher,
}: SearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(mode === "modal");
  const [loading, setLoading] = useState(false);
  const [recent] = useRecent();
  const { items: myStocks } = useWatchlist();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setActive(-1);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetcher(q, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResults(r.slice(0, 8));
          setActive(-1);
          setLoading(false);
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setResults([]);
          setLoading(false);
        }
      }
    }, 110);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, fetcher]);

  // click outside closes the inline dropdown
  useEffect(() => {
    if (mode !== "inline") return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [mode]);

  const select = useCallback(
    (r: SearchResult | { ticker: string; name?: string }) => {
      onSelect(r.ticker.toUpperCase(), r.name);
      if (!keepQueryOnSelect) {
        setQuery("");
        setResults([]);
      }
      setActive(-1);
      if (mode === "inline") setOpen(false);
    },
    [onSelect, mode, keepQueryOnSelect],
  );

  const bulk = useCallback(
    (text: string) => {
      onBulk?.(text);
      setQuery("");
      setResults([]);
      setActive(-1);
      if (mode === "inline") setOpen(false);
    },
    [onBulk, mode],
  );

  const exact = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\./g, "-");
    return results.find((r) => r.ticker === q) ?? null;
  }, [query, results]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setActive((i) => (i + 1) % results.length);
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const q = query.trim();
      if (onBulk && looksLikeList(q)) bulk(q);
      else if (active >= 0 && results[active]) select(results[active]);
      else if (exact) select(exact);
      else if (results.length) select(results[0]);
      else if (q && TICKER_RE.test(q)) select({ ticker: q.toUpperCase().replace(/\./g, "-") });
    } else if (e.key === "Escape") {
      if (query) {
        setQuery("");
        setResults([]);
      } else {
        setOpen(false);
        onEscape?.();
      }
    }
  };

  const isList = !!onBulk && looksLikeList(query);
  const showList = open && query.trim().length > 0 && !isList;
  const showRecent = showRecentWhenEmpty && !query.trim() && recent.length > 0;
  const showMyStocks = showRecentWhenEmpty && !query.trim() && myStocks.length > 0;

  return (
    <div className={`search search--${mode}`} ref={rootRef} role="search">
      <div className="search-input-wrap">
        <SearchIcon size={mode === "inline" ? 20 : 18} />
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          role="combobox"
          aria-label="Search a company or ticker"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (!onBulk) return;
            const text = e.clipboardData.getData("text");
            if (looksLikeList(text)) {
              e.preventDefault();
              bulk(text);
            }
          }}
        />
        {isList && open && (
          <button type="button" className="search-bulk" onClick={() => bulk(query)}>
            Add all ↵
          </button>
        )}
      </div>
      {(showList || showRecent || showMyStocks) && (
        <div className="search-results">
          {showList && (
            <>
              {results.length > 0 ? (
                <ul className="search-list" role="listbox" id={listId}>
                  {results.map((r, i) => (
                    <li
                      key={r.ticker}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="search-row"
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => select(r)}
                    >
                      <span className="avatar">{avatarText(r.ticker)}</span>
                      <span className="ticker">{r.ticker}</span>
                      <span className="name">{r.name}</span>
                      <span className="exchange">{r.exchange ?? ""}</span>
                      {selectLabel && <span className="select-hint">{selectLabel} ↵</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="search-empty" role="status">
                  {loading ? "Searching…" : `No matches for “${query.trim()}”. Press Enter to try it as a ticker.`}
                </div>
              )}
            </>
          )}
          {showRecent && (
            <>
              <div className="search-section caps">Recent</div>
              <div className="search-recent">
                {recent.map((r) => (
                  <button key={r.ticker} type="button" className="chip" onClick={() => select(r)}>
                    <span className="avatar">{avatarText(r.ticker)}</span>
                    <b>{r.ticker}</b>
                    {r.name && <span className="muted">{r.name}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {showMyStocks && (
            <>
              <div className="search-section caps">My Stocks</div>
              <div className="search-recent" data-section="my-stocks">
                {myStocks.map((s) => (
                  <button key={s.ticker} type="button" className="chip" onClick={() => select({ ticker: s.ticker })}>
                    <span className="avatar">{avatarText(s.ticker)}</span>
                    <b>{s.ticker}</b>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
