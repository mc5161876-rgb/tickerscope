// Ticker page (AC-3, AC-5..AC-15, AC-18, AC-19).
import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Banner, ContextStrip, Pills, SectionHead, Segmented, Sk } from "../components/Bits";
import { ExplainerProvider } from "../components/Explainer";
import { MetricTile, MetricTileSkeleton } from "../components/MetricTile";
import { Search } from "../components/Search";
import { BarSeriesChart } from "../components/charts/BarSeriesChart";
import { ChartCard, ChartEmpty, ChartSkeleton } from "../components/charts/ChartCard";
import { PriceChart } from "../components/charts/PriceChart";
import { api, type Freq, type PriceRange, type TickerPayload } from "../lib/api";
import { fmtAsOf, fmtChange, fmtInteger, fmtPrice } from "../lib/format";
import { METRIC_GROUPS, metricsInGroup } from "../lib/metrics";
import { pushRecent } from "../lib/recent";
import { useResource } from "../lib/useResource";

const RANGE_OPTIONS: { value: PriceRange; label: string }[] = [
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y" },
  { value: "10y", label: "10Y" },
  { value: "max", label: "Max" },
];
type FreqUi = "quarterly" | "annually";
const FREQ_OPTIONS: { value: FreqUi; label: string }[] = [
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

export function TickerPage({
  onCompany,
}: {
  onCompany: (c: { ticker: string; name?: string | null } | null) => void;
}) {
  const { symbol = "" } = useParams();
  const ticker = symbol.toUpperCase();
  const navigate = useNavigate();
  const [range, setRange] = useState<PriceRange>("10y");
  const [freqUi, setFreqUi] = useState<FreqUi>("annually");
  const freq: Freq = freqUi === "quarterly" ? "quarterly" : "annual";
  const [dismissed, setDismissed] = useState<string | null>(null);

  const loadTicker = useCallback((s: AbortSignal) => api.ticker(ticker, s), [ticker]);
  const loadPrices = useCallback((s: AbortSignal) => api.prices(ticker, range, s), [ticker, range]);
  const loadFin = useCallback((s: AbortSignal) => api.financials(ticker, freq, s), [ticker, freq]);

  const t = useResource<TickerPayload>(ticker ? `t:${ticker}` : null, loadTicker);
  const p = useResource(ticker ? `p:${ticker}:${range}` : null, loadPrices);
  const f = useResource(ticker ? `f:${ticker}:${freq}` : null, loadFin);

  // header company selector + recents
  useEffect(() => {
    if (t.status === "ok" && t.data) {
      const name = t.data.profile.name ?? t.data.profile.short_name ?? null;
      onCompany({ ticker, name });
      pushRecent(ticker, name ?? undefined);
    } else if (t.status === "notfound") {
      onCompany(null);
    } else if (t.status === "loading" && !t.data) {
      onCompany({ ticker, name: null });
    }
  }, [t.status, t.data, ticker, onCompany]);
  useEffect(() => () => onCompany(null), [onCompany]);
  useEffect(() => setDismissed(null), [ticker]);

  const anyUpstreamError = t.status === "error" || p.status === "error" || f.status === "error";
  const bannerKey = `${ticker}:${anyUpstreamError}`;
  const showBanner = anyUpstreamError && dismissed !== bannerKey;
  const retryAll = () => {
    t.reload();
    p.reload();
    f.reload();
  };

  const price = t.data?.quote.price ?? null;
  const change = t.data?.quote.change ?? null;
  const changePct = t.data?.quote.change_percent ?? null;
  const dir = change === null ? 0 : change > 0 ? 1 : change < 0 ? -1 : 0;
  const now = useMemo(() => new Date(), [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  if (t.status === "notfound") {
    return (
      <div className="notfound">
        <h1>No company found for {ticker}</h1>
        <p>Check the ticker, or search by company name.</p>
        <div style={{ width: "100%" }}>
          <Search
            mode="inline"
            autoFocus
            showRecentWhenEmpty={false}
            onSelect={(tk, name) => {
              pushRecent(tk, name);
              navigate(`/t/${tk}`);
            }}
          />
        </div>
      </div>
    );
  }

  const loadingHead = t.status === "loading" && !t.data;
  const profile = t.data?.profile;
  const quote = t.data?.quote;
  const metrics = t.data?.metrics ?? {};

  return (
    <ExplainerProvider>
      {showBanner && (
        <Banner
          message={
            t.stale
              ? `Data source unavailable — try again. Showing the last good data${t.staleAsOf ? ` from ${fmtAsOf(t.staleAsOf)}` : ""}.`
              : "Data source unavailable — try again."
          }
          onDismiss={() => setDismissed(bannerKey)}
          onRetry={retryAll}
        />
      )}

      {/* ------------------------------------------------ header (AC-5) */}
      <header className="ticker-head">
        <div className="ticker-id">
          {loadingHead ? (
            <>
              <h1>
                <Sk w={260} h={26} />
              </h1>
              <div className="sub">
                <Sk w={320} h={14} />
              </div>
            </>
          ) : (
            <>
              <h1>{profile?.name ?? profile?.short_name ?? ticker}</h1>
              <div className="sub">
                <b>{ticker}</b>
                {profile?.exchange && (
                  <>
                    <span className="sep" />
                    <span>{profile.exchange}</span>
                  </>
                )}
                {(profile?.sector || profile?.industry) && (
                  <>
                    <span className="sep" />
                    <span>{[profile?.sector, profile?.industry].filter(Boolean).join(" · ")}</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="ticker-price">
          {loadingHead ? (
            <>
              <div className="hero-price">
                <Sk w={150} h={40} />
              </div>
              <div className="hero-change">
                <Sk w={140} h={16} />
              </div>
              <div className="as-of">
                <Sk w={180} h={12} />
              </div>
            </>
          ) : (
            <>
              <div className="hero-price num" aria-label={`Price ${fmtPrice(price)}`}>
                {price === null ? (
                  "—"
                ) : (
                  <>
                    {fmtPrice(price).split(".")[0]}
                    <small>.{fmtPrice(price).split(".")[1] ?? "00"}</small>
                  </>
                )}
              </div>
              <div className={`hero-change num ${dir > 0 ? "pos" : dir < 0 ? "neg" : "muted"}`}>
                {dir > 0 ? <ArrowUpRight size={16} /> : dir < 0 ? <ArrowDownRight size={16} /> : null}
                {fmtChange(change, changePct)}
              </div>
              <div className="as-of">
                As of {fmtAsOf(t.data?.as_of ?? quote?.market_time)} · delayed
                {t.stale ? " · cached" : ""}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------------ snapshot (AC-6..10) */}
      <section className="section" aria-label="Snapshot">
        <SectionHead title="Snapshot" />
        {METRIC_GROUPS.map((g) => (
          <div className="group" key={g.id}>
            <h3 className="caps group-label">{g.label}</h3>
            <div className="tiles">
              {metricsInGroup(g.id).map((m) =>
                loadingHead ? (
                  <MetricTileSkeleton key={m.id} label={m.label} />
                ) : (
                  <MetricTile key={m.id} metric={m} value={metrics[m.id]} ticker={ticker} price={price} now={now} />
                ),
              )}
            </div>
          </div>
        ))}

        <div className="group">
          <h3 className="caps group-label">About</h3>
          <About
            loading={loadingHead}
            description={profile?.description ?? null}
            employees={profile?.employees ?? null}
            hq={[profile?.city, profile?.state, profile?.country].filter(Boolean).join(", ") || null}
            website={profile?.website ?? null}
          />
        </div>
      </section>

      {/* ------------------------------------------------ insights (AC-11..15) */}
      <section className="section" aria-label="Insights">
        <SectionHead
          title="Insights"
          right={
            <Segmented ariaLabel="Financials period" options={FREQ_OPTIONS} value={freqUi} onChange={setFreqUi} />
          }
        />
        <div className="chart-grid">
          <ChartCard
            title="Stock Price"
            subtitle="Split-adjusted daily close"
            controls={<Pills ariaLabel="Price range" options={RANGE_OPTIONS} value={range} onChange={setRange} />}
            footRight={p.data?.sampled ? "thinned for display" : null}
          >
            {p.status === "loading" && !p.data ? (
              <ChartSkeleton />
            ) : p.data && p.data.points.length ? (
              <PriceChart points={p.data.points} range={range} />
            ) : (
              <ChartEmpty>{p.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>

          <ChartCard
            title="Revenue"
            subtitle={freq === "quarterly" ? "Total revenue, by quarter" : "Total revenue, by fiscal year"}
          >
            {f.status === "loading" && !f.data ? (
              <ChartSkeleton />
            ) : f.data && f.data.revenue.length ? (
              <BarSeriesChart points={f.data.revenue} name="Revenue" />
            ) : (
              <ChartEmpty>{f.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>

          <ChartCard
            title="EBITDA"
            subtitle={
              f.data?.ebitda_method === "calculated"
                ? "calculated: operating income + D&A"
                : f.data?.ebitda_method === "reported"
                  ? freq === "quarterly"
                    ? "As reported, by quarter"
                    : "As reported, by fiscal year"
                  : null
            }
          >
            {f.status === "loading" && !f.data ? (
              <ChartSkeleton />
            ) : f.data && f.data.ebitda.length ? (
              <BarSeriesChart points={f.data.ebitda} name="EBITDA" />
            ) : (
              <ChartEmpty>{f.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>
        </div>
        <p className="footnote">
          Financial history from yfinance covers ~4–5 years; 10-year history and Revenue by Segment arrive with SEC
          data (next build).
        </p>
      </section>

      <ContextStrip
        title="Not investment advice"
        text="Prices and fundamentals come from Yahoo Finance via yfinance and are delayed and unofficial. TickerScope is a personal learning tool."
        action={{ label: "How to read this page", onClick: () => navigate("/settings") }}
      />
    </ExplainerProvider>
  );
}

function About({
  loading,
  description,
  employees,
  hq,
  website,
}: {
  loading: boolean;
  description: string | null;
  employees: number | null;
  hq: string | null;
  website: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [description]);
  if (loading) {
    return (
      <div className="card about" aria-hidden="true">
        <Sk h={14} />
        <Sk h={14} w="92%" />
        <Sk h={14} w="70%" />
      </div>
    );
  }
  const host = website ? website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  return (
    <div className="card about">
      {description ? (
        <>
          <p className={`about-desc${expanded ? "" : " clamped"}`}>{description}</p>
          <button type="button" className="about-more" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "less" : "more"}
          </button>
        </>
      ) : (
        <p className="about-desc muted">No description available.</p>
      )}
      <div className="about-facts">
        <div className="fact">
          <span>Employees</span>
          <b className="num">{fmtInteger(employees)}</b>
        </div>
        <div className="fact">
          <span>Headquarters</span>
          <b>{hq ?? "—"}</b>
        </div>
        <div className="fact">
          <span>Website</span>
          <b>
            {website ? (
              <a href={website} target="_blank" rel="noreferrer">
                {host} <ExternalLink size={12} style={{ verticalAlign: -1 }} />
              </a>
            ) : (
              "—"
            )}
          </b>
        </div>
      </div>
    </div>
  );
}
