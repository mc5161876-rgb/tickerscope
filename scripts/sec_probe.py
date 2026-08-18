"""Live probe: segments + companyfacts series for a ticker, with timing. Needs SEC_USER_AGENT.

uv run python scripts/sec_probe.py AMZN annual
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from tickerscope import config  # noqa: E402
from tickerscope.cache import DiskCache  # noqa: E402
from tickerscope.search import SearchIndex  # noqa: E402
from tickerscope.sec.service import SecService  # noqa: E402

sym = (sys.argv[1] if len(sys.argv) > 1 else "AMZN").upper()
freq = sys.argv[2] if len(sys.argv) > 2 else "annual"
cache = DiskCache(config.cache_dir())
index = SearchIndex(cache)
index.load()


def resolve(s: str) -> str | None:
    c = index.lookup(s)
    return str(c.cik).zfill(10) if c and c.cik else None


svc = SecService(cache, resolve)
t0 = time.time()
series = svc.series(sym, freq)
t1 = time.time()
print(
    f"series {sym} {freq}: status={series['status']} rev={len(series['revenue'])} ebitda={len(series['ebitda'])} in {t1 - t0:.1f}s"
)
for p in series["revenue"]:
    print(
        f"  {p['label']:<8} {p['period_end']} {p['value'] / 1e9:10.2f}B  {p['form']:<6} filed {p['filed']}  {p['accession']}  ({p['tag']})"
    )
print("  ebitda:", [(p["label"], round(p["value"] / 1e9, 1)) for p in series["ebitda"]])

t2 = time.time()
seg = svc.segments(sym, freq)
t3 = time.time()
print(
    f"\nsegments {sym} {freq}: status={seg['status']} periods={len(seg['periods'])} filings_read={len(seg['filings_read'])} in {t3 - t2:.1f}s"
)
print("  resegmentations:", seg["resegmentations"])
print("  legend:", [(x["label"], x["type"]) for x in seg["legend"]])
for p in seg["periods"]:
    rows = ", ".join(f"{r['label']}={r['value'] / 1e9:.1f}B" for r in p["rows"])
    alt = (
        f" ALT[{p['alternative']['label']}: {len(p['alternative']['rows'])} rows]"
        if p.get("alternative")
        else ""
    )
    print(
        f"  {p['label']:<8} {p['coverage_state']:<22} total={(p['consolidated_total'] or 0) / 1e9:8.1f}B  {p['provenance']['form']} {p['provenance']['filed']}  {rows}{alt}"
    )
    if p.get("message"):
        print(f"           msg: {p['message']}")
Path("data/sec-diagnostics").mkdir(parents=True, exist_ok=True)
Path(f"data/sec-diagnostics/probe_{sym}_{freq}.json").write_text(
    json.dumps(seg, indent=1), encoding="utf-8"
)
