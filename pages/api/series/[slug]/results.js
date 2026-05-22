// GET /api/series/[slug]/results?start=0&count=10
//
// Returns eBay bundle results for a slice of any registered series.
// Listings are read from a static JSON cache file written nightly by GitHub
// Actions (data/cache/{slug}.json). Any issues missing from the cache fall
// back to a live eBay fetch.

import fs from "fs";
import path from "path";
import { getEbayToken, searchEbay, aggregateRows } from "../../../../lib/ebay";
import { getSeriesConfig } from "../../../../lib/series-config";

const CONCURRENCY = 8;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const { slug } = req.query;
  const config = getSeriesConfig(slug);
  if (!config) return res.status(404).json({ error: `Series "${slug}" not found.` });

  const allIssues = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", config.dataFile), "utf-8")
  );

  const startIdx = Math.max(0, parseInt(req.query.start || "0", 10));
  const count = Math.min(20, Math.max(1, parseInt(req.query.count || "10", 10)));
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
