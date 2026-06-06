/**
 * Syncs LOCG wish lists and collections for all users who have a saved username.
 * Run nightly via GitHub Actions, or on-demand with SYNC_DB_USER_ID set to
 * target a specific user.
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

async function findLocgUserId(impit, slug) {
  const pages = [
    `${BASE}/profile/${slug}/pull-list`,
    `${BASE}/profile/${slug}`,
    `${BASE}/profile/${slug}/collection`,
  ];
  for (const url of pages) {
    try {
      const text = await impit.fetch(url).then(r => r.text());
      const $ = cheerio.load(text);
      let id = 0;
      $("[data-user]").each((_, el) => { if (!id) id = Number($(el).attr("data-user")); });
      if (!id) $("[data-user-id]").each((_, el) => { if (!id) id = Number($(el).attr("data-user-id")); });
      if (id > 0) return id;
      $("script").each((_, el) => {
        if (id) return;
        const src = $(el).html() || "";
        const m = src.match(/"user_id"\s*:\s*(\d+)/) || src.match(/user_id\s*=\s*(\d+)/);
        if (m) id = parseInt(m[1], 10);
      });
      if (id > 0) return id;
    } catch {}
  }
  throw new Error(`Could not find LOCG user ID for '${slug}'`);
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

async function fetchSeriesList(impit, listType, locgUserId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&user_id=${locgUserId}`;
  const json = await impit.fetch(url).then(r => r.json());
  const $ = cheerio.load(json.list || "");
  return parseSeries($);
}

async function fetchSeriesIssues(impit, listType, seriesId, locgUserId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&series_id=${seriesId}&user_id=${locgUserId}`;
  try {
    const json = await impit.fetch(url).then(r => r.json());
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

async function syncUser(pool, impit, dbUserId, locgUsername) {
  const slug = locgUsername.toLowerCase();
  console.log(`\nSyncing @${locgUsername} (DB user ${dbUserId})…`);

  let locgUserId;
  try {
    locgUserId = await findLocgUserId(impit, slug);
    console.log(`  LOCG user ID: ${locgUserId}`);
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    return;
  }

  const [wishSeries, collSeries] = await Promise.all([
    fetchSeriesList(impit, 3, locgUserId).catch(() => []),
    fetchSeriesList(impit, 2, locgUserId).catch(() => []),
  ]);
  console.log(`  Series: ${wishSeries.length} wishlist, ${collSeries.length} collection`);

  const [wishlist, collection] = await Promise.all([
    fetchAllIssues(impit, 3, wishSeries, locgUserId),
    fetchAllIssues(impit, 2, collSeries, locgUserId),
  ]);
  console.log(`  Issues: ${wishlist.length} wishlist, ${collection.length} collection`);

  const { rows } = await pool.query("SELECT locg_list FROM users WHERE id = $1", [dbUserId]);
  const existing = rows[0]?.locg_list || {};

  const payload = {
    ...existing,
    items: wishlist,
    collectionItems: collection,
    updatedAt: new Date().toISOString(),
    username: locgUsername,
  };

  await pool.query("UPDATE users SET locg_list = $1 WHERE id = $2", [JSON.stringify(payload), dbUserId]);
  console.log(`  ✓ Updated DB`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const impit = new Impit({ browser: "chrome" });

const targetDbUserId = process.env.SYNC_DB_USER_ID || null;

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
    await syncUser(pool, impit, id, username);
  } catch (e) {
    console.error(`  ✗ Unexpected error for user ${id}:`, e.message);
  }
  if (i < rows.length - 1) await new Promise(r => setTimeout(r, USER_DELAY_MS));
}

await pool.end();
console.log("\nDone.");
