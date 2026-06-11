// scripts/refresh-series-issues.js
//
// Populates Postgres (Neon) with per-series issue lists for all "metron-*" dynamic series.
// This is the ONLY place that should write series_issues rows — never from Vercel.
// API routes read from Postgres only. If the row is missing they return "not yet indexed".
//
// WHY POSTGRES, NOT VERCEL BLOB: every Blob put() is an Advanced Operation, and the
// plan allows only 2,000/month. A full backfill is ~16,000 writes. Postgres rows are
// free to read and write, and the database is already provisioned (DATABASE_URL).
//
// ── HOW IT RUNS ───────────────────────────────────────────────────────────────
//
// INCREMENTAL MODE (default — runs nightly via GitHub Actions):
//   Reads the lastRun timestamp from the series_sync_state table.
//   If present: calls GET /api/series/?modified_gt={lastRun} to find only
//   the series that changed since the last run. Typically 0–20 Metron calls per night.
//   If absent: creates one (timestamps "now") so future runs can be incremental.
//   Note: run a BACKFILL first to seed the table before relying on incremental updates.
//
// BACKFILL MODE (first-time / recovery — set METRON_SERIES_OFFSET + METRON_SERIES_LIMIT):
//   Processes a contiguous slice of series-index.json. For each series in the slice,
//   checks the existing Postgres row; skips if current, fetches and writes if missing/stale.
//
//   GitHub Actions has a 6-hour limit. At ~3.5s/request and ~2 API calls/series avg,
//   METRON_SERIES_LIMIT=1500 per run takes ~3–4 hours (safely within the limit).
//   Run multiple times with increasing offsets to cover all series:
//     METRON_SERIES_OFFSET=0     METRON_SERIES_LIMIT=1500   (run 1)
//     METRON_SERIES_OFFSET=1500  METRON_SERIES_LIMIT=1500   (run 2)
//     METRON_SERIES_OFFSET=3000  METRON_SERIES_LIMIT=1500   (run 3)
//     ... etc.
//   Series with issueCount=0 are skipped automatically.
//   Already-current rows are skipped (idempotent).
//
// ── REQUIRED ENV VARS ─────────────────────────────────────────────────────────
//   METRON_USERNAME — Metron account username
//   METRON_PASSWORD — Metron account password
//   DATABASE_URL    — Neon Postgres connection string
//
// ── METRON API RULES (DO NOT VIOLATE) ─────────────────────────────────────────
//   Rate limits:  20 requests/minute (burst)  ·  5,000 requests/day (sustained)
//   Concurrency:  Sequential ONLY — no parallel requests from this script.
//   Delay:        3500ms between every Metron request (~17 req/min).
//   Retries:      429 (honour reset timestamp) and 5xx only. Never retry 4xx.
//   Source:       https://metron-project.github.io/blog/api-best-practices
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { join }         from "path";
import pg               from "pg";

// ── Env / auth ────────────────────────────────────────────────────────────────
const USERNAME     = process.env.METRON_USERNAME;
const PASSWORD     = process.env.METRON_PASSWORD;
const DATABASE_URL = process.env.DATABASE_URL;

if (!USERNAME || !PASSWORD) {
  console.error("METRON_USERNAME and METRON_PASSWORD must be set.");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const AUTH = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
// User-Agent is required by Metron ToS. Do NOT use a browser UA or omit this.
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  "User-Agent": "ComicBundleFinder/1.0",
};

// ── Constants ─────────────────────────────────────────────────────────────────
const REQUEST_DELAY_MS       = 3500;  // ~17 req/min, safely under 20/min burst limit
const RATE_LIMIT_LOW_THRESHOLD = 3;
// If a row exists but has no `modified` field to compare against, treat it
// as fresh if written within this window (avoids re-fetching every series on first backfill).
const FRESH_NO_MODIFIED_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MANIFEST_KEY = "series-issues-manifest";

// ── Rate-limit-aware Metron fetch ─────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
      // Use the burst-reset timestamp for a precise wait; honour Retry-After as fallback;
      // enforce a 60 s floor.
      // IMPORTANT: Retry-After can be a date string. parseInt of a date string → NaN.
      // sleep(NaN) = setTimeout(fn, NaN) = fires immediately — never do this.
      const burstReset = parseInt(res.headers.get("X-RateLimit-Burst-Reset") ?? "0", 10);
      const rawRetry   = parseInt(res.headers.get("retry-after")              ?? "0", 10);
      const now        = Math.floor(Date.now() / 1000);
      const fromReset  = Number.isFinite(burstReset) && burstReset > now ? burstReset - now + 2 : 0;
      const fromRetry  = Number.isFinite(rawRetry)   && rawRetry > 0    ? rawRetry              : 0;
      const waitSec    = Math.max(fromReset, fromRetry, 60);
      console.log(`\n  429 rate limited. Waiting ${waitSec}s (attempt ${attempt}/3)...`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (res.status >= 500) {
      console.log(`\n  ${res.status} server error. Waiting 10s (attempt ${attempt}/3)...`);
      await sleep(10000);
      continue;
    }

    // Stop immediately on auth failure — retrying wastes quota on a disabled account.
    if (res.status === 401 || res.status === 403) {
      console.error(`\n  ${res.status} auth error — check credentials. Aborting.`);
      process.exit(1);
    }

    // Proactively check both rate-limit windows before firing the next request.
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
  // All retries exhausted — pause before the next request anyway.
  console.log(`\n  All retries exhausted for ${url}. Pausing before continuing.`);
  await sleep(REQUEST_DELAY_MS);
  return null;
}

// ── Issue fetcher ─────────────────────────────────────────────────────────────
// Fetches all issue pages for a Metron series ID.
// Returns an array of { number, issueName } or null on failure.
async function fetchIssuesForSeries(metronId) {
  const issues = [];
  let url = `https://metron.cloud/api/issue/?series_id=${metronId}&page_size=100`;

  while (url) {
    const res = await metronFetch(url);
    if (!res) {
      console.log(`\n  Fetch failed for series ${metronId}. Skipping.`);
      return null;
    }
    if (res.status === 404) {
      console.log(`\n  Series ${metronId}: 404 (not found on Metron). Skipping.`);
      return null;
    }
    if (!res.ok) {
      console.log(`\n  Series ${metronId}: unexpected status ${res.status}. Skipping.`);
      return null;
    }

    let data;
    try { data = await res.json(); } catch {
      console.log(`\n  Series ${metronId}: JSON parse failed. Skipping.`);
      return null;
    }

    for (const issue of data.results || []) {
      const seriesName = issue.series?.name || "";
      const num        = issue.number || "";
      if (!seriesName || !num) continue;
      // Strip year suffix from series name, then append year from cover_date.
      // e.g. "The X-Men (1963)" + "1963-03-10" → "The X-Men #1 (1963)"
      const seriesClean = seriesName.replace(/\s*\(\d{4,}\)\s*$/, "").trim();
      const year        = (issue.cover_date || "").slice(0, 4);
      const issueName   = year ? `${seriesClean} #${num} (${year})` : `${seriesClean} #${num}`;
      issues.push({ number: num, issueName });
    }

    url = data.next || null;
  }

  // Sort by issue number (float parse handles annuals, 0.5, etc.)
  issues.sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));
  return issues;
}

// ── Postgres helpers ──────────────────────────────────────────────────────────
// Tables are created on first run; subsequent CREATE IF NOT EXISTS calls are no-ops.
await pool.query(`
  CREATE TABLE IF NOT EXISTS series_issues (
    metron_id INTEGER PRIMARY KEY,
    issues    JSONB NOT NULL,
    modified  TEXT,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS series_sync_state (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
  )
`);

// Returns { modified, cachedAtMs } for an existing row, or null if absent.
async function readDbEntry(metronId) {
  const { rows } = await pool.query(
    "SELECT modified, cached_at FROM series_issues WHERE metron_id = $1",
    [metronId]
  );
  if (!rows.length) return null;
  return { modified: rows[0].modified, cachedAtMs: new Date(rows[0].cached_at).getTime() };
}

async function writeDbIssues(metronId, issues, modified) {
  await pool.query(
    `INSERT INTO series_issues (metron_id, issues, modified, cached_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (metron_id)
     DO UPDATE SET issues = $2, modified = $3, cached_at = NOW()`,
    [metronId, JSON.stringify(issues), modified || null]
  );
}

async function readManifest() {
  const { rows } = await pool.query(
    "SELECT value FROM series_sync_state WHERE key = $1",
    [MANIFEST_KEY]
  );
  return rows.length ? rows[0].value : null;
}

async function writeManifest(lastRun, meta = {}) {
  await pool.query(
    `INSERT INTO series_sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [MANIFEST_KEY, JSON.stringify({ lastRun, ...meta })]
  );
}

// ── Load series index ─────────────────────────────────────────────────────────
let seriesIndex;
try {
  seriesIndex = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "series-index.json"), "utf-8")
  );
} catch {
  console.error("Could not read public/data/series-index.json. Run refresh-series-index.js first.");
  process.exit(1);
}
console.log(`Loaded ${seriesIndex.length} series from series-index.json.`);

// Map for fast ID lookup
const seriesById = new Map(seriesIndex.map((s) => [s.id, s]));

// ── Determine run mode ────────────────────────────────────────────────────────
const envOffset = process.env.METRON_SERIES_OFFSET;
const envLimit  = process.env.METRON_SERIES_LIMIT;
const OFFSET    = parseInt(envOffset ?? "", 10);
const LIMIT     = parseInt(envLimit  ?? "", 10);
const isBackfill = Number.isFinite(OFFSET) && OFFSET >= 0 &&
                   Number.isFinite(LIMIT)  && LIMIT  >  0;

// ═══════════════════════════════════════════════════════════════════════════════
// BACKFILL MODE
// ═══════════════════════════════════════════════════════════════════════════════
if (isBackfill) {
  const slice = seriesIndex.slice(OFFSET, OFFSET + LIMIT);
  console.log(`\nBACKFILL MODE: series[${OFFSET}..${OFFSET + slice.length - 1}] (${slice.length} series)`);
  console.log(`Sequential Metron requests at ${REQUEST_DELAY_MS}ms delay.\n`);

  let fetched = 0, skipped = 0, failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const s = slice[i];
    process.stdout.write(`  [${i + 1}/${slice.length}] id=${s.id} "${(s.name || "").slice(0, 38).padEnd(38)}" `);

    // Skip series with no issues (saves both a DB check and a Metron fetch)
    if ((s.issueCount ?? 1) === 0) {
      process.stdout.write("skip (issueCount=0)\n");
      skipped++;
      continue;
    }

    // Check existing Postgres row (free — no Metron call, no Blob operation)
    const existing = await readDbEntry(s.id);

    if (existing) {
      // If both sides have a `modified` timestamp, compare them exactly.
      if (existing.modified && s.modified && existing.modified === s.modified) {
        process.stdout.write("skip (up to date)\n");
        skipped++;
        continue;
      }
      // If no `modified` to compare but the row was written recently, treat as fresh.
      if (!s.modified && existing.cachedAtMs &&
          Date.now() - existing.cachedAtMs < FRESH_NO_MODIFIED_MS) {
        process.stdout.write("skip (recently cached, no modified field)\n");
        skipped++;
        continue;
      }
    }

    process.stdout.write("fetching from Metron... ");
    const issues = await fetchIssuesForSeries(s.id);
    if (issues === null) {
      failed++;
      continue;
    }

    await writeDbIssues(s.id, issues, s.modified || null);
    process.stdout.write(`wrote ${issues.length} issues.\n`);
    fetched++;
  }

  console.log(`\nBackfill complete: ${fetched} written, ${skipped} skipped, ${failed} failed.`);
  console.log(`\nTip: the nightly incremental run will keep these entries up to date going forward.`);
  console.log(`After all chunks are complete, the first incremental run will seed the manifest.`);
  await pool.end();
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INCREMENTAL MODE
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\nINCREMENTAL MODE: checking for series modified since last run...");

const manifest = await readManifest();

if (!manifest?.lastRun) {
  // No manifest exists yet — this is expected before the first backfill.
  // Create a manifest timestamped "now" so future incremental runs work correctly.
  // Series added/modified before this timestamp will need a backfill to get into Postgres.
  const now = new Date().toISOString();
  await writeManifest(now, { note: "Seeded by first incremental run. Run backfill to populate existing series." });
  console.log(`No manifest found. Created manifest with lastRun = ${now}.`);
  console.log(`\nACTION REQUIRED: The series_issues table is not yet populated.`);
  console.log(`Run a backfill to seed it:`);
  console.log(`  METRON_SERIES_OFFSET=0 METRON_SERIES_LIMIT=1500 node scripts/refresh-series-issues.js`);
  console.log(`  METRON_SERIES_OFFSET=1500 METRON_SERIES_LIMIT=1500 node scripts/refresh-series-issues.js`);
  console.log(`  ... (repeat until all series are covered)`);
  console.log(`Future incremental runs will then keep the cache current.`);
  process.exit(0);
}

const lastRun = manifest.lastRun;
console.log(`Last run: ${lastRun}`);

// Fetch all series modified since last run
let modUrl = `https://metron.cloud/api/series/?modified_gt=${encodeURIComponent(lastRun)}&page_size=100`;
let modPage = 1;
const modifiedSeries = [];

console.log("Fetching recently modified series from Metron...");
while (modUrl) {
  process.stdout.write(`  Page ${modPage}... `);
  const res = await metronFetch(modUrl);
  if (!res || !res.ok) {
    console.error(`\nFailed to fetch modified series page ${modPage} (status ${res?.status}). Aborting.`);
    process.exit(1);
  }
  const data = await res.json();
  modifiedSeries.push(...(data.results || []));
  console.log(`${data.results?.length ?? 0} results (${modifiedSeries.length} total)`);
  modUrl = data.next || null;
  modPage++;
}

// Only process series that are in our index
const toUpdate = modifiedSeries.filter((s) => seriesById.has(s.id));
console.log(`\n${modifiedSeries.length} modified since ${lastRun}; ${toUpdate.length} are in our index.\n`);

let updated = 0, failed = 0;

for (let i = 0; i < toUpdate.length; i++) {
  const s = toUpdate[i];
  process.stdout.write(`  [${i + 1}/${toUpdate.length}] id=${s.id} "${(s.series || s.name || "").slice(0, 38).padEnd(38)}" fetching... `);

  const issues = await fetchIssuesForSeries(s.id);
  if (issues === null) { failed++; continue; }

  await writeDbIssues(s.id, issues, s.modified || null);
  process.stdout.write(`wrote ${issues.length} issues.\n`);
  updated++;
}

// Update manifest
const nowIso = new Date().toISOString();
await writeManifest(nowIso, { updatedInLastRun: updated });
console.log(`\nIncremental update complete: ${updated} updated, ${failed} failed.`);
console.log(`Manifest updated: lastRun = ${nowIso}`);
await pool.end();
