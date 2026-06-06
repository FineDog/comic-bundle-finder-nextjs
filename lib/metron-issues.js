// Blob-cache helpers for Metron series data.
// Live Metron API calls are ONLY allowed from getStaticProps (ISR) — never from API routes.

const SERIES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getBlobBaseUrl() {
  if (process.env.BLOB_BASE_URL) return process.env.BLOB_BASE_URL.replace(/\/$/, "");
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const match = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  if (match) return `https://${match[1]}.public.blob.vercel-storage.com`;
  return null;
}

// Read the issue list for a Metron series from the 7-day Blob cache.
// Throws if the cache is missing or stale — callers in API routes should return 502.
// Writing to the cache only happens from getStaticProps (via the series page ISR rebuild).
export async function getMetronIssuesCached(metronId) {
  const base = getBlobBaseUrl();
  if (!base) throw new Error("Blob base URL not configured (BLOB_READ_WRITE_TOKEN missing).");

  const url = `${base}/dynamic-series/metron-${metronId}/issues.json`;
  let r;
  try {
    r = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new Error(`Could not reach Blob cache: ${e.message}`);
  }

  if (!r.ok) {
    throw new Error(
      `Issue list not yet cached for series ${metronId}. Visit the series page to trigger a cache build.`
    );
  }

  const data = await r.json();
  if (!data.cachedAt || Date.now() - data.cachedAt > SERIES_CACHE_TTL_MS) {
    throw new Error(
      `Cached issue list for series ${metronId} is stale. Visit the series page to trigger a refresh.`
    );
  }

  return data.issues;
}
