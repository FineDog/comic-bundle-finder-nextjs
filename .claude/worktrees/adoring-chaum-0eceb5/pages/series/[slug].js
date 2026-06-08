import fs from "fs";
import path from "path";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { SERIES, getSeriesConfig } from "../../lib/series-config";

const MAX_AUTO_SKIP = 30; // stop auto-advancing after this many consecutive empty batches

function esc(s) { return String(s || ""); }

function formatAge(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "less than an hour ago";
  if (h === 1) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? "" : "s"} ago`;
}

// Recalculate bundle counts from filtered rows (price filter is client-side).
function groupResults(rows, maxPrice) {
  const filtered = rows.filter((r) => parseFloat(r.price) <= maxPrice);
  const s = {};
  for (const r of filtered) {
    if (!s[r.seller]) s[r.seller] = { listings: [] };
    s[r.seller].listings.push(r);
  }
  for (const name of Object.keys(s)) {
    const distinctIssues = new Set(s[name].listings.map((l) => l.issue)).size;
    s[name].bundle_count = distinctIssues;
    if (distinctIssues < 2) delete s[name];
  }
  return s;
}

export default function SeriesPage({ slug, displayName, subtitle, totalIssues, seoBlurb, seoTitle }) {
  const [startIdx, setStartIdx] = useState(0);
  const [batchSize, setBatchSize] = useState(10);
  const [maxPrice, setMaxPrice] = useState("10");
  const [showSlider, setShowSlider] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jumpInput, setJumpInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [wrapMsg, setWrapMsg] = useState(null);
  const abortRef = useRef(null);
  const autoSkipCount = useRef(0);
  const didWrapRef = useRef(false);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(`/api/series/${slug}/results?start=${startIdx}&count=${batchSize}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
        setScanning(false);
      });

    return () => controller.abort();
  }, [startIdx, batchSize, slug]);

  // Auto-advance past empty ranges when navigating forward.
  const maxPriceNum = parseFloat(maxPrice) || 10;
  const sellers = data ? groupResults(data.results, maxPriceNum) : {};
  const sellerCount = Object.keys(sellers).length;
  const hasNext = startIdx + batchSize < totalIssues;

  useEffect(() => {
    if (loading || !data) return;
    if (sellerCount > 0) {
      autoSkipCount.current = 0;
      didWrapRef.current = false;
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
        setWrapMsg(`No bundles found at $${maxPriceNum.toFixed(2)} through the full series — try raising your max price.`);
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
    setStartIdx((prev) => prev + batchSize);
  }, [loading, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSellers = data ? new Set(data.results.map((r) => r.seller)).size : 0;
  const displayStart = startIdx + 1;
  const displayEnd = data ? startIdx + data.issueCount : startIdx + batchSize;
  const hasPrev = startIdx > 0;

  // Sort sellers by bundle_count descending so the price filter can't reorder them.
  const sortedSellers = Object.entries(sellers).sort(
    (a, b) => b[1].bundle_count - a[1].bundle_count || a[0].localeCompare(b[0])
  );

  function goNext() {
    autoSkipCount.current = 0;
    didWrapRef.current = false;
    setWrapMsg(null);
    const next = startIdx + batchSize;
    if (next < totalIssues) setStartIdx(next);
  }
  function goPrev() {
    autoSkipCount.current = 0;
    didWrapRef.current = false;
    setScanning(false);
    setWrapMsg(null);
    setStartIdx(Math.max(0, startIdx - batchSize));
  }
  function handleJump(e) {
    e.preventDefault();
    const num = parseInt(jumpInput, 10);
    if (isNaN(num) || num < 1) return;
    autoSkipCount.current = 0;
    didWrapRef.current = false;
    setScanning(false);
    setWrapMsg(null);
    setStartIdx(Math.max(0, Math.min(num - 1, totalIssues - 1)));
    setJumpInput("");
  }

  const metaDescription = `Find the best eBay bundle deals for ${displayName} (${subtitle}). Browse all ${totalIssues} issues and find sellers carrying multiple issues you need — save big on combined shipping. Results updated daily.`;

  return (
    <>
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://www.comicbundlefinder.com/series/${slug}`} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`https://www.comicbundlefinder.com/series/${slug}`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}
        .container{max-width:960px;margin:0 auto}
        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .panel-nav{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem}
        .title-panel{background:#cc1f00;text-align:center;padding:1.25rem 1.75rem 1rem}
        .title-panel h1{font-family:'Bangers',cursive;font-size:clamp(2rem,7vw,4rem);color:#fffdf4;letter-spacing:4px;text-shadow:4px 4px 0 #1a1a1a;line-height:1}
        .series-sub{color:#ffe066;font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;margin-top:0.4rem;font-weight:400}
        .back-link{font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#003399;text-decoration:none}
        .back-link:hover{text-decoration:underline}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}
        .updated-badge{display:inline-block;background:#003399;color:#fffdf4;border:2px solid #1a1a1a;padding:0.25rem 0.7rem;font-size:0.72rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-left:0.75rem;vertical-align:middle}
        .controls-row{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}
        .range-label{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#1a1a1a;flex:1;min-width:200px}
        .nav-buttons{display:flex;gap:0.5rem;align-items:center}
        .btn-nav{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Bangers',cursive;font-size:1.15rem;letter-spacing:2px;padding:0.2rem 1.1rem 0.3rem;cursor:pointer;transition:transform 0.08s,box-shadow 0.08s;white-space:nowrap}
        .btn-nav:hover:not(:disabled){background:#0044cc}
        .btn-nav:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 #1a1a1a}
        .btn-nav:disabled{background:#888;cursor:not-allowed;transform:none;box-shadow:3px 3px 0 #1a1a1a}
        .jump-form{display:flex;gap:0.4rem;align-items:center}
        .jump-label{font-size:0.78rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap}
        .jump-input{width:62px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.9rem;font-weight:600;padding:0.25rem 0.4rem;color:#1a1a1a;text-align:center}
        .jump-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .btn-jump{background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:2px 2px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.28rem 0.75rem;cursor:pointer}
        .btn-jump:hover{background:#ffd700}
        .slider-row{display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap}
        .slider-label{font-size:0.82rem;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap}
        .btn-toggle{background:none;border:none;color:#003399;font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;text-decoration:underline;padding:0}
        .batch-slider{flex:1;min-width:140px;max-width:260px;accent-color:#cc1f00}
        .price-row{display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap}
        label{display:block;font-weight:600;font-size:0.9rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem}
        .price-row label{margin:0;font-size:0.82rem;white-space:nowrap}
        .price-input{width:90px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;font-weight:600;padding:0.3rem 0.5rem;color:#1a1a1a;text-align:center}
        .price-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}
        .hint{font-size:0.78rem;color:#666;font-weight:400}
        .loading-state{text-align:center;padding:3rem 1rem;color:#003399;font-family:'Bangers',cursive;font-size:1.8rem;letter-spacing:3px}
        .loading-sub{font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#666;margin-top:0.75rem}
        .loading-dots::after{content:'…';animation:dots 1.2s steps(3,end) infinite}
        @keyframes dots{0%,100%{content:'.'}33%{content:'..'}66%{content:'...'}}
        .error-state{text-align:center;padding:2rem;color:#cc1f00;font-weight:600}
        .no-results{text-align:center;padding:2rem;color:#666;font-size:0.95rem;font-weight:400}
        .wrap-msg{background:#ffe066;border:2px solid #1a1a1a;padding:0.6rem 1rem;font-size:0.85rem;font-weight:600;letter-spacing:0.5px;margin-bottom:1.25rem}
        .stats-row{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
        .stat-box{flex:1;min-width:110px;background:#ffe066;border:2px solid #1a1a1a;padding:0.6rem 1rem;text-align:center}
        .stat-number{font-family:'Bangers',cursive;font-size:2.2rem;color:#cc1f00;line-height:1}
        .stat-label{font-size:0.68rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#1a1a1a;margin-top:2px}
        .results-title{font-family:'Bangers',cursive;font-size:2rem;letter-spacing:2px;color:#cc1f00;margin-bottom:1.25rem}
        .seller-group{margin-bottom:1.75rem}
        .seller-header{background:#003399;color:#fffdf4;padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;border:2px solid #1a1a1a;border-bottom:none}
        .seller-name{font-family:'Bangers',cursive;font-size:1.35rem;letter-spacing:1px}
        .bundle-badge{background:#cc1f00;color:#fffdf4;font-size:0.68rem;font-weight:600;padding:2px 8px;border:1.5px solid #1a1a1a;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
        .subtotal-badge{font-size:0.78rem;font-weight:600;color:#fffdf4;background:#003399;border:1.5px solid #ffe066;padding:2px 8px;letter-spacing:0.5px;white-space:nowrap}
        .listings-table{width:100%;border-collapse:collapse;border:2px solid #1a1a1a;font-size:0.82rem;table-layout:fixed}
        .listings-table th{background:#1a1a1a;color:#fffdf4;padding:0.4rem 0.6rem;text-align:left;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;font-size:0.7rem;white-space:nowrap}
        .listings-table td{padding:0.45rem 0.6rem;border-bottom:1px solid #d4c9a8;vertical-align:top;font-weight:400;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
        .listings-table tr:last-child td{border-bottom:none}
        .listings-table tr:nth-child(even) td{background:#f8f3e3}
        .col-issue{width:22%}.col-title{width:38%}.col-price{width:9%;text-align:right}.col-ship{width:11%;text-align:right}.col-promo{width:11%}.col-link{width:9%;text-align:center}
        .listing-link{color:#cc1f00;font-weight:600;text-decoration:none;white-space:nowrap;font-size:0.8rem}
        .listing-link:hover{text-decoration:underline}
        .promo-pill{display:inline-block;background:#cc1f00;color:#fffdf4;font-size:0.65rem;font-weight:600;padding:1px 5px;letter-spacing:0.5px;text-transform:uppercase;line-height:1.6}
        .disclosure{font-size:0.72rem;color:#888;text-align:center;font-weight:400;margin-top:1.25rem;line-height:1.5;border-top:1px solid #d4c9a8;padding-top:0.75rem}
        .seo-blurb{font-size:0.88rem;font-weight:400;line-height:1.8;color:#333}
        .seo-blurb strong{font-weight:600}
        @media(max-width:600px){.col-title{display:none}.col-issue{width:40%}}
      `}</style>

      <div className="container">
        <div className="panel title-panel">
          <h1>{displayName}</h1>
          <div className="series-sub">{subtitle} &middot; {totalIssues} issues &middot; eBay Bundle Deals</div>
        </div>

        <div className="panel-nav">
          <Link href="/" className="back-link">← Back to Comic Bundle Finder</Link>
        </div>

        <div className="panel">
          <p className="seo-blurb">
            Find the best eBay bundle deals for <strong>{displayName} ({subtitle})</strong> —{" "}
            {seoBlurb} This page finds sellers who carry multiple issues you need so you can save
            on combined shipping instead of paying separately for every book. Results are updated daily.
          </p>
        </div>

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
              <button className="btn-nav" onClick={goPrev} disabled={!hasPrev || loading}>← Prev</button>
              <button className="btn-nav" onClick={goNext} disabled={!hasNext || loading}>Next →</button>
            </div>
            <form className="jump-form" onSubmit={handleJump}>
              <span className="jump-label">Jump to #</span>
              <input
                className="jump-input"
                type="number"
                min="1"
                max={totalIssues}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                placeholder="e.g. 50"
              />
              <button className="btn-jump" type="submit">Go</button>
            </form>
          </div>

          <div className="slider-row">
            <span className="slider-label">Issues per page: {batchSize}</span>
            <button className="btn-toggle" onClick={() => setShowSlider((s) => !s)}>
              {showSlider ? "hide" : "adjust"}
            </button>
            {showSlider && (
              <input
                className="batch-slider"
                type="range" min="1" max="20" value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
              />
            )}
          </div>

          <div className="price-row">
            <label htmlFor="max-price-series" style={{ margin: 0 }}>Max price per issue:</label>
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>$</span>
            <input
              className="price-input"
              type="number"
              id="max-price-series"
              value={maxPrice}
              onChange={(e) => { setMaxPrice(e.target.value); setWrapMsg(null); }}
              min="0.01" max="30" step="0.50"
            />
            <span className="hint">(filters displayed results; all prices cached)</span>
          </div>
        </div>

        <div className="panel">
          {(loading || scanning) && (
            <div className="loading-state">
              <div><span className="loading-dots">Searching eBay</span></div>
              {scanning && (
                <div className="loading-sub">
                  No bundles in issues {displayStart}–{displayEnd} — scanning ahead…
                </div>
              )}
            </div>
          )}

          {!loading && !scanning && error && (
            <div className="error-state">Error: {error}. Try refreshing the page.</div>
          )}

          {!loading && !scanning && !error && data && (
            <>
              {wrapMsg && <div className="wrap-msg">↩ {wrapMsg}</div>}
              <div className="results-title">
                {sellerCount === 0
                  ? "No Bundle Opportunities Found"
                  : "Bundle Deals — Sellers Ranked by Issues Carried"}
              </div>

              {sellerCount === 0 ? (
                <div className="no-results">
                  No single seller carries more than one issue from this range at or under ${maxPriceNum.toFixed(2)}.
                  Try raising your max price or navigating to a different range.
                </div>
              ) : (
                <>
                  <div className="stats-row">
                    <div className="stat-box">
                      <div className="stat-number">{data.issueCount}</div>
                      <div className="stat-label">Issues Searched</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-number">{totalSellers}</div>
                      <div className="stat-label">Total Sellers Found</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-number">{sellerCount}</div>
                      <div className="stat-label">Bundle Opportunities</div>
                    </div>
                  </div>

                  {sortedSellers.map(([name, sellerData]) => {
                    const cpi = {};
                    for (const l of sellerData.listings) {
                      const p = parseFloat(l.price) || 0;
                      if (!(l.issue in cpi) || p < cpi[l.issue]) cpi[l.issue] = p;
                    }
                    const subtotal = Object.values(cpi).reduce((a, b) => a + b, 0);
                    return (
                      <div className="seller-group" key={name}>
                        <div className="seller-header">
                          <span className="seller-name">{esc(name)}</span>
                          <span className="bundle-badge">{sellerData.bundle_count} issues — bundle shipping!</span>
                          <span className="subtotal-badge">from ${subtotal.toFixed(2)} in items</span>
                        </div>
                        <table className="listings-table">
                          <thead>
                            <tr>
                              <th className="col-issue">Issue</th>
                              <th className="col-title">Listing Title</th>
                              <th className="col-price">Price</th>
                              <th className="col-ship">Shipping</th>
                              <th className="col-promo">Promo</th>
                              <th className="col-link">Link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerData.listings.map((l, i) => {
                              const ship =
                                l.shipping === "0.00"
                                  ? "FREE"
                                  : l.shipping === "unknown"
                                  ? "—"
                                  : `$${parseFloat(l.shipping).toFixed(2)}`;
                              return (
                                <tr key={i}>
                                  <td className="col-issue">{esc(l.issue)}</td>
                                  <td className="col-title">{esc(l.title)}</td>
                                  <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                                  <td className="col-ship">{ship}</td>
                                  <td className="col-promo">
                                    {l.promotions ? (
                                      <span className="promo-pill">
                                        {l.promotions.split("|")[0].trim()}
                                      </span>
                                    ) : ""}
                                  </td>
                                  <td className="col-link">
                                    <a
                                      className="listing-link"
                                      href={l.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      View →
                                    </a>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                  <div className="disclosure">
                    Some links on this page may be affiliate links. A small commission may be earned if you purchase through these links, at no extra cost to you.
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {!loading && !scanning && data && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.75rem" }}>
            <button className="btn-nav" onClick={goPrev} disabled={!hasPrev}>← Prev</button>
            <span style={{ fontFamily: "'Bangers', cursive", fontSize: "1.2rem", letterSpacing: "1px", alignSelf: "center" }}>
              {displayStart}–{displayEnd} / {totalIssues}
            </span>
            <button className="btn-nav" onClick={goNext} disabled={!hasNext}>Next →</button>
          </div>
        )}

        <div className="panel" style={{ textAlign: "center", fontSize: "0.8rem", fontWeight: 400, color: "#666", padding: "0.85rem 1.75rem" }}>
          Bugs? Feature requests? Email us at{" "}
          <a href="mailto:hello@comicbundlefinder.com" style={{ color: "#003399", fontWeight: 600 }}>
            hello@comicbundlefinder.com
          </a>
          <div style={{ marginTop: "0.75rem" }}>
            <a
              href="https://ko-fi.com/O4O31ZDFTF"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                background: "#003399", color: "#fffdf4",
                border: "2px solid #1a1a1a", boxShadow: "3px 3px 0 #1a1a1a",
                fontFamily: "'Oswald', sans-serif", fontWeight: 600,
                fontSize: "0.82rem", letterSpacing: "1px", textTransform: "uppercase",
                padding: "0.35rem 1rem", textDecoration: "none",
              }}
            >
              ☕ Support me on Ko-fi
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getStaticPaths() {
  return {
    paths: Object.keys(SERIES).map((slug) => ({ params: { slug } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }) {
  const { slug } = params;
  const config = getSeriesConfig(slug);
  if (!config) return { notFound: true };

  const allIssues = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", config.dataFile), "utf-8")
  );

  return {
    props: {
      slug,
      displayName: config.displayName,
      subtitle: config.subtitle,
      totalIssues: allIssues.length,
      seoBlurb: config.seoBlurb,
      seoTitle: config.seoTitle,
    },
  };
}
