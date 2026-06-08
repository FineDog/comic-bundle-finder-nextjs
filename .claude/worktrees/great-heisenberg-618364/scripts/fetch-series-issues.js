// Generic script to fetch all issues for a Metron series and write them to data/<output>.
//
// Usage:
//   node --env-file=../.env.local scripts/fetch-series-issues.js --series-id=1581 --output=xmen-vol1-issues.json
//   node --env-file=../.env.local scripts/fetch-series-issues.js --series-id=1600 --output=daredevil-vol1-issues.json
//
// Or set env vars manually:
//   $env:METRON_USERNAME='...'; $env:METRON_PASSWORD='...'; node scripts/fetch-series-issues.js --series-id=1581 --output=xmen-vol1-issues.json

const fs = require("fs");
const path = require("path");

const METRON_USERNAME = process.env.METRON_USERNAME;
const METRON_PASSWORD = process.env.METRON_PASSWORD;

// Parse CLI args (--key=value or --key value)
function getArg(name) {
  const prefix = `--${name}=`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i].startsWith(prefix)) return process.argv[i].slice(prefix.length);
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) return process.argv[i + 1];
  }
  return null;
}

// "The X-Men (1963) #12" + "1965-09-01" → "The X-Men #12 (1965)"
function makeIssueString(issueField, coverDate) {
  const year = coverDate ? coverDate.slice(0, 4) : "";
  const name = issueField.replace(/\s*\(\d{4}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return year ? `${name} (${year})` : name;
}

async function fetchPage(seriesId, page) {
  const auth = Buffer.from(`${METRON_USERNAME}:${METRON_PASSWORD}`).toString("base64");
  const res = await fetch(
    `https://metron.cloud/api/issue/?series_id=${seriesId}&page=${page}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`Metron API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const seriesId = getArg("series-id");
  const outputFile = getArg("output");

  if (!seriesId || !outputFile) {
    console.error("Usage: node fetch-series-issues.js --series-id=<id> --output=<filename>.json");
    process.exit(1);
  }
  if (!METRON_USERNAME || !METRON_PASSWORD) {
    console.error("METRON_USERNAME and METRON_PASSWORD env vars are required.");
    process.exit(1);
  }

  console.log(`Fetching series ID ${seriesId} → data/${outputFile}`);

  const issues = [];
  let page = 1;

  while (true) {
    const data = await fetchPage(seriesId, page);
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

  const outPath = path.join(__dirname, "..", "data", outputFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2));
  console.log(`\nWrote ${issues.length} issues to ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
