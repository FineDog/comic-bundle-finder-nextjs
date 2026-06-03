// Valuation search engine — searches eBay *sold* listings (last 90 days)
// with stricter filtering than the main bundle search.
//
// Uses the eBay Marketplace Insights API (buy.marketplace.insights), which is
// the modern REST equivalent of the deprecated Finding API findCompletedItems.
// Requires its own OAuth token with the buy.marketplace.insights scope.
//
// Key differences from lib/ebay.js:
//  - Sold/completed listings only, not active inventory
//  - Extended query-level exclusions (cgc, cbcs, pgx, facsimile, reprint, signed)
//  - Post-fetch blocklist rejects graded slabs, reprints, signed copies, damaged listings
//  - Lot listings rejected even when the target issue number appears in the range
//  - Year extracted from query parens and used to reject obvious year mismatches

import { parseTitle, titleMatchesQuery } from "./parse-title.js";

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_SECRET  = process.env.EBAY_SECRET;
const INSIGHTS_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const CATEGORY_ID  = "259104"; // eBay: Comics > Single Issues

// Separate token cache for the insights scope.
let insightsToken = null;
let insightsTokenExpiresAt = 0;

async function getInsightsToken() {
  if (insightsToken && Date.now() < insightsTokenExpiresAt) return insightsToken;
  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fbuy.marketplace.insights",
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to get Marketplace Insights token: ${JSON.stringify(data)}`);
  }
  insightsToken = data.access_token;
  insightsTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return insightsToken;
}

// ---------------------------------------------------------------------------
// Blocklist — any regex match in the listing title disqualifies the result.
// ---------------------------------------------------------------------------
const BLOCKLIST = [
  /\b(cgc|cbcs|pgx)\b/i,                                          // grading companies
  /\b(facsimile|facsimile\s+edition)\b/i,                         // facsimile reprints
  /\b(reprint|2nd\s+print|second\s+print|3rd\s+print)\b/i,        // other reprints
  /\b(omnibus|tpb|trade\s+paperback|digest|hardcover)\b/i,         // collected editions
  /\b(signed|autographed|signature\s+series)\b/i,                  // signed copies
  /\b(coverless|incomplete|missing\s+pages|water\s+damage)\b/i,    // damaged
];

function isBlocked(title) {
  return BLOCKLIST.some((re) => re.test(title));
}

// ---------------------------------------------------------------------------
// Year extraction — pull the publication year from user query parens.
// e.g. "Amazing Spider-Man #1 (1963)" → 1963
// ---------------------------------------------------------------------------
function extractQueryYear(query) {
  const m = query.match(/\((\d{4})\)/);
  return m ? parseInt(m[1], 10) : null;
}

// Returns true if the listing title contains a 4-digit year that is clearly
// *not* the query year.  Only fires when at least one year appears in the
// title — if the seller didn't include a year we give them the benefit of
// the doubt.
function yearMismatch(title, queryYear) {
  if (!queryYear) return false;
  const years = [...title.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) =>
    parseInt(m[1], 10)
  );
  if (years.length === 0) return false;
  return !years.includes(queryYear);
}

// ---------------------------------------------------------------------------
// Strict title match — same as titleMatchesQuery but also rejects listings
// where more than one issue number is present (lot listings).
// ---------------------------------------------------------------------------
function titleMatchesQueryStrict(listingTitle, queryString) {
  if (!titleMatchesQuery(listingTitle, queryString)) return false;
  const parsed = parseTitle(listingTitle);
  if (parsed.issueSet.size > 1) return false; // multiple issue numbers → lot
  return true;
}

// ---------------------------------------------------------------------------
// searchSoldListings(issueName, page?)
//
// Returns { items, total } where:
//   items: [{ title, url, price, dateSold }]
//   total: raw eBay result count before our post-filtering
// ---------------------------------------------------------------------------
export async function searchSoldListings(issueName, offset = 0) {
  if (!EBAY_APP_ID || !EBAY_SECRET) {
    throw new Error("EBAY_APP_ID / EBAY_SECRET environment variables are not set");
  }

  const token = await getInsightsToken();
  const queryYear = extractQueryYear(issueName);

  // Query-level exclusions keep obvious junk out of the eBay result set.
  const exclusions =
    "-lot -set -run -collection -bundle -wholesale " +
    "-cgc -cbcs -pgx -facsimile -reprint -signed -omnibus -tpb";

  const params = new URLSearchParams({
    q: `${issueName} ${exclusions}`,
    category_ids: CATEGORY_ID,
    limit: "200",
    offset: String(offset),
  });

  // Encode the filter the same way lib/ebay.js does to avoid double-encoding.
  const filter = "conditions:{NEW|USED}";
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}")
    .replace(/%7C/g, "|");

  const url = `${INSIGHTS_URL}?${params}&filter=${encodedFilter}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!res.ok) {
    throw new Error(`eBay Insights API HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const rawItems = data.itemSales ?? [];
  const total = data.total ?? 0;

  const items = [];
  for (const item of rawItems) {
    const title    = item.title ?? "";
    const itemUrl  = item.itemWebUrl ?? "";
    const priceRaw = item.lastSoldPrice?.value ?? "0";
    const dateSold = item.lastSoldDate ?? "";

    if (!titleMatchesQueryStrict(title, issueName)) continue;
    if (isBlocked(title)) continue;
    if (yearMismatch(title, queryYear)) continue;

    items.push({
      title,
      url: itemUrl,
      price: parseFloat(priceRaw),
      dateSold,
    });
  }

  return { items, total };
}

// ---------------------------------------------------------------------------
// searchSoldBatch(issues, concurrency?)
//
// Searches multiple issues with controlled concurrency.
// Returns [{ issue, items, total, error? }]
// ---------------------------------------------------------------------------
export async function searchSoldBatch(issues, concurrency = 4) {
  const results = [];
  for (let i = 0; i < issues.length; i += concurrency) {
    const batch = issues.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((issue) => searchSoldListings(issue))
    );
    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        results.push({ issue: batch[j], ...outcome.value });
      } else {
        results.push({ issue: batch[j], items: [], total: 0, error: outcome.reason?.message });
      }
    }
  }
  return results;
}
