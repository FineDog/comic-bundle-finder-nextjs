// Shared helpers for the segmented sitemap routes (sitemap.xml + children).
//
// All sitemaps read from the static JSON indexes in public/data — never from a
// live Metron call (see the Metron golden rule). Files are parsed once per
// serverless instance and cached at the module level.

import fs from "fs";
import path from "path";

export const BASE_URL = "https://www.comicbundlefinder.com";

// A bundle needs at least two matching issues, so a 1-issue series or arc page
// can never produce a result. Excluding them keeps thin pages out of the index
// and focuses crawl budget on pages that can actually rank.
export const MIN_ISSUES = 2;

// Series sitemap chunk size. The sitemap protocol caps a single file at 50,000
// URLs; chunking well under that keeps each file small and future-proofs growth.
export const SERIES_CHUNK_SIZE = 10000;

function loadJson(file) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public", "data", file), "utf-8")
    );
  } catch {
    return [];
  }
}

let arcsCache = null;
export function getSitemapArcs() {
  if (arcsCache) return arcsCache;
  const arcs = loadJson("arc-index.json");
  arcsCache = arcs.filter((a) => a.slug && (a.issueCount || 0) >= MIN_ISSUES);
  return arcsCache;
}

let seriesCache = null;
export function getSitemapSeries() {
  if (seriesCache) return seriesCache;
  const series = loadJson("series-index.json");
  seriesCache = series.filter((s) => s.id && (s.issueCount || 0) >= MIN_ISSUES);
  return seriesCache;
}

export function seriesChunkCount() {
  return Math.max(1, Math.ceil(getSitemapSeries().length / SERIES_CHUNK_SIZE));
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Build a <urlset> document from { loc, changefreq, priority } entries.
export function buildUrlSet(entries) {
  const urls = entries
    .map((e) => {
      const parts = [`    <loc>${xmlEscape(e.loc)}</loc>`];
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority != null) parts.push(`    <priority>${e.priority}</priority>`);
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

// Build a <sitemapindex> document from child sitemap URLs.
export function buildSitemapIndex(locs) {
  const items = locs
    .map((loc) => `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}

// Sitemaps are large and change at most daily — cache hard at the CDN so crawler
// hits don't re-read and re-serialize the JSON indexes on every request.
export function sendSitemap(res, xml) {
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=43200");
  res.write(xml);
  res.end();
}
