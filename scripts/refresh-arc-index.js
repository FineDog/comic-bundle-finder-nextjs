// Fetches all story arcs from the Metron API and writes two static files:
//   public/data/arc-index.json  — arc metadata (id, name, slug, issueCount)
//   public/data/arc-issues.json — arc issue lists keyed by arc ID
//
// Both files are committed to the repo by GitHub Actions so Vercel serves them
// as static assets — no Vercel Blob writes, no Advanced Operations consumed.
//
// Run nightly via GitHub Actions. Also runnable manually:
//   METRON_USERNAME=x METRON_PASSWORD=y node scripts/refresh-arc-index.js
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

    // Stop immediately on auth failure — retrying a 401/403 will never succeed
    // and wastes quota (or hammers a disabled account).
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

// ── Load existing data ────────────────────────────────────────────────────────
const outDir = join(process.cwd(), "public", "data");
const outPath = join(outDir, "arc-index.json");
const issuesPath = join(outDir, "arc-issues.json");

/** @type {Map<number, { issueCount: number, modified: string }>} */
const existing = new Map();
try {
  for (const arc of JSON.parse(readFileSync(outPath, "utf-8"))) {
    existing.set(arc.id, { issueCount: arc.issueCount || 0, modified: arc.modified || "", desc: arc.desc || "" });
  }
  console.log(`Loaded ${existing.size} existing arcs from arc-index.json`);
} catch {
  console.log("No existing arc-index.json — starting fresh.");
}

/** @type {Record<number, string[]>} */
let existingIssues = {};
try {
  existingIssues = JSON.parse(readFileSync(issuesPath, "utf-8"));
  console.log(`Loaded arc-issues.json (${Object.keys(existingIssues).length} arcs)`);
} catch {
  console.log("No existing arc-issues.json — starting fresh.");
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
      desc: existing.get(arc.id)?.desc || arc.desc || "", // preserved from previous run; overwritten in Phase 2
      slug: `${arc.id}-${toSlug(arc.name)}`,
      modified: arc.modified || "",
      issueCount: existing.get(arc.id)?.issueCount || 0, // will be updated in Phase 2
    });
  }

  console.log(`${data.results?.length ?? 0} arcs (${arcs.length} total)`);
  nextUrl = data.next || null;
  page++;
}

// ── Phase 2: fetch issue lists for changed arcs ───────────────────────────────
// Only re-fetches arcs whose `modified` timestamp has changed since last run.
// Arcs that need issue list re-fetch: modified timestamp changed or issueCount missing.
const toFetchIssues = new Set(
  arcs
    .filter((arc) => {
      const prev = existing.get(arc.id);
      return !prev || prev.modified !== arc.modified || prev.issueCount === 0;
    })
    .map((arc) => arc.id)
);

// Arcs that need a desc fetch: missing desc (one-time backfill) or being re-fetched anyway.
const toFetchDesc = new Set(
  arcs
    .filter((arc) => {
      const prev = existing.get(arc.id);
      return !prev?.desc || toFetchIssues.has(arc.id);
    })
    .map((arc) => arc.id)
);

let toProcess = arcs.filter((arc) => toFetchIssues.has(arc.id) || toFetchDesc.has(arc.id));

const arcLimit = parseInt(process.env.METRON_ARC_LIMIT || "", 10);
if (arcLimit > 0) {
  toProcess = toProcess.slice(0, arcLimit);
  console.log(`\n  *** TEST MODE: limiting Phase 2 to first ${arcLimit} arcs ***`);
}

console.log(
  `\nPhase 2 — Processing ${toProcess.length} arcs` +
  ` (${toFetchIssues.size} issue re-fetches, ${toFetchDesc.size} desc fetches,` +
  ` ${arcs.length - toProcess.length} fully unchanged).`
);
console.log(`  Sequential requests at ${REQUEST_DELAY_MS}ms delay (~${Math.round(60000 / REQUEST_DELAY_MS)} req/min).\n`);

for (let i = 0; i < toProcess.length; i++) {
  const arc = toProcess[i];
  process.stdout.write(`\r  [${i + 1}/${toProcess.length}] arc ${arc.id} — ${arc.name.slice(0, 40).padEnd(40)}`);

  // Fetch desc if needed (one detail call per arc, skipped once all arcs have desc)
  if (toFetchDesc.has(arc.id)) {
    const detailRes = await metronFetch(`https://metron.cloud/api/arc/${arc.id}/`);
    if (detailRes?.ok) {
      try { arc.desc = (await detailRes.json()).desc || ""; } catch { /* keep existing */ }
    }
  }

  // Fetch issue list only if modified or missing
  if (toFetchIssues.has(arc.id)) {
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

    arc.issueCount = count;

    if (issues.length > 0) {
      existingIssues[arc.id] = issues;
    }
  }
}

console.log("\n  done.");

// ── Write output files ────────────────────────────────────────────────────────
// Strip internal `modified` field — not needed by the frontend
const output = arcs.map(({ id, name, desc, slug, issueCount }) => ({ id, name, desc, slug, issueCount }));
output.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(output));
writeFileSync(issuesPath, JSON.stringify(existingIssues));

const processed = toProcess.length;
const skipped = arcs.length - processed;
console.log(`\nWrote ${arcs.length} arcs to arc-index.json (${processed} updated, ${skipped} unchanged).`);
console.log(`Wrote arc-issues.json (${Object.keys(existingIssues).length} arcs with issues).`);
