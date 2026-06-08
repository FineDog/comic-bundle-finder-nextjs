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
//
// ⚠️  KNOWN GOLDEN RULE RISK: getMetronIssuesCached falls back to a live Metron
//   fetch on a Blob cache miss. This runs on Vercel's rotating IPs. In practice,
//   the 7-day TTL makes cache misses rare (only on first visit to a new series).
//   A full fix would pre-populate issue lists via GitHub Actions. Tracked as a
//   future improvement — do not add any other live Metron calls to this route.
//
// IMPORTANT — Blob operation budget:
//   All cache reads use plain fetch() to the public CDN URL (bandwidth only, not an
//   Advanced Operation).  put() is called on a cache miss — it is an Advanced Operation
//   but fires at most once per series slice per hour.  list() and head() are never used.

import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";
import { getEbayToken, searchEbay, aggregateRows } from "../../../../lib/ebay";
import { getSeriesConfig } from "../../../../lib/series-config";
import { getMetronIssuesCached, getBlobBaseUrl } from "../../../../lib/metron-issues";

const CONCURRENCY = 8;
const EBAY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Try to read a blob eBay cache entry by pathname.
// Returns { rows, cachedAt } on a fresh hit, or null on miss/stale/error.
async function readEbayCache(pathname) {
  const base = getBlobBaseUrl();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/${pathname}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.cachedAt || Date.now() - data.cachedAt > EBAY_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const { slug } = req.query;

  // POST: client uploads merged Wave 1+2 results to Blob cache (metron-* series only).
  if (req.method === "POST") {
    const metronMatch = /^metron-(\d+)$/.exec(slug);
    if (!metronMatch) return res.status(405).json({ error: "Cache write not supported for this series type." });
    const metronId = parseInt(metronMatch[1], 10);
    const { rows, startIdx, count } = req.body;
    if (!rows || startIdx == null || !count) return res.status(400).json({ error: "Missing rows, startIdx, or count." });
    const ebayBlobPathname = `dynamic-series/metron-${metronId}/ebay/${startIdx}-${count}.json`;
    try {
      await put(ebayBlobPathname, JSON.stringify({ rows, cachedAt: Date.now() }), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const startIdx = Math.max(0, parseInt(req.query.start || "0", 10));
  const count = Math.min(50, Math.max(1, parseInt(req.query.count || "50", 10)));
  const zip = req.query.zip || null;

  // ─── Dynamic series: metron-{id} ───────────────────────────────────────────
  const metronMatch = /^metron-(\d+)$/.exec(slug);
  if (metronMatch) {
    const metronId = parseInt(metronMatch[1], 10);

    // Fetch issue list (7-day Blob cache, CDN read only)
    let allIssues;
    try {
      allIssues = await getMetronIssuesCached(metronId);
    } catch (e) {
      return res.status(502).json({ error: `Could not fetch issues from Metron: ${e.message}` });
    }

    const batchIssues = allIssues.slice(startIdx, startIdx + count);
    if (!batchIssues.length) return res.status(400).json({ error: "No issues in that range." });

    // Try 1-hour Blob eBay cache (CDN read — no Advanced Operations)
    const ebayBlobPathname = `dynamic-series/metron-${metronId}/ebay/${startIdx}-${count}.json`;
    const ebayHit = await readEbayCache(ebayBlobPathname);
    if (ebayHit) {
      return res.status(200).json({
        results: ebayHit.rows,
        issueCount: batchIssues.length,
        startIdx,
        endIdx: startIdx + batchIssues.length - 1,
        totalIssues: allIssues.length,
        cachedAt: ebayHit.cachedAt,
      });
    }

    // Cache miss — live eBay fetch (Wave 1 only; client handles Wave 2 and will POST results back)
    const token = await getEbayToken();
    const issueListings = [];
    const totals = {};
    for (let i = 0; i < batchIssues.length; i += CONCURRENCY) {
      const batch = batchIssues.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((issue) => searchEbay(token, issue.issueName, 0, zip))
      );
      for (let j = 0; j < batch.length; j++) {
        issueListings.push({ issue: batch[j], listings: batchResults[j].items });
        totals[batch[j].issueName] = batchResults[j].total;
      }
    }

    const rows = aggregateRows(issueListings);
    const cachedAt = Date.now();

    // Do not write to Blob yet — client will POST back the complete (Wave 1 + Wave 2) results.
    return res.status(200).json({
      results: rows,
      totals,
      issues: batchIssues,
      issueCount: batchIssues.length,
      startIdx,
      endIdx: startIdx + batchIssues.length - 1,
      totalIssues: allIssues.length,
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
  const totals = {};
  if (staleIssues.length) {
    const token = await getEbayToken();
    for (let i = 0; i < staleIssues.length; i += CONCURRENCY) {
      const batch = staleIssues.slice(i, i + CONCURRENCY);
      const batchListings = await Promise.all(
        batch.map((issue) => searchEbay(token, issue.issueName, 0, zip))
      );
      for (let j = 0; j < batch.length; j++) {
        ebayResults.push({ issue: batch[j], listings: batchListings[j].items, cachedAt: Date.now() });
        totals[batch[j].issueName] = batchListings[j].total;
      }
    }
  }

  const issueListings = [...freshResults, ...ebayResults];
  const rows = aggregateRows(issueListings);
  const oldestCachedAt = Math.min(...issueListings.map((r) => r.cachedAt));

  return res.status(200).json({
    results: rows,
    totals: Object.keys(totals).length ? totals : undefined,
    issues: batchIssues,
    issueCount: batchIssues.length,
    startIdx,
    endIdx: startIdx + batchIssues.length - 1,
    totalIssues: allIssues.length,
    cachedAt: isFinite(oldestCachedAt) ? oldestCachedAt : null,
  });
}
