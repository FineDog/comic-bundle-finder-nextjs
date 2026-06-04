// Valuation search engine — uses the existing Browse API (active listings)
// as a current-market-price proxy, with strict post-fetch filtering.
//
// Returns fully categorized listing data so callers can see exactly what
// was included, trimmed, or blocked and why.

import { getEbayToken } from "./ebay.js";
import { parseTitle, parseQuery, titleMatchesQuery } from "./parse-title.js";

const BROWSE_URL  = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const ITEM_URL    = "https://api.ebay.com/buy/browse/v1/item";
const CATEGORY_ID = "259104"; // Comics > Single Issues

// ---------------------------------------------------------------------------
// Status labels — every listing gets exactly one of these.
// ---------------------------------------------------------------------------
export const STATUS = {
  USED:                    "Used in FMV",
  TRIMMED_LOW:             "Trimmed (low end)",
  TRIMMED_HIGH:            "Trimmed (high end)",
  BLOCKED_GRADED:          "Blocked: graded slab",
  BLOCKED_REPRINT:         "Blocked: reprint / facsimile",
  BLOCKED_COLLECTED:       "Blocked: collected edition",
  BLOCKED_SIGNED:          "Blocked: signed copy",
  BLOCKED_DAMAGED:         "Blocked: damaged / incomplete",
  BLOCKED_LOT:             "Blocked: lot / ratio variant",
  TITLE_MISMATCH:          "Title mismatch",
  INSUFFICIENT:            "Insufficient data",
  // Variation / multi-select listings
  VARIATION_PENDING:       "Variation: pending lookup",   // internal only
  VARIATION_CONFIRMED:     "Variation: issue confirmed",  // included in FMV
  VARIATION_NOT_LISTED:    "Variation: issue not listed",
  VARIATION_NO_STRUCTURE:  "Variation: no variation data",
  VARIATION_LOOKUP_FAILED: "Variation: lookup failed",
};

// ---------------------------------------------------------------------------
// Block rules — checked in order; first match wins.
// ---------------------------------------------------------------------------
const BLOCK_RULES = [
  { status: STATUS.BLOCKED_GRADED,    re: /\b(cgc|cbcs|pgx)\b/i },
  { status: STATUS.BLOCKED_REPRINT,   re: /\b(facsimile|reprint|2nd\s+print|second\s+print|3rd\s+print)\b/i },
  { status: STATUS.BLOCKED_COLLECTED, re: /\b(omnibus|tpb|trade\s+paperback|digest|hardcover)\b/i },
  { status: STATUS.BLOCKED_SIGNED,    re: /\b(signed|autographed|signature\s+series|\bss\b)\b/i },
  { status: STATUS.BLOCKED_DAMAGED,   re: /\b(coverless|incomplete|missing\s+pages|water\s+damage)\b/i },
];

// Matches ratio incentive variant notation: "1:25", "1:100", "1.100" (some
// sellers use a period instead of a colon).  Requires 2+ digits after the
// separator so "1.0" (a grade) and "1.5" don't trigger.
const RATIO_VARIANT_RE = /\b1\s*[:.]\s*\d{2,}\b/;

// Matches number-dash-number range notation indicating a lot listing, e.g.
// "229-232", "1-20", "1-24".  Lookbehind/lookahead prevent matching the
// integer parts of decimal grades ("9.4-9.6" → "4-9" would otherwise fire).
const RANGE_LOT_RE = /(?<![.\d])\b\d+[-–]\d+\b(?![.\d])/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// True if the listing looks like a generic multi-select bin / you-pick listing
// that needs a detail lookup rather than title matching.
function isVariationCandidate(title) {
  return /\binventory\s+updated\b/i.test(title) ||
         /\bcomics?\s+bin\b/i.test(title) ||
         /\byou\s+(pick|choose)\b/i.test(title) ||
         /\bpick\s+(one|your)\b/i.test(title);
}

// True if the parsed issueSet contains more than one *issue-number-sized* value.
// Excludes:
//   - 4-digit year-like numbers (1900–2099): parseTitle incorrectly picks these up
//     when a year appears after the issue number ("Daredevil #230 1986 VF/NM")
//   - Numbers that appear as part of a decimal grade ("9.6", "7.5"): parseTitle
//     captures the integer part ("9", "7") before the dot
//   - Numbers that appear as part of a ratio variant notation ("1:25", "1:100"):
//     parseTitle captures the "1" before the colon
function hasMultipleIssueNumbers(parsed, title) {
  const nonYears = [...parsed.issueSet].filter((n) => {
    if (n >= 1900 && n <= 2099) return false;
    // Decimal grade: "9.6", "7.5" etc. — n immediately followed by .digit in title
    if (new RegExp(`\\b${n}\\.[0-9]`).test(title)) return false;
    // Ratio notation: "1:25", "1:100" etc. — n immediately followed by : in title
    if (new RegExp(`\\b${n}:`).test(title)) return false;
    return true;
  });
  return nonYears.length > 1;
}

// Returns a STATUS string if blocked, STATUS.VARIATION_PENDING for bin listings,
// or null if the listing passed all checks.
// queryMeta: the parsed metadataFilters from the user's search term — used to
// avoid blocking ratio variants when the user explicitly searched for one.
function getBlockReason(title, issueName, queryMeta) {
  // Bin / multi-select listings need a detail lookup — not a simple block.
  if (isVariationCandidate(title)) return STATUS.VARIATION_PENDING;

  // Range notation check before titleMatchesQuery — hyphenated ranges like
  // "1-20" or "229-232" fool the issue-number parser (it picks up the first
  // number and stops at the hyphen), so the target issue can appear to match.
  if (RANGE_LOT_RE.test(title)) return STATUS.BLOCKED_LOT;

  if (!titleMatchesQuery(title, issueName)) return STATUS.TITLE_MISMATCH;

  const parsed = parseTitle(title);
  if (hasMultipleIssueNumbers(parsed, title)) return STATUS.BLOCKED_LOT;

  for (const rule of BLOCK_RULES) {
    if (rule.re.test(title)) return rule.status;
  }

  // Block ratio incentive variants (1:25, 1:100, etc.) unless the user's search
  // explicitly includes a ratio — in that case they're searching FOR the variant.
  const queryIncludesRatio = queryMeta.some((f) => RATIO_VARIANT_RE.test(f));
  if (!queryIncludesRatio && RATIO_VARIANT_RE.test(title)) {
    return STATUS.BLOCKED_LOT; // reuse lot label — it's a rare variant, not a standard copy
  }

  return null; // passed all checks
}

// ---------------------------------------------------------------------------
// Variation listing detail lookup
//
// Calls the Browse API item endpoint for a bin/variation listing and checks
// whether the target issue appears in the structured variation data.
// Returns:
//   { found, variationData }
//   variationData: human-readable string of what was found (for the test Excel)
// ---------------------------------------------------------------------------
async function checkVariationListing(token, itemId, issueName) {
  const parsed = parseQuery(issueName);
  const targetIssue = parsed.issue; // the issue number we're looking for

  let itemDetail;
  try {
    const res = await fetch(`${ITEM_URL}/${encodeURIComponent(itemId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!res.ok) {
      return { found: false, variationData: `HTTP ${res.status}`, status: STATUS.VARIATION_LOOKUP_FAILED };
    }
    itemDetail = await res.json();
  } catch (err) {
    return { found: false, variationData: `Fetch error: ${err.message}`, status: STATUS.VARIATION_LOOKUP_FAILED };
  }

  // Collect all variation-related text from every field eBay might use.
  const variationStrings = [];

  // variationAttributes: [{name, variationAttributeValues: [{attributeValue}]}]
  for (const attr of itemDetail.variationAttributes ?? []) {
    const vals = (attr.variationAttributeValues ?? []).map((v) => v.attributeValue ?? "");
    variationStrings.push(`[${attr.name}]: ${vals.join(" | ")}`);
  }

  // localizedAspects: [{name, value}]
  for (const aspect of itemDetail.localizedAspects ?? []) {
    variationStrings.push(`${aspect.name}: ${aspect.value}`);
  }

  // additionalImages alt text sometimes carries variation labels
  for (const img of itemDetail.additionalImages ?? []) {
    if (img.imageUrl) variationStrings.push(`img: ${img.imageUrl}`);
  }

  // Short excerpt from description (HTML) as a last resort
  const desc = (itemDetail.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (desc) variationStrings.push(`desc: ${desc.slice(0, 400)}`);

  const variationData = variationStrings.join("\n") || "(no variation fields found)";

  if (!targetIssue) {
    // No issue number to match against — can't confirm
    return { found: false, variationData, status: STATUS.VARIATION_NO_STRUCTURE };
  }

  if (variationStrings.length === 0) {
    return { found: false, variationData: "(no variation fields found)", status: STATUS.VARIATION_NO_STRUCTURE };
  }

  // Match the target issue number against all collected strings.
  // Use a word-boundary match so #230 doesn't match #2300.
  const issuePattern = new RegExp(`#?\\b${targetIssue}\\b`);
  const found = variationStrings.some((s) => issuePattern.test(s));

  return {
    found,
    variationData,
    status: found ? STATUS.VARIATION_CONFIRMED : STATUS.VARIATION_NOT_LISTED,
  };
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
    return { fmv: null, confidence: "insufficient", formula: "No listings passed the filter.", trimCount: 0, usedCount: 0 };
  }

  const sorted = [...passedItems].sort((a, b) => a.price - b.price);

  let trimCount = 0;
  if (n >= 10) {
    trimCount = Math.max(1, Math.round(n * 0.1));
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
// ---------------------------------------------------------------------------
export async function searchForValuation(issueName) {
  const token = await getEbayToken();

  // Send eBay only the parsed series+volume+issue — not variant details.
  // Variant matching is handled post-fetch by titleMatchesQuery.
  const parsedQuery = parseQuery(issueName);
  const volumePart  = parsedQuery.volume ? ` vol ${parsedQuery.volume}` : "";
  const issuePart   = parsedQuery.issue  ? ` #${parsedQuery.issue}`     : "";
  const ebayQuery   = `${parsedQuery.series}${volumePart}${issuePart}`.trim();
  const queryMeta   = parsedQuery.metadataFilters ?? [];

  // Minimal query exclusions only — terms that are completely unambiguous and
  // cannot appear innocently in a legitimate single-issue listing title.
  // Everything else (lots, reprints, graded slabs, etc.) is handled post-fetch
  // by our filter chain, which is more precise than eBay keyword exclusions.
  // Do NOT add terms like -run, -set, -collection, -signed here — they appear
  // in common single-issue titles ("Miller run", "Born Again run", etc.) and
  // silently kill recall at the eBay query level.
  const exclusions = "-cgc -cbcs -pgx -omnibus -tpb";
  const q = `${ebayQuery} ${exclusions}`;
  // No conditions filter — eBay condition labels vary widely ("Very Good",
  // "Good", "Acceptable", "Used" etc.) and restricting to NEW|USED silently
  // drops legitimate listings with other condition values.
  // No buyingOptions filter — Best Offer listings are valid FMV data.
  const filter = "buyingOptions:{FIXED_PRICE|BEST_OFFER}";
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}").replace(/%7C/g, "|")
    .replace(/%2C/g, ",").replace(/%3A/g, ":");

  // Fetch from both ends of the price range in parallel so cheap copies
  // (ranked low by eBay's relevance algorithm) aren't missed when there are
  // more than 200 total listings.  Deduplication by itemId follows.
  const fetchPage = async (sort) => {
    const params = new URLSearchParams({ q, category_ids: CATEGORY_ID, limit: "200", sort });
    const res = await fetch(`${BROWSE_URL}?${params}&filter=${encodedFilter}`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (!res.ok) throw new Error(`eBay Browse API HTTP ${res.status}`);
    const data = await res.json();
    return { items: data.itemSummaries ?? [], total: data.total ?? 0 };
  };

  const [byPriceLow, byPriceHigh] = await Promise.all([
    fetchPage("price"),   // 200 cheapest
    fetchPage("-price"),  // 200 most expensive
  ]);

  const seen = new Set();
  const rawItems = [];
  for (const item of [...byPriceLow.items, ...byPriceHigh.items]) {
    const key = item.itemId ?? item.itemWebUrl;
    if (key && !seen.has(key)) { seen.add(key); rawItems.push(item); }
  }
  const ebayTotal = Math.max(byPriceLow.total, byPriceHigh.total);

  // ---------------------------------------------------------------------------
  // Pass 1 — categorize all items from the search results.
  // ---------------------------------------------------------------------------
  const listings          = [];
  const passedItems       = [];
  const variationPending  = []; // entries needing a detail lookup

  for (const item of rawItems) {
    const title  = item.title ?? "";
    const url    = item.itemWebUrl ?? "";
    const price  = parseFloat(item.price?.value ?? "0");
    const itemId = item.itemId ?? "";

    const blockReason = getBlockReason(title, issueName, queryMeta);
    const entry = { title, url, price, itemId, status: blockReason, variationData: null };
    listings.push(entry);

    if (blockReason === null) {
      passedItems.push(entry);
    } else if (blockReason === STATUS.VARIATION_PENDING) {
      variationPending.push(entry);
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 2 — resolve variation listings via item detail API.
  // ---------------------------------------------------------------------------
  for (const entry of variationPending) {
    const result = await checkVariationListing(token, entry.itemId, issueName);
    entry.status        = result.status;
    entry.variationData = result.variationData;
    if (result.found) {
      passedItems.push(entry); // confirmed — include in FMV
    }
  }

  // ---------------------------------------------------------------------------
  // FMV calculation — runs after both passes so confirmed variations are included.
  // ---------------------------------------------------------------------------
  const fmvResult = calculateFMV(passedItems);

  // Apply _trim → final status.  Variation-confirmed items that survived the
  // trim get their status overwritten to USED/TRIMMED_*; ones that were trimmed
  // keep the trim label (more informative than VARIATION_CONFIRMED).
  for (const item of passedItems) {
    if (item._trim) {
      // Only overwrite if the item came through normal filtering.
      // Variation-confirmed items get a combined label if trimmed.
      if (item.status === STATUS.VARIATION_CONFIRMED && item._trim !== STATUS.USED) {
        item.status = item._trim; // show as trimmed, not as "confirmed"
      } else if (item.status === null || item.status === STATUS.VARIATION_CONFIRMED) {
        item.status = item._trim;
      }
    } else {
      if (item.status === null) item.status = STATUS.INSUFFICIENT;
    }
    delete item._trim;
  }

  const counts = {
    fetched:            listings.length,
    matched:            listings.filter((i) => i.status !== STATUS.TITLE_MISMATCH).length,
    passed:             passedItems.length,
    used:               fmvResult.usedCount ?? 0,
    trimmed:            passedItems.filter((i) => i.status === STATUS.TRIMMED_LOW || i.status === STATUS.TRIMMED_HIGH).length,
    blocked:            listings.filter((i) => i.status?.startsWith("Blocked")).length,
    mismatch:           listings.filter((i) => i.status === STATUS.TITLE_MISMATCH).length,
    variationChecked:   variationPending.length,
    variationConfirmed: variationPending.filter((i) => i.status === STATUS.VARIATION_CONFIRMED || i.status === STATUS.USED || i.status === STATUS.TRIMMED_LOW || i.status === STATUS.TRIMMED_HIGH).length,
  };

  return {
    issue: issueName,
    ebayQuery: q,  // exact query string sent to eBay
    ebayTotal,
    fmv:        fmvResult.fmv,
    confidence: fmvResult.confidence,
    formula:    fmvResult.formula,
    counts,
    listings:   [...listings, ...variationPending.filter((e) => !listings.includes(e))],
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
        counts:     { fetched: 0, matched: 0, passed: 0, used: 0, trimmed: 0, blocked: 0, mismatch: 0, variationChecked: 0, variationConfirmed: 0 },
        listings:   [],
      });
    }
  }
  return results;
}
