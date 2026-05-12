import Head from "next/head";
import { list } from "@vercel/blob";

function esc(s) { return String(s || ""); }

function groupResults(rows, issueCount) {
  const s = {};
  for (const r of rows) {
    if (!s[r.seller]) s[r.seller] = { bundle_count: r.bundle_count, listings: [] };
    s[r.seller].listings.push(r);
  }
  if (issueCount === 1) {
    for (const n of Object.keys(s)) {
      if (s[n].listings.length < 2) delete s[n];
      else s[n].bundle_count = s[n].listings.length;
    }
  } else {
    for (const n of Object.keys(s)) { if (s[n].bundle_count < 2) delete s[n]; }
  }
  return s;
}

export default function ResultsPage({ data }) {
  const { rows, issueCount, savedAt } = data;
  const singleIssueMode = issueCount === 1;
  const sellers = groupResults(rows, issueCount);
  const sellerCount = Object.keys(sellers).length;
  const totalSellers = new Set(rows.map(r => r.seller)).size;
  const savedDate = new Date(savedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (<>
    <Head>
      <title>Saved Results — Comic Bundle Finder</title>
      <meta name="robots" content="noindex, nofollow" />
      <link rel="icon" type="image/x-icon" href="/favicon/favicon.ico" />
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600;700&display=swap" rel="stylesheet" />
    </Head>
    <style>{`
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#f0e6c4;background-image:radial-gradient(#c8b89a 1.5px,transparent 1.5px);background-size:24px 24px;min-height:100vh;font-family:'Oswald',sans-serif}
      .container{max-width:860px;margin:0 auto;padding:24px 16px}
      .panel{background:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:1.5rem 1.75rem;margin-bottom:1.5rem}
      .title-panel{text-align:center}
      h1{font-family:'Bangers',cursive;font-size:3.2rem;letter-spacing:4px;color:#cc1f00;text-shadow:3px 3px 0 #1a1a1a;line-height:1}
      .tagline{font-size:0.88rem;color:#444;font-weight:400;margin-top:0.25rem;letter-spacing:0.5px}
      .saved-banner{background:#003399;color:#fffdf4;border:3px solid #1a1a1a;box-shadow:6px 6px 0 #1a1a1a;padding:0.75rem 1.75rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem}
      .saved-label{font-family:'Bangers',cursive;font-size:1.3rem;letter-spacing:2px}
      .saved-date{font-size:0.78rem;font-weight:400;opacity:0.8}
      .search-again{background:#ffe066;color:#1a1a1a;border:2px solid #1a1a1a;box-shadow:3px 3px 0 #1a1a1a;font-family:'Oswald',sans-serif;font-size:0.8rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:0.3rem 0.9rem;text-decoration:none;white-space:nowrap}
      .search-again:hover{background:#ffd700}
      .results-title{font-family:'Bangers',cursive;font-size:2rem;letter-spacing:2px;color:#cc1f00;margin-bottom:1.25rem}
      .stats-row{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
      .stat-box{flex:1;min-width:110px;background:#ffe066;border:2px solid #1a1a1a;padding:0.6rem 1rem;text-align:center}
      .stat-number{font-family:'Bangers',cursive;font-size:2.2rem;color:#cc1f00;line-height:1}
      .stat-label{font-size:0.68rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#1a1a1a;margin-top:2px}
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
      .no-results{text-align:center;padding:2rem;color:#666;font-size:0.95rem;font-weight:400}
      .disclosure{font-size:0.72rem;color:#888;text-align:center;font-weight:400;margin-top:1.25rem;line-height:1.5;border-top:1px solid #d4c9a8;padding-top:0.75rem}
      @media(max-width:600px){.col-title{display:none}.col-issue{width:40%}}
    `}</style>
    <div className="container">
      <div className="panel title-panel">
        <h1>Comic Bundle Finder</h1>
        <div className="tagline">Find sellers with multiple issues you need &mdash; save on shipping</div>
      </div>

      <div className="saved-banner">
        <div>
          <div className="saved-label">Saved Results</div>
          <div className="saved-date">Saved on {savedDate}</div>
        </div>
        <a href="/" className="search-again">← New Search</a>
      </div>

      <div className="panel">
        <div className="results-title">{sellerCount === 0 ? "No Bundle Opportunities Found" : "Results — Sellers Ranked by Bundle Count"}</div>
        {sellerCount === 0 ? (
          <div className="no-results">No single seller carries more than one of your issues.</div>
        ) : (<>
          <div className="stats-row">
            <div className="stat-box"><div className="stat-number">{issueCount}</div><div className="stat-label">{singleIssueMode ? "Issue Searched" : "Issues Searched"}</div></div>
            <div className="stat-box"><div className="stat-number">{totalSellers}</div><div className="stat-label">Total Sellers Found</div></div>
            <div className="stat-box"><div className="stat-number">{sellerCount}</div><div className="stat-label">{singleIssueMode ? "Multi-Copy Sellers" : "Bundle Opportunities"}</div></div>
          </div>
          {Object.entries(sellers).map(([name, data]) => {
            const cpi = {};
            for (const l of data.listings) { const p = parseFloat(l.price) || 0; if (!(l.issue in cpi) || p < cpi[l.issue]) cpi[l.issue] = p; }
            const subtotal = Object.values(cpi).reduce((a, b) => a + b, 0);
            return (
              <div className="seller-group" key={name}>
                <div className="seller-header">
                  <span className="seller-name">{esc(name)}</span>
                  <span className="bundle-badge">{singleIssueMode ? `${data.bundle_count} listings` : `${data.bundle_count} issues`} — bundle shipping!</span>
                  <span className="subtotal-badge">from ${subtotal.toFixed(2)} in items</span>
                </div>
                <table className="listings-table">
                  <thead><tr>
                    <th className="col-issue">Issue You Need</th>
                    <th className="col-title">Listing Title</th>
                    <th className="col-price">Price</th>
                    <th className="col-ship">Shipping</th>
                    <th className="col-promo">Promo</th>
                    <th className="col-link">Link</th>
                  </tr></thead>
                  <tbody>
                    {data.listings.map((l, i) => {
                      const ship = l.shipping === "0.00" ? "FREE" : l.shipping === "unknown" ? "—" : `$${parseFloat(l.shipping).toFixed(2)}`;
                      return (<tr key={i}>
                        <td className="col-issue">{esc(l.issue)}</td>
                        <td className="col-title">{esc(l.title)}</td>
                        <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                        <td className="col-ship">{ship}</td>
                        <td className="col-promo">{l.promotions ? <span className="promo-pill">{l.promotions.split("|")[0].trim()}</span> : ""}</td>
                        <td className="col-link"><a className="listing-link" href={l.url} target="_blank" rel="noopener noreferrer">View →</a></td>
                      </tr>);
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          <div className="disclosure">Some links on this page may be affiliate links. A small commission may be earned if you purchase through these links, at no extra cost to you.</div>
        </>)}
      </div>
    </div>
  </>);
}

export async function getServerSideProps({ params }) {
  const { id } = params;
  // Sanitize ID — only allow alphanumeric characters
  if (!/^[A-Za-z0-9]{6,12}$/.test(id)) return { notFound: true };
  try {
    const { blobs } = await list({ prefix: `results/${id}.json` });
    if (!blobs.length) return { notFound: true };
    const res = await fetch(blobs[0].url);
    if (!res.ok) return { notFound: true };
    const data = await res.json();
    return { props: { data } };
  } catch {
    return { notFound: true };
  }
}
