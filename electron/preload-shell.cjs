// Bridge for the shell's own pages (unreachable / settings / about). Not the web app.
const { contextBridge, ipcRenderer } = require("electron");

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
