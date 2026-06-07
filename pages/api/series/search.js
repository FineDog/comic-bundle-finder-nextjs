// GET /api/series/search?q=<query>[&full=1]
//
// Searches the static series index (public/data/series-index.json) built
// nightly by scripts/refresh-series-index.js. No live Metron calls.
//
// Response format matches the previous Metron-backed implementation so
// existing callers don't break during transition. The collection-guides
// page now does client-side search against the JSON directly (no API call),
// but this route is kept as a lightweight fallback.

import fs from "fs";
import path from "path";

let seriesIndexCache = null;
function loadSeriesIndex() {
  if (seriesIndexCache) return seriesIndexCache;
  try {
    seriesIndexCache = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public", "data", "series-index.json"), "utf-8")
    );
  } catch {
    seriesIndexCache = [];
  }
  return seriesIndexCache;
}

export default function handler(req, res) {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }

  const index = loadSeriesIndex();
  const matches = index.filter((s) => s.name.toLowerCase().includes(q));

  return res.json({
    count: matches.length,
    results: matches.map((s) => ({
      id: s.id,
      name: s.name,
      issueCount: s.issueCount,
      yearBegan: s.name.match(/\((\d{4})\)\s*$/)?.[1]
        ? parseInt(s.name.match(/\((\d{4})\)\s*$/)[1])
        : null,
    })),
  });
}
