import { useState, useRef } from "react";
import Head from "next/head";

// ─── Progress stages ──────────────────────────────────────────────────────────

const STAGES = [
  { pct: 5,  msg: "Waking up the server…" },
  { pct: 12, msg: "Connecting to eBay…" },
  { pct: 22, msg: "Authenticating…" },
  { pct: 35, msg: "Searching eBay listings…" },
  { pct: 50, msg: "Checking seller inventories…" },
  { pct: 63, msg: "Filtering by price…" },
  { pct: 74, msg: "Verifying issue numbers…" },
  { pct: 83, msg: "Tallying bundle opportunities…" },
  { pct: 90, msg: "Sorting by seller…" },
  { pct: 94, msg: "Almost there…" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || "");
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [issueInput, setIssueInput]   = useState("");
  const [maxPrice, setMaxPrice]       = useState("10");
  const [status, setStatus]           = useState({ msg: "", type: "" });
  const [progress, setProgress]       = useState({ visible: false, pct: 0, msg: "" });
  const [dym, setDym]                 = useState(null);   // { corrections, edits }
  const [results, setResults]         = useState(null);   // { rows, issueCount }
  const timerRef                      = useRef(null);
  const pendingMaxPrice               = useRef(10);

  // ── Progress bar ──

  function startProgress() {
    setProgress({ visible: true, pct: 0, msg: STAGES[0].msg });
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      if (i < STAGES.length) {
        setProgress({ visible: true, pct: STAGES[i].pct, msg: STAGES[i].msg });
      } else {
        clearInterval(timerRef.current);
      }
    }, 6000);
  }

  function finishProgress(success) {
    clearInterval(timerRef.current);
    if (success) {
      setProgress({ visible: true, pct: 100, msg: "Done!" });
      setTimeout(() => setProgress(p => ({ ...p, visible: false })), 800);
    } else {
      setProgress(p => ({ ...p, visible: false }));
    }
  }

  // ── Search flow ──

  async function handleSearch() {
    const issues = issueInput.split("\n").map(l => l.trim()).filter(Boolean);
    if (!issues.length) { setStatus({ msg: "Please enter at least one issue.", type: "error" }); return; }

    pendingMaxPrice.current = parseFloat(maxPrice) || 10;
    setStatus({ msg: "", type: "" });
    setResults(null);
    setDym(null);
    setStatus({ msg: "Checking for typos…", type: "loading" });

    try {
      const vRes = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues }),
      });
      const vData = await vRes.json();
      setStatus({ msg: "", type: "" });

      if (vData.any_changed) {
        setDym({
          corrections: vData.corrections,
          edits: vData.corrections.map(c => c.suggested),
        });
      } else {
        executeSearch(issues);
      }
    } catch {
      setStatus({ msg: "", type: "" });
      executeSearch(issues);
    }
  }

  async function executeSearch(issues) {
    setDym(null);
    setResults(null);
    startProgress();

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues, max_price: pendingMaxPrice.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Server error");
      finishProgress(true);
      setResults({ rows: data.results, issueCount: issues.length });
    } catch (err) {
      finishProgress(false);
      setStatus({ msg: `Error: ${err.message}. Try again in a moment.`, type: "error" });
    }
  }

  function searchWithCorrections() {
    const issues = dym.edits.map(e => e.trim()).filter(Boolean);
    executeSearch(issues);
  }

  function searchWithOriginal() {
    const issues = issueInput.split("\n").map(l => l.trim()).filter(Boolean);
    executeSearch(issues);
  }

  // ── Result grouping ──

  function groupResults(rows) {
    const sellers = {};
    for (const row of rows) {
      if (!sellers[row.seller]) sellers[row.seller] = { bundle_count: row.bundle_count, listings: [] };
      sellers[row.seller].listings.push(row);
    }
    // Filter out single-issue sellers
    for (const name of Object.keys(sellers)) {
      if (sellers[name].bundle_count < 2) delete sellers[name];
    }
    return sellers;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const sellers = results ? groupResults(results.rows) : {};
  const sellerCount = results ? Object.keys(groupResults(results.rows)).length : 0;
  const totalSellers = results ? new Set(results.rows.map(r => r.seller)).size : 0;

  return (
    <>
      <Head>
        <title>Comic Bundle Finder</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background-color: #f0e6c4;
          background-image: radial-gradient(circle, #c8b98a 1px, transparent 1px);
          background-size: 10px 10px;
          font-family: 'Oswald', sans-serif;
          color: #1a1a1a;
          min-height: 100vh;
          padding: 2rem 1rem 4rem;
        }
        .container { max-width: 960px; margin: 0 auto; }
        .panel { background: #fffdf4; border: 3px solid #1a1a1a; box-shadow: 6px 6px 0 #1a1a1a; padding: 1.5rem 1.75rem; margin-bottom: 1.75rem; }
        .title-panel { background: #cc1f00; text-align: center; padding: 1.25rem 1.75rem 1rem; }
        .title-panel h1 { font-family: 'Bangers', cursive; font-size: clamp(2.5rem, 8vw, 5rem); color: #fffdf4; letter-spacing: 4px; text-shadow: 4px 4px 0 #1a1a1a; line-height: 1; }
        .tagline { color: #ffe066; font-size: 0.85rem; letter-spacing: 2px; text-transform: uppercase; margin-top: 0.4rem; font-weight: 400; }
        .caption { display: inline-block; background: #ffe066; border: 2px solid #1a1a1a; padding: 0.3rem 0.7rem; font-size: 0.8rem; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 1rem; }
        label { display: block; font-weight: 600; font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 0.5rem; }
        textarea { width: 100%; height: 150px; border: 2px solid #1a1a1a; background: #fffdf4; font-family: 'Courier New', monospace; font-size: 0.9rem; padding: 0.75rem; resize: vertical; color: #1a1a1a; }
        textarea:focus { outline: none; border-color: #003399; box-shadow: 2px 2px 0 #003399; }
        .hint { font-size: 0.78rem; color: #666; margin-top: 0.4rem; font-weight: 400; line-height: 1.5; }
        .price-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
        .price-row label { margin: 0; font-size: 0.82rem; white-space: nowrap; }
        .price-input { width: 90px; border: 2px solid #1a1a1a; background: #fffdf4; font-family: 'Oswald', sans-serif; font-size: 0.95rem; font-weight: 600; padding: 0.3rem 0.5rem; color: #1a1a1a; text-align: center; }
        .price-input:focus { outline: none; border-color: #003399; box-shadow: 2px 2px 0 #003399; }
        .btn-search { display: inline-block; background: #003399; color: #fffdf4; border: 3px solid #1a1a1a; box-shadow: 4px 4px 0 #1a1a1a; font-family: 'Bangers', cursive; font-size: 1.6rem; letter-spacing: 2px; padding: 0.3rem 2.5rem 0.4rem; cursor: pointer; margin-top: 1.25rem; transition: transform 0.08s, box-shadow 0.08s; }
        .btn-search:hover { background: #0044cc; }
        .btn-search:active { transform: translate(3px,3px); box-shadow: 1px 1px 0 #1a1a1a; }
        .btn-search:disabled { background: #888; cursor: not-allowed; transform: none; box-shadow: 4px 4px 0 #1a1a1a; }
        .s-error { color: #cc1f00; font-weight: 600; font-size: 0.88rem; margin-top: 0.9rem; }
        .s-loading { color: #003399; font-size: 0.88rem; margin-top: 0.9rem; }
        .progress-wrap { margin-top: 1.25rem; }
        .progress-msg { font-size: 0.82rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 0.5rem; color: #003399; }
        .progress-track { border: 2px solid #1a1a1a; background: #f0e6c4; height: 24px; position: relative; overflow: hidden; }
        .progress-fill { height: 100%; background: #cc1f00; transition: width 0.7s ease; }
        .progress-pct { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-family: 'Bangers', cursive; font-size: 0.85rem; letter-spacing: 1px; color: #fffdf4; text-shadow: 1px 1px 0 #1a1a1a; }
        .dym-panel { background: #fffdf4; border: 3px solid #003399; box-shadow: 6px 6px 0 #003399; padding: 1.25rem 1.5rem; margin-bottom: 1.75rem; }
        .dym-title { font-family: 'Bangers', cursive; font-size: 1.6rem; color: #003399; letter-spacing: 2px; margin-bottom: 0.5rem; }
        .dym-subtitle { font-size: 0.8rem; font-weight: 400; color: #444; margin-bottom: 1rem; line-height: 1.5; }
        .dym-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
        .dym-original { font-size: 0.85rem; color: #888; text-decoration: line-through; min-width: 180px; font-weight: 400; }
        .dym-arrow { font-size: 0.85rem; color: #003399; font-weight: 600; }
        .dym-edit { border: 2px solid #003399; background: #fffdf4; font-family: 'Oswald', sans-serif; font-size: 0.85rem; font-weight: 600; padding: 0.2rem 0.5rem; color: #1a1a1a; flex: 1; min-width: 160px; }
        .dym-edit:focus { outline: none; box-shadow: 2px 2px 0 #003399; }
        .dym-unchanged { font-size: 0.85rem; color: #666; font-weight: 400; font-style: italic; }
        .dym-buttons { display: flex; gap: 0.75rem; margin-top: 1.1rem; flex-wrap: wrap; }
        .btn-accept { background: #003399; color: #fffdf4; border: 3px solid #1a1a1a; box-shadow: 4px 4px 0 #1a1a1a; font-family: 'Bangers', cursive; font-size: 1.3rem; letter-spacing: 2px; padding: 0.2rem 1.5rem 0.3rem; cursor: pointer; transition: transform 0.08s, box-shadow 0.08s; }
        .btn-accept:hover { background: #0044cc; }
        .btn-accept:active { transform: translate(3px,3px); box-shadow: 1px 1px 0 #1a1a1a; }
        .btn-skip { background: #fffdf4; color: #1a1a1a; border: 2px solid #1a1a1a; box-shadow: 3px 3px 0 #1a1a1a; font-family: 'Oswald', sans-serif; font-size: 0.82rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 0.35rem 1rem; cursor: pointer; }
        .btn-skip:hover { background: #f0e6c4; }
        .stats-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
        .stat-box { flex: 1; min-width: 110px; background: #ffe066; border: 2px solid #1a1a1a; padding: 0.6rem 1rem; text-align: center; }
        .stat-number { font-family: 'Bangers', cursive; font-size: 2.2rem; color: #cc1f00; line-height: 1; }
        .stat-label { font-size: 0.68rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #1a1a1a; margin-top: 2px; }
        .results-title { font-family: 'Bangers', cursive; font-size: 2rem; letter-spacing: 2px; color: #cc1f00; margin-bottom: 1.25rem; }
        .seller-group { margin-bottom: 1.75rem; }
        .seller-header { background: #003399; color: #fffdf4; padding: 0.5rem 0.75rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; border: 2px solid #1a1a1a; border-bottom: none; }
        .seller-name { font-family: 'Bangers', cursive; font-size: 1.35rem; letter-spacing: 1px; }
        .bundle-badge { background: #cc1f00; color: #fffdf4; font-size: 0.68rem; font-weight: 600; padding: 2px 8px; border: 1.5px solid #1a1a1a; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; }
        .subtotal-badge { font-size: 0.78rem; font-weight: 600; color: #fffdf4; background: #003399; border: 1.5px solid #ffe066; padding: 2px 8px; letter-spacing: 0.5px; white-space: nowrap; }
        .listings-table { width: 100%; border-collapse: collapse; border: 2px solid #1a1a1a; font-size: 0.82rem; table-layout: fixed; }
        .listings-table th { background: #1a1a1a; color: #fffdf4; padding: 0.4rem 0.6rem; text-align: left; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; font-size: 0.7rem; white-space: nowrap; }
        .listings-table td { padding: 0.45rem 0.6rem; border-bottom: 1px solid #d4c9a8; vertical-align: top; font-weight: 400; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }
        .listings-table tr:last-child td { border-bottom: none; }
        .listings-table tr:nth-child(even) td { background: #f8f3e3; }
        .col-issue { width: 22%; } .col-title { width: 38%; } .col-price { width: 9%; text-align: right; } .col-ship { width: 11%; text-align: right; } .col-promo { width: 11%; } .col-link { width: 9%; text-align: center; }
        .listing-link { color: #cc1f00; font-weight: 600; text-decoration: none; white-space: nowrap; font-size: 0.8rem; }
        .listing-link:hover { text-decoration: underline; }
        .promo-pill { display: inline-block; background: #cc1f00; color: #fffdf4; font-size: 0.65rem; font-weight: 600; padding: 1px 5px; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.6; }
        .no-results { text-align: center; padding: 2rem; color: #666; font-size: 0.95rem; font-weight: 400; }
        .disclosure { font-size: 0.72rem; color: #888; text-align: center; font-weight: 400; margin-top: 1.25rem; line-height: 1.5; border-top: 1px solid #d4c9a8; padding-top: 0.75rem; }
        @media (max-width: 600px) { .col-title { display: none; } .col-issue { width: 40%; } }
      `}</style>

      <div className="container">

        {/* Title */}
        <div className="panel title-panel">
          <h1>Comic Bundle Finder</h1>
          <div className="tagline">Find sellers with multiple issues you need &mdash; save on shipping</div>
        </div>

        {/* Search form */}
        <div className="panel">
          <div className="caption">Enter your missing issues</div>
          <label htmlFor="issue-input">Paste your list below &mdash; one issue per line:</label>
          <textarea
            id="issue-input"
            value={issueInput}
            onChange={e => setIssueInput(e.target.value)}
            placeholder={"Batgirl: Year One #2\nBlack Widow #10\nBlack Widow #11 (2014)"}
          />
          <div className="hint">
            Format: Series Name #Number &mdash; e.g. &ldquo;Amazing Spider-Man #300&rdquo; or &ldquo;Black Widow #10 (2014)&rdquo;<br />
            Results are ranked by how many of your issues each seller carries.
          </div>
          <div className="price-row">
            <label htmlFor="max-price">Max price per issue:</label>
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>$</span>
            <input
              className="price-input"
              type="number"
              id="max-price"
              value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)}
              min="0.01" max="999" step="0.50"
            />
            <span className="hint" style={{ margin: 0 }}>(listings above this price are excluded)</span>
          </div>
          <button
            className="btn-search"
            onClick={handleSearch}
            disabled={progress.visible}
          >
            Find Bundles!
          </button>

          {status.msg && <div className={status.type === "error" ? "s-error" : "s-loading"}>{status.msg}</div>}

          {progress.visible && (
            <div className="progress-wrap">
              <div className="progress-msg">{progress.msg}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
                <div className="progress-pct">{progress.pct}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Did you mean? */}
        {dym && (
          <div className="dym-panel">
            <div className="dym-title">Did You Mean...?</div>
            <div className="dym-subtitle">
              We found some possible typos in your list. Review the suggestions below &mdash; edit any you disagree with &mdash; then click &ldquo;Search with corrections&rdquo; to proceed.
            </div>
            {dym.corrections.map((c, i) => (
              <div className="dym-row" key={i}>
                {c.changed ? (
                  <>
                    <span className="dym-original">{c.original}</span>
                    <span className="dym-arrow">→</span>
                    <input
                      className="dym-edit"
                      type="text"
                      value={dym.edits[i]}
                      onChange={e => {
                        const edits = [...dym.edits];
                        edits[i] = e.target.value;
                        setDym({ ...dym, edits });
                      }}
                    />
                  </>
                ) : (
                  <span className="dym-unchanged">{c.original} &mdash; looks good</span>
                )}
              </div>
            ))}
            <div className="dym-buttons">
              <button className="btn-accept" onClick={searchWithCorrections}>Search with corrections</button>
              <button className="btn-skip" onClick={searchWithOriginal}>Search as originally entered</button>
            </div>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="panel">
            <div className="results-title">
              {Object.keys(sellers).length === 0 ? "No Bundle Opportunities Found" : "Results — Sellers Ranked by Bundle Count"}
            </div>

            {Object.keys(sellers).length === 0 ? (
              <div className="no-results">
                No single seller carries more than one of your issues. You may need to buy these separately, or try broadening your search.
              </div>
            ) : (
              <>
                <div className="stats-row">
                  <div className="stat-box"><div className="stat-number">{results.issueCount}</div><div className="stat-label">Issues Searched</div></div>
                  <div className="stat-box"><div className="stat-number">{totalSellers}</div><div className="stat-label">Total Sellers Found</div></div>
                  <div className="stat-box"><div className="stat-number">{sellerCount}</div><div className="stat-label">Bundle Opportunities</div></div>
                </div>

                {Object.entries(sellers).map(([name, data]) => {
                  const cheapestPerIssue = {};
                  for (const l of data.listings) {
                    const p = parseFloat(l.price) || 0;
                    if (!(l.issue in cheapestPerIssue) || p < cheapestPerIssue[l.issue]) cheapestPerIssue[l.issue] = p;
                  }
                  const subtotal = Object.values(cheapestPerIssue).reduce((a, b) => a + b, 0);

                  return (
                    <div className="seller-group" key={name}>
                      <div className="seller-header">
                        <span className="seller-name">{esc(name)}</span>
                        <span className="bundle-badge">{data.bundle_count} issues &mdash; bundle shipping!</span>
                        <span className="subtotal-badge">from ${subtotal.toFixed(2)} in items</span>
                      </div>
                      <table className="listings-table">
                        <thead>
                          <tr>
                            <th className="col-issue">Issue You Need</th>
                            <th className="col-title">Listing Title</th>
                            <th className="col-price">Price</th>
                            <th className="col-ship">Shipping</th>
                            <th className="col-promo">Promo</th>
                            <th className="col-link">Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.listings.map((l, i) => {
                            const ship = l.shipping === "0.00" ? "FREE" : l.shipping === "unknown" ? "—" : `$${parseFloat(l.shipping).toFixed(2)}`;
                            return (
                              <tr key={i}>
                                <td className="col-issue">{esc(l.issue)}</td>
                                <td className="col-title">{esc(l.title)}</td>
                                <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                                <td className="col-ship">{ship}</td>
                                <td className="col-promo">{l.promotions ? <span className="promo-pill">{l.promotions.split("|")[0].trim()}</span> : ""}</td>
                                <td className="col-link"><a className="listing-link" href={l.url} target="_blank" rel="noopener noreferrer">View →</a></td>
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
          </div>
        )}

      </div>
    </>
  );
}