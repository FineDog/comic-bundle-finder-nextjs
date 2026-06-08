// lib/metron-issues.js
// Fetches all issues for a Metron series by ID, with Vercel Blob caching (7-day TTL).
// Used by the series page (getStaticProps) and the results API route.
//
// IMPORTANT — Blob operation budget:
//   We intentionally avoid list() and head().  Cache reads use a plain fetch() to the
//   public CDN URL (bandwidth only, not an Advanced Operation).  Writes use put(), which
//   is an Advanced Operation but fires at most once per series per 7 days — low volume.

import { put } from "@vercel/blob";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function metronAuth() {
  return Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
}

// User-Agent is required by Metron ToS. Do NOT use a browser UA or omit this header.
function metronHeaders() {
  return {
    Authorization: `Basic ${metronAuth()}`,
    "User-Agent": "ComicBundleFinder/1.0",
  };
}

// Derive the Vercel Blob store's public CDN base URL from BLOB_READ_WRITE_TOKEN.
// Token format: vercel_blob_rw_{storeId}_{secret}
// Public base:  https://{storeId}.public.blob.vercel-storage.com
// Returns null if the token is absent or doesn't match the expected format.
export function getBlobBaseUrl() {
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const m = /vercel_blob_rw_([^_]+)_/.exec(token);
  return m ? `https://${m[1]}.public.blob.vercel-storage.com` : null;
}

// Read a blob cache entry via direct CDN fetch (no SDK, no Advanced Operations).
// Cached blobs must contain a top-level `cachedAt` timestamp for TTL checking.
// Returns the parsed JSON object on a fresh hit, or null on miss / stale / error.
async function readBlobCache(pathname, ttlMs) {
  const base = getBlobBaseUrl();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/${pathname}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.cachedAt || Date.now() - data.cachedAt > ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

// Fetch all issues for a Metron series, paginating through all pages.
// Returns [{ number: string, issueName: string }].
export async function fetchMetronIssues(metronId) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://metron.cloud/api/issue/?series_id=${metronId}&page_size=100&page=${page}`,
      { headers: metronHeaders() }
    );
    if (!res.ok) throw new Error(`Metron returned ${res.status} for series ${metronId}`);
    const data = await res.json();
    for (const issue of data.results || []) {
      all.push({ number: issue.number, issueName: issue.issue });
    }
    if (!data.next) break;
    page++;
  }
  return all;
}

// Fetch Metron series metadata by ID.
// Returns the raw Metron series object, or null on failure.
export async function fetchMetronSeriesMeta(metronId) {
  const res = await fetch(
    `https://metron.cloud/api/series/${metronId}/`,
    { headers: metronHeaders() }
  );
  if (!res.ok) return null;
  return await res.json();
}

// Gets the issue list for a Metron series, using Blob cache.
// Cache key: dynamic-series/metron-{id}/issues.json (TTL: 7 days).
// Cache format: { issues: [...], cachedAt: <epoch ms> }
// Falls back to live Metron fetch on miss or stale cache.
export async function getMetronIssuesCached(metronId) {
  const pathname = `dynamic-series/metron-${metronId}/issues.json`;

  // Try the CDN cache (plain fetch, not a Blob API call)
  const cached = await readBlobCache(pathname, CACHE_TTL_MS);
  if (cached) return cached.issues;

  // Cache miss — fetch fresh from Metron
  const issues = await fetchMetronIssues(metronId);

  // Write to Blob (Simple Operation — only fires on miss)
  try {
    await put(pathname, JSON.stringify({ issues, cachedAt: Date.now() }), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch {
    // Cache write failure is non-fatal
  }

  return issues;
}
