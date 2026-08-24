// Company logo with the letter avatar as its fallback (MAR-54).
//
// `/api/logo/{ticker}` only answers for companies whose profile is already cached, so a
// miss is often temporary: a search row can 404 now and have a logo a moment later, once
// the page or the batched quotes have warmed that profile. So a failure is remembered for
// RETRY_AFTER_MS rather than forever - long enough that a list of unknown tickers does not
// re-request on every keystroke, short enough that the logo turns up on the next visit.
import { useEffect, useState } from "react";
import { avatarText } from "../lib/avatar";

const RETRY_AFTER_MS = 60_000;
const failedAt = new Map<string, number>();

function recentlyFailed(ticker: string): boolean {
  const at = failedAt.get(ticker);
  if (at === undefined) return false;
  if (Date.now() - at < RETRY_AFTER_MS) return true;
  failedAt.delete(ticker);
  return false;
}

export function CompanyLogo({ ticker, name, size }: { ticker: string; name?: string | null; size?: number }) {
  const [failed, setFailed] = useState(() => recentlyFailed(ticker));
  useEffect(() => setFailed(recentlyFailed(ticker)), [ticker]);

  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  return (
    <span className="avatar" style={style} data-logo={failed ? "letters" : "image"}>
      {failed ? (
        avatarText(ticker)
      ) : (
        <img
          src={`/api/logo/${encodeURIComponent(ticker)}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            failedAt.set(ticker, Date.now());
            setFailed(true);
          }}
        />
      )}
      <span className="sr-only">{name ?? ticker}</span>
    </span>
  );
}
