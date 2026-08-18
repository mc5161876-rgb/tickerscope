"""Headless-Edge smoke harness over the Chrome DevTools Protocol.

Usage (server must be running on 127.0.0.1:8790):
    uv run python scripts/smoke_cdp.py                 # screenshots + layout checks
    uv run python scripts/smoke_cdp.py --eval "document.title"

Writes docs/screenshots/*.png. Uses only stdlib + websockets (already a uvicorn dep).
The Browser pane on this desktop can't reach localhost, so this is the review path.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websockets

# Windows consoles default to cp1252; tooltips contain arrows / dashes
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
BASE = os.environ.get("TICKERSCOPE_BASE", "http://127.0.0.1:8790")
PORT = 9333
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_edge() -> str:
    for p in EDGE_CANDIDATES:
        if Path(p).exists():
            return p
    raise SystemExit("msedge.exe not found")


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.id = 0
        self.events: list[dict] = []

    async def send(self, method: str, **params):
        self.id += 1
        mid = self.id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)

    async def wait_event(self, name: str, timeout: float = 20.0):
        for e in self.events:
            if e.get("method") == name:
                self.events.remove(e)
                return e
        end = time.time() + timeout
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=end - time.time())
            except TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get("method") == name:
                return msg
            self.events.append(msg)
        raise TimeoutError(name)

    async def eval(self, expr: str):
        res = await self.send(
            "Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True
        )
        return res.get("result", {}).get("value")

    async def goto(self, url: str, settle: float = 4.0):
        await self.send("Page.navigate", url=url)
        await self.wait_event("Page.loadEventFired")
        await asyncio.sleep(settle)

    async def viewport(self, w: int, h: int, mobile: bool = False):
        await self.send(
            "Emulation.setDeviceMetricsOverride",
            width=w,
            height=h,
            deviceScaleFactor=1,
            mobile=mobile,
        )

    async def shot(self, path: Path, full: bool = False):
        params = {"format": "png"}
        if full:
            params["captureBeyondViewport"] = True
        res = await self.send("Page.captureScreenshot", **params)
        path.write_bytes(base64.b64decode(res["data"]))
        print(f"  saved {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")

    async def click(self, selector: str):
        await self.eval(
            f"(() => {{ const el = document.querySelector({json.dumps(selector)}); if (!el) return false; el.click(); return true; }})()"
        )

    async def key(self, key: str, code: str | None = None, text: str | None = None, mods: int = 0):
        params = {"type": "keyDown", "key": key, "modifiers": mods}
        if code:
            params["code"] = code
        if text:
            params["text"] = text
        await self.send("Input.dispatchKeyEvent", **params)
        await self.send("Input.dispatchKeyEvent", type="keyUp", key=key, modifiers=mods)

    async def type_text(self, text: str):
        for ch in text:
            await self.send("Input.dispatchKeyEvent", type="keyDown", key=ch, text=ch)
            await self.send("Input.dispatchKeyEvent", type="keyUp", key=ch)
            await asyncio.sleep(0.03)


LAYOUT_JS = """
(() => {
  const cards = [...document.querySelectorAll('.chart-card')].map(c => {
    const r = c.getBoundingClientRect();
    const svg = c.querySelector('svg.recharts-surface');
    const body = c.querySelector('.chart-body');
    return { title: c.getAttribute('aria-label'), card: Math.round(r.width), body: body ? Math.round(body.getBoundingClientRect().width) : null,
             svg: svg ? +svg.getAttribute('width') : null, svgRendered: svg ? Math.round(svg.getBoundingClientRect().width) : null };
  });
  return { viewport: document.documentElement.clientWidth, cards,
           tiles: document.querySelectorAll('.tile').length,
           groups: [...document.querySelectorAll('.group-label')].map(g => g.textContent),
           dashes: [...document.querySelectorAll('.tile-value.null')].length,
           title: document.querySelector('.ticker-id h1')?.textContent,
           price: document.querySelector('.hero-price')?.textContent,
           footnote: !!document.querySelector('.footnote'),
           strip: document.querySelector('.strip .txt b')?.textContent };
})()
"""


SEG_JS = """
(() => {
  const c = document.querySelector('.chart-card[aria-label="Revenue by Segment"], .chart-card[aria-label="Revenue by Region"], .chart-card[aria-label="Revenue by Product or Service"]');
  if (!c) return null;
  const rev = document.querySelector('.chart-card[aria-label="Revenue"]');
  return {
    title: c.getAttribute('aria-label'),
    text: c.innerText.replace(/\\s+/g, ' ').slice(0, 260),
    state: c.querySelector('.seg-state')?.getAttribute('data-state') ?? null,
    bars: c.querySelectorAll('.recharts-bar-rectangle path').length,
    ticks: c.querySelectorAll('.recharts-line-dots line').length,
    legend: [...c.querySelectorAll('.seg-key')].map(k => k.textContent.trim()),
    reseg: c.querySelectorAll('.recharts-reference-line').length,
    resegNote: c.querySelector('.reseg-note')?.textContent ?? null,
    revenueTicks: rev ? [...rev.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(t => t.textContent).filter(t => /^FY|^Q/.test(t)) : [],
    revSub: rev?.querySelector('.chart-sub')?.textContent ?? null,
    grid2x2: (() => { const g = document.querySelector('.chart-grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; })(),
    footnote: !!document.querySelector('.footnote'),
  };
})()
"""


async def wait_segments(cdp: CDP, timeout: float = 90.0) -> dict | None:
    """First open of a ticker can take a while (multiple SEC fetches, AC-9)."""
    end = time.time() + timeout
    while time.time() < end:
        info = await cdp.eval(SEG_JS)
        if info and "Reading SEC filings" not in info["text"]:
            return info
        await asyncio.sleep(1.5)
    return await cdp.eval(SEG_JS)


async def sec_checks(cdp: CDP, failures: list[str]) -> None:
    print("== MAR-49 SEC checks")
    await cdp.viewport(1280, 800)

    # AMZN: stacked, ~10 fiscal years, legend, revenue chart spans SEC history
    await cdp.goto(f"{BASE}/t/AMZN", settle=3)
    info = await wait_segments(cdp)
    print(
        "AMZN:",
        json.dumps(
            {
                k: info[k]
                for k in (
                    "title",
                    "state",
                    "bars",
                    "ticks",
                    "legend",
                    "revenueTicks",
                    "grid2x2",
                    "footnote",
                )
            }
        )
        if info
        else None,
    )
    if not info or info["bars"] < 24 or info["ticks"] < 8:
        failures.append(f"AMZN segment card should stack ~10 years (bars={info and info['bars']})")
    if not info or len(info["revenueTicks"]) < 9:
        failures.append(
            f"AMZN Revenue chart should span >=9 fiscal years, got {info and info['revenueTicks']}"
        )
    if info and info["footnote"]:
        failures.append("AC-15 footnote should be removed")
    if info and info["grid2x2"] != 2:
        failures.append(f"Insights grid should be 2 columns at 1280 (got {info['grid2x2']})")
    await cdp.eval(
        "document.querySelector('.chart-grid').scrollIntoView({block:'start'}); window.scrollBy(0,-70)"
    )
    await asyncio.sleep(0.4)
    await cdp.shot(SHOTS / "segments-AMZN-1280x800.png")
    # hover a segment bar -> provenance tooltip
    await cdp.eval(
        """(() => { const p = document.querySelector('.chart-card[aria-label="Revenue by Segment"] .recharts-bar-rectangle path'); if (!p) return; const r = p.getBoundingClientRect(); const ev = new MouseEvent('mousemove', {clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true}); p.dispatchEvent(ev); })()"""
    )
    await asyncio.sleep(0.4)
    tt = await cdp.eval(
        "document.querySelector('.chart-card[aria-label=\"Revenue by Segment\"] .tt')?.innerText ?? null"
    )
    print("AMZN tooltip:", (tt or "").replace("\n", " | ")[:200])
    if not tt or "10-K" not in tt or "% of stack" not in tt:
        failures.append("segment tooltip should show % of stack and 10-K provenance")
    await cdp.shot(SHOTS / "segments-AMZN-tooltip.png")

    # NFLX: single segment
    await cdp.goto(f"{BASE}/t/NFLX", settle=3)
    info = await wait_segments(cdp)
    print("NFLX:", json.dumps({k: info[k] for k in ("state", "bars", "text")}) if info else None)
    if (
        not info
        or info["state"] != "single_segment"
        or "Reports as one segment" not in info["text"]
    ):
        failures.append("NFLX should show 'Reports as one segment'")
    await cdp.eval(
        "document.querySelector('.chart-grid').scrollIntoView({block:'start'}); window.scrollBy(0,-70)"
    )
    await asyncio.sleep(0.4)
    await cdp.shot(SHOTS / "segments-NFLX-1280x800.png")

    # INTC: withheld -> Revenue by Region alternative
    await cdp.goto(f"{BASE}/t/INTC", settle=3)
    info = await wait_segments(cdp)
    print(
        "INTC:",
        json.dumps({k: info[k] for k in ("title", "state", "bars", "legend")}) if info else None,
    )
    if not info or info["title"] != "Revenue by Region" or info["state"] != "withheld_alternative":
        failures.append("INTC should draw 'Revenue by Region' with the business view withheld")
    await cdp.eval(
        "document.querySelector('.chart-grid').scrollIntoView({block:'start'}); window.scrollBy(0,-70)"
    )
    await asyncio.sleep(0.4)
    await cdp.shot(SHOTS / "segments-INTC-1280x800.png")

    # UNH: needs review
    await cdp.goto(f"{BASE}/t/UNH", settle=3)
    info = await wait_segments(cdp)
    print("UNH:", json.dumps({k: info[k] for k in ("state", "text")}) if info else None)
    if not info or info["state"] != "needs_review" or "withheld" not in info["text"].lower():
        failures.append("UNH should show the needs_review withheld message")

    # JPM: bridge + real re-segmentation divider
    await cdp.goto(f"{BASE}/t/JPM", settle=3)
    info = await wait_segments(cdp)
    print(
        "JPM:",
        json.dumps({k: info[k] for k in ("state", "bars", "reseg", "resegNote", "legend")})
        if info
        else None,
    )
    if not info or info["reseg"] < 1 or not info["resegNote"]:
        failures.append("JPM should show a re-segmentation divider + note")
    await cdp.eval(
        "document.querySelector('.chart-grid').scrollIntoView({block:'start'}); window.scrollBy(0,-70)"
    )
    await asyncio.sleep(0.4)
    await cdp.shot(SHOTS / "segments-JPM-1280x800.png")


async def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", dest="expr")
    ap.add_argument("--url", default=f"{BASE}/t/AAPL")
    args = ap.parse_args(argv)
    SHOTS.mkdir(parents=True, exist_ok=True)

    prof = Path(os.environ.get("TEMP", ".")) / "tickerscope-cdp-profile"
    proc = subprocess.Popen(
        [
            find_edge(),
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            f"--remote-debugging-port={PORT}",
            f"--user-data-dir={prof}",
            "--window-size=1280,800",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        ws_url = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
                    targets = json.load(r)
                pages = [t for t in targets if t.get("type") == "page"]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.25)
        if not ws_url:
            print("could not connect to Edge CDP")
            return 2

        async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.send("Page.enable")
            await cdp.send("Runtime.enable")

            if args.expr:
                await cdp.viewport(1280, 800)
                await cdp.goto(args.url)
                print(json.dumps(await cdp.eval(args.expr), indent=1))
                return 0

            failures: list[str] = []

            # ---- desktop ticker page
            print("== /t/AAPL @1280x800")
            await cdp.viewport(1280, 800)
            await cdp.goto(f"{BASE}/t/AAPL", settle=5)
            lay = await cdp.eval(LAYOUT_JS)
            print(json.dumps(lay, indent=1))
            for c in lay["cards"]:
                if c["svg"] is None and c["title"] not in ("Stock Price", "Revenue", "EBITDA"):
                    continue  # segment card may still be reading SEC filings / not drawable
                if c["svg"] is None or c["body"] is None or c["svg"] > c["body"] + 2:
                    failures.append(
                        f"chart '{c['title']}' svg {c['svg']} wider than body {c['body']}"
                    )
            if lay["tiles"] != 35:
                failures.append(f"expected 35 metric tiles, got {lay['tiles']}")
            await cdp.shot(SHOTS / "ticker-AAPL-1280x800.png")
            await cdp.shot(SHOTS / "ticker-AAPL-1280-full.png", full=True)

            # ---- explainer popover
            await cdp.click('[data-metric="forward_pe"] .tile-label')
            await asyncio.sleep(0.4)
            pop = await cdp.eval(
                "(() => { const p = document.querySelector('.popover'); return p ? p.innerText : null; })()"
            )
            print("popover:", (pop or "").replace("\n", " | ")[:200])
            pop_l = (pop or "").lower()  # innerText reflects CSS text-transform on the headers
            if (
                not pop
                or "aapl" not in pop_l
                or "what it is" not in pop_l
                or "how to read it" not in pop_l
            ):
                failures.append("forward P/E popover missing or wrong")
            await cdp.eval("window.scrollTo(0, 0)")
            await cdp.shot(SHOTS / "ticker-AAPL-explainer.png")
            await cdp.key("Escape", "Escape")
            await asyncio.sleep(0.2)
            still = await cdp.eval("!!document.querySelector('.popover')")
            if still:
                failures.append("Esc did not close the popover")

            # ---- search modal via Ctrl+K
            await cdp.key("k", "KeyK", mods=2)
            await asyncio.sleep(0.3)
            modal = await cdp.eval("!!document.querySelector('.modal [role=combobox]')")
            if not modal:
                failures.append("Ctrl+K did not open the search modal")
            else:
                await cdp.type_text("nvd")
                await asyncio.sleep(1.2)
                first = await cdp.eval(
                    "(() => { const o = document.querySelector('.modal [role=option] .ticker'); return o ? o.textContent : null; })()"
                )
                print("modal first result:", first)
                if first != "NVDA":
                    failures.append(f"modal first result for 'nvd' was {first}")
                await cdp.shot(SHOTS / "search-modal-1280x800.png")
                await cdp.key("ArrowDown", "ArrowDown")
                await cdp.key("Enter", "Enter")
                await asyncio.sleep(4)
                url = await cdp.eval("location.pathname")
                print("after Enter:", url)
                if url != "/t/NVDA":
                    failures.append(f"Enter navigated to {url}, expected /t/NVDA")

            # ---- unknown ticker
            await cdp.goto(f"{BASE}/t/ZZZZ9", settle=2.5)
            nf = await cdp.eval("document.querySelector('.notfound h1')?.textContent")
            print("notfound:", nf)
            if nf != "No company found for ZZZZ9":
                failures.append(f"unknown ticker state: {nf}")

            # ---- JPM EBITDA fallback text
            await cdp.goto(f"{BASE}/t/JPM", settle=5)
            eb = await cdp.eval(
                "(() => { const c = document.querySelector('.chart-card[aria-label=EBITDA]'); return c ? c.innerText.replace(/\\s+/g,' ') : null; })()"
            )
            print("JPM EBITDA card:", (eb or "")[:120])
            if not eb or "Not available from source" not in eb:
                failures.append("JPM EBITDA card should say 'Not available from source'")
            await cdp.shot(SHOTS / "ticker-JPM-1280-full.png", full=True)

            # ---- light theme
            await cdp.click(".topbar .switch")
            await asyncio.sleep(0.4)
            theme = await cdp.eval("document.documentElement.getAttribute('data-theme')")
            if theme != "light":
                failures.append(f"Lights toggle -> theme {theme}")
            await cdp.eval("window.scrollTo(0,0)")
            await cdp.shot(SHOTS / "ticker-JPM-light-1280x800.png")
            await cdp.click(".topbar .switch")

            # ---- MAR-49: SEC history + Revenue by Segment (only when SEC is configured)
            health = json.loads(await cdp.eval("fetch('/api/health').then(r=>r.text())"))
            if health.get("sec_configured"):
                await sec_checks(cdp, failures)
            else:
                print("(SEC_USER_AGENT not set: skipping segment checks)")

            # ---- home
            await cdp.goto(f"{BASE}/", settle=2)
            await cdp.shot(SHOTS / "home-1280x800.png")
            recent = await cdp.eval("document.querySelectorAll('.recent .chip b').length")
            print("recent chips:", recent)

            # ---- phone
            print("== /t/AAPL @390x844")
            await cdp.viewport(390, 844, mobile=True)
            await cdp.goto(f"{BASE}/t/AAPL", settle=5)
            lay = await cdp.eval(LAYOUT_JS)
            print(json.dumps({k: lay[k] for k in ("viewport", "cards")}, indent=1))
            for c in lay["cards"]:
                if c["svg"] is None and c["title"] not in ("Stock Price", "Revenue", "EBITDA"):
                    continue
                if c["svg"] is None or c["svg"] > (c["body"] or 0) + 2:
                    failures.append(
                        f"phone chart '{c['title']}' svg {c['svg']} wider than body {c['body']}"
                    )
            hscroll = await cdp.eval(
                "document.documentElement.scrollWidth > document.documentElement.clientWidth"
            )
            if hscroll:
                failures.append("phone layout scrolls horizontally")
            await cdp.shot(SHOTS / "ticker-AAPL-390x844.png")
            await cdp.shot(SHOTS / "ticker-AAPL-390-full.png", full=True)

            print()
            if failures:
                print("FAILURES:")
                for f in failures:
                    print(" -", f)
                return 1
            print("ALL SMOKE CHECKS PASSED")
            return 0
    finally:
        proc.terminate()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
