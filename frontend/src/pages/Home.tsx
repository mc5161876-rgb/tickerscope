// Home (AC-1): wordmark + mark, large inline search, Recent chips — and (MAR-50 AC-2) the
// My Stocks list under the search box, so Mario can react to both front doors.
import { X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Banner } from "../components/Bits";
import { Mark, Wordmark } from "../components/Mark";
import { CompanyLogo } from "../components/CompanyLogo";
import { Search } from "../components/Search";
import { WatchlistTable } from "../components/WatchlistTable";
import { pushRecent, removeRecent, useRecent } from "../lib/recent";
import { useQuotes, useWatchlist } from "../lib/watchlist";

export function Home() {
  const navigate = useNavigate();
  const [recent] = useRecent();
  const wl = useWatchlist();
  const q = useQuotes(wl.tickers);

  return (
    <div className="home">
      <div className="home-brand">
        <Mark size={56} />
        <Wordmark />
        <div className="home-tag">Type a ticker. Get the one-page report — with every number explained.</div>
      </div>
      <div className="home-search">
        <Search
          mode="inline"
          autoFocus
          showRecentWhenEmpty={false}
          onSelect={(ticker, name) => {
            pushRecent(ticker, name);
            navigate(`/t/${ticker}`);
          }}
        />
      </div>

      <section className="home-mystocks" aria-label="My Stocks">
        <div className="section-head" style={{ marginBottom: 8 }}>
          <div className="caps">My Stocks</div>
          <Link to="/my-stocks" className="muted" style={{ fontSize: 12.5 }}>
            Manage →
          </Link>
        </div>
        {q.status === "error" && <Banner message="Data source unavailable — try again." onDismiss={() => {}} onRetry={q.reload} />}
        {wl.loaded && wl.items.length === 0 ? (
          <div className="empty-hint">No stocks yet — search above and tap Add.</div>
        ) : (
          <div className="card wl-card">
            <WatchlistTable items={wl.items} quotes={q.quotes} quotesStatus={q.status} onMove={(a, b) => void wl.move(a, b)} compact />
          </div>
        )}
      </section>

      <div className="recent" aria-label="Recent tickers">
        <div className="caps">Recent</div>
        {recent.length === 0 ? (
          <div className="empty-hint">Nothing yet — companies you open will show up here for one-tap access.</div>
        ) : (
          <div className="recent-row">
            {recent.map((r) => (
              <span key={r.ticker} style={{ display: "inline-flex" }}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => navigate(`/t/${r.ticker}`)}
                  style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 0 }}
                >
                  <CompanyLogo ticker={r.ticker} name={r.name} />
                  <b>{r.ticker}</b>
                  {r.name && <span className="muted">{r.name}</span>}
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-label={`Remove ${r.ticker} from recent`}
                  onClick={() => removeRecent(r.ticker)}
                  style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: "0 8px" }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
