// lib/metron-issues.js
// Reads series issue lists from Postgres (series_issues table).
//
// Rows are written EXCLUSIVELY by scripts/refresh-series-issues.js running
// via GitHub Actions (stable IP). This file NEVER calls the Metron API — doing so
// from Vercel's rotating serverless IPs violates Metron's ToS and risks account suspension.
//
// On a cache miss, getMetronIssuesCached returns null. The API route shows a
// "not yet indexed" message. The nightly GitHub Actions job will populate the table.
//
// WHY POSTGRES, NOT VERCEL BLOB: every Blob put() is an Advanced Operation
// (2,000/month budget). The ~16k-series backfill alone would be 8x the budget.
// Postgres reads/writes are free and the database is already provisioned.

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

// Lazy, memoized pg Pool. `pg` is imported dynamically so this module stays safe
// to import from page files — the client bundle never pulls in the driver.
// max: 1 because each serverless invocation handles one request at a time.
let _pool = null;
async function getPool() {
  if (!_pool) {
    const { Pool } = await import("pg");
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  }
  return _pool;
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
// Reads from Postgres only — NEVER calls Metron. Rows are written by
// scripts/refresh-series-issues.js (GitHub Actions). If null is returned, the
// caller should show a "not yet indexed" message rather than calling Metron.
// Row format: { issues: jsonb [...], modified: text|null, cached_at: timestamptz }
export async function getMetronIssuesCached(metronId) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      "SELECT issues, cached_at FROM series_issues WHERE metron_id = $1",
      [Number(metronId)]
    );
    if (!rows.length) return null;
    if (Date.now() - new Date(rows[0].cached_at).getTime() > CACHE_TTL_MS) return null;
    return rows[0].issues;
  } catch {
    return null;
  }
}
