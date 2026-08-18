// Shape of the desktop shell bridge (electron/preload.cjs). Absent in the plain web build.
export interface TickerScopeShellConfig {
  serverUrl: string;
  repoPath: string | null;
  theme: "dark" | "light";
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  __file?: string;
}

export interface TickerScopeShell {
  isElectron: true;
  version(): Promise<string>;
  getConfig(): Promise<TickerScopeShellConfig>;
  setConfig(patch: Partial<Pick<TickerScopeShellConfig, "serverUrl" | "repoPath" | "theme">>): Promise<TickerScopeShellConfig>;
  openExternal(url: string): Promise<void>;
  saveFile(filename: string, dataUrl: string): Promise<string | null>;
  setTheme(theme: "dark" | "light"): Promise<void>;
  openSettings(): Promise<void>;
}

declare global {
  interface Window {
    tickerscope?: TickerScopeShell;
  }
}

export {};
