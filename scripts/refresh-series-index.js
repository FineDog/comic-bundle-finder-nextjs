// Fetches series metadata from the Metron API and writes a static index file:
//   public/data/series-index.json   — series metadata (id, name, yearEnd, volume, issueCount, modified)
//   public/data/series-manifest.json — internal; stores lastRun timestamp for incremental runs
//
// The data file is committed to the repo by GitHub Actions so Vercel serves it as a
// static asset — no live Metron calls at page render time.
//
// ── RUN MODES ────────────────────────────────────────────────────────────────
//
// INCREMENTAL (default after first run):
//   Reads series-manifest.json for the lastRun timestamp. Calls
//   GET /api/series/?modified_gt={lastRun} to get only series that changed.
//   Merges updates into the existing index. Typically 0–20 series/day.
//   Writes the updated index and manifest.
//
// FULL (first run, or when series-manifest.json is absent):
//   Fetches all ~15,000+ series from Metron (~160 pages).
//   This is a one-time operation. After completion the manifest is written
//   and all future runs are incremental.
//   To force a full re-run: delete series-manifest.json from the repo.
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Wraps fetch with rate-limit handling, retries, and polite delay.
async function metronFetch(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: HEADERS });
    } catch (err) {
      // Network-level failure (ECONNREFUSED, ECONNRESET, ETIMEDOUT, etc.).
      // This likely means Metron is blocking this runner's IP. Do NOT retry —
      // repeated connection attempts from rotating IPs is what causes account bans.
      // Exit immediately so the problem can be reviewed manually.
      const code = err.cause?.code ?? err.code ?? err.message;
      console.error(`\n  Network error: ${code}`);
      console.error(`  URL: ${url}`);
      console.error(`  Metron may be blocking this runner's IP. Aborting — check manually before re-running.`);
      process.exit(1);
    }

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
const outDir       = join(process.cwd(), "public", "data");
const outPath      = join(outDir, "series-index.json");
const manifestPath = join(outDir, "series-manifest.json");

// Capture run-start time before any Metron calls. Using the start (not end) of the run
// as lastRun ensures the next incremental run won't miss series modified while this
// run was in progress.
const thisRunStart = new Date().toISOString();

// ── Load existing data ────────────────────────────────────────────────────────
/** @type {Map<number, {id, name, yearEnd, volume, issueCount, modified}>} */
const existingSeries = new Map();
try {
  for (const s of JSON.parse(readFileSync(outPath, "utf-8"))) {
    existingSeries.set(s.id, s);
  }
  console.log(`Loaded ${existingSeries.size} existing series from series-index.json.`);
} catch {
  console.log("No existing series-index.json — full run required.");
}

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  console.log(`Manifest found: lastRun = ${manifest.lastRun}`);
} catch {
  console.log("No series-manifest.json — this will be a full run.");
}

// ── Determine run mode ────────────────────────────────────────────────────────
const isIncremental = !!manifest?.lastRun && existingSeries.size > 0;

if (isIncremental) {
  console.log(`\nINCREMENTAL MODE — only fetching series modified since ${manifest.lastRun}`);
  console.log(`Existing index has ${existingSeries.size} series; only changes will be fetched and merged.`);
} else {
  console.log(`\nFULL MODE — fetching all series from Metron.`);
  console.log(`(This is a one-time operation. Future runs will be incremental.)`);
  console.log(`Sequential requests at ${REQUEST_DELAY_MS}ms delay (~${Math.round(60000 / REQUEST_DELAY_MS)} req/min).`);
}

// ── Fetch series from Metron ──────────────────────────────────────────────────
// Incremental: only series modified since lastRun (usually 0–20 per day).
// Full: all series (one-time, ~160 pages at ~9 minutes total).
let nextUrl = isIncremental
  ? `https://metron.cloud/api/series/?modified_gt=${encodeURIComponent(manifest.lastRun)}&page_size=100`
  : "https://metron.cloud/api/series/?page_size=100";
let page = 1;
let updatedCount = 0;

console.log("\nFetching series list...");
while (nextUrl) {
  process.stdout.write(`  Page ${page}... `);

  const res = await metronFetch(nextUrl);
  if (!res || !res.ok) {
    console.error(`\nFailed to fetch series list page ${page} (status ${res?.status}). Aborting.`);
    process.exit(1);
  }

  const data = await res.json();

  for (const s of data.results || []) {
    existingSeries.set(s.id, {
      id: s.id,
      // Metron list endpoint uses "series" field; detail endpoint uses "name".
      // We store as "name" for consistency with getStaticProps.
      name: s.series || s.name || "",
      yearEnd: s.year_end || null,
      volume: s.volume || null,
      issueCount: s.issue_count || 0,
      // `modified` is used by refresh-series-issues.js for incremental issue-list updates.
      modified: s.modified || null,
    });
    updatedCount++;
  }

  console.log(`${data.results?.length ?? 0} series (${updatedCount} processed so far)`);
  nextUrl = data.next || null;
  page++;
}

// ── Write output files ────────────────────────────────────────────────────────
// Preserve insertion order (don't sort — series-index.json is searched client-side
// and order doesn't matter; sorting 15k entries on every incremental run adds overhead).
const output = Array.from(existingSeries.values());
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath,     JSON.stringify(output));
writeFileSync(manifestPath, JSON.stringify({ lastRun: thisRunStart }));

const mode = isIncremental ? "incremental" : "full";
console.log(`\n[${mode}] Wrote ${existingSeries.size} series to series-index.json (${updatedCount} updated/added, ${existingSeries.size - updatedCount} unchanged).`);
console.log(`Wrote series-manifest.json (lastRun = ${thisRunStart}).`);
