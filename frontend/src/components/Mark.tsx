// Original TickerScope mark: a scope ring with a rising line inside. No third-party assets.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="14" cy="14" r="8.5" stroke="var(--accent)" strokeWidth="2.4" />
      <path d="M20.5 20.5 L27 27" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M9.5 16 L12.5 12.8 L14.6 15 L18.6 10.6"
        stroke="var(--green)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark" style={compact ? { fontSize: 15 } : undefined}>
      Ticker<span>Scope</span>
    </span>
  );
}
