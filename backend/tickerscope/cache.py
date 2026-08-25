"""Tiny disk JSON cache with per-entry TTLs (AC-17).

Layout: <cache_dir>/<namespace>/<key>.json -> {"stored_at": epoch, "payload": ...}
`get` distinguishes fresh / stale / missing so callers can serve stale data on upstream failure.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class CacheHit:
    payload: Any
    stored_at: float
    fresh: bool

    @property
    def age_seconds(self) -> float:
        return max(0.0, time.time() - self.stored_at)


class DiskCache:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, namespace: str, key: str) -> Path:
        safe_ns = _SAFE.sub("_", namespace)
        safe_key = _SAFE.sub("_", key) or "_"
        return self.root / safe_ns / f"{safe_key}.json"

    def get(self, namespace: str, key: str, ttl: float) -> CacheHit | None:
        path = self._path(namespace, key)
        if not path.exists():
            return None
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            stored_at = float(raw["stored_at"])
            payload = raw["payload"]
        except (OSError, ValueError, KeyError, TypeError):
            return None
        return CacheHit(payload=payload, stored_at=stored_at, fresh=(time.time() - stored_at) < ttl)

    def set(self, namespace: str, key: str, payload: Any) -> None:
        path = self._path(namespace, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"stored_at": time.time(), "payload": payload}, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)

    def clear(self) -> None:
        if not self.root.exists():
            return
        for p in self.root.rglob("*.json"):
            try:
                p.unlink()
            except OSError:
                pass
