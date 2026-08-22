"""Logo resolution and caching (MAR-54). No test here touches the network."""

from __future__ import annotations

import json
import time

import httpx
import pytest

from tickerscope import logos

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 200


@pytest.fixture(autouse=True)
def logo_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TICKERSCOPE_DATA_DIR", str(tmp_path / "data"))
    return tmp_path / "data" / "logos"


class FakeClient:
    """Stands in for httpx.Client. `answers` maps url -> (status, content_type, body)."""

    def __init__(self, answers: dict, log: list[str]):
        self.answers = answers
        self.log = log

    def __call__(self, *_args, **_kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def get(self, url: str):
        self.log.append(url)
        if url not in self.answers:
            raise httpx.ConnectError("nope")
        status, ctype, body = self.answers[url]
        return httpx.Response(status, headers={"content-type": ctype}, content=body)


def install(monkeypatch, answers: dict) -> list[str]:
    log: list[str] = []
    monkeypatch.setattr(logos.httpx, "Client", FakeClient(answers, log))
    return log


@pytest.mark.parametrize(
    "website,expected",
    [
        ("https://www.apple.com/", "apple.com"),
        ("http://apple.com", "apple.com"),
        ("apple.com", "apple.com"),
        ("https://investor.nvidia.com/home/default.aspx", "investor.nvidia.com"),
        ("https://WWW.Apple.COM", "apple.com"),
        (None, None),
        ("", None),
        ("   ", None),
        ("not a url", None),
        ("https://localhost", None),
    ],
)
def test_domain_for(website, expected):
    assert logos.domain_for(website) == expected


def test_first_source_that_answers_with_an_image_wins(monkeypatch):
    log = install(
        monkeypatch,
        {"https://icons.duckduckgo.com/ip3/apple.com.ico": (200, "image/x-icon", PNG)},
    )
    found = logos.logo_for_website("https://www.apple.com")
    assert found is not None
    assert found.body == PNG
    assert found.content_type == "image/x-icon"
    assert found.domain == "apple.com"
    assert len(log) == 1  # stopped at the first hit


def test_falls_through_to_the_next_source(monkeypatch):
    log = install(
        monkeypatch,
        {
            "https://icons.duckduckgo.com/ip3/apple.com.ico": (404, "text/html", b"nope"),
            "https://apple.com/favicon.ico": (200, "image/png", PNG),
        },
    )
    found = logos.logo_for_website("apple.com")
    assert found is not None and found.content_type == "image/png"
    assert len(log) == 2


def test_html_error_pages_are_not_logos(monkeypatch):
    install(monkeypatch, {"https://apple.com/favicon.ico": (200, "text/html", b"<html>" * 40)})
    assert logos.logo_for_website("apple.com") is None


def test_tracking_pixels_are_not_logos(monkeypatch):
    install(monkeypatch, {"https://apple.com/favicon.ico": (200, "image/gif", b"GIF89a")})
    assert logos.logo_for_website("apple.com") is None


def test_oversized_bodies_are_rejected(monkeypatch):
    huge = b"\x89PNG" + b"x" * (logos.MAX_BYTES + 1)
    install(monkeypatch, {"https://apple.com/favicon.ico": (200, "image/png", huge)})
    assert logos.logo_for_website("apple.com") is None


def test_a_hit_is_served_from_disk_without_asking_again(monkeypatch, logo_data_dir):
    answers = {"https://icons.duckduckgo.com/ip3/apple.com.ico": (200, "image/png", PNG)}
    log = install(monkeypatch, answers)
    assert logos.logo_for_website("apple.com") is not None
    assert (logo_data_dir / "apple.com.png").read_bytes() == PNG

    again = logos.logo_for_website("apple.com")
    assert again is not None and again.body == PNG
    assert len(log) == 1  # no second round trip


def test_a_miss_is_cached_too(monkeypatch):
    log = install(monkeypatch, {})
    assert logos.logo_for_website("apple.com") is None
    assert logos.logo_for_website("apple.com") is None
    assert len(log) == 3  # three sources tried once, then the negative cache answered


def test_an_expired_miss_is_retried(monkeypatch, logo_data_dir):
    install(monkeypatch, {})
    assert logos.logo_for_website("apple.com") is None
    stale = {"ok": False, "stored_at": time.time() - logos.TTL_MISS - 1}
    (logo_data_dir / "apple.com.json").write_text(json.dumps(stale), encoding="utf-8")

    log = install(monkeypatch, {"https://apple.com/favicon.ico": (200, "image/png", PNG)})
    assert logos.logo_for_website("apple.com") is not None
    assert log  # it went back out


def test_a_hit_whose_file_vanished_refetches(monkeypatch, logo_data_dir):
    answers = {"https://icons.duckduckgo.com/ip3/apple.com.ico": (200, "image/png", PNG)}
    install(monkeypatch, answers)
    assert logos.logo_for_website("apple.com") is not None
    (logo_data_dir / "apple.com.png").unlink()

    log = install(monkeypatch, answers)
    assert logos.logo_for_website("apple.com") is not None
    assert log


def test_a_company_with_no_website_never_reaches_the_network(monkeypatch):
    log = install(monkeypatch, {})
    assert logos.logo_for_website(None) is None
    assert log == []


def test_the_route_serves_the_image_and_404s_without_one(client, monkeypatch):
    client.get("/api/ticker/AAPL")  # warm the profile the route reads
    client.get("/api/ticker/NVDA")
    install(monkeypatch, {"https://icons.duckduckgo.com/ip3/apple.com.ico": (200, "image/png", PNG)})
    r = client.get("/api/logo/AAPL")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content == PNG

    install(monkeypatch, {})
    assert client.get("/api/logo/NVDA").status_code == 404


def test_the_route_404s_for_an_unknown_ticker(client):
    assert client.get("/api/logo/ZZZZ").status_code == 404


def test_the_route_never_fetches_a_profile_of_its_own(client, fetcher, monkeypatch):
    """A page of search results must not turn into one yfinance call per logo."""
    log = install(monkeypatch, {})
    before = len(fetcher.calls)
    assert client.get("/api/logo/AAPL").status_code == 404
    assert fetcher.calls[before:] == []  # no upstream call
    assert log == []  # and no logo lookup either, since there was no website to try


def test_a_stale_cached_profile_is_still_good_enough_for_a_logo(client, cache, monkeypatch):
    client.get("/api/ticker/AAPL")
    entry = cache.get("ticker", "AAPL", 10**9)
    assert entry is not None
    cache.set("ticker", "AAPL", entry.payload)
    monkeypatch.setattr("tickerscope.config.TTL_QUOTE", 0)  # everything is stale now
    install(monkeypatch, {"https://icons.duckduckgo.com/ip3/apple.com.ico": (200, "image/png", PNG)})
    assert client.get("/api/logo/AAPL").status_code == 200


def test_a_logo_lookup_blowing_up_is_a_404_not_a_500(client, monkeypatch):
    client.get("/api/ticker/AAPL")

    def boom(_website):
        raise RuntimeError("logo service on fire")

    monkeypatch.setattr(logos, "logo_for_website", boom)
    assert client.get("/api/logo/AAPL").status_code == 404
