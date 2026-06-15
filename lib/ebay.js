// Shared eBay Browse API helpers used by series result and refresh routes.

import { titleMatchesQuery } from "./parse-title.js";

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_SECRET = process.env.EBAY_SECRET;
const CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || "";
const CATEGORY_ID = "259104"; // Comics > Single Issues
const MAX_RESULTS = 200;

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getEbayToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get eBay token.");
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function makeAffiliateUrl(url) {
  if (!CAMPAIGN_ID || !url) return url;
  const suffix = `mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${CAMPAIGN_ID}&toolid=10001&mkevt=1`;
  return url.includes("?") ? `${url}&${suffix}` : `${url}?${suffix}`;
}

// Canonical hyphenated words that appear in comic series names.
// When a user omits the hyphen (e.g. "spiderman"), we run a second eBay
// query with the canonical form and merge results to work around the
// Browse API not normalising these the way the website does.
const HYPHENATED_WORDS = [
  // Spider-* family
  "spider-man", "spider-girl", "spider-gwen", "spider-woman",
  "spider-verse", "spider-ham",
  // X-* family
  "x-men", "x-force", "x-factor", "x-23", "x-statix", "x-treme",
  // Other hyphenated series
  "she-hulk", "man-thing", "star-lord",
];

// Returns all query string variants needed to cover both hyphenated and flat
// token forms (e.g. "spider-man" and "spiderman").  Works in both directions:
// input with hyphens gets a flat variant added, input without gets a hyphenated
// variant added.  This ensures DB-style names like "Amazing Spider-Man #155"
// also query "Amazing Spiderman #155" so neither form is silently missed.
function getQueryVariants(issueName) {
  const lower = issueName.toLowerCase();
  const variants = new Set([issueName]);
  for (const word of HYPHENATED_WORDS) {
    const flat = word.replace(/-/g, "");
    if (lower.includes(word)) {
      variants.add(issueName.replace(new RegExp(word, "gi"), flat));
    } else if (new RegExp(`\\b${flat}\\b`, "i").test(issueName)) {
      variants.add(issueName.replace(new RegExp(`\\b${flat}\\b`, "gi"), word));
    }
  }
  return [...variants];
}

// Returns { items, total } for an issue.
// items: array of { seller, price, title, url, shipping, promotions }
// total: max result count across variants (used by client to decide if Wave 2 is needed)
// offset, zip, and country mirror the main /api/search behaviour — pass defaults for series/arc pages.
// zip takes priority (gives accurate domestic rates); country alone is used for international
// visitors so eBay can still return zone-based shipping estimates without a postal code.
export async function searchEbay(token, issueName, offset = 0, zip = null, country = null) {
  const EXCLUSIONS = "-lot -set -full -run -collection -bundle -wholesale";
  const filter = `buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}`;
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}")
    .replace(/%7C/g, "|").replace(/%5B/g, "[")
    .replace(/%5D/g, "]").replace(/%2C/g, ",")
    .replace(/%3A/g, ":");

  let endUserCtx = null;
  if (zip) {
    // Full context: accurate domestic (or international-to-US-zip) shipping estimates
    endUserCtx = `contextualLocation=country%3DUS%2Czip%3D${encodeURIComponent(zip)}`;
  } else if (country) {
    // Country-only: enough for flat-rate and zone-based international estimates
    endUserCtx = `contextualLocation=country%3D${encodeURIComponent(country)}`;
  }

  const queryNames = getQueryVariants(issueName);
  const seenUrls = new Set();
  const items = [];
  let total = 0;

  for (const queryName of queryNames) {
    const params = new URLSearchParams({
      q: `${queryName} ${EXCLUSIONS}`,
      category_ids: CATEGORY_ID,
      limit: MAX_RESULTS,
      offset,
    });
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}&filter=${encodedFilter}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    };
    if (endUserCtx) headers["X-EBAY-C-ENDUSERCTX"] = endUserCtx;

    const res = await fetch(url, { headers });
    if (!res.ok) continue;

    const data = await res.json();
    total = Math.max(total, data.total || 0);

    for (const item of data.itemSummaries || []) {
      const rawUrl = item.itemWebUrl || "";
      if (seenUrls.has(rawUrl)) continue;
      seenUrls.add(rawUrl);

      const title = item.title || "";
      if (!titleMatchesQuery(title, issueName)) continue;

      const seller = item.seller?.username || "unknown";
      const priceStr = item.price?.value || "0";
      const itemUrl = makeAffiliateUrl(rawUrl);
      const shippingOpts = item.shippingOptions || [];
      let shipping = "unknown";
      if (shippingOpts.length) {
        shipping =
          shippingOpts[0].shippingCostType === "FREE"
            ? "0.00"
            : shippingOpts[0].shippingCost?.value || "unknown";
      }
      const promotions = (item.promotions || [])
        .map((p) => p.message || "")
        .filter(Boolean)
        .join(" | ");

      items.push({ seller, price: priceStr, title, url: itemUrl, shipping, promotions, itemId: item.itemId || null });
    }
  }

  return { items, total };
}

// Fetch available quantity for a batch of item IDs.
// Fires all calls in parallel. Returns { [itemId]: number }.
// Items without determinable quantity are omitted from the result.
export async function fetchItemQuantities(token, itemIds) {
  const quantities = {};
  await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        const res = await fetch(
          `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            },
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        const avail = data.estimatedAvailabilities?.[0];
        if (!avail) return;
        if (avail.estimatedRemainingQuantity != null) {
          quantities[itemId] = avail.estimatedRemainingQuantity;
        } else if (avail.availabilityThresholdType === "MORE_THAN") {
          // "More than N available" — we know it's at least N+1
          quantities[itemId] = (avail.availabilityThreshold ?? 1) + 1;
        }
      } catch {}
    })
  );
  return quantities;
}

// Run eBay searches in parallel batches of CONCURRENCY.
export async function searchEbayBatch(token, issues, concurrency = 8) {
  const allResults = [];
  for (let i = 0; i < issues.length; i += concurrency) {
    const batch = issues.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((issue) => searchEbay(token, issue.issueName))
    );
    for (let j = 0; j < batch.length; j++) {
      allResults.push({ issue: batch[j], listings: batchResults[j].items });
    }
  }
  return allResults;
}

// Aggregate per-issue listing arrays into seller-grouped rows (same shape as /api/search).
export function aggregateRows(issueListings) {
  const sellerIssues = {};
  for (const { issue, listings } of issueListings) {
    for (const listing of listings) {
      if (!sellerIssues[listing.seller]) sellerIssues[listing.seller] = {};
      if (!sellerIssues[listing.seller][issue.issueName]) {
        sellerIssues[listing.seller][issue.issueName] = [];
      }
      sellerIssues[listing.seller][issue.issueName].push(listing);
    }
  }

  const rows = [];
  for (const [seller, issuesFound] of Object.entries(sellerIssues)) {
    const bundleCount = Object.keys(issuesFound).length;
    for (const [issueName, listings] of Object.entries(issuesFound)) {
      for (const listing of listings) {
        rows.push({ seller, bundle_count: bundleCount, issue: issueName, ...listing });
      }
    }
  }
  rows.sort((a, b) => b.bundle_count - a.bundle_count || a.seller.localeCompare(b.seller));
  return rows;
}
