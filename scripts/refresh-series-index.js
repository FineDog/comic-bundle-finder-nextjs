// Fetches all series from the Metron API and writes a static index file:
//   public/data/series-index.json — series metadata (id, name, yearEnd, volume, issueCount)
//
// The file is committed to the repo by GitHub Actions so Vercel serves it as a
// static asset — no live Metron calls needed at page render time.
//
// Used by:
//   - pages/series/[slug].js getStaticProps (replaces fetchMetronSeriesMeta live call)
//   - pages/collection-guides.js series search (replaces /api/series/search live call)
//
// Run nightly via GitHub Actions. Also runnable manually:
//   METRON_USERNAME=x METRON_PASSWORD=y node scripts/refresh-series-index.js
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

import { writeFileSync, mkdirSync } from "fs";
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
// How many remaining requests in either window triggers a precautionary pause
const RATE_LIMIT_LOW_THRESHOLD = 3;

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
      // Use the burst-reset timestamp for a precise wait; fall back to Retry-After;
      // enforce a 60 s floor in all cases.
      // NOTE: Retry-After can be a date string — parseInt of that returns NaN,
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

    // Stop immediately on auth failure — retrying a 401/403 will never succeed.
    if (res.status === 401 || res.status === 403) {
      console.error(`\n  ${res.status} auth error — check credentials. Aborting.`);
      process.exit(1);
    }

    // Proactively check both rate-limit windows.
    // Correct header names: X-RateLimit-Burst-Remaining (per-minute) and
    // X-RateLimit-Sustained-Remaining (per-day). The old "X-RateLimit-Remaining"
    // header does not exist — reading it always returned null → 999 → never paused.
    const burstRemaining     = parseInt(res.headers.get("X-RateLimit-Burst-Remaining")     ?? "999", 10);
    const sustainedRemaining = parseInt(res.headers.get("X-RateLimit-Sustained-Remaining") ?? "999", 10);
    if (burstRemaining <= RATE_LIMIT_LOW_THRESHOLD) {
      const resetTs  = parseInt(res.headers.get("X-RateLimit-Burst-Reset") ?? "0", 10);
      const now      = Math.floor(Date.now() / 1000);
      const waitSec  = Math.max(resetTs > now ? resetTs - now + 2 : 65, 65);
      console.log(`\n  Burst limit low (${burstRemaining} remaining). Pausing ${waitSec}s...`);
      await sleep(waitSec * 1000);
    } else if (sustainedRemaining <= RATE_LIMIT_LOW_THRESHOLD) {
      const resetTs  = parseInt(res.headers.get("X-RateLimit-Sustained-Reset") ?? "0", 10);
      const now      = Math.floor(Date.now() / 1000);
      const waitSec  = Math.max(resetTs > now ? resetTs - now + 2 : 65, 65);
      console.log(`\n  Daily limit low (${sustainedRemaining} remaining). Pausing ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }

    // Polite delay after every successful Metron response
    await sleep(REQUEST_DELAY_MS);
    return res;
  }
  // All retries exhausted — pause before returning so the outer loop doesn't
  // immediately fire the next request with no delay.
  console.log(`\n  All retries exhausted for ${url}. Pausing ${REQUEST_DELAY_MS}ms before continuing.`);
  await sleep(REQUEST_DELAY_MS);
  return null;
}

// ── Fetch all series ──────────────────────────────────────────────────────────
const series = [];
let nextUrl = "https://metron.cloud/api/series/?page_size=100";
let page = 1;

console.log("Fetching series list from Metron...");
console.log(`Sequential requests at ${REQUEST_DELAY_MS}ms delay (~${Math.round(60000 / REQUEST_DELAY_MS)} req/min).\n`);

while (nextUrl) {
  process.stdout.write(`  Page ${page}... `);

  const res = await metronFetch(nextUrl);
  if (!res || !res.ok) {
    console.error(`\nFailed to fetch series list page ${page} (status ${res?.status}). Aborting.`);
    process.exit(1);
  }

  const data = await res.json();

  for (const s of data.results || []) {
    series.push({
      id: s.id,
      // Metron list endpoint uses "series" field (not "name"); detail endpoint uses "name".
      // We store as "name" to match what getStaticProps expects from meta.name || meta.series.
      name: s.series || s.name || "",
      yearEnd: s.year_end || null,
      volume: s.volume || null,
      issueCount: s.issue_count || 0,
    });
  }

  console.log(`${data.results?.length ?? 0} series (${series.length} total)`);
  nextUrl = data.next || null;
  page++;
}

// ── Write output ──────────────────────────────────────────────────────────────
const outDir = join(process.cwd(), "public", "data");
const outPath = join(outDir, "series-index.json");

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(series));

console.log(`\nWrote ${series.length} series to series-index.json.`);
