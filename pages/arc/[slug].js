import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import SiteNav from "../../components/SiteNav";
import SiteFooter from "../../components/SiteFooter";
import { runEbaySearch } from "../../lib/ebay-search";

function esc(s) { return String(s || ""); }

// Apply filters, compute per-seller metrics, return sorted [name, data] entries.
function groupResults(rows, filters, sortBy) {
  const minP = parseFloat(filters.minPrice);
  const maxP = parseFloat(filters.maxPrice);

  let filtered = rows;
  if (!isNaN(minP) && minP > 0) filtered = filtered.filter(r => parseFloat(r.price) >= minP);
  if (!isNaN(maxP) && maxP > 0) filtered = filtered.filter(r => parseFloat(r.price) <= maxP);

  if (filters.shipping === "required") {
    filtered = filtered.filter(r => r.shipping === "0.00");
  } else if (filters.shipping === "excluded") {
    filtered = filtered.filter(r => r.shipping !== "0.00");
  }

  const s = {};
  for (const r of filtered) {
    if (!s[r.seller]) s[r.seller] = { listings: [] };
    s[r.seller].listings.push(r);
  }

  const minBundle = Math.max(2, parseInt(filters.minBundle) || 2);

  for (const name of Object.keys(s)) {
    const distinctIssues = new Set(s[name].listings.map(l => l.issue)).size;
    s[name].bundle_count = distinctIssues;
    if (distinctIssues < minBundle) { delete s[name]; continue; }
    if (filters.requiredIssues?.length > 0) {
      const sellerIssues = new Set(s[name].listings.map(l => l.issue));
      if (!filters.requiredIssues.every(ri => sellerIssues.has(ri))) { delete s[name]; continue; }
    }

    const cheapestPerIssue = {};
    for (const l of s[name].listings) {
      const p = parseFloat(l.price) || 0;
      if (!(l.issue in cheapestPerIssue) || p < parseFloat(cheapestPerIssue[l.issue].price)) {
        cheapestPerIssue[l.issue] = l;
      }
    }

    let totalIndividualShipping = 0, maxShipping = 0, hasUnknownShipping = false;
    for (const l of Object.values(cheapestPerIssue)) {
      const ship = parseFloat(l.shipping);
      if (!isFinite(ship) || l.shipping === "unknown") {
        hasUnknownShipping = true;
      } else {
        totalIndividualShipping += ship;
        if (ship > maxShipping) maxShipping = ship;
      }
    }

    const sumCheapest = Object.values(cheapestPerIssue).reduce((a, l) => a + (parseFloat(l.price) || 0), 0);
    const numUnique = Object.keys(cheapestPerIssue).length;
    s[name].subtotal = sumCheapest;
    s[name].maxShipping = maxShipping;
    s[name].estPerIssue = numUnique > 0 ? (sumCheapest + maxShipping) / numUnique : 0;
    s[name].shippingSavings = hasUnknownShipping ? null : Math.max(0, totalIndividualShipping - maxShipping);
  }

  const entries = Object.entries(s);
  entries.sort(([nameA, a], [nameB, b]) => {
    if (sortBy === "est_price_per_issue") return a.estPerIssue - b.estPerIssue;
    if (sortBy === "est_shipping") return a.maxShipping - b.maxShipping;
    return b.bundle_count - a.bundle_count || nameA.localeCompare(nameB);
  });
  return entries;
}

export default function ArcPage({ slug, arcId, arcName, arcDesc, configError }) {
  // "loading-issues" → "loading-ebay" → "done" | "error"
  const [status, setStatus] = useState("loading-issues");
  const [issues, setIssues] = useState([]);
  const [rows, setRows] = useState([]);
  const [wave2Loading, setWave2Loading] = useState(false);
  const [userZip, setUserZip] = useState(null);

  // Filter + sort state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    minPrice: "",
    maxPrice: "15",
    shipping: "included",
    minBundle: 2,
    requiredIssues: [],
  });
  const [sortBy, setSortBy] = useState("bundle_size");

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

    fetch(`/api/arc/${arcId}/issues`)
      .then(r => r.json())
      .then(async data => {
        if (data.error) throw new Error(data.error);
        if (data.issues === null) { setStatus("not-cached"); return; }
        const issueList = data.issues || [];
        setIssues(issueList);
        if (!issueList.length) { setStatus("done"); return; }

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

  const sortedSellers = groupResults(rows, filters, sortBy);
  const totalSellers  = new Set(rows.map(r => r.seller)).size;

  // ─── Filter helpers ───────────────────────────────────────────────────────
  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }
  function toggleRequiredIssue(issue) {
    setFilters(f => ({
      ...f,
      requiredIssues: f.requiredIssues.includes(issue)
        ? f.requiredIssues.filter(i => i !== issue)
        : [...f.requiredIssues, issue],
    }));
  }
  function resetFilters() {
    setFilters({ minPrice: "", maxPrice: "15", shipping: "included", minBundle: 2, requiredIssues: [] });
    setSortBy("bundle_size");
  }
  const filtersActive =
    filters.minPrice !== "" ||
    filters.maxPrice !== "15" ||
    filters.shipping !== "included" ||
    filters.minBundle > 2 ||
    filters.requiredIssues.length > 0 ||
    sortBy !== "bundle_size";

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
        /* ── Arc header card ────────────────────────────────────────── */
        .arc-title{font-family:'Bangers',cursive;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:3px;color:#1a1a1a;line-height:1;margin-bottom:0.4rem}
        .arc-sub{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:0.6rem}
        .arc-desc{font-size:0.88rem;font-weight:400;line-height:1.7;color:#444}

        /* ── Issue grid ─────────────────────────────────────────────── */
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
            {issues.map(issue => (
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

          {status === "error" && (
            <div className="error-state">
              Search failed. Please try refreshing the page.
            </div>
          )}

          {status === "done" && (
            <>
              {wave2Loading && (
                <div className="wave2-banner">
                  <span className="wave2-spinner" />
                  Loading additional results…
                </div>
              )}

              {/* Filter & Sort */}
              <div className="filter-toggle-row">
                <button
                  className={`btn-filter-toggle${filtersOpen ? " active" : ""}`}
                  onClick={() => setFiltersOpen(o => !o)}
                >
                  Filter &amp; Sort {filtersOpen ? "▲" : "▼"}
                  {filtersActive && !filtersOpen && <span className="filter-active-dot" />}
                </button>
                {filtersActive && (
                  <button className="btn-filter-reset" onClick={resetFilters}>Reset</button>
                )}
              </div>

              {filtersOpen && (
                <div className="filter-panel">
                  <div className="filter-grid">
                    {/* Price range */}
                    <div className="filter-section">
                      <span className="filter-section-label">Price per issue</span>
                      <div className="filter-row">
                        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>From</span>
                        <span style={{ fontWeight: 600 }}>$</span>
                        <input
                          className="filter-input"
                          type="number"
                          placeholder="0"
                          value={filters.minPrice}
                          onChange={e => setFilter("minPrice", e.target.value)}
                          min="0" step="0.50"
                        />
                        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>to</span>
                        <span style={{ fontWeight: 600 }}>$</span>
                        <input
                          className="filter-input"
                          type="number"
                          placeholder="any"
                          value={filters.maxPrice}
                          onChange={e => setFilter("maxPrice", e.target.value)}
                          min="0" step="0.50"
                        />
                      </div>
                    </div>

                    {/* Min bundle size */}
                    <div className="filter-section">
                      <span className="filter-section-label">Min issues per bundle</span>
                      <div className="filter-row">
                        <input
                          className="filter-input"
                          type="number"
                          value={filters.minBundle}
                          onChange={e => setFilter("minBundle", Math.max(2, parseInt(e.target.value) || 2))}
                          min="2" step="1"
                          style={{ width: "60px" }}
                        />
                        <span style={{ fontSize: "0.8rem", fontWeight: 400 }}>issues minimum</span>
                      </div>
                    </div>

                    {/* Shipping filter */}
                    <div className="filter-section">
                      <span className="filter-section-label">Free shipping</span>
                      <div className="filter-radio-group">
                        {[["included", "Any"], ["required", "Free only"], ["excluded", "No free"]].map(([val, label]) => (
                          <label key={val} className="filter-radio-label">
                            <input
                              type="radio"
                              name="shipping-filter-arc"
                              value={val}
                              checked={filters.shipping === val}
                              onChange={() => setFilter("shipping", val)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Sort */}
                    <div className="filter-section">
                      <span className="filter-section-label">Sort by</span>
                      <div className="filter-radio-group" style={{ flexDirection: "column", gap: "0.3rem" }}>
                        {[
                          ["bundle_size", "Bundle size (most issues first)"],
                          ["est_price_per_issue", "Lowest est. price per issue"],
                          ["est_shipping", "Lowest est. shipping"],
                        ].map(([val, label]) => (
                          <label key={val} className="filter-radio-label">
                            <input
                              type="radio"
                              name="sort-by-arc"
                              value={val}
                              checked={sortBy === val}
                              onChange={() => setSortBy(val)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Required issues */}
                    {issues.length > 1 && (() => {
                      const allSelected = issues.every(i => filters.requiredIssues.includes(i));
                      return (
                        <div className="filter-section" style={{ gridColumn: "1 / -1" }}>
                          <hr className="filter-divider" style={{ marginTop: 0, marginBottom: "0.75rem" }} />
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                            <span className="filter-section-label" style={{ margin: 0 }}>Required issues (only show sellers who have these)</span>
                            <button
                              className="btn-filter-reset"
                              style={{ textDecoration: "none", background: "#ffe066", border: "1.5px solid #1a1a1a", padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer" }}
                              onClick={() => setFilter("requiredIssues", allSelected ? [] : [...issues])}
                            >
                              {allSelected ? "Deselect All" : "Select All"}
                            </button>
                          </div>
                          <div className="filter-checkboxes">
                            {issues.map(issue => (
                              <label
                                key={issue}
                                className={`filter-checkbox-label${filters.requiredIssues.includes(issue) ? " checked" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  style={{ display: "none" }}
                                  checked={filters.requiredIssues.includes(issue)}
                                  onChange={() => toggleRequiredIssue(issue)}
                                />
                                {issue}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {sortedSellers.length === 0 ? (
                <>
                  <div className="section-title">No Bundle Opportunities Found</div>
                  <div className="no-results">
                    No single seller carries 2 or more issues from this arc at the current filters.
                    Try adjusting or resetting them above.
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
                    const estPerIssueStr = `~$${sellerData.estPerIssue.toFixed(2)}/issue`;
                    const savingsStr = sellerData.shippingSavings !== null && sellerData.shippingSavings > 0.01
                      ? `save ~$${sellerData.shippingSavings.toFixed(2)} shipping`
                      : null;

                    return (
                      <div className="seller-group" key={name}>
                        <div className="seller-header">
                          <span className="seller-name">{esc(name)}</span>
                          <span className="bundle-badge">{sellerData.bundle_count} issues &mdash; bundle shipping!</span>
                          <span className="subtotal-badge">from ${sellerData.subtotal.toFixed(2)} in items</span>
                          <span className="badge-est">{estPerIssueStr}</span>
                          {savingsStr && <span className="badge-savings">{savingsStr}</span>}
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
                                      View &rarr;
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

        <SiteFooter />
      </div>
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  const { slug } = params;

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
