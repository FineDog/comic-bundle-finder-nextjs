// Valuation search engine — uses the existing Browse API (active listings)
// as a current-market-price proxy, with strict post-fetch filtering.
//
// Returns fully categorized listing data so callers can see exactly what
// was included, trimmed, or blocked and why.

import { getEbayToken } from "./ebay.js";
import { parseTitle, parseQuery, titleMatchesQuery } from "./parse-title.js";

const BROWSE_URL  = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const CATEGORY_ID = "259104"; // Comics > Single Issues

// ---------------------------------------------------------------------------
// Status labels — every listing gets exactly one of these.
// ---------------------------------------------------------------------------
export const STATUS = {
  USED:               "Used in FMV",
  TRIMMED_LOW:        "Trimmed (low end)",
  TRIMMED_HIGH:       "Trimmed (high end)",
  BLOCKED_GRADED:     "Blocked: graded slab",
  BLOCKED_REPRINT:    "Blocked: reprint / facsimile",
  BLOCKED_COLLECTED:  "Blocked: collected edition",
  BLOCKED_SIGNED:     "Blocked: signed copy",
  BLOCKED_DAMAGED:    "Blocked: damaged / incomplete",
  BLOCKED_LOT:        "Blocked: lot listing",
  BLOCKED_YEAR:       "Blocked: year mismatch",
  TITLE_MISMATCH:     "Title mismatch",
  INSUFFICIENT:       "Insufficient data",
};

// ---------------------------------------------------------------------------
// Block rules — checked in order; first match wins.
// ---------------------------------------------------------------------------
const BLOCK_RULES = [
  { status: STATUS.BLOCKED_GRADED,    re: /\b(cgc|cbcs|pgx)\b/i },
  { status: STATUS.BLOCKED_REPRINT,   re: /\b(facsimile|reprint|2nd\s+print|second\s+print|3rd\s+print)\b/i },
  { status: STATUS.BLOCKED_COLLECTED, re: /\b(omnibus|tpb|trade\s+paperback|digest|hardcover)\b/i },
  { status: STATUS.BLOCKED_SIGNED,    re: /\b(signed|autographed|signature\s+series)\b/i },
  { status: STATUS.BLOCKED_DAMAGED,   re: /\b(coverless|incomplete|missing\s+pages|water\s+damage)\b/i },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractQueryYear(query) {
  const m = query.match(/\((\d{4})\)/);
  return m ? parseInt(m[1], 10) : null;
}

function yearMismatch(title, queryYear) {
  if (!queryYear) return false;
  const years = [...title.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) =>
    parseInt(m[1], 10)
  );
  if (years.length === 0) return false; // no year in title → benefit of the doubt
  return !years.includes(queryYear);
}

// True if a listing title looks like a generic multi-select bin listing
// (e.g. "$2 Comics Bin (Inventory Updated: 5/25/2026)").
function isGenericBinListing(title) {
  return /\binventory\s+updated\b/i.test(title) ||
         /\bcomics?\s+bin\b/i.test(title) ||
         /\byou\s+(pick|choose)\b/i.test(title);
}

// True if the parsed issueSet contains more than one *issue-number-sized* value.
// Excludes 4-digit year-like numbers (1900–2099) which parseTitle incorrectly
// picks up as consecutive issue numbers when a year appears after the issue number
// (e.g. "Daredevil #230 1986 VF/NM" → issueSet {230, 1986}).
function hasMultipleIssueNumbers(parsed) {
  const nonYears = [...parsed.issueSet].filter((n) => n < 1900 || n > 2099);
  return nonYears.length > 1;
}

// Returns a STATUS string if the listing should be blocked, null if it passed.
function getBlockReason(title, issueName, queryYear) {
  // Generic bin / multi-select listings — can't match a specific issue.
  if (isGenericBinListing(title)) return STATUS.BLOCKED_LOT;

  if (!titleMatchesQuery(title, issueName)) return STATUS.TITLE_MISMATCH;

  const parsed = parseTitle(title);
  // Only flag as a lot if there are multiple *issue-sized* numbers — not years.
  if (hasMultipleIssueNumbers(parsed)) return STATUS.BLOCKED_LOT;

  for (const rule of BLOCK_RULES) {
    if (rule.re.test(title)) return rule.status;
  }

  if (yearMismatch(title, queryYear)) return STATUS.BLOCKED_YEAR;

  return null; // passed all checks
}

// ---------------------------------------------------------------------------
// FMV calculation
//
// Trim strategy:
//   n >= 10 → drop bottom 10% and top 10% (at least 1 each end)
//   3–9     → drop 1 each end
//   < 3     → no trimming; flag as low confidence
// ---------------------------------------------------------------------------
function calculateFMV(passedItems) {
  const n = passedItems.length;

  if (n === 0) {
    return {
      fmv: null, confidence: "insufficient",
      formula: "No listings passed the filter.",
      trimCount: 0,
    };
  }

  // Sort ascending by price; sort is on cloned references so originals unaffected.
  const sorted = [...passedItems].sort((a, b) => a.price - b.price);

  let trimCount = 0;
  if (n >= 10) {
    trimCount = Math.max(1, Math.round(n * 0.1));
    // Ensure we don't trim everything
    if (trimCount * 2 >= n) trimCount = Math.floor((n - 1) / 2);
  } else if (n >= 3) {
    trimCount = 1;
  }

  const trimLow  = sorted.slice(0, trimCount);
  const trimHigh = trimCount > 0 ? sorted.slice(n - trimCount) : [];
  const used     = sorted.slice(trimCount, trimCount > 0 ? n - trimCount : n);

  const fmv = used.reduce((sum, item) => sum + item.price, 0) / used.length;

  // Mark trim status directly on the objects (passed by reference).
  for (const item of trimLow)  item._trim = STATUS.TRIMMED_LOW;
  for (const item of trimHigh) item._trim = STATUS.TRIMMED_HIGH;
  for (const item of used)     item._trim = STATUS.USED;

  // Build human-readable formula string.
  const usedPrices = used.map((i) => `$${i.price.toFixed(2)}`).join(" + ");
  let formula;
  if (trimCount === 0) {
    formula =
      `Mean of all ${n} filtered listings (too few to trim): ` +
      `(${usedPrices}) ÷ ${used.length} = $${fmv.toFixed(2)}`;
  } else {
    const pct = Math.round((trimCount / n) * 100);
    formula =
      `Trimmed mean: sorted ${n} prices; ` +
      `dropped ${trimCount} lowest [${trimLow.map((i) => `$${i.price.toFixed(2)}`).join(", ")}] ` +
      `and ${trimCount} highest [${trimHigh.map((i) => `$${i.price.toFixed(2)}`).join(", ")}] ` +
      `(~${pct}% each end); ` +
      `averaged remaining ${used.length}: (${usedPrices}) ÷ ${used.length} = $${fmv.toFixed(2)}`;
  }

  const confidence = n >= 10 ? "high" : n >= 5 ? "medium" : "low";
  return { fmv, confidence, formula, trimCount, usedCount: used.length };
}

// ---------------------------------------------------------------------------
// searchForValuation(issueName)
//
// Returns a fully-annotated result object:
// {
//   issue, ebayTotal, fmv, confidence, formula,
//   counts: { fetched, matched, passed, used, trimmed, blocked, mismatch },
//   listings: [{ title, url, price, status }]
// }
// ---------------------------------------------------------------------------
export async function searchForValuation(issueName) {
  const token = await getEbayToken();
  const queryYear = extractQueryYear(issueName);

  // Build the eBay query from only the essential identifiers — series name,
  // issue number, and volume.  Sending the full user string (including variant
  // details like "JEEHYUNG LEE 1:100 VIRGIN VARIANT") makes eBay return zero
  // results because sellers write variant names differently.  Variant/metadata
  // matching is handled post-fetch by titleMatchesQuery's metadataFilters.
  const parsed = parseQuery(issueName);
  const volumePart = parsed.volume ? ` vol ${parsed.volume}` : "";
  const issuePart  = parsed.issue  ? ` #${parsed.issue}`      : "";
  const ebayQuery  = `${parsed.series}${volumePart}${issuePart}`.trim();

  const exclusions =
    "-lot -set -run -collection -bundle -wholesale " +
    "-cgc -cbcs -pgx -facsimile -reprint -signed -omnibus -tpb";

  const params = new URLSearchParams({ q: `${ebayQuery} ${exclusions}`, category_ids: CATEGORY_ID, limit: "200" });
  const filter = "buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}";
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}").replace(/%7C/g, "|")
    .replace(/%2C/g, ",").replace(/%3A/g, ":");

  const res = await fetch(`${BROWSE_URL}?${params}&filter=${encodedFilter}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  if (!res.ok) throw new Error(`eBay Browse API HTTP ${res.status}`);

  const data = await res.json();
  const rawItems    = data.itemSummaries ?? [];
  const ebayTotal   = data.total ?? 0;

  // Build categorized listing array.
  const listings   = [];
  const passedItems = [];

  for (const item of rawItems) {
    const title = item.title ?? "";
    const url   = item.itemWebUrl ?? "";
    const price = parseFloat(item.price?.value ?? "0");

    const blockReason = getBlockReason(title, issueName, queryYear);
    const entry = { title, url, price, status: blockReason }; // status=null means passed
    listings.push(entry);
    if (blockReason === null) passedItems.push(entry);
  }

  // Calculate FMV and assign trim statuses via _trim property.
  const fmvResult = calculateFMV(passedItems);

  // Apply _trim → status on passed items.
  for (const item of passedItems) {
    item.status = item._trim ?? STATUS.INSUFFICIENT;
    delete item._trim;
  }

  const counts = {
    fetched:  listings.length,
    matched:  listings.filter((i) => i.status !== STATUS.TITLE_MISMATCH).length,
    passed:   passedItems.length,
    used:     fmvResult.usedCount ?? 0,
    trimmed:  passedItems.filter((i) => i.status === STATUS.TRIMMED_LOW || i.status === STATUS.TRIMMED_HIGH).length,
    blocked:  listings.filter((i) => i.status?.startsWith("Blocked")).length,
    mismatch: listings.filter((i) => i.status === STATUS.TITLE_MISMATCH).length,
  };

  return {
    issue: issueName,
    ebayTotal,
    fmv:        fmvResult.fmv,
    confidence: fmvResult.confidence,
    formula:    fmvResult.formula,
    counts,
    listings,
  };
}

// Sequential batch — avoids any API rate concerns.
export async function searchForValuationBatch(issues) {
  const results = [];
  for (const issue of issues) {
    try {
      results.push(await searchForValuation(issue));
    } catch (err) {
      results.push({
        issue,
        ebayTotal:  0,
        fmv:        null,
        confidence: "error",
        formula:    `Error: ${err.message}`,
        counts:     { fetched: 0, matched: 0, passed: 0, used: 0, trimmed: 0, blocked: 0, mismatch: 0 },
        listings:   [],
      });
    }
  }
  return results;
}
