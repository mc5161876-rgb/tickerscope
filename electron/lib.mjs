// Pure, testable pieces of the desktop shell (no `electron` import): config file, URL rules,
// health check + wait, and the startup decision (open / spawn / unreachable). MAR-51.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:8790";
export const DEFAULT_PORT = 8790;

export const DEFAULT_CONFIG = Object.freeze({
  serverUrl: DEFAULT_SERVER_URL,
  /** repo checkout used to spawn the local server in local mode (uv run uvicorn …) */
  repoPath: null,
  window: { width: 1280, height: 800, x: undefined, y: undefined, maximized: false },
  theme: "dark",
});

/** Normalise a user-typed server address to an origin (adds http://, strips trailing slash). */
export function normalizeServerUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) return DEFAULT_SERVER_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) throw new Error("Server address must be http(s)");
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Server address must be http(s)");
  return u.origin;
}

/** Local mode = loopback host (the shell may spawn the server). */
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]" || h === "0.0.0.0";
  } catch {
    return false;
  }
}

export function portOf(url) {
  try {
    const u = new URL(url);
    return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Startup decision (AC-3 / AC-4 / AC-5):
 *  healthy            -> "open"        (never spawn a second server)
 *  unhealthy + local  -> "spawn"       (we start it, we own it, we stop it on quit)
 *  unhealthy + remote -> "unreachable" (never spawn anything; show Can't reach + Retry/Settings)
 */
export function decideStartup({ healthy, serverUrl }) {
  if (healthy) return "open";
  return isLocalUrl(serverUrl) ? "spawn" : "unreachable";
}

/** GET {url}/api/health with a timeout; true only on HTTP 200 + status:"ok". */
export async function healthCheck(serverUrl, { fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverUrl.replace(/\/$/, "")}/api/health`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!body && body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Poll healthCheck until it passes or `timeoutMs` elapses. Returns true/false. */
export async function waitForHealth(serverUrl, { timeoutMs = 20_000, intervalMs = 500, fetchImpl, onTick, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const start = now();
  let n = 0;
  while (now() - start < timeoutMs) {
    if (await healthCheck(serverUrl, { fetchImpl, timeoutMs: Math.min(2000, intervalMs * 3) })) return true;
    n += 1;
    onTick?.(n, now() - start);
    await sleep(intervalMs);
  }
  return false;
}

// ---- config file (%APPDATA%/TickerScope/config.json) ------------------------------------
export async function readConfig(file) {
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return mergeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG, window: { ...DEFAULT_CONFIG.window } };
  }
}

export function mergeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, window: { ...DEFAULT_CONFIG.window } };
  if (raw && typeof raw === "object") {
    if (typeof raw.serverUrl === "string") {
      try {
        cfg.serverUrl = normalizeServerUrl(raw.serverUrl);
      } catch {
        /* keep default */
      }
    }
    if (typeof raw.repoPath === "string" && raw.repoPath.trim()) cfg.repoPath = raw.repoPath.trim();
    if (raw.theme === "light" || raw.theme === "dark") cfg.theme = raw.theme;
    if (raw.window && typeof raw.window === "object") {
      const w = raw.window;
      if (Number.isFinite(w.width) && w.width >= 400) cfg.window.width = Math.round(w.width);
      if (Number.isFinite(w.height) && w.height >= 300) cfg.window.height = Math.round(w.height);
      if (Number.isFinite(w.x)) cfg.window.x = Math.round(w.x);
      if (Number.isFinite(w.y)) cfg.window.y = Math.round(w.y);
      cfg.window.maximized = !!w.maximized;
    }
  }
  return cfg;
}

export async function writeConfig(file, cfg) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(mergeConfig(cfg), null, 2), "utf8");
  await rename(tmp, file);
}

/** Command line to start the local server from a repo checkout (uv-managed venv). */
export function serverCommand(repoPath, port = DEFAULT_PORT) {
  return {
    cmd: process.platform === "win32" ? "uv.exe" : "uv",
    args: ["run", "uvicorn", "tickerscope.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", String(port)],
    cwd: repoPath,
  };
}
