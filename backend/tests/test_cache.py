import time

from tickerscope.cache import DiskCache


def test_roundtrip_and_freshness(tmp_path):
    c = DiskCache(tmp_path)
    assert c.get("ns", "k", 60) is None
    c.set("ns", "k", {"a": 1})
    hit = c.get("ns", "k", 60)
    assert hit is not None and hit.fresh and hit.payload == {"a": 1}


def test_stale_after_ttl(tmp_path):
    c = DiskCache(tmp_path)
    c.set("ns", "k", [1, 2, 3])
    time.sleep(0.02)
    hit = c.get("ns", "k", 0.001)
    assert hit is not None and not hit.fresh and hit.payload == [1, 2, 3]


def test_keys_are_filesystem_safe(tmp_path):
    c = DiskCache(tmp_path)
    c.set("ticker", "BRK.B/../x", {"ok": True})
    assert c.get("ticker", "BRK.B/../x", 60).payload == {"ok": True}
    assert all(p.is_relative_to(tmp_path) for p in tmp_path.rglob("*.json"))


def test_corrupt_file_is_treated_as_miss(tmp_path):
    c = DiskCache(tmp_path)
    c.set("ns", "k", 1)
    path = next(tmp_path.rglob("*.json"))
    path.write_text("{not json", encoding="utf-8")
    assert c.get("ns", "k", 60) is None
