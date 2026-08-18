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
```

## Develop

```powershell
npm run dev      # backend (uvicorn --reload on 8790) + Vite (5190) concurrently
```

Open <http://127.0.0.1:5190>. Vite proxies `/api/*` to the backend.

Individually: `npm run dev:api`, `npm run dev:web`.

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
`uv run python scripts/record_fixtures.py`.

## API

| Route | Returns |
| --- | --- |
| `GET /api/health` | `{status, data_mode, yfinance_version, search_index_size, version}` |
| `GET /api/search?q=` | `{query, results:[{ticker,name,exchange,cik}]}` from the SEC index (24h cache) |
| `GET /api/ticker/{symbol}` | `{symbol, profile, quote, metrics{...}, as_of, fetched_at}` (15-min cache) |
| `GET /api/ticker/{symbol}/prices?range=1y\|5y\|10y\|max` | `{points:[{date,close}], sampled}` (6h cache) |
| `GET /api/ticker/{symbol}/financials?freq=annual\|quarterly` | `{revenue:[{period_end,label,value}], ebitda:[...], ebitda_method}` (6h cache) |
| `GET /api/metrics` | the shared registry |

Every numeric field is nullable; keys are snake_case. Responses carry `x-cache: hit|miss|stale`.
Unknown ticker → `404 {error:"not_found"}`. Yahoo failure → `503 {error:"data_source_unavailable", stale?, stale_as_of?}`
(the UI shows a dismissible banner and keeps the last good payload). Set `TICKERSCOPE_FORCE_FAIL=1`
to exercise that path locally.

Env: `TICKERSCOPE_DATA_DIR` (cache location, default `./data`), `TICKERSCOPE_FORCE_FAIL`,
`TICKERSCOPE_SEC_USER_AGENT`, `TICKERSCOPE_HOST`, `TICKERSCOPE_PORT`.

## Layout

```
backend/tickerscope/   main.py (FastAPI) · yahoo.py (only yfinance import) · search.py · cache.py · service.py · metrics.py · config.py
backend/tests/         pytest + fixtures/
shared/metrics.json    metric registry + explainer copy
frontend/src/          App.tsx · pages/ · components/ · components/charts/ · lib/ · styles/ · __tests__/
scripts/               start.ps1 · record_fixtures.py · probe_yf.py
docs/screenshots/      review screenshots (1280×800, 390×844)
```

## Not in this build (see later issues)

Revenue by Segment / SEC 10-year history (MAR-49), My Stocks watchlist + fullscreen charts +
share-card export (MAR-50), Electron shell + installer (MAR-51). No auth, billing, brokerage,
alerts, news, screener, or AI commentary — by design.

Data disclaimer: yfinance is unofficial and delayed. Not investment advice.
