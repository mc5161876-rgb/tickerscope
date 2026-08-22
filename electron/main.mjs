// TickerScope desktop shell (MAR-51). Loads the app from a URL (default http://127.0.0.1:8790):
//  - local mode: health-check; if down, spawn `uv run uvicorn …` from the repo, wait ≤ 20 s behind a
//    splash, and stop that child on quit (never a server we didn't start);
//  - remote mode: never spawn; on failure show "Can't reach {url}" with Retry / Settings.
// Config lives in %APPDATA%/TickerScope/config.json. Follows Toolbelt's shape.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideStartup, healthCheck, isLocalUrl, normalizeServerUrl, portOf, readConfig, serverCommand, waitForHealth, writeConfig } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "TickerScope";
const smokeMode = process.env.TICKERSCOPE_SMOKE === "1";
const SPAWN_TIMEOUT_MS = 20_000;

app.setName(APP_NAME);

let mainWindow = null;
let auxWindow = null; // settings / about
let serverChild = null; // the uvicorn we started (and therefore own)
let serverLog = [];
let config = null;
let configFile = null;
let starting = false;
let currentPageIsShell = false;

const pagePath = (name) => path.join(__dirname, "pages", name);
const iconPath = () => path.join(__dirname, "..", "assets", process.platform === "win32" ? "icon.ico" : "icon-512.png");

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  serverLog.push(line);
  if (serverLog.length > 200) serverLog = serverLog.slice(-200);
  console.log(line);
}

// ------------------------------------------------------------------ config
async function loadConfig() {
  configFile = path.join(app.getPath("userData"), "config.json");
  config = await readConfig(configFile);
  if (!config.repoPath) {
    // dev checkout: this file lives at <repo>/electron/main.mjs; packaged: fall back to the
    // conventional checkout for this machine (C:\rex on Windows, ~/rex on macOS/Linux).
    const devRepo = path.resolve(__dirname, "..");
    const candidates = [
      devRepo,
      ...(process.platform === "win32"
        ? ["C:\\rex\\tickerscope"]
        : [path.join(app.getPath("home"), "rex", "tickerscope")]),
    ];
    const found = candidates.find((c) => existsSync(path.join(c, "pyproject.toml")));
    if (found) config.repoPath = found;
  }
  nativeTheme.themeSource = config.theme === "light" ? "light" : "dark";
}

let serverUrlOverride = null; // TICKERSCOPE_SERVER_URL (dev:app / smoke) — effective, never persisted

async function saveConfig(patch = {}) {
  const persisted = await readConfig(configFile); // what's on disk (an env override is not there)
  const next = { ...config, ...patch, window: { ...config.window, ...(patch.window ?? {}) } };
  if (patch.serverUrl !== undefined) {
    next.serverUrl = normalizeServerUrl(patch.serverUrl);
    serverUrlOverride = null; // an explicit user change wins over the env override
  } else {
    next.serverUrl = persisted.serverUrl;
  }
  if (patch.repoPath !== undefined) next.repoPath = String(patch.repoPath || "").trim() || null;
  await writeConfig(configFile, next);
  config = { ...next, serverUrl: serverUrlOverride ?? next.serverUrl };
  return config;
}

// ------------------------------------------------------------------ local server
/**
 * PATH for the spawned server. A Finder- or Dock-launched .app inherits launchd's minimal PATH,
 * which has neither ~/.local/bin nor Homebrew, so a bare `uv` would not resolve. Prepend the
 * places uv actually installs itself; a shell-launched app already has them and loses nothing.
 */
function spawnPath() {
  const current = process.env.PATH || "";
  if (process.platform === "win32") return current;
  const home = app.getPath("home");
  const extra = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const parts = current.split(path.delimiter).filter(Boolean);
  return [...extra.filter((d) => !parts.includes(d) && existsSync(d)), ...parts].join(path.delimiter);
}

function spawnServer() {
  const repo = config.repoPath;
  if (!repo || !existsSync(path.join(repo, "pyproject.toml"))) {
    throw new Error(`Repo path not found (${repo ?? "unset"}). Set it in Settings, or run the server yourself.`);
  }
  const { cmd, args, cwd } = serverCommand(repo, portOf(config.serverUrl));
  log(`spawning: ${cmd} ${args.join(" ")} (cwd ${cwd})`);
  const child = spawn(cmd, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: spawnPath(), PYTHONUNBUFFERED: "1" },
  });
  child.stdout?.on("data", (d) => log("[api]", String(d).trim()));
  child.stderr?.on("data", (d) => log("[api]", String(d).trim()));
  child.on("exit", (code) => {
    log(`server exited with code ${code}`);
    if (serverChild === child) serverChild = null;
  });
  child.on("error", (err) => log("server spawn error:", err.message));
  serverChild = child;
  spawnedPort = portOf(config.serverUrl);
  return child;
}

let spawnedPort = null; // the port we started a server on (so we can find its listener pid on quit)

/** PIDs listening on a TCP port (Windows: netstat; POSIX: lsof). Synchronous on purpose (used at exit). */
function listenerPids(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) pids.add(Number(m[2]));
      }
      return [...pids];
    }
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function stopServer() {
  const child = serverChild;
  const port = spawnedPort;
  serverChild = null;
  spawnedPort = null;
  if (!child) return; // we never started one -> never touch a server we don't own (AC-4)
  log("stopping the server we started (pid", String(child.pid) + (port ? `, port ${port}` : "") + ")");
  const kill = (pid) => {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  if (child.exitCode === null) kill(child.pid);
  // uv -> uvicorn.exe -> venv python -> python: the launcher chain re-parents on Windows, so also
  // stop whatever is listening on the port we started (it was free before we spawned).
  if (port) for (const pid of listenerPids(port)) kill(pid);
}

// ------------------------------------------------------------------ windows
function createMainWindow() {
  const w = config.window;
  mainWindow = new BrowserWindow({
    width: w.width,
    height: w.height,
    x: w.x,
    y: w.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: config.theme === "light" ? "#ffffff" : "#0b0d10",
    title: APP_NAME,
    icon: iconPath(),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (w.maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const b = maximized ? config.window : mainWindow.getBounds();
    void saveConfig({ window: { ...b, maximized } });
  };
  mainWindow.on("resize", debounce(persistBounds, 400));
  mainWindow.on("move", debounce(persistBounds, 400));
  mainWindow.on("maximize", persistBounds);
  mainWindow.on("unmaximize", persistBounds);

  // external links (EDGAR filings, company websites) open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("file://")) return;
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || currentPageIsShell) return;
    log(`did-fail-load ${code} ${desc} ${url}`);
    void showUnreachable(`The app page failed to load (${desc || code}).`);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === new URL(config.serverUrl).origin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (["http:", "https:"].includes(u.protocol)) void shell.openExternal(u.toString());
  } catch {
    /* ignore malformed */
  }
}

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

async function loadShellPage(name, params = {}) {
  currentPageIsShell = true;
  const q = new URLSearchParams(params).toString();
  await mainWindow.loadFile(pagePath(name), { search: q ? `?${q}` : undefined });
}

async function loadApp() {
  currentPageIsShell = false;
  await mainWindow.loadURL(config.serverUrl + "/");
}

async function showUnreachable(why, extra = "") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await loadShellPage("unreachable.html", { url: config.serverUrl, why, log: extra || serverLog.slice(-3).join(" · ") });
}

/** The startup / retry sequence (AC-3, AC-4, AC-5). */
async function connect() {
  if (starting || !mainWindow) return;
  starting = true;
  try {
    const healthy = await healthCheck(config.serverUrl);
    const decision = decideStartup({ healthy, serverUrl: config.serverUrl });
    log(`health ${healthy ? "ok" : "down"} at ${config.serverUrl} -> ${decision}`);
    if (decision === "open") {
      await loadApp();
      return;
    }
    if (decision === "unreachable") {
      await showUnreachable("This is a remote address, so TickerScope only connects to it and never starts anything here. Make sure the server is running there and reachable on the tailnet.");
      return;
    }
    // spawn
    await loadShellPage("splash.html", { url: config.serverUrl });
    try {
      if (!serverChild) spawnServer();
    } catch (err) {
      await showUnreachable(String(err.message || err));
      return;
    }
    const ok = await waitForHealth(config.serverUrl, {
      timeoutMs: SPAWN_TIMEOUT_MS,
      intervalMs: 500,
      onTick: (n) => {
        if (mainWindow && !mainWindow.isDestroyed() && currentPageIsShell) {
          mainWindow.webContents.executeJavaScript(`window.postMessage({detail: "Waiting for the server… (${Math.round(n / 2)}s)"}, "*")`).catch(() => {});
        }
      },
    });
    if (ok) {
      await loadApp();
    } else {
      await showUnreachable(`The local server did not answer within ${SPAWN_TIMEOUT_MS / 1000} s.`, serverLog.slice(-4).join(" · "));
    }
  } finally {
    starting = false;
  }
}

function openAux(name, size = { width: 560, height: 420 }) {
  if (auxWindow && !auxWindow.isDestroyed()) {
    auxWindow.close();
  }
  auxWindow = new BrowserWindow({
    ...size,
    parent: mainWindow ?? undefined,
    modal: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: name === "about.html" ? `About ${APP_NAME}` : `${APP_NAME} Settings`,
    icon: iconPath(),
    backgroundColor: config.theme === "light" ? "#ffffff" : "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload-shell.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  auxWindow.setMenuBarVisibility(false);
  void auxWindow.loadFile(pagePath(name));
  auxWindow.on("closed", () => {
    auxWindow = null;
  });
  return auxWindow;
}

// ------------------------------------------------------------------ menu (AC-6)
function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => (currentPageIsShell ? void connect() : mainWindow?.webContents.reload()) },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => openAux("settings.html", { width: 600, height: 520 }) },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [{ label: `About ${APP_NAME}`, click: () => openAux("about.html", { width: 560, height: 420 }) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ IPC
function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("config:get", () => ({ ...config, __file: configFile }));
  ipcMain.handle("config:set", async (_e, patch) => {
    const before = config.serverUrl;
    await saveConfig(patch ?? {});
    if (config.serverUrl !== before) {
      log(`server address changed ${before} -> ${config.serverUrl}`);
      // switching away from a local server we started: stop it (we own it); never touch anything else
      if (serverChild && !isLocalUrl(config.serverUrl)) stopServer();
      void connect();
    }
    return { ...config, __file: configFile };
  });
  ipcMain.handle("app:about", () => ({ version: app.getVersion(), serverUrl: config.serverUrl, local: isLocalUrl(config.serverUrl), configFile }));
  ipcMain.handle("app:retry", () => connect());
  ipcMain.handle("app:open-settings", () => {
    openAux("settings.html", { width: 600, height: 520 });
  });
  ipcMain.handle("app:open-external", (_e, url) => openExternal(url));
  ipcMain.handle("app:close-aux", () => auxWindow?.close());
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:set-theme", async (_e, theme) => {
    const t = theme === "light" ? "light" : "dark";
    nativeTheme.themeSource = t;
    await saveConfig({ theme: t });
  });
  ipcMain.handle("app:save-file", async (_e, { filename, dataUrl }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: "Save image",
      defaultPath: path.join(app.getPath("downloads"), String(filename || "tickerscope.png")),
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (res.canceled || !res.filePath) return null;
    const b64 = String(dataUrl).split(",", 2)[1] ?? "";
    await writeFile(res.filePath, Buffer.from(b64, "base64"));
    return res.filePath;
  });
}

// downloads (Save image uses an <a download>): native dialog defaulting to Downloads/{filename} (AC-7)
function wireDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    const name = item.getFilename() || "tickerscope.png";
    item.setSaveDialogOptions({
      title: "Save image",
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    item.once("done", (_e, state) => log(`download ${name}: ${state}`));
  });
}

// ------------------------------------------------------------------ smoke mode (screenshots for review)
async function runSmoke() {
  const outDir = process.env.TICKERSCOPE_SMOKE_DIR || path.join(process.cwd(), "docs", "screenshots");
  const shot = async (win, file) => {
    // the compositor may not have a frame yet right after a navigation: retry a few times
    let lastErr = null;
    for (let i = 0; i < 6; i++) {
      try {
        win.webContents.invalidate?.();
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) {
          await writeFile(path.join(outDir, file), img.toPNG());
          log(`smoke: saved ${file}`);
          return;
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    throw lastErr ?? new Error("empty capture");
  };
  try {
    await new Promise((r) => setTimeout(r, 6000));
    if (mainWindow) await shot(mainWindow, "electron-app-1280x800.png");
    // child windows can't be captured reliably here; render the shell pages in the main window
    for (const [page, file] of [
      ["about.html", "electron-about.png"],
      ["settings.html", "electron-settings.png"],
      ["unreachable.html", "electron-unreachable.png"],
    ]) {
      if (!mainWindow) break;
      const search = page === "unreachable.html" ? `?url=${encodeURIComponent("http://geekom:8790")}&why=${encodeURIComponent("Preview of the remote-mode failure screen.")}` : undefined;
      // shell pages need the shell bridge; swap preload by loading through a fresh aux-less path:
      await mainWindow.loadFile(pagePath(page), search ? { search } : undefined);
      await new Promise((r) => setTimeout(r, 1500));
      await shot(mainWindow, file);
    }
  } catch (err) {
    log("smoke error:", err?.message || String(err));
  } finally {
    setTimeout(() => app.quit(), 500);
  }
}

// ------------------------------------------------------------------ lifecycle
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (smokeMode) app.setPath("userData", path.join(app.getPath("temp"), "tickerscope-smoke-profile"));
  await loadConfig();
  if (process.env.TICKERSCOPE_SERVER_URL) {
    serverUrlOverride = normalizeServerUrl(process.env.TICKERSCOPE_SERVER_URL);
    config.serverUrl = serverUrlOverride;
  }
  registerIpc();
  wireDownloads();
  buildMenu();
  createMainWindow();
  await connect();
  if (smokeMode) void runSmoke();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => stopServer());
process.on("exit", () => stopServer());
