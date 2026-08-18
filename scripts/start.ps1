<#
.SYNOPSIS
  Build the frontend and start the TickerScope production server on 127.0.0.1:8790.

.DESCRIPTION
  One command for "just run it": builds frontend/dist (skip with -NoBuild), then runs
  uvicorn serving both the API and the built app at http://127.0.0.1:8790/.
  Phone access over the tailnet:  tailscale serve --bg 8790

.EXAMPLE
  .\scripts\start.ps1
  .\scripts\start.ps1 -NoBuild
  .\scripts\start.ps1 -Port 8790 -Host 127.0.0.1
#>
[CmdletBinding()]
param(
  [switch]$NoBuild,
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8790
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Error "uv is not on PATH. Install from https://docs.astral.sh/uv/ and re-run."
}

if (-not $NoBuild) {
  Write-Host "==> Building frontend (npm run build)" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Error "frontend build failed" }
}

if (-not (Test-Path (Join-Path $root "frontend\dist\index.html"))) {
  Write-Error "frontend/dist/index.html not found. Run without -NoBuild first."
}

Write-Host "==> Starting TickerScope at http://$BindHost`:$Port/" -ForegroundColor Green
Write-Host "    (Ctrl+C to stop; phone: tailscale serve --bg $Port)" -ForegroundColor DarkGray
uv run uvicorn tickerscope.main:app --app-dir backend --host $BindHost --port $Port
