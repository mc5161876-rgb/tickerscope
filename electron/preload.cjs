// Renderer bridge (MAR-51). Everything the web app may ask the shell for. Context-isolated.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tickerscope", {
  isElectron: true,
  version: () => ipcRenderer.invoke("app:version"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  /** partial config, e.g. { serverUrl } — the shell persists it and reloads if the URL changed */
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  /** save a data: URL through a native Save dialog defaulting to Downloads/{filename} */
  saveFile: (filename, dataUrl) => ipcRenderer.invoke("app:save-file", { filename, dataUrl }),
  /** keep the native title bar in step with the app theme */
  setTheme: (theme) => ipcRenderer.invoke("app:set-theme", theme),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
});

// The shell's own pages (splash / unreachable / about / settings) can be shown in the main window
// too (e.g. "Can't reach {url}"), so expose their bridge here as well.
contextBridge.exposeInMainWorld("tickerscopeShell", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  about: () => ipcRenderer.invoke("app:about"),
  retry: () => ipcRenderer.invoke("app:retry"),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  close: () => ipcRenderer.invoke("app:close-aux"),
  quit: () => ipcRenderer.invoke("app:quit"),
});
