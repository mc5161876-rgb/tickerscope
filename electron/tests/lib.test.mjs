// node --test electron/tests/  (MAR-51 test expectations: startup decision, config, health stub)
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decideStartup, healthCheck, isLocalUrl, mergeConfig, normalizeServerUrl, portOf, readConfig, serverCommand, waitForHealth, writeConfig, DEFAULT_SERVER_URL } from "../lib.mjs";

test("normalizeServerUrl adds scheme, strips paths, rejects non-http", () => {
  assert.equal(normalizeServerUrl("127.0.0.1:8790"), "http://127.0.0.1:8790");
  assert.equal(normalizeServerUrl("http://geekom:8790/"), "http://geekom:8790");
  assert.equal(normalizeServerUrl(" https://ts.tailnet.ts.net/anything "), "https://ts.tailnet.ts.net");
  assert.equal(normalizeServerUrl(""), DEFAULT_SERVER_URL);
  assert.throws(() => normalizeServerUrl("ftp://x"), /http/);
});

test("isLocalUrl / portOf", () => {
  assert.equal(isLocalUrl("http://127.0.0.1:8790"), true);
  assert.equal(isLocalUrl("http://localhost:8790"), true);
  assert.equal(isLocalUrl("http://geekom:8790"), false);
  assert.equal(isLocalUrl("http://10.255.255.1:8790"), false);
  assert.equal(isLocalUrl("garbage"), false);
  assert.equal(portOf("http://127.0.0.1:8790"), 8790);
  assert.equal(portOf("https://geekom"), 443);
});

test("decideStartup: healthy -> open; local+down -> spawn; remote+down -> unreachable", () => {
  assert.equal(decideStartup({ healthy: true, serverUrl: "http://127.0.0.1:8790" }), "open");
  assert.equal(decideStartup({ healthy: true, serverUrl: "http://geekom:8790" }), "open");
  assert.equal(decideStartup({ healthy: false, serverUrl: "http://127.0.0.1:8790" }), "spawn");
  assert.equal(decideStartup({ healthy: false, serverUrl: "http://geekom:8790" }), "unreachable");
});

test("healthCheck against a stub endpoint: ok / not ok / down / timeout", async () => {
  let mode = "ok";
  const srv = createServer((req, res) => {
    if (req.url !== "/api/health") {
      res.writeHead(404).end();
      return;
    }
    if (mode === "ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (mode === "bad") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "starting" }));
    } else if (mode === "hang") {
      /* never respond */
    } else {
      res.writeHead(500).end();
    }
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal(await healthCheck(url), true);
    mode = "bad";
    assert.equal(await healthCheck(url), false);
    mode = "500";
    assert.equal(await healthCheck(url), false);
    mode = "hang";
    assert.equal(await healthCheck(url, { timeoutMs: 150 }), false);
    assert.equal(await healthCheck("http://127.0.0.1:1", { timeoutMs: 500 }), false);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test("waitForHealth polls until healthy and gives up at the timeout", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return { ok: true, json: async () => ({ status: "ok" }) };
  };
  let clock = 0;
  const ok = await waitForHealth("http://127.0.0.1:8790", { fetchImpl, timeoutMs: 20_000, intervalMs: 500, sleep: async (ms) => { clock += ms; }, now: () => clock });
  assert.equal(ok, true);
  assert.equal(calls, 3);

  let clock2 = 0;
  const never = async () => { throw new Error("down"); };
  const ok2 = await waitForHealth("http://127.0.0.1:8790", { fetchImpl: never, timeoutMs: 20_000, intervalMs: 500, sleep: async (ms) => { clock2 += ms; }, now: () => clock2 });
  assert.equal(ok2, false);
  assert.ok(clock2 >= 20_000);
});

test("config read/write round-trips and sanitises", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ts-cfg-"));
  const file = path.join(dir, "TickerScope", "config.json");
  try {
    const fresh = await readConfig(file);
    assert.equal(fresh.serverUrl, DEFAULT_SERVER_URL);
    assert.equal(fresh.window.width, 1280);
    await writeConfig(file, { serverUrl: "geekom:8790", window: { width: 1000.4, height: 200, x: 10, y: 20, maximized: 1 }, theme: "light", junk: true });
    const back = await readConfig(file);
    assert.equal(back.serverUrl, "http://geekom:8790");
    assert.equal(back.window.width, 1000);
    assert.equal(back.window.height, 800); // 200 < 300 -> default kept
    assert.equal(back.window.x, 10);
    assert.equal(back.window.maximized, true);
    assert.equal(back.theme, "light");
    assert.equal("junk" in back, false);
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.serverUrl, "http://geekom:8790");
    // corrupt file -> defaults
    await writeConfig(file, {}); // valid
    assert.equal(mergeConfig("nonsense").serverUrl, DEFAULT_SERVER_URL);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serverCommand builds the uv/uvicorn command for the repo", () => {
  const c = serverCommand("C:\\rex\\tickerscope", 8790);
  assert.match(c.cmd, /^uv(\.exe)?$/);
  assert.deepEqual(c.args.slice(0, 3), ["run", "uvicorn", "tickerscope.main:app"]);
  assert.ok(c.args.includes("8790"));
  assert.equal(c.cwd, "C:\\rex\\tickerscope");
});
