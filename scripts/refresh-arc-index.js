// Fetches story arc data from the Metron API and writes static files:
//   public/data/arc-index.json  — arc metadata (id, name, desc, slug, issueCount)
//   public/data/arc-issues.json — arc issue lists keyed by arc ID
//   public/data/arc-manifest.json — internal; stores lastRun timestamp for incremental runs
//
// Both data files are committed to the repo by GitHub Actions so Vercel serves them
// as static assets — no live Metron calls, no Vercel Blob writes.
//
// ── RUN MODES ────────────────────────────────────────────────────────────────
//
// INCREMENTAL (default after first run):
//   Reads arc-manifest.json for the lastRun timestamp. Calls
//   GET /api/arc/?modified_gt={lastRun} to get only arcs that changed.
//   Fetches detail + issue list for those arcs only. Typically 0–10 arcs/day.
//   Updates the stored data in place and writes the manifest with a new timestamp.
//
// FULL (first run, or when arc-manifest.json is absent):
//   Fetches all arcs from Metron and builds the index from scratch.
//   This is a one-time operation (~2,215 arcs × ~2 calls each ≈ several hours).
//   After completion the manifest is written; all future runs are incremental.
//   To force a full re-run: delete arc-manifest.json from the repo.
//
// ── METRON API RULES (DO NOT VIOLATE) ────────────────────────────────────────
//   Rate limits:  20 requests/minute  ·  5,000 requests/day
//   Concurrency:  Sequential only — NO parallel requests from this script.
//   Delay:        REQUEST_DELAY_MS between every Metron request (default 3500ms
//                 = ~17 req/min, safely under the 20/min burst limit).
//   Retries:      Only on HTTP 429 (honour reset timestamp) or 5xx.
//                 Never retry 4xx errors other than 429.
//   Source:       https://metron-project.github.io/blog/api-best-practices
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const USERNAME = process.env.METRON_USERNAME;
const PASSWORD = process.env.METRON_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error("METRON_USERNAME and METRON_PASSWORD must be set.");
  process.exit(1);
}

const AUTH = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
// User-Agent is required by Metron ToS. Do NOT use a browser UA or omit this header.
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  "User-Agent": "ComicBundleFinder/1.0",
};

// 3.5 seconds between requests ≈ 17 req/min (under the 20/min burst limit)
const REQUEST_DELAY_MS = 3500;
const RATE_LIMIT_LOW_THRESHOLD = 3;

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Wraps fetch with rate-limit handling, retries, and polite delay.
async function metronFetch(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS });

    if (res.status === 429) {
      // Use the burst-reset timestamp for a precise wait; fall back to Retry-After;
      // enforce a 60 s floor.
      // NOTE: Retry-After can be a date string — parseInt returns NaN,
      //       and sleep(NaN) fires immediately. Always guard with isFinite().
      const burstReset = parseInt(res.headers.get("X-RateLimit-Burst-Reset") ?? "0", 10);
      const rawRetry  = parseInt(res.headers.get("retry-after")              ?? "0", 10);
      const now       = Math.floor(Date.now() / 1000);
      const fromReset = Number.isFinite(burstReset) && burstReset > now ? burstReset - now + 2 : 0;
      const fromRetry = Number.isFinite(rawRetry)   && rawRetry > 0    ? rawRetry              : 0;
      const waitSec   = Math.max(fromReset, fromRetry, 60);
      console.log(`\n  429 rate limited. Waiting ${waitSec}s (attempt ${attempt}/3)...`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (res.status >= 500) {
      console.log(`\n  ${res.status} server error. Waiting 10s (attempt ${attempt}/3)...`);
      await sleep(10000);
      continue;
    }

    // Stop immediately on auth failure — retrying a disabled account wastes quota.
    if (res.status === 401 || res.status === 403) {
      console.error(`\n  ${res.status} auth error — check credentials. Aborting.`);
      process.exit(1);
    }

    // Proactively check both rate-limit windows.
    // Correct header names: X-RateLimit-Burst-Remaining (per-minute) and
    // X-RateLimit-Sustained-Remaining (per-day). "X-RateLimit-Remaining" doesn't exist.
    const burstRemaining     = parseInt(res.headers.get("X-RateLimit-Burst-Remaining")     ?? "999", 10);
    const sustainedRemaining = parseInt(res.headers.get("X-RateLimit-Sustained-Remaining") ?? "999", 10);
    if (burstRemaining <= RATE_LIMIT_LOW_THRESHOLD) {
      const resetTs = parseInt(res.headers.get("X-RateLimit-Burst-Reset") ?? "0", 10);
      const now     = Math.floor(Date.now() / 1000);
      const waitSec = Math.max(resetTs > now ? resetTs - now + 2 : 65, 65);
      console.log(`\n  Burst limit low (${burstRemaining} remaining). Pausing ${waitSec}s...`);
      await sleep(waitSec * 1000);
    } else if (sustainedRemaining <= RATE_LIMIT_LOW_THRESHOLD) {
      const resetTs = parseInt(res.headers.get("X-RateLimit-Sustained-Reset") ?? "0", 10);
      const now     = Math.floor(Date.now() / 1000);
      const waitSec = Math.max(resetTs > now ? resetTs - now + 2 : 65, 65);
      console.log(`\n  Daily limit low (${sustainedRemaining} remaining). Pausing ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }

    await sleep(REQUEST_DELAY_MS);
    return res;
  }
  console.log(`\n  All retries exhausted for ${url}. Pausing before continuing.`);
  await sleep(REQUEST_DELAY_MS);
  return null;
}

// ── File paths ────────────────────────────────────────────────────────────────
const outDir      = join(process.cwd(), "public", "data");
const outPath     = join(outDir, "arc-index.json");
const issuesPath  = join(outDir, "arc-issues.json");
const manifestPath = join(outDir, "arc-manifest.json");

// Capture run-start time before any Metron calls. Used as the new lastRun value.
// Setting it at start (not end) ensures the next incremental run won't miss arcs
// that were modified on Metron while this run was in progress.
const thisRunStart = new Date().toISOString();

// ── Load existing data ────────────────────────────────────────────────────────
/** @type {Map<number, {id, name, desc, slug, issueCount}>} */
const existingArcs = new Map();
try {
  for (const arc of JSON.parse(readFileSync(outPath, "utf-8"))) {
    existingArcs.set(arc.id, arc);
  }
  console.log(`Loaded ${existingArcs.size} existing arcs from arc-index.json.`);
} catch {
  console.log("No existing arc-index.json — full run required.");
}

/** @type {Record<number, string[]>} */
const existingIssues = {};
try {
  Object.assign(existingIssues, JSON.parse(readFileSync(issuesPath, "utf-8")));
  console.log(`Loaded arc-issues.json (${Object.keys(existingIssues).length} arcs with issues).`);
} catch {
  console.log("No existing arc-issues.json — will build from scratch.");
}

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  console.log(`Manifest found: lastRun = ${manifest.lastRun}`);
} catch {
  console.log("No arc-manifest.json — this will be a full run.");
}

// ── Determine run mode ────────────────────────────────────────────────────────
// Incremental requires both a manifest with a lastRun timestamp and an existing
// index to merge changes into. Without those, fall back to full mode.
const isIncremental = !!manifest?.lastRun && existingArcs.size > 0;

if (isIncremental) {
  console.log(`\nINCREMENTAL MODE — only fetching arcs modified since ${manifest.lastRun}`);
  console.log(`Existing index has ${existingArcs.size} arcs; only changes will be fetched and merged.`);
} else {
  console.log(`\nFULL MODE — fetching all arcs from Metron.`);
  console.log(`(This is a one-time operation. Future runs will be incremental.)`);
  console.log(`Sequential requests at ${REQUEST_DELAY_MS}ms delay (~${Math.round(60000 / REQUEST_DELAY_MS)} req/min).`);
}

// ── Phase 1: Fetch arc list ───────────────────────────────────────────────────
// Incremental: only arcs modified since lastRun (usually 0–10 per day).
// Full: all arcs (one-time, ~23 pages).
const arcsFromMetron = []; // Arc objects as returned by the Metron list endpoint
let nextUrl = isIncremental
  ? `https://metron.cloud/api/arc/?modified_gt=${encodeURIComponent(manifest.lastRun)}&page_size=100`
  : "https://metron.cloud/api/arc/?page_size=100";
let page = 1;

console.log("\nFetching arc list...");
while (nextUrl) {
  process.stdout.write(`  Page ${page}... `);
  const res = await metronFetch(nextUrl);
  if (!res || !res.ok) {
    console.error(`\nFailed to fetch arc list page ${page} (status ${res?.status}). Aborting.`);
    process.exit(1);
  }
  const data = await res.json();
  arcsFromMetron.push(...(data.results || []));
  console.log(`${data.results?.length ?? 0} arcs (${arcsFromMetron.length} total so far)`);
  nextUrl = data.next || null;
  page++;
}

console.log(`\n${arcsFromMetron.length} arcs to process (${isIncremental ? "incremental delta" : "full index"}).`);

// Chunked full-run support (METRON_ARC_OFFSET + METRON_ARC_LIMIT).
// Allows the one-time full run to be spread across multiple GitHub Actions jobs,
// each safely within the 5,000/day API limit and 6-hour job time limit.
// Example:
//   Run 1: METRON_ARC_OFFSET=0    METRON_ARC_LIMIT=1500  (arcs 0–1499)
//   Run 2: METRON_ARC_OFFSET=1500 METRON_ARC_LIMIT=1500  (arcs 1500–2999)
// Each chunk: ~23 (list) + 1500 × 2.5 ≈ 3,775 calls — within the 5,000/day limit.
// Time: ~3.7 hours — within the 6-hour GitHub Actions limit.
//
// In incremental mode, OFFSET and LIMIT are ignored.
const arcOffset = parseInt(process.env.METRON_ARC_OFFSET || "0", 10);
const arcLimit  = parseInt(process.env.METRON_ARC_LIMIT  || "",  10);
const isChunked = !isIncremental && arcLimit > 0;

let toProcess = arcsFromMetron;
if (isChunked) {
  const off = Number.isFinite(arcOffset) && arcOffset >= 0 ? arcOffset : 0;
  toProcess = arcsFromMetron.slice(off, off + arcLimit);
  console.log(`  Chunked full run: processing arcs[${off}..${off + toProcess.length - 1}] (${toProcess.length} arcs).`);
  console.log(`  Manifest will NOT be written for a partial run — write it manually after all chunks complete.`);
}

// ── Phase 2: Fetch detail + issue list for each arc ───────────────────────────
console.log(`\nFetching details and issue lists for ${toProcess.length} arcs...`);
console.log(`Sequential requests at ${REQUEST_DELAY_MS}ms delay.\n`);

for (let i = 0; i < toProcess.length; i++) {
  const arc = toProcess[i];
  process.stdout.write(`\r  [${i + 1}/${toProcess.length}] arc ${arc.id} — ${arc.name.slice(0, 40).padEnd(40)}`);

  const slug = `${arc.id}-${toSlug(arc.name)}`;

  // Fetch arc detail for the description field
  let desc = existingArcs.get(arc.id)?.desc || "";
  const detailRes = await metronFetch(`https://metron.cloud/api/arc/${arc.id}/`);
  if (detailRes?.ok) {
    try { desc = (await detailRes.json()).desc || ""; } catch { /* keep existing */ }
  }

  // Fetch the complete issue list for this arc (may be multiple pages)
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
      const num    = issue.number || "";
      if (!series || !num) return "";
      return `${series} #${num}`;
    })
    .filter(Boolean);

  // Merge into in-memory store
  existingArcs.set(arc.id, { id: arc.id, name: arc.name, desc, slug, issueCount: count || issues.length });
  if (issues.length > 0) existingIssues[arc.id] = issues;
}

console.log("\n  done.");

// ── Write output files ────────────────────────────────────────────────────────
const output = Array.from(existingArcs.values()).sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath,    JSON.stringify(output));
writeFileSync(issuesPath, JSON.stringify(existingIssues));

console.log(`\nWrote ${output.length} arcs to arc-index.json (${toProcess.length} updated, ${output.length - toProcess.length} unchanged).`);
console.log(`Wrote arc-issues.json (${Object.keys(existingIssues).length} arcs with issues).`);

// Write the manifest only after a COMPLETE run (incremental, or full without a limit).
// Chunked full runs are partial by definition — writing the manifest prematurely would
// cause the next run to skip the un-processed portion via modified_gt.
if (!isChunked) {
  writeFileSync(manifestPath, JSON.stringify({ lastRun: thisRunStart }));
  console.log(`Wrote arc-manifest.json (lastRun = ${thisRunStart}).`);
} else {
  console.log(`\nChunked run complete. arc-manifest.json was NOT written.`);
  console.log(`After all chunks finish, create the manifest manually to enable incremental mode:`);
  console.log(`  echo '{"lastRun":"${thisRunStart}"}' > public/data/arc-manifest.json`);
  console.log(`  git add public/data/arc-manifest.json && git commit -m "chore: seed arc manifest"`);
}
