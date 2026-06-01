import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import SiteNav from "../../components/SiteNav";
import { runEbaySearch } from "../../lib/ebay-search";

function esc(s) { return String(s || ""); }

function groupResults(rows, maxPrice) {
  const filtered = rows.filter((r) => parseFloat(r.price) <= maxPrice);
  const sellers = {};
  for (const r of filtered) {
    if (!sellers[r.seller]) sellers[r.seller] = { listings: [] };
    sellers[r.seller].listings.push(r);
  }
  for (const name of Object.keys(sellers)) {
    const distinctIssues = new Set(sellers[name].listings.map((l) => l.issue)).size;
    sellers[name].bundle_count = distinctIssues;
    if (distinctIssues < 2) delete sellers[name];
  }
  return sellers;
}

export default function ArcPage({ slug, arcId, arcName, arcDesc, configError }) {
  // "loading-issues" → "loading-ebay" → "done" | "error"
  const [status, setStatus] = useState("loading-issues");
  const [issues, setIssues] = useState([]);
  const [rows, setRows] = useState([]);
  const [wave2Loading, setWave2Loading] = useState(false);
  const [maxPrice, setMaxPrice] = useState("15");
  const [userZip, setUserZip] = useState(null);
  const didFire = useRef(false);

  // Geolocate on mount for shipping estimates
  useEffect(() => {
    fetch("/api/geolocate")
      .then(r => r.json())
      .then(({ zip }) => setUserZip(zip || null))
      .catch(() => setUserZip(null));
  }, []);

  useEffect(() => {
    if (didFire.current || !arcId) return;
    didFire.current = true;

    // Step 1: fetch issues from the Blob-cached API route (never calls Metron directly)
    fetch(`/api/arc/${arcId}/issues`)
      .then((r) => r.json())
      .then(async (data) => {
        if (data.error) throw new Error(data.error);
        if (data.issues === null) { setStatus("not-cached"); return; }
        const issueList = data.issues || [];
        setIssues(issueList);
        if (!issueList.length) { setStatus("done"); return; }

        // Step 2: two-wave eBay search
        setStatus("loading-ebay");
        await runEbaySearch(issueList, userZip, {
          onWave1(wave1Rows) { setRows(wave1Rows); setStatus("done"); },
          onWave2Start()    { setWave2Loading(true); },
          onWave2(merged)   { setRows(merged); },
          onWave2End()      { setWave2Loading(false); },
        });
      })
      .catch(() => setStatus("error"));
  }, [arcId]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxPriceNum = parseFloat(maxPrice) || 15;
  const sellers = groupResults(rows, maxPriceNum);
  const sortedSellers = Object.entries(sellers).sort(
    (a, b) => b[1].bundle_count - a[1].bundle_count || a[0].localeCompare(b[0])
  );
  const totalSellers = new Set(rows.map((r) => r.seller)).size;

  const metaDesc = `Find eBay bundle deals for the ${arcName} story arc. Sellers ranked by how many issues they carry — save on combined shipping.`;
  const pageUrl = `https://www.comicbundlefinder.com/arc/${slug || ""}`;

  return (
    <>
      <Head>
        <title>{arcName} — Story Arc Bundle Deals — Comic Bundle Finder</title>
        <meta name="description" content={metaDesc} />
        <meta property="og:title" content={`${arcName} — Story Arc Bundle Deals`} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:image" content="https://www.comicbundlefinder.com/preview.png" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={pageUrl} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <style>{`
        /* ── Page-specific: arc header card ────────────────────────── */
        .arc-title{font-family:'Bangers',cursive;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:3px;color:#1a1a1a;line-height:1;margin-bottom:0.4rem}
        .arc-sub{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.6rem}
        .arc-desc{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}

        /* ── Page-specific: issue grid ─────────────────────────────── */
        .issue-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.35rem;margin-top:0.25rem}
        .issue-item{background:#f8f3e3;border:1px solid #d4c9a8;padding:0.3rem 0.6rem;font-size:0.82rem;font-weight:400}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <a href="/collection-guides" className="breadcrumb-link">&larr; Collection Guides</a>
        </div>

        {configError && (
          <div className="panel" style={{ background: "#fff0f0", borderColor: "#cc1f00", color: "#cc1f00", fontWeight: 600, fontSize: "0.9rem" }}>
            Configuration error: {configError}
          </div>
        )}

        <div className="panel-accent">
          <div className="panel-accent-stripe" />
          <div className="panel-accent-body">
            <h1 className="arc-title">{arcName}</h1>
            <div className="arc-sub">{issues.length > 0 ? issues.length : "…"} issues &middot; Story Arc &middot; eBay Bundle Deals</div>
            {arcDesc && <p className="arc-desc">{arcDesc}</p>}
          </div>
        </div>

        <div className="panel">
          <div className="caption">Issues in this arc</div>
          <ul className="issue-grid">
            {issues.map((issue) => (
              <li className="issue-item" key={issue}>{issue}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          {status === "loading-issues" && (
            <div className="loading-state">
              <div><span className="loading-dots">Loading issues</span></div>
              <div className="loading-sub">Fetching arc issue list…</div>
            </div>
          )}

          {status === "not-cached" && (
            <div className="no-results" style={{ padding: "2rem" }}>
              <strong>Issues not yet indexed.</strong><br />
              This arc&rsquo;s issue list is populated by a nightly job. Check back after the next update (daily at 6:30 AM UTC).
            </div>
          )}

          {status === "loading-ebay" && (
            <div className="loading-state">
              <div><span className="loading-dots">Searching eBay</span></div>
              <div className="loading-sub">Checking all {issues.length} issues for bundle deals…</div>
            </div>
          )}

          {status === "done" && wave2Loading && (
            <div className="wave2-banner">
              <span className="wave2-spinner" />
              Loading additional results…
            </div>
          )}

          {status === "error" && (
            <div className="error-state">
              Search failed. Please try refreshing the page.
            </div>
          )}

          {status === "done" && (
            <>
              <div className="price-row">
                <label htmlFor="max-price-arc">Max price per issue:</label>
                <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>$</span>
                <input
                  className="price-input"
                  type="number"
                  id="max-price-arc"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  min="0.01"
                  max="50"
                  step="0.50"
                />
              </div>

              {sortedSellers.length === 0 ? (
                <>
                  <div className="section-title">No Bundle Opportunities Found</div>
                  <div className="no-results">
                    No single seller carries 2 or more issues from this arc at or under $
                    {maxPriceNum.toFixed(2)}. Try raising your max price.
                  </div>
                </>
              ) : (
                <>
                  <div className="stats-row">
                    <div className="stat-box">
                      <div className="stat-number">{issues.length}</div>
                      <div className="stat-label">Issues Searched</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-number">{totalSellers}</div>
                      <div className="stat-label">Total Sellers Found</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-number">{sortedSellers.length}</div>
                      <div className="stat-label">Bundle Opportunities</div>
                    </div>
                  </div>

                  <div className="section-title">Bundle Deals — Sellers Ranked by Issues Carried</div>

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
                    Some links on this page may be affiliate links. A small commission may be earned
                    if you purchase through these links, at no extra cost to you.
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div
          className="panel"
          style={{ textAlign: "center", fontSize: "0.8rem", fontWeight: 400, color: "#666", padding: "0.85rem 1.75rem" }}
        >
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
  return { paths: [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  const { slug } = params;

  // Slug format: "{metronId}-{readable-name}", e.g. "123-brand-new-day"
  const idMatch = slug.match(/^(\d+)/);
  if (!idMatch) return { notFound: true };
  const arcId = parseInt(idMatch[1], 10);

  if (!process.env.METRON_USERNAME || !process.env.METRON_PASSWORD) {
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: "METRON credentials not configured." }, revalidate: 60 };
  }

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "User-Agent": "ComicBundleFinder/1.0",
  };

  // Only fetch arc metadata here — one lightweight request suitable for ISR.
  // Issues are fetched client-side via /api/arc/[id]/issues, which uses a 24h
  // Vercel Blob cache so Metron is only hit once per arc per day regardless of
  // how many times the ISR page is regenerated.
  let arcRes;
  try {
    arcRes = await fetch(`https://metron.cloud/api/arc/${arcId}/`, { headers });
  } catch (e) {
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: `Network error: ${e.message}` }, revalidate: 60 };
  }
  if (!arcRes.ok) {
    if (arcRes.status === 404) return { notFound: true };
    return { props: { slug, arcId, arcName: "Arc Unavailable", arcDesc: "", configError: `Metron returned ${arcRes.status}` }, revalidate: 60 };
  }
  const arc = await arcRes.json();

  return {
    props: { slug, arcId, arcName: arc.name, arcDesc: arc.desc || "" },
    revalidate: 86400,
  };

}
