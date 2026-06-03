// Valuation search engine — searches eBay *sold* listings (last 90 days)
// with stricter filtering than the main bundle search.
//
// Uses the eBay Finding API (findCompletedItems).  No OAuth needed — the
// App ID alone is sufficient for the Finding API.
//
// Key differences from lib/ebay.js:
//  - Sold/completed listings only, not active inventory
//  - Extended query-level exclusions (cgc, cbcs, pgx, facsimile, reprint, signed)
//  - Post-fetch blocklist rejects graded slabs, reprints, signed copies, damaged listings
//  - Lot listings rejected even when the target issue number appears in the range
//  - Year extracted from query parens and used to reject obvious year mismatches

import { parseTitle, titleMatchesQuery } from "./parse-title.js";

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const FINDING_API_URL = "https://svcs.ebay.com/services/search/FindingService/v1";
const CATEGORY_ID = "259104"; // eBay: Comics > Single Issues

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
export async function searchSoldListings(issueName, page = 1) {
  if (!EBAY_APP_ID) throw new Error("EBAY_APP_ID environment variable is not set");

  const queryYear = extractQueryYear(issueName);

  // Query-level exclusions keep obvious junk out of the eBay result set.
  const exclusions =
    "-lot -set -run -collection -bundle -wholesale " +
    "-cgc -cbcs -pgx -facsimile -reprint -signed -omnibus -tpb";

  const params = new URLSearchParams([
    ["OPERATION-NAME",              "findCompletedItems"],
    ["SERVICE-VERSION",             "1.0.0"],
    ["SECURITY-APPNAME",            EBAY_APP_ID],
    ["RESPONSE-DATA-FORMAT",        "JSON"],
    ["REST-PAYLOAD",                ""],
    ["keywords",                    `${issueName} ${exclusions}`],
    ["categoryId",                  CATEGORY_ID],
    ["itemFilter(0).name",          "SoldItemsOnly"],
    ["itemFilter(0).value",         "true"],
    ["itemFilter(1).name",          "ListingType"],
    ["itemFilter(1).value(0)",      "FixedPrice"],
    ["itemFilter(1).value(1)",      "Auction"],
    ["paginationInput.entriesPerPage", "100"],
    ["paginationInput.pageNumber",  String(page)],
    ["sortOrder",                   "EndTimeSoonest"],
  ]);

  const res = await fetch(`${FINDING_API_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`eBay Finding API HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const apiResponse = data.findCompletedItemsResponse?.[0];

  // Surface API-level errors clearly.
  const ack = apiResponse?.ack?.[0];
  if (ack === "Failure" || ack === "PartialFailure") {
    const errMsg = apiResponse?.errorMessage?.[0]?.error?.[0]?.message?.[0] ?? "Unknown API error";
    throw new Error(`eBay Finding API error: ${errMsg}`);
  }

  const rawItems = apiResponse?.searchResult?.[0]?.item ?? [];
  const total = parseInt(
    apiResponse?.paginationOutput?.[0]?.totalEntries?.[0] ?? "0",
    10
  );

  const items = [];
  for (const item of rawItems) {
    const title    = item.title?.[0] ?? "";
    const itemUrl  = item.viewItemURL?.[0] ?? "";
    const priceRaw = item.sellingStatus?.[0]?.currentPrice?.[0]?.["__value__"] ?? "0";
    const dateSold = item.listingInfo?.[0]?.endTime?.[0] ?? "";

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
