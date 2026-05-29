// GET /api/series/[slug]/results?start=0&count=50
//
// Returns eBay bundle results for a slice of a series.
//
// For locally-configured series (slug in SERIES registry):
//   Reads from a static nightly cache file (data/cache/{slug}.json), falling back
//   to a live eBay fetch for any issues not yet cached.
//
// For dynamic series (slug = "metron-{id}"):
//   Fetches the issue list from Metron via getMetronIssuesCached (7-day Blob TTL),
//   then fetches eBay results live with a 1-hour Blob cache keyed by start+count.

import fs from "fs";
import path from "path";
import { list, put } from "@vercel/blob";
import { getEbayToken, searchEbay, aggregateRows } from "../../../../lib/ebay";
import { getSeriesConfig } from "../../../../lib/series-config";
import { getMetronIssuesCached } from "../../../../lib/metron-issues";

const CONCURRENCY = 8;
const EBAY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const { slug } = req.query;
  const startIdx = Math.max(0, parseInt(req.query.start || "0", 10));
  const count = Math.min(50, Math.max(1, parseInt(req.query.count || "50", 10)));

  // ─── Dynamic series: metron-{id} ───────────────────────────────────────────
  const metronMatch = /^metron-(\d+)$/.exec(slug);
  if (metronMatch) {
    const metronId = parseInt(metronMatch[1], 10);

    // Fetch issue list (7-day Blob cache via getMetronIssuesCached)
    let allIssues;
    try {
      allIssues = await getMetronIssuesCached(metronId);
    } catch (e) {
      return res.status(502).json({ error: `Could not fetch issues from Metron: ${e.message}` });
    }

    const batchIssues = allIssues.slice(startIdx, startIdx + count);
    if (!batchIssues.length) return res.status(400).json({ error: "No issues in that range." });

    // Try 1-hour Blob eBay cache
    const ebayBlobKey = `dynamic-series/metron-${metronId}/ebay/${startIdx}-${count}.json`;
    try {
      const { blobs } = await list({ prefix: `dynamic-series/metron-${metronId}/ebay/${startIdx}-${count}.json` });
      if (blobs.length > 0) {
        const blob = blobs[0];
        const age = Date.now() - new Date(blob.uploadedAt).getTime();
        if (age < EBAY_CACHE_TTL_MS) {
          const r = await fetch(blob.url, { cache: "no-store" });
          if (r.ok) {
            const cached = await r.json();
            return res.status(200).json({
              results: cached.rows,
              issueCount: batchIssues.length,
              startIdx,
              endIdx: startIdx + batchIssues.length - 1,
              totalIssues: allIssues.length,
              cachedAt: cached.cachedAt,
            });
          }
        }
      }
    } catch {
      // Cache miss — fall through to live fetch
    }

    // Live eBay fetch
    const token = await getEbayToken();
    const issueListings = [];
    for (let i = 0; i < batchIssues.length; i += CONCURRENCY) {
      const batch = batchIssues.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((issue) => searchEbay(token, issue.issueName))
      );
      for (let j = 0; j < batch.length; j++) {
        issueListings.push({ issue: batch[j], listings: batchResults[j] });
      }
    }

    const rows = aggregateRows(issueListings);
    const cachedAt = Date.now();

    // Write to Blob cache (non-blocking on failure)
    try {
      await put(ebayBlobKey, JSON.stringify({ rows, cachedAt }), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });
    } catch {
      // Cache write failure is non-fatal
    }

    return res.status(200).json({
      results: rows,
      issueCount: batchIssues.length,
      startIdx,
      endIdx: startIdx + batchIssues.length - 1,
      totalIssues: allIssues.length,
      cachedAt,
    });
  }

  // ─── Locally configured series ─────────────────────────────────────────────
  const config = getSeriesConfig(slug);
  if (!config) return res.status(404).json({ error: `Series "${slug}" not found.` });

  const allIssues = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", config.dataFile), "utf-8")
  );

  const batchIssues = allIssues.slice(startIdx, startIdx + count);
  if (!batchIssues.length) return res.status(400).json({ error: "No issues in that range." });

  // Read the static cache file. Written nightly by GitHub Actions; any issue
  // present here is considered fresh (the whole file is replaced each night).
  let cache = null;
  try {
    cache = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "cache", `${slug}.json`), "utf-8")
    );
  } catch {
    // Cache not yet available — all issues will fall back to live eBay.
  }

  const freshResults = [];
  const staleIssues = [];

  for (const issue of batchIssues) {
    const listings = cache?.issues?.[issue.number];
    if (listings !== undefined) {
      freshResults.push({ issue, listings, cachedAt: cache.cachedAt });
    } else {
      staleIssues.push(issue);
    }
  }

  // Fetch any missing issues live from eBay.
  const ebayResults = [];
  if (staleIssues.length) {
    const token = await getEbayToken();
    for (let i = 0; i < staleIssues.length; i += CONCURRENCY) {
      const batch = staleIssues.slice(i, i + CONCURRENCY);
      const batchListings = await Promise.all(
        batch.map((issue) => searchEbay(token, issue.issueName))
      );
      for (let j = 0; j < batch.length; j++) {
        ebayResults.push({ issue: batch[j], listings: batchListings[j], cachedAt: Date.now() });
      }
    }
  }

  const issueListings = [...freshResults, ...ebayResults];
  const rows = aggregateRows(issueListings);
  const oldestCachedAt = Math.min(...issueListings.map((r) => r.cachedAt));

  return res.status(200).json({
    results: rows,
    issueCount: batchIssues.length,
    startIdx,
    endIdx: startIdx + batchIssues.length - 1,
    totalIssues: allIssues.length,
    cachedAt: isFinite(oldestCachedAt) ? oldestCachedAt : null,
  });
}
