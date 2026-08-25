"""Paths, ports and environment flags. Everything else imports from here."""

from __future__ import annotations

import os
from pathlib import Path

# repo root = two levels up from backend/tickerscope/
REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = REPO_ROOT / "shared"
METRICS_JSON = SHARED_DIR / "metrics.json"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def data_dir() -> Path:
    """Where the disk cache lives. Overridable so tests never touch the real cache."""
    return Path(os.environ.get("TICKERSCOPE_DATA_DIR", REPO_ROOT / "data"))


def cache_dir() -> Path:
    return data_dir() / "cache"


def force_fail() -> bool:
    """When TICKERSCOPE_FORCE_FAIL=1 the fetcher raises, so the 503 path can be exercised."""
    return os.environ.get("TICKERSCOPE_FORCE_FAIL", "").strip() in {"1", "true", "yes"}


HOST = os.environ.get("TICKERSCOPE_HOST", "127.0.0.1")
PORT = int(os.environ.get("TICKERSCOPE_PORT", "8790"))

# TTLs in seconds (AC-17)
TTL_QUOTE = 15 * 60
TTL_FINANCIALS = 6 * 60 * 60
TTL_PRICES = 6 * 60 * 60
TTL_SEARCH_INDEX = 24 * 60 * 60

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
# SEC asks for a descriptive User-Agent with contact info on every request.
SEC_USER_AGENT = os.environ.get(
    "TICKERSCOPE_SEC_USER_AGENT", "TickerScope/0.1 (personal research tool; mc5161876@gmail.com)"
)
