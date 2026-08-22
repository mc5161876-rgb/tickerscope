# TickerScope on macOS (foundry)

The app was built on the Windows desktop and runs there unchanged. This is what it takes
to run and package the same checkout on the Mac Studio (`foundry`, M3 Ultra / Apple Silicon).

## Setup

```bash
gh repo clone mc5161876-rgb/tickerscope ~/rex/tickerscope
cd ~/rex/tickerscope
uv sync --all-groups     # Python 3.12 venv
npm install              # root + frontend
```

`npm install` does not download Electron's binary under npm 11's install-script blocking.
If `node_modules/electron/dist` is missing, run it by hand once:

```bash
node node_modules/electron/install.js
```

`electron-winstaller` asks for an install script too — it is Windows-only packaging, so
denying it costs nothing on this machine.

## `.env`

`.env` is gitignored, so it does not travel with the repo. SEC EDGAR refuses requests
without an identifying User-Agent, and `/api/health` reports `sec_configured: false`
until one is set. Not a secret — it is a contact string the SEC asks every client to send:

```
SEC_USER_AGENT=TickerScope/0.1 (personal research tool; mc5161876@gmail.com)
```

## Running

```bash
npm run dev              # API 8790 + Vite 5190
npm run dev:app          # …and the Electron shell
```

## Packaging

```bash
npm run dist:mac         # release/TickerScope-0.1.0-arm64.dmg + .zip
```

arm64 only, and **unsigned** — `mac.identity` is `null` because there is no Developer ID
on this account. A locally built `.app` carries no quarantine flag, so it opens normally;
a `.dmg` copied to another Mac would need a right-click → Open the first time.

Install with:

```bash
cp -R release/mac-arm64/TickerScope.app /Applications/
```

## macOS-specific fixes made during the port

- **`PATH` for the spawned server.** A Finder- or Dock-launched `.app` inherits launchd's
  minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which contains neither `~/.local/bin`
  nor Homebrew, so a bare `uv` did not resolve and the server never started.
  `spawnPath()` in `electron/main.mjs` prepends the places uv installs itself.
- **Repo-path fallback.** The packaged app fell back to a hardcoded `C:\rex\tickerscope`.
  It now picks the conventional checkout per platform — `C:\rex\tickerscope` on Windows,
  `~/rex/tickerscope` on macOS/Linux.
- **Icons.** electron-builder renders the `.icns` from `assets/icon-1024.png`, added to
  `scripts/render-icons.mjs` alongside the existing `.ico` and PNG set.
- **`localStorage` in tests.** Node >= 22 ships its own `localStorage` global that stays
  undefined without `--localstorage-file` and clobbers jsdom's Storage when vitest merges
  the jsdom window into `globalThis`. This Mac runs Node 26, so all 50 vitest tests failed
  on `localStorage.clear()`. The test setup now installs an in-memory Storage. Node-version
  driven, not macOS-driven — the Windows box will hit it on its next Node upgrade.
- **Smoke harness.** `scripts/smoke_cdp.py` hardcoded `msedge.exe`. It now finds whichever
  Chromium is installed per platform (override with `TICKERSCOPE_BROWSER`), and writes its
  throwaway profile to `tempfile.gettempdir()` instead of `%TEMP%` — which on macOS fell
  back to `.` and left a profile directory in the repo.

## Verified on foundry 2026-08-21

pytest 93 passed / 1 skipped · vitest 50 · electron 7 · ruff + tsc clean · `dist:mac` builds ·
installed `.app` launched from Finder, auto-started uvicorn, served live yfinance and SEC data ·
`smoke_cdp.py` all checks passed.

## Both machines

The Windows install (`%LOCALAPPDATA%\Programs\TickerScope`) and this one both default to
port 8790 on their own loopback, so they do not collide. Watchlists are stored server-side
per machine and do **not** sync — a ticker added here does not appear there. Pointing one
at the other is the same Settings → Server address path documented in `GEEKOM.md`.
