// Fetches all story arcs from the Metron API and writes
// public/data/arc-index.json for the collection guides search bar.
//
// Run nightly via GitHub Actions. Also runnable manually:
//   METRON_USERNAME=x METRON_PASSWORD=y node scripts/refresh-arc-index.js
//
// Output format:
//   [{ "id": 123, "name": "Brand New Day", "slug": "123-brand-new-day" }, ...]

import { writeFileSync, mkdirSync } from "fs";
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

const arcs = [];
let nextUrl = "https://metron.cloud/api/arc/?page_size=100";
let page = 1;

console.log("Fetching story arcs from Metron...");

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
    });
  }

  console.log(`${data.results?.length ?? 0} arcs (${arcs.length} total)`);

  nextUrl = data.next || null;
  page++;

  // Polite delay between pages
  if (nextUrl) await sleep(1000);
}

arcs.sort((a, b) => a.name.localeCompare(b.name));

const outDir = join(process.cwd(), "public", "data");
mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, "arc-index.json");
writeFileSync(outPath, JSON.stringify(arcs));

console.log(`\nWrote ${arcs.length} arcs to public/data/arc-index.json`);
