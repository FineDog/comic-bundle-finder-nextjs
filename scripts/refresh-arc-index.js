// Fetches all story arcs from the Metron API and writes
// public/data/arc-index.json for the collection guides search bar.
//
// Run nightly via GitHub Actions. Also runnable manually:
//   METRON_USERNAME=x METRON_PASSWORD=y node scripts/refresh-arc-index.js
//
// Output format:
//   [{ "id": 123, "name": "Brand New Day", "slug": "123-brand-new-day", "issueCount": 12 }, ...]
//
// Issue counts are NOT in the arc list endpoint — a separate call to
// /api/arc/{id}/issue_list/?page_size=1 is needed for each arc.
//
// To avoid rate limits we run sequentially with a 2-second delay between
// requests, and we PRESERVE existing counts from the committed arc-index.json
// so only new/uncounted arcs need to be fetched on each run.
// First run: ~74 min (2214 arcs × 2s). Subsequent runs: seconds.

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const USERNAME = process.env.METRON_USERNAME;
const PASSWORD = process.env.METRON_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error("METRON_USERNAME and METRON_PASSWORD must be set.");
  process.exit(1);
}

const AUTH = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  Accept: "application/json",
  "User-Agent": "ComicBundleFinder/1.0",
};

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch the issue count for a single arc via the issue_list endpoint.
// Returns 0 on any error (non-fatal — badge just won't show).
async function fetchIssueCount(arcId) {
  try {
    const res = await fetch(
      `https://metron.cloud/api/arc/${arcId}/issue_list/?page_size=1`,
      { headers: HEADERS }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count || 0;
  } catch {
    return 0;
  }
}

const outDir = join(process.cwd(), "public", "data");
const outPath = join(outDir, "arc-index.json");

// ── Load existing issue counts so we don't re-fetch them ─────────────────────
const existingCounts = {};
try {
  const existing = JSON.parse(readFileSync(outPath, "utf-8"));
  for (const arc of existing) {
    if (arc.issueCount > 0) existingCounts[arc.id] = arc.issueCount;
  }
  console.log(`Loaded ${Object.keys(existingCounts).length} existing issue counts from arc-index.json`);
} catch {
  console.log("No existing arc-index.json — starting fresh.");
}

// ── Phase 1: fetch arc list ───────────────────────────────────────────────────
const arcs = [];
let nextUrl = "https://metron.cloud/api/arc/?page_size=100";
let page = 1;

console.log("\nPhase 1 — Fetching story arcs from Metron...");

while (nextUrl) {
  process.stdout.write(`  Page ${page}... `);

  let res;
  // Retry up to 3 times on 429 with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(nextUrl, { headers: HEADERS });
    if (res.status !== 429) break;
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    const wait = retryAfter * 1000;
    console.log(`\n  Rate limited (429). Waiting ${retryAfter}s before retry ${attempt}/3...`);
    await sleep(wait);
  }

  if (!res.ok) {
    console.error(`\nMetron returned ${res.status} on page ${page}. Aborting.`);
    process.exit(1);
  }

  const data = await res.json();

  for (const arc of data.results || []) {
    arcs.push({
      id: arc.id,
      name: arc.name,
      slug: `${arc.id}-${toSlug(arc.name)}`,
      issueCount: existingCounts[arc.id] || 0,
    });
  }

  console.log(`${data.results?.length ?? 0} arcs (${arcs.length} total)`);

  nextUrl = data.next || null;
  page++;

  if (nextUrl) await sleep(1000);
}

// ── Phase 2: fetch issue counts for arcs we don't have yet ───────────────────
const uncounted = arcs.filter((a) => !a.issueCount);

if (uncounted.length === 0) {
  console.log("\nPhase 2 — All issue counts already known. Skipping.");
} else {
  console.log(`\nPhase 2 — Fetching issue counts for ${uncounted.length} arcs (sequential, 2s delay)...`);
  for (let i = 0; i < uncounted.length; i++) {
    uncounted[i].issueCount = await fetchIssueCount(uncounted[i].id);
    process.stdout.write(`\r  ${i + 1} / ${uncounted.length}  `);
    if (i + 1 < uncounted.length) await sleep(2000);
  }
  console.log("\n  done.");
}

// ── Write output ──────────────────────────────────────────────────────────────
arcs.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(arcs));

console.log(`\nWrote ${arcs.length} arcs to public/data/arc-index.json`);
