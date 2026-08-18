"""Paths, ports and environment flags. Everything else imports from here."""

from __future__ import annotations

import os
from pathlib import Path

# repo root = two levels up from backend/tickerscope/
REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = REPO_ROOT / "shared"
METRICS_JSON = SHARED_DIR / "metrics.json"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
ENV_FILE = REPO_ROOT / ".env"


def load_dotenv(path: Path = ENV_FILE) -> None:
    """Minimal .env loader (KEY=VALUE, # comments, optional quotes). Never overrides real env."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


def data_dir() -> Path:
    """Where the disk cache lives. Overridable so tests never touch the real cache."""
    return Path(os.environ.get("TICKERSCOPE_DATA_DIR", REPO_ROOT / "data"))


def cache_dir() -> Path:
    return data_dir() / "cache"


def sec_cache_dir() -> Path:
    """Durable SEC response cache (immutable filings cached forever) - AC-8."""
    return data_dir() / "sec-cache"


def sec_diagnostics_dir() -> Path:
    return data_dir() / "sec-diagnostics"


# SEC history depth (MAR-49)
SEC_ANNUAL_YEARS = 10
SEC_QUARTERS = 40
SEC_SEGMENT_QUARTER_YEARS = 5  # 10-Qs are 4 fetches each; keep the first open bounded
TTL_SEC_DERIVED = 6 * 60 * 60  # computed series/segments payloads


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
