"""Company logos (MAR-54).

One fetch per company *domain*, not per ticker, cached on disk effectively forever. The
sources are the public favicon endpoints - no API key, no account, no cost. Nothing about
Mario goes out: the only thing sent is a public company's own domain.

Misses are cached too. Plenty of companies have no usable icon, and without a negative
cache every page view would re-ask three services for an answer that will not change.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from . import config

TTL_HIT = 30 * 24 * 60 * 60  # a logo changes maybe once a decade
TTL_MISS = 7 * 24 * 60 * 60  # re-ask about a company with no icon once a week
TIMEOUT = 6.0
MAX_BYTES = 512 * 1024
MIN_BYTES = 64  # a 1x1 tracking pixel is not a logo

USER_AGENT = "TickerScope/0.1 (personal research tool)"

# ico first: the icons services return the real favicon, which is usually the largest art
# available. Google's endpoint always answers, so it goes last - it re-encodes to a small
# jpeg and will happily hand back a generic globe for a domain it does not know.
SOURCES = (
    "https://icons.duckduckgo.com/ip3/{domain}.ico",
    "https://{domain}/favicon.ico",
    "https://www.google.com/s2/favicons?domain={domain}&sz=128",
)

EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "image/ico": ".ico",
}

_SAFE_DOMAIN = re.compile(r"^[a-z0-9.-]{3,190}$")


@dataclass(frozen=True)
class Logo:
    body: bytes
    content_type: str
    domain: str
    source: str


def logo_dir() -> Path:
    return config.data_dir() / "logos"


def domain_for(website: str | None) -> str | None:
    """`https://www.apple.com/` -> `apple.com`. None when there is nothing usable."""
    if not website:
        return None
    raw = website.strip()
    if not raw:
        return None
    if "//" not in raw:
        raw = f"https://{raw}"
    host = (urlsplit(raw).hostname or "").lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    if "." not in host or not _SAFE_DOMAIN.match(host):
        return None
    return host


def _meta_path(domain: str) -> Path:
    return logo_dir() / f"{domain}.json"


def _read_cached(domain: str) -> Logo | None | str:
    """Logo on a cached hit, "miss" on a cached miss, None when the cache says nothing."""
    meta_file = _meta_path(domain)
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    age = time.time() - float(meta.get("stored_at", 0))
    if not meta.get("ok"):
        return "miss" if age < TTL_MISS else None
    if age >= TTL_HIT:
        return None
    try:
        body = (logo_dir() / str(meta["file"])).read_bytes()
    except (OSError, KeyError):
        return None
    return Logo(
        body,
        str(meta.get("content_type", "image/png")),
        domain,
        str(meta.get("source", "")),
    )


def _write_hit(domain: str, body: bytes, content_type: str, source: str) -> None:
    d = logo_dir()
    d.mkdir(parents=True, exist_ok=True)
    name = f"{domain}{EXT_BY_TYPE.get(content_type, '.img')}"
    (d / name).write_bytes(body)
    _meta_path(domain).write_text(
        json.dumps(
            {
                "ok": True,
                "file": name,
                "content_type": content_type,
                "source": source,
                "stored_at": time.time(),
            }
        ),
        encoding="utf-8",
    )


def _write_miss(domain: str) -> None:
    d = logo_dir()
    d.mkdir(parents=True, exist_ok=True)
    _meta_path(domain).write_text(
        json.dumps({"ok": False, "stored_at": time.time()}), encoding="utf-8"
    )


def _fetch(domain: str) -> Logo | None:
    headers = {"User-Agent": USER_AGENT, "Accept": "image/*"}
    for template in SOURCES:
        url = template.format(domain=domain)
        try:
            with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=headers) as client:
                r = client.get(url)
        except httpx.HTTPError:
            continue
        if r.status_code != 200:
            continue
        ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
        if ctype not in EXT_BY_TYPE:
            continue
        body = r.content
        if not (MIN_BYTES <= len(body) <= MAX_BYTES):
            continue
        return Logo(body, ctype, domain, url)
    return None


def logo_for_domain(domain: str) -> Logo | None:
    """Cached logo for a domain, fetching once if the cache has nothing to say."""
    cached = _read_cached(domain)
    if isinstance(cached, Logo):
        return cached
    if cached == "miss":
        return None
    found = _fetch(domain)
    if found is None:
        _write_miss(domain)
        return None
    _write_hit(domain, found.body, found.content_type, found.source)
    return found


def logo_for_website(website: str | None) -> Logo | None:
    domain = domain_for(website)
    return logo_for_domain(domain) if domain else None
