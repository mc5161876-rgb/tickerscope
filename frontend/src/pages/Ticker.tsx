// Ticker page (AC-3, AC-5..AC-15, AC-18, AC-19; MAR-50: watchlist toggle, fullscreen, export).
import { ArrowDownRight, ArrowUpRight, Check, ExternalLink, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Banner, ContextStrip, Pills, SectionHead, Segmented, Sk } from "../components/Bits";
import { ExplainerProvider } from "../components/Explainer";
import { MetricTile, MetricTileSkeleton } from "../components/MetricTile";
import { Search } from "../components/Search";
import { useToast } from "../components/Toast";
import { BarSeriesChart } from "../components/charts/BarSeriesChart";
import { ChartCard, ChartEmpty, ChartSkeleton } from "../components/charts/ChartCard";
import { useChartExport } from "../components/charts/ExportFrame";
import { FullscreenChart } from "../components/charts/FullscreenChart";
import { PriceChart } from "../components/charts/PriceChart";
import { SegmentBody, SegmentCard, segmentMeta } from "../components/charts/SegmentCard";
import { api, type Freq, type PriceRange, type SegmentsPayload, type TickerPayload } from "../lib/api";
import { exportFilename, periodLabel, type ChartKey } from "../lib/exportPng";
import { fmtAsOf, fmtChange, fmtInteger, fmtPrice } from "../lib/format";
import { METRIC_GROUPS, metricsInGroup } from "../lib/metrics";
import { pushRecent } from "../lib/recent";
import type { Theme } from "../lib/theme";
import { useResource } from "../lib/useResource";
import { useWatchlist } from "../lib/watchlist";

const CHART_KEYS: ChartKey[] = ["price", "revenue", "ebitda", "segments"];

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
  theme = "dark",
}: {
  onCompany: (c: { ticker: string; name?: string | null } | null) => void;
  theme?: Theme;
}) {
  const { symbol = "" } = useParams();
  const ticker = symbol.toUpperCase();
  const navigate = useNavigate();
  const [range, setRange] = useState<PriceRange>("10y");
  const [freqUi, setFreqUi] = useState<FreqUi>("annually");
  const freq: Freq = freqUi === "quarterly" ? "quarterly" : "annual";
  const [dismissed, setDismissed] = useState<string | null>(null);
  const wl = useWatchlist();
  const toast = useToast();
  const { exportChart, stage: exportStage, exporting } = useChartExport();

  // fullscreen chart is URL state: /t/NVDA?chart=revenue (MAR-50 AC-7)
  const [params, setParams] = useSearchParams();
  const chartParam = params.get("chart");
  const fullscreen: ChartKey | null = CHART_KEYS.includes(chartParam as ChartKey) ? (chartParam as ChartKey) : null;
  const openFullscreen = useCallback(
    (k: ChartKey) => {
      const next = new URLSearchParams(params);
      next.set("chart", k);
      setParams(next);
    },
    [params, setParams],
  );
  const closeFullscreen = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("chart");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const loadTicker = useCallback((s: AbortSignal) => api.ticker(ticker, s), [ticker]);
  const loadPrices = useCallback((s: AbortSignal) => api.prices(ticker, range, s), [ticker, range]);
  const loadFin = useCallback((s: AbortSignal) => api.financials(ticker, freq, s), [ticker, freq]);
  const loadSeg = useCallback((s: AbortSignal) => api.segments(ticker, freq, s), [ticker, freq]);

  const t = useResource<TickerPayload>(ticker ? `t:${ticker}` : null, loadTicker);
  const p = useResource(ticker ? `p:${ticker}:${range}` : null, loadPrices);
  const f = useResource(ticker ? `f:${ticker}:${freq}` : null, loadFin);
  // segments are independent of /api/ticker (AC-9): the snapshot never waits on SEC reads
  const sg = useResource<SegmentsPayload>(ticker ? `s:${ticker}:${freq}` : null, loadSeg);

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
  const companyName = t.data?.profile.name ?? t.data?.profile.short_name ?? null;
  const inList = wl.has(ticker);

  const toggleWatch = async () => {
    if (inList) {
      const before = wl.tickers.slice();
      const ok = await wl.remove(ticker);
      if (ok) toast.push({ message: `${ticker} removed from My Stocks`, action: { label: "Undo", onClick: () => void wl.replace(before) } });
    } else {
      const r = await wl.add(ticker);
      if (r.ok) toast.push({ message: `${ticker} added to My Stocks`, kind: "success", duration: 2500 });
      else toast.push({ message: r.detail ?? `Couldn't add ${ticker}`, kind: "error" });
    }
  };

  // ---- chart renderers shared by card / fullscreen / export (MAR-50 AC-7..AC-10) ----
  const segMeta = useMemo(() => (sg.data && sg.data.status === "ok" ? segmentMeta(sg.data, freq) : null), [sg.data, freq]);
  const chartTitle: Record<ChartKey, string> = {
    price: "Stock Price",
    revenue: "Revenue",
    ebitda: "EBITDA",
    segments: segMeta?.title ?? "Revenue by Segment",
  };
  const chartSubtitle: Record<ChartKey, string | null> = {
    price: "Split-adjusted daily close",
    revenue: (f.data?.sec?.status === "ok" ? "SEC filings + yfinance, " : "yfinance, ") + (freq === "quarterly" ? "by quarter" : "by fiscal year"),
    ebitda:
      f.data?.ebitda_method === "calculated"
        ? "calculated: operating income + D&A"
        : f.data?.ebitda_method === "reported"
          ? freq === "quarterly"
            ? "As reported, by quarter"
            : "As reported, by fiscal year"
          : null,
    segments: segMeta?.subtitle ?? null,
  };
  const hasChart: Record<ChartKey, boolean> = {
    price: !!(p.data && p.data.points.length),
    revenue: !!(f.data && f.data.revenue.length),
    ebitda: !!(f.data && f.data.ebitda.length),
    segments: !!(segMeta && segMeta.drawable),
  };
  const renderChart = (k: ChartKey, opts: { detail?: boolean; hideTooltip?: boolean; withLegend?: boolean } = {}): ReactNode => {
    switch (k) {
      case "price":
        return p.data ? <PriceChart points={p.data.points} range={range} detail={opts.detail} hideTooltip={opts.hideTooltip} /> : null;
      case "revenue":
        return f.data ? <BarSeriesChart points={f.data.revenue} name="Revenue" detail={opts.detail} hideTooltip={opts.hideTooltip} /> : null;
      case "ebitda":
        return f.data ? <BarSeriesChart points={f.data.ebitda} name="EBITDA" detail={opts.detail} hideTooltip={opts.hideTooltip} /> : null;
      case "segments":
        return sg.data && segMeta ? (
          <SegmentBody payload={sg.data} meta={segMeta} detail={opts.detail} hideTooltip={opts.hideTooltip} withLegend={opts.withLegend} />
        ) : null;
    }
  };
  const chartPeriod = (k: ChartKey): string => {
    if (k === "price") return periodLabel("price", { range });
    const pts = k === "revenue" ? f.data?.revenue : k === "ebitda" ? f.data?.ebitda : sg.data?.periods;
    const first = pts?.[0]?.label;
    const last = pts?.[pts.length - 1]?.label;
    return periodLabel(k, { freq, first, last });
  };
  const chartSource = (k: ChartKey): string => {
    if (k === "price") return "Source: yfinance (Yahoo Finance)";
    if (k === "segments") return "Source: SEC EDGAR filings";
    const anySec = (k === "revenue" ? f.data?.revenue : f.data?.ebitda)?.some((x) => x.source === "sec");
    return anySec ? "Source: SEC EDGAR + yfinance" : "Source: yfinance (Yahoo Finance)";
  };
  const saveImage = async (k: ChartKey) => {
    if (!hasChart[k]) return;
    const ok = await exportChart({
      filename: exportFilename(ticker, k),
      title: chartTitle[k],
      ticker,
      company: companyName,
      period: chartPeriod(k),
      source: chartSource(k),
      theme,
      height: k === "segments" ? 600 : 560,
      render: () => renderChart(k, { detail: true, hideTooltip: true, withLegend: k === "segments" }),
    });
    toast.push(ok ? { message: `Saved ${exportFilename(ticker, k)}`, kind: "success", duration: 3000 } : { message: "Couldn't save the image", kind: "error" });
  };
  const chartControls = (k: ChartKey): ReactNode =>
    k === "price" ? (
      <Pills ariaLabel="Price range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
    ) : (
      <Segmented ariaLabel="Financials period" options={FREQ_OPTIONS} value={freqUi} onChange={setFreqUi} />
    );

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
              <button
                type="button"
                className={`wl-toggle${inList ? " on" : ""}`}
                onClick={() => void toggleWatch()}
                aria-pressed={inList}
                data-testid="watch-toggle"
              >
                {inList ? <Check size={14} /> : <Plus size={14} />}
                {inList ? "In My Stocks ✓" : "Add to My Stocks"}
              </button>
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
            subtitle={chartSubtitle.price}
            controls={chartControls("price")}
            footRight={p.data?.sampled ? "thinned for display" : null}
            onExpand={hasChart.price ? () => openFullscreen("price") : undefined}
            onSave={hasChart.price ? () => void saveImage("price") : undefined}
            saving={exporting}
          >
            {p.status === "loading" && !p.data ? (
              <ChartSkeleton />
            ) : hasChart.price ? (
              renderChart("price")
            ) : (
              <ChartEmpty>{p.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>

          <ChartCard
            title="Revenue"
            subtitle={chartSubtitle.revenue}
            onExpand={hasChart.revenue ? () => openFullscreen("revenue") : undefined}
            onSave={hasChart.revenue ? () => void saveImage("revenue") : undefined}
            saving={exporting}
          >
            {f.status === "loading" && !f.data ? (
              <ChartSkeleton />
            ) : hasChart.revenue ? (
              renderChart("revenue")
            ) : (
              <ChartEmpty>{f.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>

          <ChartCard
            title="EBITDA"
            subtitle={chartSubtitle.ebitda}
            onExpand={hasChart.ebitda ? () => openFullscreen("ebitda") : undefined}
            onSave={hasChart.ebitda ? () => void saveImage("ebitda") : undefined}
            saving={exporting}
          >
            {f.status === "loading" && !f.data ? (
              <ChartSkeleton />
            ) : hasChart.ebitda ? (
              renderChart("ebitda")
            ) : (
              <ChartEmpty>{f.status === "error" ? "Data source unavailable" : "Not available from source"}</ChartEmpty>
            )}
          </ChartCard>

          <SegmentCard
            res={sg}
            freq={freq}
            onExpand={() => openFullscreen("segments")}
            onSave={() => void saveImage("segments")}
            saving={exporting}
          />
        </div>
      </section>

      {fullscreen && (
        <FullscreenChart
          title={chartTitle[fullscreen]}
          subtitle={chartSubtitle[fullscreen]}
          ticker={ticker}
          company={companyName}
          controls={chartControls(fullscreen)}
          onClose={closeFullscreen}
          onSave={hasChart[fullscreen] ? () => void saveImage(fullscreen) : undefined}
          saving={exporting}
        >
          {hasChart[fullscreen] ? (
            renderChart(fullscreen, { detail: true, withLegend: fullscreen === "segments" })
          ) : (
            <ChartEmpty>{fullscreen === "segments" && sg.status === "loading" ? "Reading SEC filings…" : "Not available"}</ChartEmpty>
          )}
        </FullscreenChart>
      )}
      {exportStage}

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
