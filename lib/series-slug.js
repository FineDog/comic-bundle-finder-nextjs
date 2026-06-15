// lib/series-slug.js
// Single source of truth for mapping dynamic (Metron-indexed) series between
// their metron ID and their public URL slug.
//
// Public series URLs used to be /series/metron-<id>. They are now name-based:
//   /series/infamous-iron-man-2016
// The slug is derived from the series base name plus its first-published year,
// because Metron's "volume" field is unreliable (≈88% of series are "volume 1"
// regardless of how many distinct runs share a name). The year is what actually
// distinguishes runs, so it is the disambiguator.
//
// Internally everything is still keyed by metron ID — the Postgres issue list
// (series_issues.metron_id) and the Blob cache path (dynamic-series/metron-<id>/…)
// are unchanged. This module only translates between that ID and the URL slug.
//
// NOTE: locally-configured series (the SERIES registry in lib/series-config.js)
// keep their own hand-written slugs and are NOT handled here. slugToMetronId
// returns null for them so callers fall through to the local-config path.

import fs from "fs";
import path from "path";

// Strip a trailing "(YYYY)" and slugify: "The Infamous Iron Man (2016)" -> "infamous-iron-man"
export function baseNameToSlug(name) {
  return String(name || "")
    .replace(/\s*\(\d{4,}\)\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yearOf(name) {
  const m = /\((\d{4})\)\s*$/.exec(String(name || "").trim());
  return m ? m[1] : null;
}

// The slug a single index entry would get if it had no collision.
function baseSlugFor(entry) {
  const base = baseNameToSlug(entry.name);
  if (!base) return null; // name was all punctuation — force the id-based fallback
  const year = yearOf(entry.name);
  return year ? `${base}-${year}` : base;
}

// ── Index loading + memoized slug maps ──────────────────────────────────────
// Parsed once per serverless instance.

let indexCache = null;
function loadIndex() {
  if (indexCache) return indexCache;
  try {
    indexCache = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public", "data", "series-index.json"), "utf-8")
    );
  } catch {
    indexCache = [];
  }
  return indexCache;
}

let maps = null;
function buildMaps() {
  if (maps) return maps;
  const index = loadIndex();

  // First pass: count how many entries want each base slug so we know where to
  // disambiguate. Any base slug claimed by more than one series — plus any entry
  // whose name produced no usable slug — falls back to "<base>-<id>", which is
  // always unique and round-trips cleanly.
  const counts = new Map();
  for (const entry of index) {
    const base = baseSlugFor(entry);
    if (base) counts.set(base, (counts.get(base) || 0) + 1);
  }

  const idToSlug = new Map();
  const slugToId = new Map();
  for (const entry of index) {
    const base = baseSlugFor(entry);
    const slug = !base || counts.get(base) > 1 ? `${base || "series"}-${entry.id}` : base;
    idToSlug.set(entry.id, slug);
    slugToId.set(slug, entry.id);
  }

  maps = { idToSlug, slugToId };
  return maps;
}

// Public slug for a dynamic series, e.g. metronIdToSlug(1702) -> "infamous-iron-man-2016".
// Returns null if the id is not in the static index.
export function metronIdToSlug(id) {
  return buildMaps().idToSlug.get(Number(id)) ?? null;
}

// Resolve a public slug back to a metron ID, e.g. "infamous-iron-man-2016" -> 1702.
// Returns null for slugs that are not dynamic series (e.g. locally-configured ones).
export function slugToMetronId(slug) {
  return buildMaps().slugToId.get(String(slug)) ?? null;
}

// The series-index entry for a metron ID, or null. Convenience for callers that
// need the name/volume/issueCount alongside the slug.
export function getSeriesById(id) {
  return loadIndex().find((s) => s.id === Number(id)) ?? null;
}

// The full parsed series index (memoized). Exported so callers don't re-read the file.
export function getSeriesIndex() {
  return loadIndex();
}
