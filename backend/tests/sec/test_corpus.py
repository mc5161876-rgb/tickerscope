"""AC-10: the hostile-corpus check (17 as_filed / 3 needs_review / 0 errors) - runs offline from
the durable SEC cache when it is present, otherwise skips. Populate with:
    PYTHONPATH=backend uv run python -m tickerscope.sec.extractor
"""

from __future__ import annotations

import argparse
import collections
from unittest.mock import patch

import pytest

from tickerscope import config
from tickerscope.sec import extractor
from tickerscope.sec.client import Fetcher

CORPUS_CACHE = config.REPO_ROOT / "data" / "sec-cache"


def _corpus_present() -> bool:
    f = Fetcher("corpus-check", CORPUS_CACHE)
    return f.cached("https://www.sec.gov/files/company_tickers.json") and f.cached(
        "https://data.sec.gov/submissions/CIK0000789019.json"
    )


@pytest.mark.skipif(
    not _corpus_present(), reason="SEC corpus cache not present under data/sec-cache"
)
def test_hostile_corpus_reports_17_as_filed_3_needs_review_0_errors(tmp_path):
    with patch(
        "tickerscope.sec.client.urllib.request.urlopen", side_effect=AssertionError("network")
    ):
        rows = extractor.run(
            argparse.Namespace(
                user_agent="corpus-check",
                cache_dir=str(CORPUS_CACHE),
                tickers="",
                limit=0,
                request_pause=0,
                output=str(tmp_path / "corpus.json"),
            )
        )
    tally = collections.Counter(r.get("status") for r in rows)
    assert tally["AS_FILED"] == 17, tally
    assert tally["NEEDS_REVIEW"] == 3, tally
    assert tally.get("ERROR", 0) == 0, [r for r in rows if r.get("status") == "ERROR"]
    assert {r["ticker"] for r in rows if r["status"] == "NEEDS_REVIEW"} == {"INTC", "DE", "UNH"}
