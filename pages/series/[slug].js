import fs from "fs";
import path from "path";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { SERIES, SERIES_GROUPS, getSeriesConfig } from "../../lib/series-config";
import { fetchMetronSeriesMeta } from "../../lib/metron-issues";
import SiteNav from "../../components/SiteNav";
import SiteFooter from "../../components/SiteFooter";
import ResultsPanel from "../../components/ResultsPanel";
import { mergeAndRecount, EBAY_PAGE_SIZE } from "../../lib/ebay-search";

const FETCH_SIZE = 50;
const MAX_AUTO_SKIP = 30;

function esc(s) { return String(s || ""); }

function formatAge(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "less than an hour ago";
  if (h === 1) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? "" : "s"} ago`;
}

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Quick unfiltered check: are there any sellers with 2+ distinct issues in this window?
// Used by auto-advance to decide whether to skip a page.
function hasBundles(rows) {
  const perSeller = {};
  for (const r of rows) {
    if (!perSeller[r.seller]) perSeller[r.seller] = new Set();
    perSeller[r.seller].add(r.issue);
  }
  return Object.values(perSeller).some(s => s.size >= 2);
}

export default function SeriesPage({ slug, displayName, subtitle, totalIssues, seoBlurb, seoTitle, groupSlug, prevVolSlug, nextVolSlug }) {
  const [startIdx, setStartIdx]     = useState(0);
  const [batchSize, setBatchSize]   = useState(10);
  const [showSlider, setShowSlider] = useState(false);
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [wave2Loading, setWave2Loading] = useState(false);
  const [error, setError]           = useState(null);
  const [jumpInput, setJumpInput]   = useState("");
  const [scanning, setScanning]     = useState(false);
  const [wrapMsg, setWrapMsg]       = useState(null);
  const [userZip, setUserZip]       = useState(null);

  const abortRef      = useRef(null);
  const autoSkipCount = useRef(0);
  const didWrapRef    = useRef(false);

  useEffect(() => {
    fetch("/api/geolocate")
      .then(r => r.json())
      .then(({ zip }) => setUserZip(zip || null))
      .catch(() => setUserZip(null));
  }, []);

  const fetchStart = Math.floor(startIdx / FETCH_SIZE) * FETCH_SIZE;

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setData(null);
    setWave2Loading(false);

    const zipParam = userZip ? `&zip=${encodeURIComponent(userZip)}` : "";

    fetch(`/api/series/${slug}/results?start=${fetchStart}&count=${FETCH_SIZE}${zipParam}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(async json => {
        if (json.error) throw new Error(json.error);
        setData(json);
        setLoading(false);

        if (!cancelled && json.totals) {
          const wave2Tasks = [];
          for (const [issue, total] of Object.entries(json.totals)) {
            for (let offset = EBAY_PAGE_SIZE; offset < total; offset += EBAY_PAGE_SIZE) {
              wave2Tasks.push({ issue, offset });
            }
          }
          if (wave2Tasks.length > 0) {
            setWave2Loading(true);
            try {
              const res2 = await fetch("/api/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ issueOffsets: wave2Tasks, zip: userZip }),
                signal: controller.signal,
              });
              const data2 = await res2.json();
              if (!cancelled && res2.ok && data2.results?.length) {
                const merged = mergeAndRecount(json.results, data2.results);
                setData(prev => ({ ...prev, results: merged }));
                if (/^metron-\d+$/.test(slug)) {
                  fetch(`/api/series/${slug}/results`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rows: merged, startIdx: fetchStart, count: FETCH_SIZE }),
                  }).catch(() => {});
                }
              }
            } catch {}
            if (!cancelled) setWave2Loading(false);
          }
        }
      })
      .catch(err => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
        setScanning(false);
      });

    return () => { controller.abort(); cancelled = true; };
  }, [fetchStart, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const offsetInBlock  = startIdx - fetchStart;
  const issuesInWindow = data?.issues?.slice(offsetInBlock, offsetInBlock + batchSize) ?? [];
  const issueNamesInWindow = new Set(issuesInWindow.map(i => i.issueName));
  const windowResults  = data?.results?.filter(r => issueNamesInWindow.has(r.issue)) ?? [];

  const displayStart = startIdx + 1;
  const displayEnd   = data
    ? startIdx + issuesInWindow.length
    : Math.min(startIdx + batchSize, totalIssues);
  const hasPrev = startIdx > 0;
  const hasNext = startIdx + batchSize < totalIssues;

  function goNext() {
    if (!hasNext) return;
    autoSkipCount.current = 0;
    didWrapRef.current    = false;
    setWrapMsg(null);
    const next     = startIdx + batchSize;
    const blockEnd = fetchStart + FETCH_SIZE;
    setStartIdx(Math.min(next, blockEnd));
  }

  function goPrev() {
    if (!hasPrev) return;
    autoSkipCount.current = 0;
    didWrapRef.current    = false;
    setScanning(false);
    setWrapMsg(null);
    setStartIdx(Math.max(0, startIdx - batchSize));
  }

  function handleJump(e) {
    e.preventDefault();
    const num = parseInt(jumpInput, 10);
    if (isNaN(num) || num < 1) return;
    autoSkipCount.current = 0;
    didWrapRef.current    = false;
    setScanning(false);
    setWrapMsg(null);
    setStartIdx(Math.max(0, Math.min(num - 1, totalIssues - 1)));
    setJumpInput("");
  }

  // Auto-advance past pages with no bundle opportunities.
  // Uses unfiltered data so the user's filter settings don't cause skipping.
  useEffect(() => {
    if (loading || wave2Loading || !data) return;
    if (data.startIdx !== fetchStart) return;

    if (hasBundles(windowResults)) {
      autoSkipCount.current = 0;
      didWrapRef.current    = false;
      setScanning(false);
      return;
    }
    if (didWrapRef.current) {
      didWrapRef.current = false;
      setScanning(false);
      return;
    }
    if (!hasNext) {
      const wasScanning = autoSkipCount.current > 0;
      autoSkipCount.current = 0;
      setScanning(false);
      if (wasScanning) {
        setWrapMsg("No bundle opportunities found through the full series — try adjusting your max price.");
        didWrapRef.current = true;
        setStartIdx(0);
      }
      return;
    }
    if (autoSkipCount.current >= MAX_AUTO_SKIP) {
      setScanning(false);
      return;
    }
    autoSkipCount.current += 1;
    setScanning(true);
    const next     = startIdx + batchSize;
    const blockEnd = fetchStart + FETCH_SIZE;
    setStartIdx(Math.min(next, blockEnd));
  }, [loading, wave2Loading, data, startIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const metaDescription = `Find the best eBay bundle deals for ${displayName} (${subtitle}). Browse all ${totalIssues} issues and find sellers carrying multiple issues you need — save big on combined shipping.`;

  return (
    <>
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://www.comicbundlefinder.com/series/${slug}`} />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`https://www.comicbundlefinder.com/series/${slug}`} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebPage",
              "name": seoTitle,
              "description": metaDescription,
              "url": `https://www.comicbundlefinder.com/series/${slug}`,
              "isPartOf": { "@type": "WebSite", "name": "Comic Bundle Finder", "url": "https://www.comicbundlefinder.com" },
              "about": { "@type": "ComicSeries", "name": displayName, "description": seoBlurb },
            }),
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        .series-sub{color:#555;font-size:1rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
        .updated-badge{display:inline-block;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;padding:0.25rem 0.7rem;font-size:0.72rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-left:0.75rem;vertical-align:middle}
        .vol-nav{display:flex;justify-content:space-between;align-items:center;gap:0.5rem;width:100%}
        .vol-nav-links{display:flex;gap:0.4rem;align-items:center}
        .btn-vol{font-family:'Oswald',sans-serif;font-size:0.72rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.2rem 0.65rem;border:1.5px solid #1a1a1a;white-space:nowrap;text-decoration:none;display:inline-block}
        .btn-vol-active{background:#ffe066;color:#1a1a1a;cursor:pointer}
        .btn-vol-active:hover{background:#ffd700}
        .btn-vol-disabled{background:#e8e0cc;color:#aaa;border-color:#ccc;cursor:default}
        .controls-row{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}
        .range-label{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#1a1a1a;flex:1;min-width:200px}
        .nav-buttons{display:flex;gap:0.5rem;align-items:center}
        .btn-nav{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;padding:0.2rem 1.1rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s;white-space:nowrap}
        .btn-nav:hover:not(:disabled){background:#0044cc}
        .btn-nav:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 #1a1a1a}
        .btn-nav:disabled{background:#888;cursor:not-allowed;transform:none;box-shadow:3px 3px 0 #1a1a1a}
        .jump-form{display:flex;gap:0.4rem;align-items:center}
        .jump-label{font-size:0.78rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap}
        .jump-input{width:62px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:1rem;font-weight:600;padding:0.25rem 0.4rem;color:#1a1a1a;text-align:center}
        .jump-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .btn-jump{background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.28rem 0.75rem;cursor:pointer}
        .btn-jump:hover{background:#ffd700}
        .slider-row{display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap}
        .slider-label{font-size:0.82rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap}
        .btn-toggle{background:none;border:none;color:#003399;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;text-decoration:underline;padding:0}
        .batch-slider{flex:1;min-width:140px;max-width:260px;accent-color:#cc1f00}
        label{display:block;font-weight:600;font-size:1rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        {/* Breadcrumb with volume navigation */}
        <div className="panel-slim">
          <div className="vol-nav">
            <div>
              {groupSlug ? (
                <Link href={`/series-guide/${groupSlug}`} className="breadcrumb-link">
                  &larr; {displayName}
                </Link>
              ) : (
                <Link href="/collection-guides" className="breadcrumb-link">
                  &larr; Collection Guides
                </Link>
              )}
            </div>
            {groupSlug && (
              <div className="vol-nav-links">
                {prevVolSlug ? (
                  <Link href={`/series/${prevVolSlug}`} className="btn-vol btn-vol-active">&larr; Prev Vol</Link>
                ) : (
                  <span className="btn-vol btn-vol-disabled">&larr; Prev Vol</span>
                )}
                {nextVolSlug ? (
                  <Link href={`/series/${nextVolSlug}`} className="btn-vol btn-vol-active">Next Vol &rarr;</Link>
                ) : (
                  <span className="btn-vol btn-vol-disabled">Next Vol &rarr;</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Series header */}
        <div className="panel-accent">
          <div className="panel-accent-stripe" />
          <div className="panel-accent-body">
            <h2 style={{ fontFamily: "'Bangers', cursive", fontSize: "clamp(1.75rem,5vw,2.8rem)", letterSpacing: "3px", color: "#1a1a1a", lineHeight: 1, margin: 0 }}>{displayName}</h2>
            <div className="series-sub">{subtitle} &middot; {totalIssues} issues &middot; eBay Bundle Deals</div>
          </div>
        </div>

        <div className="panel">
          <p style={{ fontSize: "1rem", fontWeight: 400, lineHeight: 1.8, color: "#333" }}>
            Find the best eBay bundle deals for <strong>{displayName} &mdash; {subtitle}</strong>.{" "}
            {seoBlurb} This page finds sellers who carry multiple issues you need so you can save
            on combined shipping instead of paying separately for every book.
          </p>
        </div>

        {/* Pagination controls */}
        <div className="panel">
          <div className="controls-row">
            <div className="range-label">
              {loading
                ? "Loading…"
                : `Issues ${displayStart}–${displayEnd} of ${totalIssues}`}
              {data?.cachedAt && !loading && (
                <span className="updated-badge">Updated {formatAge(Date.now() - data.cachedAt)}</span>
              )}
            </div>
            <div className="nav-buttons">
              <button className="btn-nav" onClick={goPrev} disabled={!hasPrev || loading}>&larr; Prev</button>
              <button className="btn-nav" onClick={goNext} disabled={!hasNext || loading}>Next &rarr;</button>
            </div>
            <form className="jump-form" onSubmit={handleJump}>
              <span className="jump-label">Jump to #</span>
              <input
                className="jump-input"
                type="number"
                min="1"
                max={totalIssues}
                value={jumpInput}
                onChange={e => setJumpInput(e.target.value)}
                placeholder="e.g. 50"
              />
              <button className="btn-jump" type="submit">Go</button>
            </form>
          </div>

          <div className="slider-row">
            <span className="slider-label">Issues per page: {batchSize}</span>
            <button className="btn-toggle" onClick={() => setShowSlider(s => !s)}>
              {showSlider ? "hide" : "adjust"}
            </button>
            {showSlider && (
              <input
                className="batch-slider"
                type="range" min="5" max="50" step="5" value={batchSize}
                onChange={e => setBatchSize(parseInt(e.target.value, 10))}
              />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="panel">
          {(loading || scanning) && (
            <div className="loading-state">
              <div><span className="loading-dots">Searching eBay</span></div>
              {scanning && (
                <div className="loading-sub">
                  No bundles in issues {displayStart}&ndash;{displayEnd} &mdash; scanning ahead&hellip;
                </div>
              )}
            </div>
          )}

          {!loading && !scanning && error && (
            <div className="error-state">Error: {error}. Try refreshing the page.</div>
          )}

          {!loading && !scanning && !error && data && (
            <>
              {wrapMsg && <div className="wrap-msg">&#8617; {wrapMsg}</div>}
              <ResultsPanel
                rows={windowResults}
                issues={issuesInWindow.map(i => i.issueName)}
                wave2Loading={wave2Loading}
                defaultMaxPrice="10"
                hint="All prices cached — filters apply to displayed results"
                resetKey={startIdx}
              />
            </>
          )}
        </div>

        {!loading && !scanning && data && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.75rem" }}>
            <button className="btn-nav" onClick={goPrev} disabled={!hasPrev}>&larr; Prev</button>
            <span style={{ fontFamily: "'Bangers', cursive", fontSize: "1.2rem", letterSpacing: "1px", alignSelf: "center" }}>
              {displayStart}&ndash;{displayEnd} / {totalIssues}
            </span>
            <button className="btn-nav" onClick={goNext} disabled={!hasNext}>Next &rarr;</button>
          </div>
        )}

        <SiteFooter />
      </div>
    </>
  );
}

// --- Static generation ---

export async function getStaticPaths() {
  return {
    paths: Object.keys(SERIES).map(slug => ({ params: { slug } })),
    fallback: "blocking",
  };
}

function metronAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`).toString("base64")}`;
}

export async function getStaticProps({ params }) {
  const { slug } = params;

  const metronMatch = /^metron-(\d+)$/.exec(slug);
  if (metronMatch) {
    const metronId = parseInt(metronMatch[1], 10);
    const meta = await fetchMetronSeriesMeta(metronId);
    if (!meta) return { notFound: true };

    const seriesName = meta.name || meta.series || "";
    const baseName = seriesName.replace(/\s*\(\d{4,}\)\s*$/, "").trim();
    const yearMatch = /\((\d{4})\)\s*$/.exec(seriesName.trim());
    const yearBegan = yearMatch ? parseInt(yearMatch[1]) : null;
    const yearEnd = meta.year_end || null;
    const vol = meta.volume || null;

    const yearRange = yearBegan
      ? yearEnd && yearEnd !== yearBegan ? `${yearBegan}–${yearEnd}` : String(yearBegan)
      : "";
    const subtitle = vol ? `Vol. ${vol}${yearRange ? ` · ${yearRange}` : ""}` : yearRange;
    const displayName = baseName;
    const groupSlug = nameToSlug(baseName);
    const totalIssues = meta.issue_count || 0;
    const seoTitle = `${displayName} ${subtitle} — eBay Bundle Deals | Comic Bundle Finder`;
    const seoBlurb = `Browse all ${totalIssues} issues and find sellers carrying multiple books you need.`;

    let prevVolSlug = null, nextVolSlug = null;
    try {
      const sibRes = await fetch(
        `https://metron.cloud/api/series/?name=${encodeURIComponent(baseName)}&page_size=100`,
        { headers: { Authorization: metronAuthHeader() } }
      );
      if (sibRes.ok) {
        const sibData = await sibRes.json();
        const siblings = (sibData.results || [])
          .filter(s => (s.name || s.series || "").replace(/\s*\(\d{4,}\)\s*$/, "").trim().toLowerCase() === baseName.toLowerCase())
          .sort((a, b) => {
            const yA = parseInt(/\((\d{4})\)/.exec(a.name || a.series || "")?.[1] || "9999");
            const yB = parseInt(/\((\d{4})\)/.exec(b.name || b.series || "")?.[1] || "9999");
            return yA - yB;
          });
        const currentIdx = siblings.findIndex(s => s.id === metronId);
        if (currentIdx > 0) prevVolSlug = `metron-${siblings[currentIdx - 1].id}`;
        if (currentIdx !== -1 && currentIdx < siblings.length - 1) nextVolSlug = `metron-${siblings[currentIdx + 1].id}`;
      }
    } catch {}

    return {
      props: { slug, displayName, subtitle, totalIssues, seoBlurb, seoTitle, groupSlug, prevVolSlug, nextVolSlug },
      revalidate: 86400,
    };
  }

  const config = getSeriesConfig(slug);
  if (!config) return { notFound: true };

  const allIssues = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", config.dataFile), "utf-8")
  );
  const groupSlug = nameToSlug(config.displayName);

  let prevVolSlug = null, nextVolSlug = null;
  for (const group of Object.values(SERIES_GROUPS)) {
    const idx = group.slugs.indexOf(slug);
    if (idx !== -1) {
      prevVolSlug = group.slugs[idx - 1] || null;
      nextVolSlug = group.slugs[idx + 1] || null;
      break;
    }
  }

  return {
    props: {
      slug,
      displayName: config.displayName,
      subtitle: config.subtitle,
      totalIssues: allIssues.length,
      seoBlurb: config.seoBlurb,
      seoTitle: config.seoTitle,
      groupSlug,
      prevVolSlug,
      nextVolSlug,
    },
  };
}
