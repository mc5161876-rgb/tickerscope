# Ported verbatim from traderscope backend/tests/test_sec_cache.py @ 4ebf231 (import + patch paths only).
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

from tickerscope.sec.client import Fetcher


class FakeResponse:
    def __init__(self, payload: bytes, *, gzipped: bool = False) -> None:
        self.payload = gzip.compress(payload) if gzipped else payload
        self.headers = {"Content-Encoding": "gzip"} if gzipped else {}

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload


def digest_for(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def test_fetcher_writes_integrity_metadata_and_reuses_cached_bytes(tmp_path: Path) -> None:
    url = "https://www.sec.gov/Archives/edgar/data/1/filing/instance.xml"
    fetcher = Fetcher("TraderScope test test@example.com", tmp_path)

    with patch(
        "tickerscope.sec.client.urllib.request.urlopen",
        return_value=FakeResponse(b"filing bytes", gzipped=True),
    ) as urlopen:
        assert fetcher.get(url) == b"filing bytes"
        assert fetcher.get(url) == b"filing bytes"

    assert urlopen.call_count == 1
    digest = digest_for(url)
    assert (tmp_path / f"{digest}.bin").read_bytes() == b"filing bytes"
    metadata = json.loads((tmp_path / f"{digest}.json").read_text(encoding="utf-8"))
    assert metadata["url"] == url
    assert metadata["byte_length"] == len(b"filing bytes")
    assert metadata["sha256"] == hashlib.sha256(b"filing bytes").hexdigest()


def test_full_url_hash_prevents_truncated_filename_collisions(tmp_path: Path) -> None:
    shared = "https://www.sec.gov/Archives/edgar/data/1/" + ("a" * 240)
    first = f"{shared}/first.xml"
    second = f"{shared}/second.xml"
    fetcher = Fetcher("TraderScope test test@example.com", tmp_path)

    with patch(
        "tickerscope.sec.client.urllib.request.urlopen",
        side_effect=[FakeResponse(b"first"), FakeResponse(b"second")],
    ) as urlopen:
        assert fetcher.get(first) == b"first"
        assert fetcher.get(second) == b"second"

    assert urlopen.call_count == 2
    assert digest_for(first) != digest_for(second)
    assert (tmp_path / f"{digest_for(first)}.bin").read_bytes() == b"first"
    assert (tmp_path / f"{digest_for(second)}.bin").read_bytes() == b"second"


def test_corrupt_cache_is_refetched_and_repaired(tmp_path: Path) -> None:
    url = "https://data.sec.gov/submissions/CIK0000000001.json"
    fetcher = Fetcher("TraderScope test test@example.com", tmp_path)
    digest = digest_for(url)
    (tmp_path / f"{digest}.bin").write_bytes(b"corrupt")
    (tmp_path / f"{digest}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "url": url,
                "fetched_at": "2026-08-03T00:00:00+00:00",
                "byte_length": 7,
                "sha256": "wrong",
            }
        ),
        encoding="utf-8",
    )

    with patch(
        "tickerscope.sec.client.urllib.request.urlopen",
        return_value=FakeResponse(b"repaired"),
    ) as urlopen:
        assert fetcher.get(url) == b"repaired"

    assert urlopen.call_count == 1
    assert (tmp_path / f"{digest}.bin").read_bytes() == b"repaired"


def test_stale_mutable_metadata_is_refetched(tmp_path: Path) -> None:
    url = "https://data.sec.gov/submissions/CIK0000000001.json"
    fetcher = Fetcher(
        "TraderScope test test@example.com",
        tmp_path,
        mutable_ttl_seconds=60,
    )
    digest = digest_for(url)
    stale = b"stale"
    (tmp_path / f"{digest}.bin").write_bytes(stale)
    (tmp_path / f"{digest}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "url": url,
                "fetched_at": "2000-01-01T00:00:00+00:00",
                "cache_policy": "refreshable",
                "byte_length": len(stale),
                "sha256": hashlib.sha256(stale).hexdigest(),
            }
        ),
        encoding="utf-8",
    )

    with patch(
        "tickerscope.sec.client.urllib.request.urlopen",
        return_value=FakeResponse(b"fresh"),
    ) as urlopen:
        assert fetcher.get(url) == b"fresh"

    assert urlopen.call_count == 1


def test_immutable_filing_ignores_age(tmp_path: Path) -> None:
    url = "https://www.sec.gov/Archives/edgar/data/1/filing/instance.xml"
    fetcher = Fetcher(
        "TraderScope test test@example.com",
        tmp_path,
        mutable_ttl_seconds=0,
    )
    fetcher._write_cache(url, b"immutable")

    with patch("tickerscope.sec.client.urllib.request.urlopen") as urlopen:
        assert fetcher.get(url) == b"immutable"

    urlopen.assert_not_called()


def test_legacy_cache_is_migrated_without_network_request(tmp_path: Path) -> None:
    url = "https://www.sec.gov/files/company_tickers.json"
    fetcher = Fetcher("TraderScope test test@example.com", tmp_path)
    legacy = fetcher._legacy_cache_path(url)
    legacy.write_bytes(b"legacy")

    with patch("tickerscope.sec.client.urllib.request.urlopen") as urlopen:
        assert fetcher.get(url) == b"legacy"

    urlopen.assert_not_called()
    digest = digest_for(url)
    assert (tmp_path / f"{digest}.bin").read_bytes() == b"legacy"
    metadata = json.loads((tmp_path / f"{digest}.json").read_text(encoding="utf-8"))
    assert metadata["url"] == url


def test_truncated_legacy_cache_is_not_trusted(tmp_path: Path) -> None:
    url = "https://www.sec.gov/Archives/edgar/data/1/" + ("a" * 240)
    fetcher = Fetcher("TraderScope test test@example.com", tmp_path)
    fetcher._legacy_cache_path(url).write_bytes(b"possibly collided")

    with patch(
        "tickerscope.sec.client.urllib.request.urlopen",
        return_value=FakeResponse(b"verified"),
    ) as urlopen:
        assert fetcher.get(url) == b"verified"

    assert urlopen.call_count == 1
