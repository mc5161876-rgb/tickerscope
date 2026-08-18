// App shell: left rail (Dashboard / My Stocks / Settings), top bar with company selector + Lights toggle.
import { LayoutDashboard, Search as SearchIcon, Settings, Star } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api, type HealthPayload } from "../lib/api";
import type { Theme } from "../lib/theme";
import { Mark, Wordmark } from "./Mark";
import { SearchModal, useSearchShortcuts } from "./SearchModal";

export interface ShellContext {
  openSearch: () => void;
  health: HealthPayload | null;
  currentCompany: { ticker: string; name?: string | null } | null;
  setCurrentCompany: (c: { ticker: string; name?: string | null } | null) => void;
}

export function Shell({
  theme,
  onToggleTheme,
  children,
  currentCompany,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  children: ReactNode;
  currentCompany: { ticker: string; name?: string | null } | null;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const location = useLocation();
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useSearchShortcuts(openSearch);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .health(ctrl.signal)
      .then((r) => {
        if (r.ok) setHealth(r.data);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // close the palette on navigation
  useEffect(() => setSearchOpen(false), [location.pathname]);

  const onTicker = location.pathname.startsWith("/t/");

  return (
    <div className="app">
      <aside className="rail" aria-label="Primary">
        <Link to="/" className="rail-logo" aria-label="TickerScope home">
          <Mark size={28} />
          <Wordmark compact />
        </Link>
        <div className="rail-group caps">Menu</div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => `rail-item${isActive || onTicker ? " active" : ""}`}>
            <LayoutDashboard size={17} />
            Dashboard
          </NavLink>
          <NavLink to="/my-stocks" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}>
            <Star size={17} />
            My Stocks
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}>
            <Settings size={17} />
            Settings
          </NavLink>
        </nav>
        <div className="rail-status" aria-live="polite">
          <div className="caps" style={{ marginBottom: 4 }}>
            Data sources
          </div>
          <div>
            <span className={`dot${health && health.data_mode === "live" ? "" : " off"}`} />
            yfinance {health ? (health.data_mode === "live" ? "✓" : "✕") : "…"}
            {health?.yfinance_version ? <span className="faint"> {health.yfinance_version}</span> : null}
          </div>
          <div>
            <span className={`dot${health && health.sec_configured ? "" : " off"}`} />
            SEC EDGAR {health ? (health.sec_configured ? "✓" : "✕") : "…"}
            {health && !health.sec_configured ? <span className="faint"> not configured</span> : null}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="topbar-search" onClick={openSearch} aria-label="Search a company or ticker">
            <SearchIcon size={16} />
            <span className="label">
              {currentCompany ? (
                <>
                  <strong>{currentCompany.name ?? currentCompany.ticker}</strong>
                  {currentCompany.name ? <span className="muted"> ({currentCompany.ticker})</span> : null}
                </>
              ) : (
                "Search a company or ticker…"
              )}
            </span>
            <span className="kbd">Ctrl K</span>
          </button>
          <span className="topbar-spacer" />
          <label className="lights">
            <span className="text">
              Lights: <strong>{theme === "dark" ? "Off" : "On"}</strong>
            </span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={theme === "light"}
              aria-label="Toggle light theme"
              onClick={onToggleTheme}
            />
          </label>
        </header>
        <main className="content">{children}</main>
      </div>

      <SearchModal open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
