"""My Stocks watchlist: validated model + atomic JSON store (MAR-50 AC-1).

File: data/watchlist.json -> {"version": 1, "items": [{"ticker", "added_at", "position"}]}
Writes go to a temp file in the same directory and are renamed into place; stray temp files
from an interrupted write are ignored on read.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
MAX_ITEMS = 100


class WatchlistError(ValueError):
    """Validation failure; message is user-facing."""


def normalize_ticker(raw: str) -> str:
    """Uppercase, trim, `NASDAQ:AAPL` -> `AAPL`, `brk.b` -> `BRK-B`. Raises WatchlistError."""
    t = (raw or "").strip().upper()
    if ":" in t:
        t = t.rsplit(":", 1)[-1]
    t = t.replace(".", "-").replace("/", "-")
    if not t or not TICKER_RE.match(t):
        raise WatchlistError(f"'{raw}' is not a valid ticker")
    return t


def _now() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat().replace("+00:00", "Z")


class WatchlistStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    # ---- io ------------------------------------------------------------------
    def _read(self) -> list[dict[str, Any]]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            return []
        items = raw.get("items", []) if isinstance(raw, dict) else raw
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict) or not it.get("ticker"):
                continue
            try:
                t = normalize_ticker(str(it["ticker"]))
            except WatchlistError:
                continue
            if t in seen:
                continue
            seen.add(t)
            out.append({"ticker": t, "added_at": it.get("added_at") or _now()})
        return [{**it, "position": i} for i, it in enumerate(out)]

    def _write(self, items: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "updated_at": _now(), "items": items}
        fd, tmp_name = tempfile.mkstemp(dir=self.path.parent, prefix=".watchlist.", suffix=".tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=1)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass

    # ---- api -----------------------------------------------------------------
    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()

    def replace(self, tickers: list[str]) -> list[dict[str, Any]]:
        """Whole-list replace (order = position). Keeps added_at for tickers already present."""
        with self._lock:
            current = {it["ticker"]: it for it in self._read()}
            normalized: list[str] = []
            for raw in tickers:
                t = normalize_ticker(str(raw))
                if t in normalized:
                    raise WatchlistError(f"duplicate ticker {t}")
                normalized.append(t)
            if len(normalized) > MAX_ITEMS:
                raise WatchlistError(f"watchlist is limited to {MAX_ITEMS} tickers")
            items = [
                {
                    "ticker": t,
                    "added_at": current.get(t, {}).get("added_at") or _now(),
                    "position": i,
                }
                for i, t in enumerate(normalized)
            ]
            self._write(items)
            return items

    def add(self, ticker: str) -> tuple[list[dict[str, Any]], bool]:
        """Append (idempotent). Returns (items, added?)."""
        t = normalize_ticker(ticker)
        with self._lock:
            items = self._read()
            if any(it["ticker"] == t for it in items):
                return items, False
            if len(items) >= MAX_ITEMS:
                raise WatchlistError(f"watchlist is limited to {MAX_ITEMS} tickers")
            items.append({"ticker": t, "added_at": _now(), "position": len(items)})
            self._write(items)
            return items, True

    def remove(self, ticker: str) -> tuple[list[dict[str, Any]], bool]:
        t = normalize_ticker(ticker)
        with self._lock:
            items = self._read()
            kept = [it for it in items if it["ticker"] != t]
            if len(kept) == len(items):
                return items, False
            kept = [{**it, "position": i} for i, it in enumerate(kept)]
            self._write(kept)
            return kept, True
