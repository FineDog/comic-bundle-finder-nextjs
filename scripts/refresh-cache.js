// Fetches fresh eBay results for every issue in every series and writes them
// to data/cache/{slug}.json. Run nightly by GitHub Actions; the commit
// triggers a Vercel redeploy so the app always serves up-to-date cached data.
//
// Required env vars (set as GitHub Actions secrets):
//   EBAY_APP_ID, EBAY_SECRET
// Optional:
//   EBAY_CAMPAIGN_ID  (affiliate links — same value as in Vercel)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getEbayToken, searchEbayBatch } from "../lib/ebay.js";
import { SERIES } from "../lib/series-config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function refreshSeries(slug, config, token) {
  const issues = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", config.dataFile), "utf-8")
  );
  console.log(`  ${config.displayName}: ${issues.length} issues`);

  const results = await searchEbayBatch(token, issues);

  const issueMap = {};
  for (const { issue, listings } of results) {
    issueMap[issue.number] = listings;
  }

  return { issueMap, count: issues.length };
}

async function main() {
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_SECRET) {
    console.error("EBAY_APP_ID and EBAY_SECRET environment variables are required.");
    process.exit(1);
  }

  const cacheDir = path.join(ROOT, "data", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const token = await getEbayToken();
  const cachedAt = Date.now();

  console.log("Fetching eBay data...");
  for (const [slug, config] of Object.entries(SERIES)) {
    const { issueMap, count } = await refreshSeries(slug, config, token);
    fs.writeFileSync(
      path.join(cacheDir, `${slug}.json`),
      JSON.stringify({ cachedAt, issues: issueMap })
    );
    console.log(`  ✓ Wrote ${count} issues → data/cache/${slug}.json`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
