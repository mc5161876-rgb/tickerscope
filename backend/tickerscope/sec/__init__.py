"""SEC EDGAR access for TickerScope (MAR-49).

client.py        durable response cache + rate-limited HTTP (ported from traderscope feat/sec-cache)
extractor.py     linkbase-aware segment-revenue extractor (ported; per-filing API added)
companyfacts.py  10-year Revenue / EBITDA series from the XBRL companyfacts API
segments.py      Revenue-by-Segment contract per period (coverage states, re-segmentation)
"""
