// Shared eBay Browse API helpers used by series result and refresh routes.

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

function normalize(w) {
  return w.toLowerCase().replace(/[^a-z]/g, "");
}

function extractIssueNumber(issueName) {
  const hashMatch = issueName.match(/#(\d+)/);
  if (hashMatch) return hashMatch[1];
  const cleaned = issueName.replace(/\(\d{4}\)/, "").trim();
  const endMatch = cleaned.match(/\b(\d+)\s*$/);
  return endMatch ? endMatch[1] : null;
}

function getSeriesKeywords(issueName) {
  const stopwords = new Set(["the", "a", "an", "of", "in", "and", "vol", "volume"]);
  const base = issueName
    .replace(/#\d+/, "")
    .replace(/\(\d{4}\)/, "")
    .toLowerCase();
  const words = base.match(/[a-z']+/g)?.filter((w) => !stopwords.has(w) && w.length > 1) || [];
  // Also include dehyphenated compounds so "spiderman" matches "spider-man" searches
  const compounds = (base.match(/[a-z]+-(?:[a-z]+-)*[a-z]+/g) || []).map((s) => s.replace(/-/g, ""));
  return [...new Set([...words, ...compounds])];
}

function getSeriesSlug(issueName) {
  return normalize(issueName.replace(/#\d+/, "").replace(/\(\d{4}\)/, ""));
}

function titleMatchesIssue(title, issueName) {
  const titleLower = title.toLowerCase();
  const keywords = getSeriesKeywords(issueName);
  const normalizedKeywords = new Set(keywords.map(normalize));
  const seriesSlug = getSeriesSlug(issueName);
  const issueNum = extractIssueNumber(issueName);

  if (issueNum) {
    const pattern = new RegExp(`(?<!\\d)#?\\s*0*${issueNum}\\b`, "gi");
    let foundValid = false;
    for (const m of title.matchAll(pattern)) {
      const before = title.slice(0, m.index).trimEnd();
      const prevWords = before.match(/[a-zA-Z]+/g) || [];
      for (const word of prevWords.slice(-5)) {
        const normWord = normalize(word);
        if (normalizedKeywords.has(normWord) || normWord === seriesSlug) {
          foundValid = true;
          break;
        }
      }
      if (foundValid) break;
    }
    if (!foundValid) return false;
  }

  const normTitle = normalize(titleLower);
  for (const kw of keywords) {
    if (!normTitle.includes(normalize(kw))) return false;
  }
  return true;
}

function makeAffiliateUrl(url) {
  if (!CAMPAIGN_ID || !url) return url;
  const suffix = `mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${CAMPAIGN_ID}&toolid=10001&mkevt=1`;
  return url.includes("?") ? `${url}&${suffix}` : `${url}?${suffix}`;
}

// Returns an array of { seller, price, title, url, shipping, promotions } for an issue.
export async function searchEbay(token, issueName) {
  const EXCLUSIONS = "-lot -set -full -run -collection -bundle -wholesale";
  const queryName = issueName.replace(/-/g, "");
  const params = new URLSearchParams({
    q: `${queryName} ${EXCLUSIONS}`,
    category_ids: CATEGORY_ID,
    limit: MAX_RESULTS,
  });
  const filter = `buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}`;
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}")
    .replace(/%7C/g, "|").replace(/%5B/g, "[")
    .replace(/%5D/g, "]").replace(/%2C/g, ",")
    .replace(/%3A/g, ":");

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}&filter=${encodedFilter}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const results = [];

  for (const item of data.itemSummaries || []) {
    const title = item.title || "";
    const priceStr = item.price?.value || "0";
    if (!titleMatchesIssue(title, issueName)) continue;

    const seller = item.seller?.username || "unknown";
    const itemUrl = makeAffiliateUrl(item.itemWebUrl || "");
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

    results.push({ seller, price: priceStr, title, url: itemUrl, shipping, promotions });
  }

  return results;
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
      allResults.push({ issue: batch[j], listings: batchResults[j] });
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
