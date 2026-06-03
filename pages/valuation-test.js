// Valuation search test page — NOT for production use.
// Paste issue names (one per line), click Search, get an Excel file back.
// Each row: Issue | Listing Title | Price (USD) | Date Sold | eBay URL

import { useState } from "react";
import * as XLSX from "xlsx";

export default function ValuationTest() {
  const [text, setText] = useState(
    "Daredevil #230 (Marvel, 1986)\nAmazing Spider-Man #300 (Marvel, 1988)"
  );
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  async function handleSearch() {
    const issues = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!issues.length) return;

    setLoading(true);
    setStatus(`Searching ${issues.length} issue${issues.length > 1 ? "s" : ""}…`);
    setSummary(null);

    try {
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
      const rows = [];

      for (const result of data.results) {
        if (result.error) {
          rows.push({
            Issue: result.issue,
            "eBay Total": result.total ?? 0,
            "Passed Filter": 0,
            Title: `ERROR: ${result.error}`,
            "Price (USD)": "",
            "Date Sold": "",
            URL: "",
          });
        } else if (result.items.length === 0) {
          rows.push({
            Issue: result.issue,
            "eBay Total": result.total,
            "Passed Filter": 0,
            Title: "(no results after filtering)",
            "Price (USD)": "",
            "Date Sold": "",
            URL: "",
          });
        } else {
          for (const listing of result.items) {
            rows.push({
              Issue: result.issue,
              "eBay Total": result.total,
              "Passed Filter": result.items.length,
              Title: listing.title,
              "Price (USD)": listing.price,
              "Date Sold": listing.dateSold
                ? new Date(listing.dateSold).toLocaleDateString()
                : "",
              URL: listing.url,
            });
          }
        }
      }

      // Build workbook
      const ws = XLSX.utils.json_to_sheet(rows);

      // Widen columns for readability
      ws["!cols"] = [
        { wch: 40 }, // Issue
        { wch: 10 }, // eBay Total
        { wch: 13 }, // Passed Filter
        { wch: 80 }, // Title
        { wch: 12 }, // Price
        { wch: 12 }, // Date Sold
        { wch: 60 }, // URL
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sold Listings");
      XLSX.writeFile(wb, "valuation-test.xlsx");

      const withResults = data.results.filter((r) => r.items?.length > 0).length;
      setSummary({
        total: data.results.length,
        withResults,
        totalListings: rows.filter((r) => r["Price (USD)"] !== "").length,
      });
      setStatus(null);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Valuation Search — Test Page</h1>
      <p style={styles.sub}>
        Searches eBay <strong>sold listings</strong> (last 90 days) with strict
        filtering: no graded slabs, no reprints/facsimiles, no lots, no signed copies.
        Downloads an Excel file so you can verify match quality manually.
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
          {loading ? "Searching…" : "Search & Download Excel"}
        </button>
        <span style={styles.note}>Max 50 issues per search</span>
      </div>

      {status && <p style={styles.status}>{status}</p>}

      {summary && (
        <div style={styles.summary}>
          ✓ Done —{" "}
          <strong>{summary.withResults}</strong> of{" "}
          <strong>{summary.total}</strong> issues returned results (
          <strong>{summary.totalListings}</strong> total listings after filtering).{" "}
          Check <code>valuation-test.xlsx</code> in your downloads.
        </div>
      )}

      <div style={styles.filterBox}>
        <strong>Active filters in this search:</strong>
        <ul style={styles.filterList}>
          <li>Query exclusions: <code>-lot -set -run -collection -bundle -wholesale -cgc -cbcs -pgx -facsimile -reprint -signed -omnibus -tpb</code></li>
          <li>Post-fetch blocklist: grading agencies (CGC/CBCS/PGX), facsimile editions, reprints, omnibus/TPB/digest, signed/autographed, coverless/incomplete/damaged</li>
          <li>Lot detection: listings with more than one issue number in title are excluded</li>
          <li>Year anchoring: if query includes a year in parens, listings with a conflicting year are excluded</li>
          <li>Standard title matching: series name, issue number, volume, and any metadata filters (e.g. "Newsstand") must match</li>
        </ul>
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: "2rem",
    maxWidth: "760px",
    margin: "0 auto",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  heading: {
    fontSize: "1.6rem",
    marginBottom: "0.25rem",
  },
  sub: {
    color: "#555",
    marginBottom: "1.25rem",
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontWeight: 600,
    marginBottom: "0.4rem",
  },
  textarea: {
    width: "100%",
    fontFamily: "monospace",
    fontSize: "13px",
    padding: "0.6rem",
    border: "2px solid #ccc",
    borderRadius: "4px",
    resize: "vertical",
    boxSizing: "border-box",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginTop: "0.75rem",
  },
  button: {
    padding: "0.55rem 1.75rem",
    fontSize: "1rem",
    fontWeight: 600,
    background: "#cc1f00",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
  buttonDisabled: {
    background: "#999",
    cursor: "not-allowed",
  },
  note: {
    fontSize: "0.85rem",
    color: "#777",
  },
  status: {
    marginTop: "1rem",
    padding: "0.6rem 1rem",
    background: "#fff3cd",
    border: "1px solid #f0c040",
    borderRadius: "4px",
  },
  summary: {
    marginTop: "1rem",
    padding: "0.6rem 1rem",
    background: "#d4edda",
    border: "1px solid #a0c8a0",
    borderRadius: "4px",
    lineHeight: 1.6,
  },
  filterBox: {
    marginTop: "2rem",
    padding: "1rem 1.25rem",
    background: "#f5f5f5",
    border: "1px solid #ddd",
    borderRadius: "4px",
    fontSize: "0.85rem",
  },
  filterList: {
    marginTop: "0.5rem",
    paddingLeft: "1.25rem",
    lineHeight: 1.8,
  },
};
