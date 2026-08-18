# Running the TickerScope server on the Geekom (always-on host)

> **Aries/Mario runs this; not executed by this build.** The desktop is the development machine and
> never hosts always-on services (house rule). This page is the runbook the Geekom operator follows;
> nothing here was performed by the MAR-51 build.

The desktop app (`TickerScope Setup 0.1.0.exe`) loads TickerScope from a URL. By default that is the
local server it starts itself. Once the server runs on the Geekom, the only desktop change is
Settings → **Server address** → `http://geekom:8790` (or the tailnet MagicDNS name) — no rebuild.

## Prerequisites (Geekom, user `Rex`)

- Python 3.12 + `uv` (`https://docs.astral.sh/uv/`) — the server is `uv run uvicorn …`
- Node only if you want to (re)build the frontend on the Geekom; the built `frontend/dist` can also
  be copied from a desktop build (`npm run build`) or built once with `npm install && npm run build`
- Git access to the private repo `mc5161876-rgb/tickerscope` (same GitHub account/PAT pattern as
  the other Aries repos; **code moves between machines only via GitHub**)
- Tailscale on the Geekom (already the case for the other Aries services)

## Install

```powershell
cd C:\aries            # or wherever the other services live
git clone https://github.com/mc5161876-rgb/tickerscope.git
cd tickerscope
uv sync
npm install && npm run build      # produces frontend/dist (skip if you copy dist/ from the desktop)
copy .env.example .env             # then set SEC_USER_AGENT=TickerScope/0.1 (mario; mc5161876@gmail.com)
```

`.env` is never committed. `data/` (caches, `watchlist.json`, `sec-cache/`) is created on first run and
belongs to the host — back it up with the other Aries data if you care about the watchlist.

## Run under the Geekom supervisor

Use the same process-supervisor pattern as the other Aries services (Task Scheduler "at logon /
restart on failure" job, or the NSSM-style wrapper the others use). The command is:

```
uv run uvicorn tickerscope.main:app --app-dir backend --host 0.0.0.0 --port 8790
```

- **Bind on the tailnet only.** Either bind `--host <tailnet IPv4 of the Geekom>` instead of
  `0.0.0.0`, or keep `0.0.0.0` and make sure the Windows firewall rule for 8790 allows only the
  Tailscale interface. There is no auth in TickerScope by design; the tailnet is the boundary.
- Working directory = the repo checkout (so `data/` and `.env` resolve).
- Log to the usual place; the API prints one line per request.
- Health: `curl http://<geekom>:8790/api/health` → `{"status":"ok", …, "sec_configured": true}`.

Optional HTTPS with the tailnet cert (already enabled on the desktop, so it also works here):
`tailscale serve --bg 8790` and use the `https://geekom.<tailnet>.ts.net` address in the app.

## Point the desktop app at it

1. Open TickerScope on the desktop → File → Settings… (or the Settings page inside the app).
2. Server address → `http://geekom:8790` (or the tailnet name / HTTPS address) → Save.
3. The window reconnects. If the host is unreachable you get "Can't reach {url}" with Retry / Settings —
   the app never starts anything for a remote address.
4. `%APPDATA%\TickerScope\config.json` holds the setting; delete it to return to local mode.

## Updating

```powershell
cd C:\aries\tickerscope
git pull
uv sync
npm run build          # only if frontend changed and you build here
# restart the supervised process
```

## Not in scope here

Auto-update, code signing, HTTPS certificates beyond `tailscale serve`, or exposing the server outside
the tailnet. Keep it on the tailnet.
