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
// Arc issue lists are static (arcs don't change once created), so there is no
// TTL — entries written by the nightly script are served indefinitely.
// On cache miss, returns { issues: null, cached: false } — the arc page shows
// a "not yet indexed" message. Issues appear after the next nightly run.

import { getBlobBaseUrl } from "../../../../lib/metron-issues";

// Arc issue lists are essentially static — once written by the nightly script,
// they never expire. No TTL check: if the entry exists in Blob, serve it.
async function readBlobCache(pathname) {
  const base = getBlobBaseUrl();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/${pathname}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
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
