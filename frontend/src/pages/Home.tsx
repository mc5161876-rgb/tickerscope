// Home (AC-1): wordmark + mark, large inline search, Recent chips.
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Mark, Wordmark } from "../components/Mark";
import { Search, avatarText } from "../components/Search";
import { pushRecent, removeRecent, useRecent } from "../lib/recent";

export function Home() {
  const navigate = useNavigate();
  const [recent] = useRecent();

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
                  <span className="avatar">{avatarText(r.ticker)}</span>
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
