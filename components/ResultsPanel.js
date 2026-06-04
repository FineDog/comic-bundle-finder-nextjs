/**
 * ResultsPanel — shared results presentation for collection guide pages.
 *
 * Encapsulates filter/sort state, seller metric computation, and all results
 * JSX so that every collection guide (series, arc, and future pages) renders
 * identically without copy-pasting.
 *
 * Usage:
 *   <ResultsPanel
 *     rows={rows}              // flat listing rows from eBay search
 *     issues={issues}          // ordered array of issue name strings
 *     wave2Loading={bool}      // true while Wave 2 is in flight
 *     defaultMaxPrice="10"     // optional; default "10"
 *     hint="All prices cached" // optional hint shown beside Filter toggle
 *     resetKey={startIdx}      // optional; when value changes, requiredIssues clears
 *   />
 */

import { useState, useEffect } from "react";

function esc(s) { return String(s || ""); }

// Apply filters, compute per-seller metrics, return sorted [name, data] entries.
export function groupResults(rows, filters, sortBy) {
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

export default function ResultsPanel({
  rows = [],
  issues = [],
  wave2Loading = false,
  defaultMaxPrice = "10",
  hint,
  resetKey,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    minPrice: "",
    maxPrice: defaultMaxPrice,
    shipping: "included",
    minBundle: 2,
    requiredIssues: [],
  });
  const [sortBy, setSortBy] = useState("bundle_size");

  // When the caller signals a context change (e.g. series page navigates to a new
  // issue window), clear the required-issues selection so stale choices don't carry over.
  useEffect(() => {
    if (resetKey !== undefined) {
      setFilters(f => ({ ...f, requiredIssues: [] }));
    }
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setFilters({ minPrice: "", maxPrice: defaultMaxPrice, shipping: "included", minBundle: 2, requiredIssues: [] });
    setSortBy("bundle_size");
  }

  const filtersActive =
    filters.minPrice !== "" ||
    filters.maxPrice !== defaultMaxPrice ||
    filters.shipping !== "included" ||
    filters.minBundle > 2 ||
    filters.requiredIssues.length > 0 ||
    sortBy !== "bundle_size";

  const sortedSellers = groupResults(rows, filters, sortBy);
  const sellerCount   = sortedSellers.length;
  const totalSellers  = new Set(rows.map(r => r.seller)).size;

  return (
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
        {hint && <span className="hint" style={{ marginTop: 0 }}>{hint}</span>}
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
                      name={`shipping-filter-rp-${defaultMaxPrice}`}
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
                      name={`sort-by-rp-${defaultMaxPrice}`}
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
                    <span className="filter-section-label" style={{ margin: 0 }}>
                      Required issues (only show sellers who have these)
                    </span>
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

      {/* Results */}
      <div className="section-title">
        {sellerCount === 0
          ? "No Bundle Opportunities Found"
          : "Bundle Deals — Sellers Ranked by Issues Carried"}
      </div>

      {sellerCount === 0 ? (
        <div className="no-results">
          No single seller carries 2 or more issues at the current filters.
          Try adjusting or resetting them above.
        </div>
      ) : (
        <>
          <div className="stats-row">
            <div className="stat-box">
              <div className="stat-number">{issues.length || rows.length}</div>
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
                        l.shipping === "0.00" ? "FREE"
                        : l.shipping === "unknown" ? "—"
                        : `$${parseFloat(l.shipping).toFixed(2)}`;
                      return (
                        <tr key={i}>
                          <td className="col-issue">{esc(l.issue)}</td>
                          <td className="col-title">{esc(l.title)}</td>
                          <td className="col-price">${parseFloat(l.price).toFixed(2)}</td>
                          <td className="col-ship">{ship}</td>
                          <td className="col-link">
                            <a className="listing-link" href={l.url} target="_blank" rel="noopener noreferrer">
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
            Some links on this page may be affiliate links. A small commission may be earned if you purchase through these links, at no extra cost to you.
          </div>
        </>
      )}
    </>
  );
}
