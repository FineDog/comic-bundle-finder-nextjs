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
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background-color:#f0e6c4;background-image:radial-gradient(circle,#c8b98a 1px,transparent 1px);background-size:10px 10px;font-family:'Oswald',sans-serif;color:#1a1a1a;min-height:100vh;padding:2rem 1rem 4rem}

        .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.75rem}
        .caption{display:inline-block;background:#ffe066;border:2px solid #1a1a1a;padding:0.3rem 0.7rem;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:1rem}

        .arc-header{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;margin-bottom:1.75rem;display:flex;overflow:hidden}
        .arc-accent{width:8px;flex-shrink:0;background:#cc1f00}
        .arc-header-body{padding:1.25rem 1.5rem;flex:1;min-width:0}
        .arc-title{font-family:'Bangers',cursive;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:3px;color:#1a1a1a;line-height:1;margin-bottom:0.4rem}
        .arc-sub{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.6rem}
        .arc-desc{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}

        .issue-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.35rem;margin-top:0.25rem}
        .issue-item{background:#f8f3e3;border:1px solid #d4c9a8;padding:0.3rem 0.6rem;font-size:0.82rem;font-weight:400}

        .price-row{display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1.5rem}
        .price-row label{font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
        .price-input{width:90px;border:2px solid #1a1a1a;background:#fffdf4;font-family:'Oswald',sans-serif;font-size:0.95rem;font-weight:600;padding:0.3rem 0.5rem;color:#1a1a1a;text-align:center}
        .price-input:focus{outline:none;border-color:#003399;box-shadow:2px 2px 0 #003399}

        .loading-state{text-align:center;padding:3rem 1rem;color:#003399;font-family:'Bangers',cursive;font-size:1.8rem;letter-spacing:3px}
        .loading-sub{font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#666;margin-top:0.75rem}
        .loading-dots::after{content:'…';animation:dots 1.2s steps(3,end) infinite}
        @keyframes dots{0%,100%{content:'.'}33%{content:'..'}66%{content:'...'}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .error-state{text-align:center;padding:2rem;color:#cc1f00;font-weight:600}
        .no-results{text-align:center;padding:2rem;color:#666;font-size:0.95rem;font-weight:400}

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
        .col-issue{width:22%}.col-title{width:49%}.col-price{width:9%;text-align:right}.col-ship{width:11%;text-align:right}.col-link{width:9%;text-align:center}
        .listing-link{color:#cc1f00;font-weight:600;text-decoration:none;white-space:nowrap;font-size:0.8rem}
        .listing-link:hover{text-decoration:underline}
        .disclosure{font-size:0.72rem;color:#888;text-align:center;font-weight:400;margin-top:1.25rem;line-height:1.5;border-top:1px solid #d4c9a8;padding-top:0.75rem}
        .panel-slim{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:0.6rem 1.25rem;margin-bottom:1.75rem;font-size:0.8rem;font-weight:600}
        .breadcrumb-link{color:#003399;text-decoration:none;font-weight:600}.breadcrumb-link:hover{text-decoration:underline}
        @media(max-width:600px){.col-title{display:none}.col-issue{width:40%}}
      `}</style>

      <div className="page-wrap">
        <SiteNav />

        <div className="panel-slim">
          <a href="/collection-guides" className="breadcrumb-link">← Collection Guides</a>
        </div>

        {configError && (
          <div className="panel" style={{ background: "#fff0f0", borderColor: "#cc1f00", color: "#cc1f00", fontWeight: 600, fontSize: "0.9rem" }}>
            Configuration error: {configError}
          </div>
        )}

        <div className="arc-header">
          <div className="arc-accent" />
          <div className="arc-header-body">
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
            <div style={{display:"inline-flex",alignItems:"center",gap:"0.5rem",background:"#ffe066",border:"2px solid #1a1a1a",fontSize:"0.75rem",fontWeight:600,letterSpacing:"1px",textTransform:"uppercase",padding:"0.3rem 0.85rem",marginBottom:"1.25rem"}}>
              <span style={{width:10,height:10,border:"2px solid #1a1a1a",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.6s linear infinite",display:"inline-block",flexShrink:0}} />
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
                  <div className="results-title">No Bundle Opportunities Found</div>
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

                  <div className="results-title">Bundle Deals — Sellers Ranked by Issues Carried</div>

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
