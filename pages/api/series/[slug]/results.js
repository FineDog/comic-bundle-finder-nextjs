// GET /api/series/[slug]/results?start=0&count=10
//
// Returns eBay bundle results for a slice of any registered series.
// Per-issue results are cached in Vercel Blob for 24 hours. Stale or
// missing issues are fetched live from eBay and stored before responding.

import fs from "fs";
import path from "path";
import { list, put } from "@vercel/blob";
import { getEbayToken, searchEbay, aggregateRows } from "../../../../lib/ebay";
import { getSeriesConfig } from "../../../../lib/series-config";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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

  // One list() call fetches metadata for all cached blobs in this series.
  const { blobs } = await list({ prefix: config.blobPrefix });
  const blobMap = {};
  for (const blob of blobs) {
    const num = blob.pathname.match(/issue-(.+)\.json$/)?.[1];
    if (num) blobMap[num] = { url: blob.url, uploadedAt: new Date(blob.uploadedAt).getTime() };
  }

  const now = Date.now();
  const freshIssues = [];
  const staleIssues = [];

  for (const issue of batchIssues) {
    const entry = blobMap[issue.number];
    if (entry && now - entry.uploadedAt < CACHE_TTL_MS) {
      freshIssues.push({ issue, url: entry.url, cachedAt: entry.uploadedAt });
    } else {
      staleIssues.push(issue);
    }
  }

  // Fetch fresh blobs in parallel.
  const freshResults = await Promise.all(
    freshIssues.map(async ({ issue, url, cachedAt }) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const data = await r.json();
        return { issue, listings: data.listings, cachedAt };
      } catch {
        return null;
      }
    })
  );

  // Any blobs that failed to fetch fall back to eBay.
  const blobFailures = freshIssues
    .filter((_, i) => freshResults[i] === null)
    .map(({ issue }) => issue);
  const staleAll = [...staleIssues, ...blobFailures];

  // Fetch stale/missing issues from eBay.
  const ebayResults = [];
  if (staleAll.length) {
    const token = await getEbayToken();
    for (let i = 0; i < staleAll.length; i += CONCURRENCY) {
      const batch = staleAll.slice(i, i + CONCURRENCY);
      const batchListings = await Promise.all(
        batch.map((issue) => searchEbay(token, issue.issueName))
      );
      for (let j = 0; j < batch.length; j++) {
        const issue = batch[j];
        const listings = batchListings[j];
        ebayResults.push({ issue, listings, cachedAt: now });
        // Store in Blob for future requests (fire-and-forget).
        put(
          `${config.blobPrefix}${issue.number}.json`,
          JSON.stringify({ issueName: issue.issueName, listings }),
          { access: "public", addRandomSuffix: false, contentType: "application/json" }
        ).catch(() => {});
      }
    }
  }

  const issueListings = [
    ...freshResults.filter(Boolean),
    ...ebayResults,
  ];

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
