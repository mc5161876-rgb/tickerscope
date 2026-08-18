#!/usr/bin/env node
// Dev launcher: FastAPI (uvicorn --reload) on 8790 + Vite on 5190.
//
// Why not `concurrently`? uvicorn's reloader on Windows restarts its worker by sending a
// CTRL_C_EVENT, which every process on the *same console* receives — the `cmd /c` shims that
// concurrently spawns answer "Terminate batch job (Y/N)?" and everything dies on the first
// backend edit. Here the API runs detached (its own hidden console) and Vite is spawned
// directly, so a backend reload never reaches the rest.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const apiHost = process.env.TICKERSCOPE_HOST ?? "127.0.0.1";
const apiPort = process.env.TICKERSCOPE_PORT ?? "8790";
const webPort = process.env.TICKERSCOPE_WEB_PORT ?? "5190";

const c = { cyan: "\x1b[36m", magenta: "\x1b[35m", dim: "\x1b[2m", reset: "\x1b[0m", red: "\x1b[31m" };
const tag = (name, color) => `${color}[${name}]${c.reset} `;

function pipe(child, name, color) {
  const prefix = tag(name, color);
  const forward = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        out.write(prefix + buf.slice(0, i + 1));
        buf = buf.slice(i + 1);
      }
    });
    stream.on("end", () => {
      if (buf) out.write(prefix + buf + "\n");
    });
  };
  if (child.stdout) forward(child.stdout, process.stdout);
  if (child.stderr) forward(child.stderr, process.stderr);
}

// ---- API (uvicorn --reload) — detached so its CTRL_C reload signal stays on its own console
const api = spawn(
  win ? "uv.exe" : "uv",
  [
    "run", "uvicorn", "tickerscope.main:app",
    "--app-dir", "backend",
    "--host", apiHost, "--port", apiPort,
    "--reload", "--reload-dir", "backend", "--reload-dir", "shared",
  ],
  { cwd: root, detached: win, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: process.env },
);
pipe(api, "API", c.cyan);

// ---- Vite — spawned directly (no shell), inherits our console for colors + HMR logs
const viteBin = path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  console.error(`${c.red}frontend/node_modules missing — run npm install first${c.reset}`);
  process.exit(1);
}
const web = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", webPort, "--strictPort"], {
  cwd: path.join(root, "frontend"),
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "1" },
});
pipe(web, "WEB", c.magenta);

console.log(`${c.dim}TickerScope dev: API http://${apiHost}:${apiPort}  ·  Web http://127.0.0.1:${webPort}  (Ctrl+C stops both)${c.reset}`);

let shuttingDown = false;
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (win) {
    // taskkill /T takes the whole tree (uv -> uvicorn reloader -> worker)
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  kill(api);
  kill(web);
  setTimeout(() => process.exit(code), 400);
}
api.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`${tag("API", c.cyan)}exited with code ${code}`);
    shutdown(code ?? 1);
  }
});
web.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`${tag("WEB", c.magenta)}exited with code ${code}`);
    shutdown(code ?? 1);
  }
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(0));
}
