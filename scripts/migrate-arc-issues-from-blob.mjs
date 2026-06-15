// One-time migration: reads all arc issue lists from Vercel Blob CDN (plain fetch —
// no Advanced Operations) and writes them to public/data/arc-issues.json.
//
// Run once after the code change, before deploying:
//   BLOB_READ_WRITE_TOKEN=xxx node scripts/migrate-arc-issues-from-blob.mjs
//
// After this script succeeds, commit public/data/arc-issues.json and push.
// Future nightly runs of refresh-arc-index.js will maintain the file going forward.

import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN must be set.");
  process.exit(1);
}

const m = /vercel_blob_rw_([^_]+)_/.exec(token);
if (!m) {
  console.error("Could not parse store ID from BLOB_READ_WRITE_TOKEN.");
  process.exit(1);
}
const BASE_URL = `https://${m[1]}.public.blob.vercel-storage.com`;

const arcIndex = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "arc-index.json"), "utf-8")
);

console.log(`Fetching issue lists for ${arcIndex.length} arcs from CDN...`);

const issues = {};
let found = 0;
let missing = 0;
const CONCURRENCY = 20;

for (let i = 0; i < arcIndex.length; i += CONCURRENCY) {
  const batch = arcIndex.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async ({ id }) => {
      try {
        const r = await fetch(`${BASE_URL}/arc-issues/${id}.json`);
        if (!r.ok) { missing++; return; }
        const data = await r.json();
        if (data.issues?.length) {
          issues[id] = data.issues;
          found++;
        } else {
          missing++;
        }
      } catch {
        missing++;
      }
    })
  );
  process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, arcIndex.length)}/${arcIndex.length} checked (${found} found, ${missing} missing)`);
}

console.log(`\n\nDone. Writing arc-issues.json with ${found} arcs.`);
writeFileSync(
  join(process.cwd(), "public", "data", "arc-issues.json"),
  JSON.stringify(issues)
);
console.log("Wrote public/data/arc-issues.json");
