// Small shared pieces: banner, context strip, skeleton block, segmented control, pills.
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import type { ReactNode } from "react";

export function Banner({ message, onDismiss, onRetry }: { message: string; onDismiss: () => void; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      <AlertTriangle size={16} />
      <div className="txt">{message}</div>
      {onRetry && (
        <button type="button" className="act" onClick={onRetry}>
          Retry
        </button>
      )}
      <button type="button" className="act" onClick={onDismiss} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}

export function ContextStrip({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="strip" role="note">
      <Info size={20} />
      <div className="txt">
        <b>{title}</b>
        <span>{text}</span>
      </div>
      {action &&
        (action.href ? (
          <a className="ghost" href={action.href} target="_blank" rel="noreferrer">
            <ArrowRight size={14} /> {action.label}
          </a>
        ) : (
          <button type="button" className="ghost" onClick={action.onClick}>
            <ArrowRight size={14} /> {action.label}
          </button>
        ))}
    </div>
  );
}

export function Sk({ w = "100%", h = 14, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="pills" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {right}
    </div>
  );
}
