// lib/metron-issues.js
// Fetches all issues for a Metron series by ID, with Vercel Blob caching (7-day TTL).
// Used by the series page (getStaticProps) and the results API route.

import { list, put } from "@vercel/blob";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function metronAuth() {
  return Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
}

// Fetch all issues for a Metron series, paginating through all pages.
// Returns [{ number: string, issueName: string }].
export async function fetchMetronIssues(metronId) {
  const auth = metronAuth();
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://metron.cloud/api/issue/?series_id=${metronId}&page_size=100&page=${page}`,
      { headers: { Authorization: `Basic ${auth}` } }
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
  const auth = metronAuth();
  const res = await fetch(
    `https://metron.cloud/api/series/${metronId}/`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) return null;
  return await res.json();
}

// Gets the issue list for a Metron series, using Blob cache.
// Cache key: dynamic-series/metron-{id}/issues.json (TTL: 7 days).
// Falls back to live Metron fetch on miss or stale cache.
export async function getMetronIssuesCached(metronId) {
  const blobPathname = `dynamic-series/metron-${metronId}/issues.json`;

  // Try Blob cache first
  try {
    const { blobs } = await list({ prefix: `dynamic-series/metron-${metronId}/issues` });
    if (blobs.length > 0) {
      const blob = blobs[0];
      const age = Date.now() - new Date(blob.uploadedAt).getTime();
      if (age < CACHE_TTL_MS) {
        const r = await fetch(blob.url, { cache: "no-store" });
        if (r.ok) return await r.json();
      }
    }
  } catch {
    // Cache miss — fall through to Metron
  }

  // Fetch fresh from Metron
  const issues = await fetchMetronIssues(metronId);

  // Write to Blob (non-blocking on failure)
  try {
    await put(blobPathname, JSON.stringify(issues), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch {
    // Cache write failure is non-fatal
  }

  return issues;
}
