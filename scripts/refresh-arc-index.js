// Fetches all story arcs from the Metron API, writes public/data/arc-index.json,
// and pre-populates the Vercel Blob cache with each arc's issue list.
//
// Run nightly via GitHub Actions. Also runnable manually:
//   METRON_USERNAME=x METRON_PASSWORD=y BLOB_READ_WRITE_TOKEN=z node scripts/refresh-arc-index.js
//
// Output format (arc-index.json):
//   [{ "id": 123, "name": "Brand New Day", "slug": "123-brand-new-day", "issueCount": 12 }, ...]
//
// Blob cache (arc-issues/{id}.json, read by /api/arc/[id]/issues):
//   { "issues": ["Series #N", ...], "cachedAt": <epoch ms> }
//
// ─── Metron API rules (DO NOT VIOLATE) ───────────────────────────────────────
//   Rate limits:  20 requests/minute  ·  5,000 requests/day
//   Concurrency:  Sequential only — NO parallel requests from this script.
//   Delay:        REQUEST_DELAY_MS between every Metron request (default 3500ms
//                 = ~17 req/min, safely under the 20/min burst limit).
//   Headers:      Check X-RateLimit-Remaining before each request; pause if low.
//   Retries:      Only on HTTP 429 (honour Retry-After header) or 5xx.
//                 Never retry 4xx errors other than 429.
//   Source:       https://metron-project.github.io/blog/api-best-practices
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { put } from "@vercel/blob";

const USERNAME = process.env.METRON_USERNAME;
const PASSWORD = process.env.METRON_PASSWORD;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!USERNAME || !PASSWORD) {
  console.error("METRON_USERNAME and METRON_PASSWORD must be set.");
  process.exit(1);
}

if (!BLOB_TOKEN) {
  console.warn("Warning: BLOB_READ_WRITE_TOKEN not set — Blob cache will not be written.");
}

const AUTH = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  Accept: "application/json",
  "User-Agent": "ComicBundleFinder/1.0",
};

// 3.5 seconds between requests ≈ 17 req/min (under the 20/min burst limit)
const REQUEST_DELAY_MS = 3500;
// Pause this long if X-RateLimit-Remaining is critically low
const RATE_LIMIT_PAUSE_MS = 65000;
// How many remaining requests triggers a precautionary pause
const RATE_LIMIT_LOW_THRESHOLD = 3;

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wraps fetch with:
//   - 3-retry logic on 429 (honours Retry-After) or 5xx
//   - Proactive rate-limit header check
//   - REQUEST_DELAY_MS wait after each successful response
// Returns the Response, or null on permanent failure.
async function metronFetch(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
      console.log(`\n  429 rate limited. Waiting ${retryAfter}s (attempt ${attempt}/3)...`);
      await sleep(retryAfter * 1000 + 1000);
      continue;
    }

    if (res.status >= 500) {
      console.log(`\n  ${res.status} server error. Waiting 10s (attempt ${attempt}/3)...`);
      await sleep(10000);
      continue;
    }

    // Check remaining quota proactively — pause if critically low
    const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") ?? "999", 10);
    if (remaining <= RATE_LIMIT_LOW_THRESHOLD) {
      console.log(`\n  Rate limit low (${remaining} remaining). Pausing ${RATE_LIMIT_PAUSE_MS / 1000}s...`);
      await sleep(RATE_LIMIT_PAUSE_MS);
    }

    // Polite delay after every successful Metron response
    await sleep(REQUEST_DELAY_MS);
    return res;
  }
  return null; // exhausted retries
}

// Write a single arc's issue list to Vercel Blob.
// Blob key: arc-issues/{arcId}.json
// Format:   { issues: ["Batman #492", ...], cachedAt: <epoch ms> }
async function writeBlobCache(arcId, issues) {
  if (!BLOB_TOKEN) return; // no-op if token not available
  try {
    await put(
      `arc-issues/${arcId}.json`,
      JSON.stringify({ issues, cachedAt: Date.now() }),
      { access: "public", addRandomSuffix: false, contentType: "application/json" }
    );
  } catch (e) {
    console.warn(`\n  Blob write failed for arc ${arcId}: ${e.message}`);
  }
}

// ── Load existing data ────────────────────────────────────────────────────────
const outDir = join(process.cwd(), "public", "data");
const outPath = join(outDir, "arc-index.json");

/** @type {Map<number, { issueCount: number, modified: string }>} */
const existing = new Map();
try {
  for (const arc of JSON.parse(readFileSync(outPath, "utf-8"))) {
    existing.set(arc.id, { issueCount: arc.issueCount || 0, modified: arc.modified || "" });
  }
  console.log(`Loaded ${existing.size} existing arcs from arc-index.json`);
} catch {
  console.log("No existing arc-index.json — starting fresh.");
}

// ── Phase 1: fetch arc list ───────────────────────────────────────────────────
const arcs = [];
let nextUrl = "https://metron.cloud/api/arc/?page_size=100";
let page = 1;

console.log("\nPhase 1 — Fetching arc list from Metron...");

while (nextUrl) {
  process.stdout.write(`  Page ${page}... `);

  const res = await metronFetch(nextUrl);
  if (!res || !res.ok) {
    console.error(`\nFailed to fetch arc list page ${page} (status ${res?.status}). Aborting.`);
    process.exit(1);
  }

  const data = await res.json();

  for (const arc of data.results || []) {
    arcs.push({
      id: arc.id,
      name: arc.name,
      slug: `${arc.id}-${toSlug(arc.name)}`,
      modified: arc.modified || "",
      issueCount: existing.get(arc.id)?.issueCount || 0, // will be updated in Phase 2
    });
  }

  console.log(`${data.results?.length ?? 0} arcs (${arcs.length} total)`);
  nextUrl = data.next || null;
  page++;
}

// ── Phase 2: fetch issue lists, write Blob cache, extract counts ──────────────
// Only re-fetches arcs whose `modified` timestamp has changed since last run.
// On first run (no existing data) all arcs are processed.
const toProcess = arcs.filter((arc) => {
  const prev = existing.get(arc.id);
  return !prev || prev.modified !== arc.modified || prev.issueCount === 0;
});

console.log(
  `\nPhase 2 — Fetching issue lists for ${toProcess.length} arcs` +
  ` (${arcs.length - toProcess.length} unchanged, skipped).`
);
console.log(`  Sequential requests at ${REQUEST_DELAY_MS}ms delay (~${Math.round(60000 / REQUEST_DELAY_MS)} req/min).\n`);

for (let i = 0; i < toProcess.length; i++) {
  const arc = toProcess[i];
  process.stdout.write(`\r  [${i + 1}/${toProcess.length}] arc ${arc.id} — ${arc.name.slice(0, 40).padEnd(40)}`);

  const allIssues = [];
  let issueUrl = `https://metron.cloud/api/arc/${arc.id}/issue_list/?page_size=100`;
  let count = 0;

  while (issueUrl) {
    const issueRes = await metronFetch(issueUrl);
    if (!issueRes || !issueRes.ok) break;

    let issueData;
    try { issueData = await issueRes.json(); } catch { break; }

    count = issueData.count ?? count;
    allIssues.push(...(issueData.results || []));
    issueUrl = issueData.next || null;
  }

  const issues = allIssues
    .map((issue) => {
      const series = issue.series?.name || "";
      const num = issue.number || "";
      if (!series || !num) return "";
      return `${series} #${num}`;
    })
    .filter(Boolean);

  // Update the arc entry in our array
  arc.issueCount = count;

  // Write issue list to Blob (read by /api/arc/[id]/issues — cache-only)
  if (issues.length > 0) {
    await writeBlobCache(arc.id, issues);
  }
}

console.log("\n  done.");

// ── Write arc-index.json ──────────────────────────────────────────────────────
// Strip internal `modified` field — not needed by the frontend
const output = arcs.map(({ id, name, slug, issueCount }) => ({ id, name, slug, issueCount }));
output.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(output));

const processed = toProcess.length;
const skipped = arcs.length - processed;
console.log(`\nWrote ${arcs.length} arcs to arc-index.json (${processed} updated, ${skipped} unchanged).`);
if (BLOB_TOKEN) {
  console.log(`Blob cache updated for arcs with issues.`);
} else {
  console.log(`Blob cache NOT updated (BLOB_READ_WRITE_TOKEN missing).`);
}
