# TickerScope

Type a ticker, get a clean one-page report: price, valuation, profitability, cash flow,
dividends, and three 10-year-style charts — with a click-to-reveal plain-English explainer
on every number. Personal tool, one user, $0/month data (yfinance + the free SEC ticker list).

Issue tracker: Linear project **TickerScope** (MAR-48 core → MAR-49 SEC history/segments →
MAR-50 watchlist/fullscreen/export → MAR-51 desktop app). Spec + design direction:
`G:\My Drive\Aries HQ\Projects\TickerScope\`.

## Stack

- **Backend** — Python 3.12 via `uv`, FastAPI + uvicorn, `yfinance` (pinned; the only Yahoo
  access lives in `backend/tickerscope/yahoo.py`), `rapidfuzz` search over the SEC company list,
  JSON disk cache under `data/cache/`.
- **Frontend** — Vite + React 19 + TypeScript, Recharts, lucide-react, react-router.
- **Shared** — `shared/metrics.json` is the single registry of metrics + explainer copy that both
  sides read.

Ports: API `127.0.0.1:8790`, Vite dev `127.0.0.1:5190`. In production FastAPI serves the built
`frontend/dist` at `/`.

## Setup

```powershell
cd C:\rex\tickerscope
uv sync          # creates .venv with Python 3.12 (uses uv's managed interpreter, never the PATH python)
npm install      # root deps + frontend deps (postinstall)
copy .env.example .env   # then set SEC_USER_AGENT (contact string, not a secret) - needed for SEC history + segments
```

## Develop

```powershell
npm run dev      # backend (uvicorn --reload on 8790) + Vite (5190) via scripts/dev.mjs
```

Open <http://127.0.0.1:5190>. Vite proxies `/api/*` to the backend.

Individually: `npm run dev:api`, `npm run dev:web`. (`scripts/dev.mjs` runs the API detached on
its own console: uvicorn's Windows reloader broadcasts a Ctrl+C on every change, which used to
kill both processes under `concurrently`.)

## Build & run (production, one command)

```powershell
npm run build          # tsc --noEmit + vite build -> frontend/dist
.\scripts\start.ps1    # builds (skip with -NoBuild) then serves http://127.0.0.1:8790/
```

Phone access on the tailnet (HTTPS with the tailnet cert already enabled on this machine):

```powershell
tailscale serve --bg 8790
```

## Test & lint

```powershell
uv run pytest          # backend: fixture-backed, no network (backend/tests)
npm test               # frontend: vitest (frontend/src/__tests__)
uv run ruff check backend scripts
npm run check          # tsc --noEmit
```

Fixtures for AAPL / NVDA / JPM live in `backend/tests/fixtures/`. Re-record with network:
`uv run python scripts/record_fixtures.py`. SEC fixtures (trimmed companyfacts for
AMZN/MSFT/JPM/NFLX) live in `backend/tests/sec/fixtures/`.

Hostile-corpus regression (17 `AS_FILED` / 3 `NEEDS_REVIEW` / 0 errors across 20 issuers): runs
offline as `backend/tests/sec/test_corpus.py` when the durable SEC cache holds the corpus; populate
once with network via `$env:PYTHONPATH="backend"; uv run python -m tickerscope.sec.extractor`.

Browser review harness (headless Edge over CDP; the Browser pane can't reach localhost here):
`uv run python scripts/smoke_cdp.py` against a running server (`TICKERSCOPE_BASE` to override).
It regenerates `docs/screenshots/` and asserts the search palette, not-found state, explainers,
theme toggle, phone layout, and (when `SEC_USER_AGENT` is set) the segment card states for
AMZN / NFLX / INTC / UNH / JPM.

## API

| Route | Returns |
| --- | --- |
| `GET /api/health` | `{status, data_mode, yfinance_version, search_index_size, version}` |
| `GET /api/search?q=` | `{query, results:[{ticker,name,exchange,cik}]}` from the SEC index (24h cache) |
| `GET /api/ticker/{symbol}` | `{symbol, profile, quote, metrics{...}, as_of, fetched_at}` (15-min cache) |
| `GET /api/ticker/{symbol}/prices?range=1y\|5y\|10y\|max` | `{points:[{date,close}], sampled}` (6h cache) |
| `GET /api/ticker/{symbol}/financials?freq=annual\|quarterly` | up to 10 fiscal years / 40 quarters: `{revenue:[{period_end,label,value,source,accession,filed,form,method}], ebitda:[...], ebitda_method, sec:{status}}` — SEC companyfacts wins per period, yfinance fills gaps (marked) |
| `GET /api/ticker/{symbol}/segments?freq=annual\|quarterly` | Revenue by Segment contract per period: `coverage_state`, `render_mode`, `view`, `rows[]`, `consolidation_bridge[]`, totals, `alternative?`, `message?`, `provenance{form,accession,filed,axis,cik,edgar_url}`, plus `legend`, `resegmentations`, `filings_read` |
| `GET /api/watchlist` · `PUT /api/watchlist {tickers:[…]}` · `POST/DELETE /api/watchlist/{ticker}` | My Stocks (MAR-50): validated (uppercase, unique, ≤ 100), persisted atomically to `data/watchlist.json` |
| `GET /api/quotes?symbols=A,B,C` | batched watchlist quotes: one fetcher call for every uncached symbol, 15-min `ticker` cache reused/warmed; unknown symbols → `null` |
| `GET /api/metrics` | the shared registry |

Every numeric field is nullable; keys are snake_case. Responses carry `x-cache: hit|miss|stale`.
Unknown ticker → `404 {error:"not_found"}`. Yahoo failure → `503 {error:"data_source_unavailable", stale?, stale_as_of?}`
(the UI shows a dismissible banner and keeps the last good payload). Set `TICKERSCOPE_FORCE_FAIL=1`
to exercise that path locally. `/segments` without `SEC_USER_AGENT` → `503 {status:"not_configured"}`.

### SEC EDGAR (MAR-49)

`backend/tickerscope/sec/` — `client.py` (identifying User-Agent, ≤ 8 req/s, durable cache under
`data/sec-cache/`: immutable `Archives/edgar/data` URLs cached forever, submissions/companyfacts 6h),
`companyfacts.py` (Revenue `Revenues → RevenueFromContractWithCustomerExcludingAssessedTax → SalesRevenueNet`,
EBITDA *calculated* = `OperatingIncomeLoss` + `DepreciationDepletionAndAmortization`/`DepreciationAndAmortization`,
newest filing wins per period), `extractor.py` (the traderscope linkbase-aware segment extractor,
ported; per-filing/per-period API added), `segments.py` (walks 10 years of 10-Ks / 5 years of 10-Qs,
prefers the latest filing per period, emits the coverage-state contract, detects re-segmentation).
Diagnostics land in `data/sec-diagnostics/`.

Coverage states → UI: `as_filed` / `as_filed_with_bridge` stacked with a consolidated tick;
`single_segment` "Reports as one segment"; `needs_review` withheld with the reconciliation gap;
`withheld_alternative` draws the reconciled alternative under its real title (e.g. "Revenue by
Region"); `unavailable` "Not available". A geography/product view is never passed off as segments.

Env: `SEC_USER_AGENT` (in `.env`), `TICKERSCOPE_DATA_DIR` (cache location, default `./data`),
`TICKERSCOPE_FORCE_FAIL`, `TICKERSCOPE_SEC_USER_AGENT` (ticker-list download only),
`TICKERSCOPE_HOST`, `TICKERSCOPE_PORT`.

## Layout

```
backend/tickerscope/   main.py (FastAPI) · yahoo.py (only yfinance import) · search.py · cache.py · service.py · metrics.py · watchlist.py · config.py
backend/tickerscope/sec/  client.py · companyfacts.py · extractor.py · segments.py · service.py
backend/tests/         pytest + fixtures/ · tests/sec/ (ported extractor + cache tests, companyfacts, segments, api, corpus)
shared/metrics.json    metric registry + explainer copy
frontend/src/          App.tsx · pages/ · components/ · components/charts/ · lib/ · styles/ · __tests__/
scripts/               start.ps1 · record_fixtures.py · probe_yf.py
docs/screenshots/      review screenshots (1280×800, 390×844)
```

### My Stocks, fullscreen, share cards (MAR-50)

- Watchlist lives server-side (`data/watchlist.json`, atomic temp+rename) so it survives browsers
  and the Electron shell. Home shows it under the search box; `/my-stocks` is the full-width
  version with **Add Stock** (same search component; paste a list — commas/spaces/newlines,
  `NASDAQ:AAPL` works — invalid tokens are reported in a toast, never dropped), remove with a
  5-second Undo, drag handle or ↑/↓ to reorder. The ticker header has **Add to My Stocks / In My
  Stocks ✓**; the `Ctrl+K` palette lists My Stocks before you type.
- Every chart card's expand icon opens a fullscreen modal (`?chart=price|revenue|ebitda|segments`,
  linkable), with finer ticks and a price crosshair; **Save image** (card or fullscreen) renders a
  2× PNG share card — title, ticker + company, period, watermark, generation date, source line, no
  UI chrome, in the active theme — named `{TICKER}-{chart}-{YYYY-MM-DD}.png` (client-side via
  `html-to-image`, no server round trip).

## Not in this build (see later issues)

Electron shell + installer (MAR-51). Multiple watchlists / tags / notes / alerts, portfolio
quantities or P&L, brokerage imports, and sharing to social/URL hosting are out of scope. Restatement-aware multi-year stitching (Q4 segment quarters, restated comparatives) is
deliberately out of scope: each period shows the newest filed value. No auth, billing, brokerage,
alerts, news, screener, or AI commentary — by design.

Data disclaimer: yfinance is unofficial and delayed. Not investment advice.
