// Valuation search test page — NOT for production.
// Searches eBay active listings, applies strict filtering, calculates a
// trimmed-mean FMV, and downloads an Excel workbook with:
//   Sheet 1 "Summary"  — one row per issue with FMV, confidence, formula
//   Sheet 2 "Listings" — every listing with its status (used / trimmed / blocked)

import { useState } from "react";
import * as XLSX from "xlsx";

// Status → background fill color (ARGB hex, no leading #)
const STATUS_FILL = {
  "Used in FMV":                   "C6EFCE", // green
  "Trimmed (low end)":             "FFEB9C", // yellow
  "Trimmed (high end)":            "FFEB9C", // yellow
  "Blocked: graded slab":          "FFC7CE", // red
  "Blocked: reprint / facsimile":  "FFC7CE",
  "Blocked: collected edition":    "FFC7CE",
  "Blocked: signed copy":          "FFC7CE",
  "Blocked: damaged / incomplete": "FFC7CE",
  "Blocked: lot / ratio variant":  "FFC7CE",
  "Title mismatch":                "EDEDED", // light grey
  "Variation: issue confirmed":    "C6EFCE", // green (same as used)
  "Variation: issue not listed":   "EDEDED", // grey
  "Variation: no variation data":  "FCE4D6", // orange
  "Variation: lookup failed":      "FFC7CE", // red
};

function applyFill(ws, cellAddr, rgbHex) {
  if (!ws[cellAddr]) return;
  ws[cellAddr].s = {
    fill: { patternType: "solid", fgColor: { rgb: rgbHex } },
  };
}

function buildWorkbook(results) {
  // ── Sheet 1: Summary ───────────────────────────────────────────────────────
  const summaryRows = results.map((r) => ({
    "Issue":               r.issue,
    "eBay Query Sent":     r.ebayQuery ?? "",
    "FMV ($)":             r.fmv != null ? parseFloat(r.fmv.toFixed(2)) : "",
    "Confidence":          r.confidence,
    "eBay Total":          r.ebayTotal,
    "Fetched":             r.counts.fetched,
    "Title Matched":       r.counts.matched,
    "Passed Filter":       r.counts.passed,
    "Var. Checked":        r.counts.variationChecked ?? 0,
    "Var. Confirmed":      r.counts.variationConfirmed ?? 0,
    "Used in Calc":        r.counts.used,
    "Trimmed":             r.counts.trimmed,
    "Blocked":             r.counts.blocked,
    "Title Mismatch":      r.counts.mismatch,
    "Formula":             r.formula,
  }));

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 45 }, // Issue
    { wch: 80 }, // eBay Query Sent
    { wch: 10 }, // FMV
    { wch: 12 }, // Confidence
    { wch: 11 }, // eBay Total
    { wch: 9  }, // Fetched
    { wch: 13 }, // Title Matched
    { wch: 13 }, // Passed Filter
    { wch: 13 }, // Var. Checked
    { wch: 14 }, // Var. Confirmed
    { wch: 12 }, // Used
    { wch: 9  }, // Trimmed
    { wch: 9  }, // Blocked
    { wch: 14 }, // Title Mismatch
    { wch: 120 }, // Formula
  ];

  // ── Sheet 2: Listings ──────────────────────────────────────────────────────
  // Sort each issue's listings: Used → Trimmed → Blocked → Mismatch, then by price.
  const STATUS_ORDER = {
    "Used in FMV":                  0,
    "Trimmed (low end)":            1,
    "Trimmed (high end)":           2,
    "Blocked: graded slab":         3,
    "Blocked: reprint / facsimile": 4,
    "Blocked: collected edition":   5,
    "Blocked: signed copy":         6,
    "Blocked: damaged / incomplete":7,
    "Blocked: lot listing":         8,
    "Blocked: year mismatch":       9,
    "Title mismatch":               10,
    "Insufficient data":            11,
  };

  const listingRows = [];
  for (const r of results) {
    const sorted = [...r.listings].sort((a, b) => {
      const orderDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      return orderDiff !== 0 ? orderDiff : a.price - b.price;
    });
    for (const l of sorted) {
      listingRows.push({
        "Issue":          r.issue,
        "Status":         l.status,
        "Price ($)":      l.price,
        "Title":          l.title,
        "URL":            l.url,
        "Variation Data": l.variationData ?? "",
      });
    }
  }

  const wsListings = XLSX.utils.json_to_sheet(listingRows);
  wsListings["!cols"] = [
    { wch: 45 }, // Issue
    { wch: 30 }, // Status
    { wch: 10 }, // Price
    { wch: 80 }, // Title
    { wch: 60 }, // URL
    { wch: 80 }, // Variation Data
  ];

  // Apply row fill colors based on status.
  listingRows.forEach((row, i) => {
    const excelRow = i + 2;
    const fill = STATUS_FILL[row["Status"]];
    if (fill) {
      ["A", "B", "C", "D", "E", "F"].forEach((col) => {
        applyFill(wsListings, `${col}${excelRow}`, fill);
      });
    }
  });

  // Bold headers.
  ["A1","B1","C1","D1","E1","F1"].forEach((addr) => {
    if (!wsListings[addr]) return;
    wsListings[addr].s = { font: { bold: true } };
  });
  ["A1","B1","C1","D1","E1","F1","G1","H1","I1","J1","K1","L1","M1","N1"].forEach((addr) => {
    if (!wsSummary[addr]) return;
    wsSummary[addr].s = { font: { bold: true } };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary,  "Summary");
  XLSX.utils.book_append_sheet(wb, wsListings, "Listings");
  return wb;
}

export default function ValuationTest() {
  const [text, setText] = useState(
    "Daredevil #230 (Marvel, 1986)\nAmazing Spider-Man #300 (Marvel, 1988)"
  );
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError]       = useState(null);
  const [summary, setSummary]   = useState(null);

  async function handleSearch() {
    const issues = text.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!issues.length) return;

    setLoading(true);
    setError(null);
    setSummary(null);
    setProgress({ done: 0, total: issues.length });

    try {
      // Fire in one request; show spinner with issue count.
      const res = await fetch("/api/valuation-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      setProgress({ done: data.results.length, total: issues.length });

      const wb = buildWorkbook(data.results);
      XLSX.writeFile(wb, "valuation-test.xlsx", { cellStyles: true });

      const withFMV    = data.results.filter((r) => r.fmv != null).length;
      const totalUsed  = data.results.reduce((s, r) => s + (r.counts?.used ?? 0), 0);
      setSummary({ total: data.results.length, withFMV, totalUsed });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Valuation Search — Test Page</h1>
      <p style={styles.sub}>
        Uses eBay <strong>active listing prices</strong> as a current-market-price proxy.
        Applies strict filtering, then a trimmed mean for FMV. Downloads an Excel workbook
        with a summary sheet and a full per-listing breakdown (with colour-coded status rows)
        so you can verify match quality manually.
      </p>

      <label style={styles.label}>Issues (one per line)</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        style={styles.textarea}
        placeholder={
          "Daredevil #230 (Marvel, 1986)\n" +
          "Amazing Spider-Man #300 (Marvel, 1988)\n" +
          "X-Men #94 (Marvel, 1975) Newsstand"
        }
      />

      <div style={styles.controls}>
        <button
          onClick={handleSearch}
          disabled={loading}
          style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
        >
          {loading
            ? progress
              ? `Searching ${progress.total} issue${progress.total > 1 ? "s" : ""}…`
              : "Searching…"
            : "Search & Download Excel"}
        </button>
        <span style={styles.note}>Max 50 issues · results include all 200 eBay listings per issue</span>
      </div>

      {error && <div style={styles.errorBox}>⚠ {error}</div>}

      {summary && (
        <div style={styles.successBox}>
          ✓ Done — FMV calculated for <strong>{summary.withFMV}</strong> of{" "}
          <strong>{summary.total}</strong> issues (
          <strong>{summary.totalUsed}</strong> listings used in calculations).{" "}
          Check <code>valuation-test.xlsx</code> in your downloads.
        </div>
      )}

      <div style={styles.legendBox}>
        <strong>Excel colour key (Listings sheet):</strong>
        <div style={styles.legendGrid}>
          {[
            ["C6EFCE", "Used in FMV calc (incl. variation confirmed)"],
            ["FFEB9C", "Trimmed (low or high end)"],
            ["FFC7CE", "Blocked (graded / reprint / lot / ratio variant / etc.) or variation lookup failed"],
            ["FCE4D6", "Variation: no variation data"],
            ["EDEDED", "Title mismatch · Variation: issue not listed"],
          ].map(([color, label]) => (
            <div key={color} style={styles.legendRow}>
              <span style={{ ...styles.swatch, background: `#${color}` }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={styles.filterBox}>
        <strong>Active filters:</strong>
        <ul style={styles.filterList}>
          <li>Query exclusions sent to eBay: <code>-lot -set -run -collection -bundle -wholesale -cgc -cbcs -pgx -facsimile -reprint -signed -omnibus -tpb</code></li>
          <li>Blocked post-fetch: grading agencies (CGC/CBCS/PGX), facsimile/reprint, omnibus/TPB/digest, signed/SS, coverless/damaged</li>
          <li>Blocked: listings with more than one issue number in the title (lot detection — grade decimals and ratio notation excluded from count)</li>
          <li>Blocked: ratio incentive variants (1:25, 1:100, etc.) unless the user's search explicitly includes a ratio</li>
          <li>Title mismatch: series name or issue number not found in listing title</li>
          <li>FMV: trimmed mean — drops 1 each end (n 3–9) or ~10% each end (n ≥ 10)</li>
        </ul>
      </div>
    </div>
  );
}

const styles = {
  page:         { padding: "2rem", maxWidth: "800px", margin: "0 auto", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" },
  heading:      { fontSize: "1.6rem", marginBottom: "0.25rem" },
  sub:          { color: "#555", marginBottom: "1.25rem", lineHeight: 1.5 },
  label:        { display: "block", fontWeight: 600, marginBottom: "0.4rem" },
  textarea:     { width: "100%", fontFamily: "monospace", fontSize: "13px", padding: "0.6rem", border: "2px solid #ccc", borderRadius: "4px", resize: "vertical", boxSizing: "border-box" },
  controls:     { display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" },
  button:       { padding: "0.55rem 1.75rem", fontSize: "1rem", fontWeight: 600, background: "#cc1f00", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" },
  buttonDisabled: { background: "#999", cursor: "not-allowed" },
  note:         { fontSize: "0.82rem", color: "#777" },
  errorBox:     { marginTop: "1rem", padding: "0.6rem 1rem", background: "#fff0f0", border: "1px solid #f5c6cb", borderRadius: "4px" },
  successBox:   { marginTop: "1rem", padding: "0.6rem 1rem", background: "#d4edda", border: "1px solid #a0c8a0", borderRadius: "4px", lineHeight: 1.6 },
  legendBox:    { marginTop: "2rem", padding: "1rem 1.25rem", background: "#fafafa", border: "1px solid #ddd", borderRadius: "4px", fontSize: "0.875rem" },
  legendGrid:   { marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" },
  legendRow:    { display: "flex", alignItems: "center", gap: "0.5rem" },
  swatch:       { display: "inline-block", width: "18px", height: "18px", borderRadius: "3px", border: "1px solid #ccc", flexShrink: 0 },
  filterBox:    { marginTop: "1.25rem", padding: "1rem 1.25rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: "4px", fontSize: "0.85rem" },
  filterList:   { marginTop: "0.5rem", paddingLeft: "1.25rem", lineHeight: 1.8 },
};
