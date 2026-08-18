// My Stocks placeholder (AC-4, NG-3) and Settings (AC-4).
import type { Theme } from "../lib/theme";

export function MyStocks() {
  return (
    <div className="card placeholder">
      <div className="caps">My Stocks</div>
      <h1>Coming in a later build</h1>
      <p>
        Your watchlist lives here once issue #3 ships: saved tickers, one-tap jumps from the search palette, and
        fullscreen charts. Until then, use Recent on the Dashboard.
      </p>
    </div>
  );
}

export function Settings({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <div className="settings">
      <h1 className="section-title" style={{ margin: "0 0 4px" }}>
        Settings
      </h1>
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
