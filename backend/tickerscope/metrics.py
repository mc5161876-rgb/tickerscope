"""Loads shared/metrics.json - the single registry both backend and frontend read."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import METRICS_JSON


@lru_cache(maxsize=1)
def registry() -> dict[str, Any]:
    with open(METRICS_JSON, encoding="utf-8") as fh:
        return json.load(fh)


def metric_ids() -> list[str]:
    return [m["id"] for m in registry()["metrics"]]


def metric_by_id() -> dict[str, dict[str, Any]]:
    return {m["id"]: m for m in registry()["metrics"]}
