// Settings (AC-4; MAR-49 AC-11 adds SEC EDGAR; MAR-51 AC-5 adds the desktop "Server address").
// My Stocks moved to pages/MyStocks.tsx (MAR-50).
import { useEffect, useState } from "react";
import { api, type HealthPayload } from "../lib/api";
import type { Theme } from "../lib/theme";

/** Desktop-only card: shown when running inside the Electron shell (window.tickerscope). */
function ServerAddressCard() {
  const shell = window.tickerscope;
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    if (!shell) return;
    void shell.getConfig().then((c) => {
      setValue(c.serverUrl);
      setSaved(c.serverUrl);
    });
    void shell.version().then(setVersion);
  }, [shell]);
  if (!shell) return null;
  const dirty = value.trim() !== saved;
  const save = async () => {
    setStatus("Saving…");
    try {
      const c = await shell.setConfig({ serverUrl: value.trim() });
      setSaved(c.serverUrl);
      setValue(c.serverUrl);
      setStatus(c.serverUrl === saved ? "Saved" : "Saved — reconnecting…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <div className="card row" data-testid="server-address">
      <div className="k" style={{ flex: 1 }}>
        <b>Server address (desktop app{version ? ` v${version}` : ""})</b>
        <span>
          Where this window loads TickerScope from. Local (<code>127.0.0.1</code>) — the app starts the server itself.
          Anything else, e.g. <code>http://geekom:8790</code> on the tailnet, is remote: the app only connects.
        </span>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="search-input"
            style={{ height: 38, paddingLeft: 12, maxWidth: 420, fontSize: 14 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) void save();
            }}
            spellCheck={false}
            aria-label="Server address"
          />
          <button type="button" className="ghost" onClick={() => void save()} disabled={!dirty}>
            Save
          </button>
          {status && <span className="muted" style={{ fontSize: 12.5 }}>{status}</span>}
        </div>
      </div>
    </div>
  );
}

export function Settings({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
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
  const secOn = health?.sec_configured === true;
  return (
    <div className="settings">
      <h1 className="section-title" style={{ margin: "0 0 4px" }}>
        Settings
      </h1>
      <ServerAddressCard />
      <div className="card row">
        <div className="k">
          <b>Lights: {theme === "dark" ? "Off" : "On"}</b>
          <span>Dark is the default. Turn the lights on for a white, Mercury-style palette.</span>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={theme === "light"}
          aria-label="Toggle light theme"
          onClick={onToggleTheme}
        />
      </div>
      <div className="card row">
        <div className="k">
          <b>Data: yfinance, delayed; not investment advice</b>
          <span>
            Quotes and fundamentals come from Yahoo Finance through the open-source yfinance library. Prices are
            delayed and unofficial. TickerScope is a personal learning tool, not a broker or an advisor.
          </span>
        </div>
      </div>
      <div className="card row" data-sec={health ? String(secOn) : "unknown"}>
        <div className="k">
          <b>SEC EDGAR (filings, cached)</b>
          <span>
            10-year Revenue / EBITDA history and Revenue by Segment come from XBRL filings on sec.gov, cached
            under <code>data/sec-cache/</code>. The SEC asks every client to identify itself with a{" "}
            <code>SEC_USER_AGENT</code> contact string in <code>.env</code> (not a secret).
          </span>
          <span style={{ marginTop: 6 }}>
            {health === null ? (
              "Checking…"
            ) : secOn ? (
              <>
                <span className="pos">● SEC_USER_AGENT is set</span>
                {health.sec_user_agent_hint ? <span className="faint"> · {health.sec_user_agent_hint}</span> : null}
              </>
            ) : (
              <span className="neg">● SEC_USER_AGENT is not set — segment and history cards show "SEC access not configured"</span>
            )}
          </span>
        </div>
      </div>
      <div className="card row">
        <div className="k">
          <b>Keyboard</b>
          <span>
            <span className="kbd">/</span> or <span className="kbd">Ctrl K</span> opens search anywhere ·{" "}
            <span className="kbd">Esc</span> closes popovers and the palette.
          </span>
        </div>
      </div>
    </div>
  );
}
