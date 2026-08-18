# Changelog

All notable changes to TickerScope. Dates are the day the work landed in a PR.

## 0.1.0 — 2026-08-18

The first complete build, delivered as four stacked PRs on the same day (MAR-48 → MAR-51).

### Core app (MAR-48, PR #1)
- Search (inline on Home + `Ctrl+K` / `/` palette) over the SEC ticker list; Recent chips.
- Ticker page: hero price, 35 snapshot metrics in five groups + About, every metric with a
  click-to-reveal plain-English explainer (What / How to read / live example), null → "Not reported".
- Insights: Stock Price (1Y/5Y/10Y/Max), Revenue, EBITDA (reported / calculated / not available),
  Quarterly | Annually control.
- FastAPI backend over yfinance (pinned, isolated in one module), disk cache with TTLs, 503 with the
  last good payload; dark default + Mercury light theme; responsive to 390 px.

### SEC history + Revenue by Segment (MAR-49, PR #2)
- 10 fiscal years / 40 quarters of Revenue and calculated EBITDA from SEC companyfacts, provenance in
  every tooltip; yfinance fills gaps.
- Revenue by Segment card driven by the ported traderscope linkbase-aware extractor across a decade of
  10-Ks (5 years of 10-Qs): honest coverage states, consolidated tick, re-segmentation divider,
  provenance tooltip + click-through to EDGAR. `SEC_USER_AGENT` in `.env` gates SEC access.

### My Stocks, fullscreen, share cards (MAR-50, PR #3)
- Server-side watchlist (`data/watchlist.json`) on Home and `/my-stocks`; batched quotes; Add Stock
  with bulk paste; remove with Undo; drag / ↑↓ reorder; header toggle.
- Fullscreen chart modal (`?chart=…`, linkable) with finer ticks and a price crosshair.
- Save image → 2× PNG share card (`{TICKER}-{chart}-{YYYY-MM-DD}.png`).

### Desktop app (MAR-51, PR #4)
- Electron shell (`electron/main.mjs`) that loads the app from a configurable **Server address**
  (`%APPDATA%\TickerScope\config.json`); local mode auto-starts `uv run uvicorn …` behind a
  "Starting TickerScope server…" splash and stops it on quit; remote mode never spawns and shows
  "Can't reach {url}" with Retry / Settings.
- Original TickerScope icon rendered from one master SVG; NSIS installer (`TickerScope Setup 0.1.0.exe`)
  to `%LOCALAPPDATA%\Programs\TickerScope` with desktop + Start Menu shortcuts and an uninstaller.
- Window geometry remembered, dark/light title bar follows the app theme, reduced menu (File / View /
  Help → About), external links open in the system browser, Save image goes through a native dialog.
- `docs/GEEKOM.md` runbook for hosting the server on the Geekom (not executed by the build).
