// Centered command-palette wrapper around <Search mode="modal"> (Design Direction §3).
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "./Search";
import { pushRecent } from "../lib/recent";

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Search a company or ticker">
        <Search
          mode="modal"
          autoFocus
          onEscape={onClose}
          onSelect={(ticker, name) => {
            pushRecent(ticker, name);
            onClose();
            navigate(`/t/${ticker}`);
          }}
        />
      </div>
    </div>
  );
}

/** Global "/" and Ctrl/Cmd+K shortcuts. */
export function useSearchShortcuts(openModal: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openModal();
        return;
      }
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openModal]);
}
