// Fullscreen chart modal (MAR-50 AC-7, AC-8): full viewport re-render with the same controls,
// finer detail, Save image, close on Esc / × / click-outside. The URL carries ?chart=… so a
// fullscreen view is linkable (owned by the Ticker page).
import { Download, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Mark } from "../Mark";

export function FullscreenChart({
  title,
  subtitle,
  ticker,
  company,
  controls,
  onClose,
  onSave,
  saving,
  children,
}: {
  title: string;
  subtitle?: string | null;
  ticker: string;
  company: string | null;
  controls?: ReactNode;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fs-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fs" role="dialog" aria-modal="true" aria-label={`${title} — fullscreen`}>
        <div className="fs-head">
          <div className="fs-title">
            <h2>{title}</h2>
            <div className="muted">
              <b>{ticker}</b>
              {company ? ` · ${company}` : ""}
              {subtitle ? ` · ${subtitle}` : ""}
            </div>
          </div>
          <div className="fs-actions">
            {controls}
            {onSave && (
              <button type="button" className="ghost" onClick={onSave} disabled={saving} title="Save image (PNG, 2×)">
                <Download size={14} /> {saving ? "Saving…" : "Save image"}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close fullscreen" title="Close (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="fs-body">{children}</div>
        <div className="fs-foot">
          <span className="watermark">
            <Mark size={14} /> TickerScope
          </span>
        </div>
      </div>
    </div>
  );
}
