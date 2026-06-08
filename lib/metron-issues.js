// lib/metron-issues.js
// Reads series issue lists from Vercel Blob cache.
//
// Blob entries are written EXCLUSIVELY by scripts/refresh-series-issues.js running
// via GitHub Actions (stable IP). This file NEVER calls the Metron API — doing so
// from Vercel's rotating serverless IPs violates Metron's ToS and risks account suspension.
//
// On a Blob cache miss, getMetronIssuesCached returns null. The API route shows a
// "not yet indexed" message. The nightly GitHub Actions job will populate the cache.
//
// IMPORTANT — Blob operation budget:
//   Cache reads use a plain fetch() to the public CDN URL (bandwidth only, not an
//   Advanced Operation). list() and head() are never used.

// 30-day TTL: the nightly GHA job keeps entries fresh. This generous window ensures
// users continue to see results even if the job is down for a few days.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

// ── Script-only functions ─────────────────────────────────────────────────────
// The functions below call the Metron API directly.
// ⚠️  DO NOT CALL FROM VERCEL (pages/api/*, getServerSideProps, client code).
//     They are exported for use ONLY in scripts/ run by GitHub Actions (stable IP).
//     Calling Metron from Vercel's rotating IPs violates ToS and can suspend the account.

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

// ── Vercel-safe cache reader ──────────────────────────────────────────────────

// Returns the cached issue list for a series, or null if not yet indexed.
// Reads from Blob CDN only — NEVER calls Metron. Blob entries are written by
// scripts/refresh-series-issues.js (GitHub Actions). If null is returned, the
// caller should show a "not yet indexed" message rather than calling Metron.
// Cache format: { issues: [...], cachedAt: <epoch ms>, modified: <string|null> }
export async function getMetronIssuesCached(metronId) {
  const pathname = `dynamic-series/metron-${metronId}/issues.json`;
  const cached = await readBlobCache(pathname, CACHE_TTL_MS);
  return cached ? cached.issues : null;
}
