// Client-side eBay search orchestration. Handles the two-wave fetch sequence
// for getting complete results past eBay Browse API's 200-result-per-request cap.
//
// Usage:
//   import { runEbaySearch, mergeAndRecount, EBAY_PAGE_SIZE } from "../lib/ebay-search";
//   await runEbaySearch(issues, zip, {
//     onWave1(rows, totals) { /* render Wave 1 immediately */ },
//     onWave2Start()        { /* show loading indicator    */ },
//     onWave2(mergedRows)   { /* update with full results  */ },
//     onWave2End()          { /* hide loading indicator    */ },
//   });

export const EBAY_PAGE_SIZE = 200;

// Merge wave 2 rows into wave 1, deduplicated by URL, with bundle counts recomputed.
export function mergeAndRecount(rows1, rows2) {
  const urlSet = new Set(rows1.map(r => r.url));
  const merged = [...rows1];
  for (const r of rows2) {
    if (!urlSet.has(r.url)) {
      urlSet.add(r.url);
      merged.push(r);
    }
  }
  const sellerIssues = {};
  for (const r of merged) {
    if (!sellerIssues[r.seller]) sellerIssues[r.seller] = new Set();
    sellerIssues[r.seller].add(r.issue);
  }
  return merged.map(r => ({ ...r, bundle_count: sellerIssues[r.seller].size }));
}

// Run a full two-wave eBay search via /api/search.
// Wave 1 fetches the first 200 results per issue and returns immediately via onWave1.
// Wave 2 fetches any remaining results (when eBay total > 200) and calls onWave2 with
// the fully merged, deduplicated, recount rows.
export async function runEbaySearch(issues, zip, {
  onWave1,
  onWave2Start,
  onWave2,
  onWave2End,
} = {}) {
  // Wave 1
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issues, zip }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");

  onWave1?.(data.results, data.totals);

  // Build Wave 2 task list from per-issue totals
  const wave2Tasks = [];
  for (const [issue, total] of Object.entries(data.totals || {})) {
    for (let offset = EBAY_PAGE_SIZE; offset < total; offset += EBAY_PAGE_SIZE) {
      wave2Tasks.push({ issue, offset });
    }
  }

  if (wave2Tasks.length === 0) return data.results;

  onWave2Start?.();
  try {
    const res2 = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueOffsets: wave2Tasks, zip }),
    });
    const data2 = await res2.json();
    if (res2.ok && data2.results?.length) {
      const merged = mergeAndRecount(data.results, data2.results);
      onWave2?.(merged);
      onWave2End?.();
      return merged;
    }
  } catch {}
  onWave2End?.();
  return data.results;
}
