/**
 * Syncs LOCG wish lists and collections for all users who have a saved username.
 * Run nightly via GitHub Actions, or on-demand with SYNC_DB_USER_ID set to
 * target a specific user.
 *
 * LOCG user ID resolution (in priority order):
 *   1. LOCG_USER_ID env var (manual override, saved to DB for future runs)
 *   2. locg_list.locgUserId in DB (stored from a prior successful lookup)
 *   3. Profile page scraping (last resort, may fail on some runners)
 *
 * Required GitHub secrets:
 *   DATABASE_URL — Neon Postgres connection string
 */

import { Impit } from "impit";
import * as cheerio from "cheerio";
import pg from "pg";

const { Pool } = pg;
const BASE = "https://leagueofcomicgeeks.com";
const SERIES_CONCURRENCY = 4;   // parallel series→issue fetches per user
const USER_DELAY_MS = 3000;     // pause between users to avoid hammering LOCG

// ── LOCG scraping helpers ──────────────────────────────────────────────────────

async function findLocgUserIdByScaping(impit, slug) {
  const pages = [
    `${BASE}/profile/${slug}/pull-list`,
    `${BASE}/profile/${slug}`,
    `${BASE}/profile/${slug}/collection`,
  ];
  for (const url of pages) {
    try {
      console.log(`    Trying ${url}…`);
      const res = await impit.fetch(url);
      console.log(`    Status: ${res.status}, ok: ${res.ok}`);
      const text = await res.text();
      console.log(`    HTML length: ${text.length}, has 'data-user': ${text.includes("data-user")}`);
      const $ = cheerio.load(text);
      let id = 0;
      $("[data-user]").each((_, el) => { if (!id) id = Number($(el).attr("data-user")); });
      if (!id) $("[data-user-id]").each((_, el) => { if (!id) id = Number($(el).attr("data-user-id")); });
      if (!id) {
        $("script").each((_, el) => {
          if (id) return;
          const src = $(el).html() || "";
          const m = src.match(/"user_id"\s*:\s*(\d+)/) || src.match(/user_id\s*=\s*(\d+)/);
          if (m) id = parseInt(m[1], 10);
        });
      }
      if (id > 0) {
        console.log(`    Found LOCG user ID via scraping: ${id}`);
        return id;
      }
      console.log(`    No data-user attribute found in HTML`);
    } catch (e) {
      console.log(`    Error fetching ${url}: ${e.message}`);
    }
  }
  return null;
}

function parseSeries($) {
  const series = [];
  $("li").each((_, el) => {
    const name = $(el).find(".title.color-primary a").text().trim();
    const id = $(el).find("[data-id]").first().attr("data-id");
    if (name && id) series.push({ name, id });
  });
  return series;
}

function parseIssues($) {
  const issues = [];
  $("li.issue").each((_, el) => {
    const title = $(el).find(".title.color-primary a").text().trim();
    const dateAttr = $(el).find(".date[data-date]").attr("data-date");
    const year = dateAttr ? new Date(parseInt(dateAttr, 10) * 1000).getFullYear() : null;
    if (title) issues.push(year ? `${title} (${year})` : title);
  });
  return issues;
}

const AJAX_HEADERS = { "X-Requested-With": "XMLHttpRequest" };

async function warmUpSession(impit, slug) {
  // Visit a public page first so LOCG sets its session cookie.
  // The /comic/get_comics API endpoint returns HTML instead of JSON
  // when no session cookie is present.
  const url = `${BASE}/profile/${slug}/collection`;
  try {
    const res = await impit.fetch(url);
    console.log(`  Session warm-up: ${url} → ${res.status}`);
  } catch (e) {
    // Non-fatal — the API calls may still work on some hosts
    console.log(`  Session warm-up failed (${e.message}), proceeding anyway…`);
  }
}

async function fetchSeriesList(impit, listType, locgUserId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&user_id=${locgUserId}`;
  const res = await impit.fetch(url, { headers: AJAX_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const json = await res.json();
  const $ = cheerio.load(json.list || "");
  return parseSeries($);
}

async function fetchSeriesIssues(impit, listType, seriesId, locgUserId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&series_id=${seriesId}&user_id=${locgUserId}`;
  try {
    const res = await impit.fetch(url, { headers: AJAX_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    const $ = cheerio.load(json.list || "");
    return parseIssues($);
  } catch {
    return [];
  }
}

async function fetchAllIssues(impit, listType, seriesList, locgUserId) {
  const all = [];
  for (let i = 0; i < seriesList.length; i += SERIES_CONCURRENCY) {
    const batch = seriesList.slice(i, i + SERIES_CONCURRENCY);
    const results = await Promise.all(
      batch.map(s => fetchSeriesIssues(impit, listType, s.id, locgUserId))
    );
    all.push(...results.flat());
  }
  return all;
}

// ── Per-user sync ──────────────────────────────────────────────────────────────

async function syncUser(pool, impit, dbUserId, locgUsername, envLocgUserId) {
  const slug = locgUsername.toLowerCase();
  console.log(`\nSyncing @${locgUsername} (DB user ${dbUserId})…`);

  // Read existing locg_list to get stored locgUserId (if any)
  const { rows: existing } = await pool.query(
    "SELECT locg_list FROM users WHERE id = $1",
    [dbUserId]
  );
  const stored = existing[0]?.locg_list || {};

  // Resolve LOCG user ID: env override → stored in DB → scrape profile
  let locgUserId = null;
  let idSource = null;

  if (envLocgUserId) {
    locgUserId = envLocgUserId;
    idSource = "env var LOCG_USER_ID";
  } else if (stored.locgUserId) {
    locgUserId = stored.locgUserId;
    idSource = "stored in DB";
  } else {
    console.log(`  LOCG user ID not in env or DB — attempting profile scraping…`);
    locgUserId = await findLocgUserIdByScaping(impit, slug);
    idSource = "profile scraping";
  }

  if (!locgUserId) {
    console.error(`  ✗ Could not resolve LOCG user ID for '${locgUsername}'.`);
    console.error(`    Fix: trigger this workflow with locg_user_id input set to their numeric LOCG ID.`);
    console.error(`    (Find it by visiting their LOCG profile and inspecting the page source for data-user.)`);
    return;
  }

  console.log(`  LOCG user ID: ${locgUserId} (source: ${idSource})`);

  await warmUpSession(impit, slug);

  const [wishSeries, collSeries] = await Promise.all([
    fetchSeriesList(impit, 3, locgUserId).catch(e => { console.error(`  Wish series fetch failed: ${e.message}`); return []; }),
    fetchSeriesList(impit, 2, locgUserId).catch(e => { console.error(`  Coll series fetch failed: ${e.message}`); return []; }),
  ]);
  console.log(`  Series: ${wishSeries.length} wishlist, ${collSeries.length} collection`);

  const [wishlist, collection] = await Promise.all([
    fetchAllIssues(impit, 3, wishSeries, locgUserId),
    fetchAllIssues(impit, 2, collSeries, locgUserId),
  ]);
  console.log(`  Issues: ${wishlist.length} wishlist, ${collection.length} collection`);

  const payload = {
    ...stored,
    locgUserId,             // always persist so future runs skip the scraping step
    items: wishlist,
    collectionItems: collection,
    updatedAt: new Date().toISOString(),
    username: locgUsername,
  };

  await pool.query(
    "UPDATE users SET locg_list = $1 WHERE id = $2",
    [JSON.stringify(payload), dbUserId]
  );
  console.log(`  ✓ Updated DB`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const impit = new Impit({ browser: "chrome" });

const targetDbUserId = process.env.SYNC_DB_USER_ID || null;
// Numeric LOCG user ID override — only meaningful for single-user syncs
const envLocgUserId = process.env.LOCG_USER_ID ? parseInt(process.env.LOCG_USER_ID, 10) : null;

if (envLocgUserId && !targetDbUserId) {
  console.warn("Warning: LOCG_USER_ID is set but SYNC_DB_USER_ID is not. The ID will only be applied to the first user found.");
}

const { rows } = await pool.query(
  targetDbUserId
    ? "SELECT id, locg_list->>'username' AS username FROM users WHERE id = $1 AND locg_list->>'username' IS NOT NULL"
    : "SELECT id, locg_list->>'username' AS username FROM users WHERE locg_list->>'username' IS NOT NULL",
  targetDbUserId ? [targetDbUserId] : []
);

console.log(`Found ${rows.length} user(s) with LOCG username(s) to sync`);

for (let i = 0; i < rows.length; i++) {
  const { id, username } = rows[i];
  try {
    await syncUser(pool, impit, id, username, envLocgUserId);
  } catch (e) {
    console.error(`  ✗ Unexpected error for user ${id}:`, e.message);
  }
  if (i < rows.length - 1) await new Promise(r => setTimeout(r, USER_DELAY_MS));
}

await pool.end();
console.log("\nDone.");
