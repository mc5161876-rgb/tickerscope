import { useCallback, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { useTheme } from "./lib/theme";
import { Home } from "./pages/Home";
import { MyStocks } from "./pages/MyStocks";
import { Settings } from "./pages/Placeholders";
import { TickerPage } from "./pages/Ticker";

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [company, setCompany] = useState<{ ticker: string; name?: string | null } | null>(null);
  const onCompany = useCallback((c: { ticker: string; name?: string | null } | null) => setCompany(c), []);

  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell theme={theme} onToggleTheme={toggleTheme} currentCompany={company}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/t/:symbol" element={<TickerPage onCompany={onCompany} theme={theme} />} />
            <Route path="/my-stocks" element={<MyStocks />} />
            <Route path="/settings" element={<Settings theme={theme} onToggleTheme={toggleTheme} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </ToastProvider>
    </BrowserRouter>
  );
}
