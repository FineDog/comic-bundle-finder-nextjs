// GET /api/arc/[id]/issues
//
// Returns the cached issue list for a Metron story arc.
//
// *** IMPORTANT — NO LIVE METRON CALLS ***
// This endpoint is strictly cache-read-only. It never calls the Metron API.
// Arc issue lists are pre-populated nightly by scripts/refresh-arc-index.js
// running in GitHub Actions (single stable IP, rate-limit-aware).
//
// Calling Metron from Vercel serverless functions is prohibited because each
// invocation uses a different IP address, which Metron flags as a distributed
// attack and disables the account. See CLAUDE.md for full API rules.
//
// On cache miss, returns { issues: null, cached: false } — the arc page shows
// a "not yet indexed" message. Issues will be available after the next nightly run.

import { getBlobBaseUrl } from "../../../../lib/metron-issues";

const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h — nightly script refreshes every 24h

async function readBlobCache(pathname) {
  const base = getBlobBaseUrl();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/${pathname}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.cachedAt || Date.now() - data.cachedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const arcId = parseInt(req.query.id, 10);
  if (!arcId) return res.status(400).json({ error: "Invalid arc ID." });

  const cached = await readBlobCache(`arc-issues/${arcId}.json`);
  if (cached) {
    return res.status(200).json({ issues: cached.issues, cachedAt: cached.cachedAt });
  }

  // Cache miss — nightly script hasn't run yet or arc has no issues in Metron
  return res.status(200).json({ issues: null, cached: false });
}
