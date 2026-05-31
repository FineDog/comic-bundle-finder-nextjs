// GET /api/arc/[id]/issues
//
// Returns the formatted issue list for a Metron story arc, with a 24-hour
// Vercel Blob cache so Metron is only hit once per arc per day.
//
// This endpoint exists so the arc page can fetch issues client-side rather
// than in getStaticProps — avoiding Metron rate-limit errors during ISR
// generation (which shares the same credential quota as the nightly script).
//
// Cache reads use plain fetch() to the public CDN URL (bandwidth only, not
// an Advanced Operation). Only put() fires on a cache miss (Simple Operation).

import { put } from "@vercel/blob";
import { getBlobBaseUrl } from "../../../../lib/metron-issues";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  // Try Blob cache first (CDN read — no Advanced Operations)
  const blobPathname = `arc-issues/${arcId}.json`;
  const cached = await readBlobCache(blobPathname);
  if (cached) {
    return res.status(200).json({ issues: cached.issues, cachedAt: cached.cachedAt });
  }

  // Cache miss — fetch from Metron
  if (!process.env.METRON_USERNAME || !process.env.METRON_PASSWORD) {
    return res.status(503).json({ error: "Metron credentials not configured." });
  }

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "User-Agent": "ComicBundleFinder/1.0",
  };

  const allIssues = [];
  let nextUrl = `https://metron.cloud/api/arc/${arcId}/issue_list/?page_size=100`;

  while (nextUrl) {
    let issueRes;
    try {
      issueRes = await fetch(nextUrl, { headers });
    } catch {
      break;
    }
    if (!issueRes.ok) break;
    let issueData;
    try {
      issueData = await issueRes.json();
    } catch {
      break;
    }
    allIssues.push(...(issueData.results || []));
    nextUrl = issueData.next || null;
  }

  const issues = allIssues
    .map((issue) => {
      const series = issue.series?.name || "";
      const num = issue.number || "";
      if (!series || !num) return "";
      return `${series} #${num}`;
    })
    .filter(Boolean);

  const cachedAt = Date.now();

  // Write to Blob cache (Simple Operation — only fires on miss)
  try {
    await put(blobPathname, JSON.stringify({ issues, cachedAt }), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch {
    // Cache write failure is non-fatal
  }

  return res.status(200).json({ issues, cachedAt });
}
