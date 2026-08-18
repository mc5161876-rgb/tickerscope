"""SEC HTTP client: identifying User-Agent, <= 8 req/s, durable on-disk response cache.

`Fetcher` is ported from traderscope (branch feat/sec-cache @ 4ebf231) with its behaviour
unchanged so the ported cache tests keep passing: SHA-256 URL keys, integrity metadata,
immutable EDGAR archive URLs cached forever, mutable endpoints refreshed after the TTL,
legacy-cache migration. TickerScope adds the shared rate limiter and the SEC_USER_AGENT gate.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .. import config

MAX_REQUESTS_PER_SECOND = 8


class SecNotConfigured(Exception):
    """SEC_USER_AGENT is missing; the SEC asks every client to identify itself."""


class SecError(Exception):
    """SEC endpoint failed after retries."""


class _RateLimiter:
    """Simple sliding-window limiter shared by every Fetcher in the process."""

    def __init__(self, per_second: int):
        self.per_second = per_second
        self._times: deque[float] = deque()
        self._lock = threading.Lock()

    def wait(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                while self._times and now - self._times[0] >= 1.0:
                    self._times.popleft()
                if len(self._times) < self.per_second:
                    self._times.append(now)
                    return
                sleep_for = 1.0 - (now - self._times[0])
            time.sleep(max(0.01, sleep_for))


_LIMITER = _RateLimiter(MAX_REQUESTS_PER_SECOND)


@dataclass
class Fetcher:
    user_agent: str
    cache_dir: Path
    retries: int = 3
    mutable_ttl_seconds: int = 6 * 60 * 60
    limiter: _RateLimiter = field(default_factory=lambda: _LIMITER, repr=False)

    @staticmethod
    def _is_immutable(url: str) -> bool:
        parsed = urllib.parse.urlparse(url)
        return parsed.hostname in {"sec.gov", "www.sec.gov"} and parsed.path.startswith(
            "/Archives/edgar/data/"
        )

    def _cache_paths(self, url: str) -> tuple[Path, Path]:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.bin", self.cache_dir / f"{digest}.json"

    def _legacy_cache_path(self, url: str) -> Path:
        key = re.sub(r"[^A-Za-z0-9._-]+", "_", url)[:220]
        return self.cache_dir / key

    def _legacy_cache_is_unambiguous(self, url: str) -> bool:
        normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", url)
        return len(normalized) <= 220

    def _read_cache(self, url: str) -> bytes | None:
        payload_path, metadata_path = self._cache_paths(url)
        if payload_path.exists() and metadata_path.exists():
            try:
                raw = payload_path.read_bytes()
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if metadata.get("url") != url:
                    return None
                if metadata.get("byte_length") != len(raw):
                    return None
                if metadata.get("sha256") != hashlib.sha256(raw).hexdigest():
                    return None
                if not self._is_immutable(url):
                    fetched_at = datetime.fromisoformat(metadata["fetched_at"])
                    age = datetime.now(UTC) - fetched_at
                    if age.total_seconds() > self.mutable_ttl_seconds:
                        return None
                return raw
            except (KeyError, OSError, ValueError, TypeError):
                return None

        # Preserve the traderscope v3 corpus cache. The legacy filename truncated
        # long URLs and had no integrity metadata. Only untruncated names can be
        # mapped back to one URL safely; ambiguous legacy entries are refetched.
        legacy_path = self._legacy_cache_path(url)
        if self._legacy_cache_is_unambiguous(url) and legacy_path.exists():
            raw = legacy_path.read_bytes()
            self._write_cache(url, raw)
            return raw
        return None

    def _atomic_write(self, destination: Path, raw: bytes) -> None:
        handle, temporary_name = tempfile.mkstemp(
            dir=self.cache_dir,
            prefix=f".{destination.name}.",
            suffix=".tmp",
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def _write_cache(self, url: str, raw: bytes) -> None:
        payload_path, metadata_path = self._cache_paths(url)
        metadata = {
            "schema_version": 1,
            "url": url,
            "fetched_at": datetime.now(UTC).isoformat(),
            "cache_policy": "immutable" if self._is_immutable(url) else "refreshable",
            "byte_length": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        self._atomic_write(payload_path, raw)
        self._atomic_write(
            metadata_path,
            json.dumps(metadata, sort_keys=True, indent=2).encode("utf-8"),
        )

    def cached(self, url: str) -> bool:
        return self._read_cache(url) is not None

    def get(self, url: str) -> bytes:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cached = self._read_cache(url)
        if cached is not None:
            return cached
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                self.limiter.wait()
                request = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": self.user_agent,
                        "Accept-Encoding": "gzip",
                    },
                )
                with urllib.request.urlopen(request, timeout=90) as response:
                    raw = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    self._write_cache(url, raw)
                    return raw
            except Exception as error:  # noqa: BLE001 - urllib raises many things
                last_error = error
                if attempt == self.retries - 1:
                    raise SecError(f"{type(error).__name__}: {error}") from error
                time.sleep(1.5 * (attempt + 1))
        raise SecError(str(last_error))  # pragma: no cover - loop always returns/raises

    def get_json(self, url: str):
        return json.loads(self.get(url))


# --------------------------------------------------------------------------- configuration
def sec_user_agent() -> str | None:
    """`SEC_USER_AGENT` from the environment (config loads .env first). Not a secret."""
    value = os.environ.get("SEC_USER_AGENT", "").strip()
    return value or None


def sec_configured() -> bool:
    return sec_user_agent() is not None


def get_fetcher(cache_dir: Path | None = None) -> Fetcher:
    """A Fetcher for the app, or raise SecNotConfigured when the user agent is missing."""
    ua = sec_user_agent()
    if not ua:
        raise SecNotConfigured(
            "SEC access not configured: set SEC_USER_AGENT in .env "
            "(e.g. 'TickerScope/0.1 (mario; mc5161876@gmail.com)')"
        )
    return Fetcher(ua, cache_dir or config.sec_cache_dir())


def edgar_filing_url(cik: str | int, accession: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/"
