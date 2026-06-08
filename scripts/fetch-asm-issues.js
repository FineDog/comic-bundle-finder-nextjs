// ⚠️  ONE-OFF LOCAL SCRIPT — DO NOT RUN FROM VERCEL OR ANY CI/CD AUTOMATION ⚠️
//
// This script makes live Metron API calls. It may only be run manually from a
// local machine with a stable IP. Running it from Vercel (rotating IPs) or any
// automated job other than the designated GitHub Actions workflows violates
// Metron's ToS and can result in a permanent account ban.
//
// One-time script to fetch all Amazing Spider-Man Vol. 1 issues from Metron API
// and write them to data/asm-vol1-issues.json.
//
// Usage (Node 20+):
//   node --env-file=../.env.local scripts/fetch-asm-issues.js
//
// Or set env vars manually:
//   $env:METRON_USERNAME='...'; $env:METRON_PASSWORD='...'; node scripts/fetch-asm-issues.js

const fs = require("fs");
const path = require("path");

const METRON_USERNAME = process.env.METRON_USERNAME;
const METRON_PASSWORD = process.env.METRON_PASSWORD;
const SERIES_ID = 835; // Amazing Spider-Man Vol. 1

// "The Amazing Spider-Man (1963) #72" + "1969-05-01" → "The Amazing Spider-Man #72 (1969)"
function makeIssueString(issueField, coverDate) {
  const year = coverDate ? coverDate.slice(0, 4) : "";
  const name = issueField.replace(/\s*\(\d{4}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return year ? `${name} (${year})` : name;
}

async function fetchPage(page) {
  const auth = Buffer.from(`${METRON_USERNAME}:${METRON_PASSWORD}`).toString("base64");
  const res = await fetch(
    `https://metron.cloud/api/issue/?series_id=${SERIES_ID}&page=${page}`,
    { headers: { Authorization: `Basic ${auth}`, "User-Agent": "ComicBundleFinder/1.0" } }
  );
  if (!res.ok) throw new Error(`Metron API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!METRON_USERNAME || !METRON_PASSWORD) {
    console.error("METRON_USERNAME and METRON_PASSWORD env vars are required.");
    console.error("Run with: node --env-file=../.env.local scripts/fetch-asm-issues.js");
    process.exit(1);
  }

  const issues = [];
  let page = 1;

  while (true) {
    const data = await fetchPage(page);
    for (const issue of data.results) {
      issues.push({
        number: issue.number,
        issueName: makeIssueString(issue.issue, issue.cover_date),
        coverDate: issue.cover_date,
        image: issue.image,
      });
    }
    console.log(`Page ${page}: fetched ${issues.length} / ${data.count}`);
    if (!data.next) break;
    page++;
  }

  issues.sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));

  const outPath = path.join(__dirname, "..", "data", "asm-vol1-issues.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2));
  console.log(`\nWrote ${issues.length} issues to ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
