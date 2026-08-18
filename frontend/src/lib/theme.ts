// "Lights: Off / On" theme toggle. Dark is default; choice persists in localStorage.
import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "tickerscope.theme";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function useTheme(): [Theme, () => void, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => (typeof window === "undefined" ? "dark" : readTheme()));
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle, setTheme];
}
