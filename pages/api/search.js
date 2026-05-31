// pages/api/search.js
import { titleMatchesQuery } from "../../lib/parse-title.js";

const EBAY_APP_ID  = process.env.EBAY_APP_ID;
const EBAY_SECRET  = process.env.EBAY_SECRET;
const CAMPAIGN_ID  = process.env.EBAY_CAMPAIGN_ID || "";
const CATEGORY_ID  = "259104";
const MAX_RESULTS  = 200;
const CONCURRENCY  = 8;

let cachedToken    = null;
let tokenExpiresAt = 0;

async function getEbayToken() {
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

const HYPHENATED_WORDS = [
  "spider-man", "spider-girl", "spider-gwen", "spider-woman",
  "spider-verse", "spider-ham",
  "x-men", "x-force", "x-factor", "x-23", "x-statix", "x-treme",
  "she-hulk", "man-thing", "star-lord",
];

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

// Returns { items: [...], total: number }
// total is the max across all query variants — used by the frontend to decide if wave 2 is needed.
async function searchEbay(token, issueName, offset = 0, zip = null) {
  const EXCLUSIONS = "-lot -set -full -run -collection -bundle -wholesale";
  const filter = `buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}`;
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g, "{").replace(/%7D/g, "}")
    .replace(/%7C/g, "|").replace(/%5B/g, "[")
    .replace(/%5D/g, "]").replace(/%2C/g, ",")
    .replace(/%3A/g, ":");

  const endUserCtx = zip
    ? `contextualLocation=country%3DUS%2Czip%3D${encodeURIComponent(zip)}`
    : null;

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
      const quantity = item.availableQuantity || 1;

      items.push({ seller, price: priceStr, title, url: itemUrl, shipping, promotions, quantity });
    }
  }

  return { items, total };
}

function buildSellerIssueMap(existing, issue, items) {
  for (const listing of items) {
    if (!existing[listing.seller]) existing[listing.seller] = {};
    if (!existing[listing.seller][issue]) existing[listing.seller][issue] = [];
    existing[listing.seller][issue].push(listing);
  }
}

function buildRows(sellerIssues) {
  const rows = [];
  for (const [seller, issuesFound] of Object.entries(sellerIssues)) {
    const bundleCount = Object.keys(issuesFound).length;
    for (const [issueName, listings] of Object.entries(issuesFound)) {
      for (const listing of listings) {
        rows.push({
          seller,
          bundle_count: bundleCount,
          issue: issueName,
          title: listing.title,
          price: listing.price,
          shipping: listing.shipping,
          promotions: listing.promotions,
          url: listing.url,
          quantity: listing.quantity || 1,
        });
      }
    }
  }
  rows.sort((a, b) => b.bundle_count - a.bundle_count || a.seller.localeCompare(b.seller));
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!EBAY_APP_ID || !EBAY_SECRET) return res.status(500).json({ error: "eBay credentials not configured." });

  const { issues, issueOffsets, zip } = req.body;

  let token;
  try {
    token = await getEbayToken();
  } catch (e) {
    return res.status(500).json({ error: `eBay authentication failed: ${e.message}` });
  }

  // Wave 2: client sends specific issue+offset pairs to fetch additional pages
  if (issueOffsets && Array.isArray(issueOffsets)) {
    const sellerIssues = {};
    for (let i = 0; i < issueOffsets.length; i += CONCURRENCY) {
      const batch = issueOffsets.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({ issue, offset }) => searchEbay(token, issue, offset, zip || null))
      );
      for (let j = 0; j < batch.length; j++) {
        buildSellerIssueMap(sellerIssues, batch[j].issue, batchResults[j].items);
      }
    }
    return res.status(200).json({ results: buildRows(sellerIssues) });
  }

  // Wave 1: normal search across all issues at offset 0
  if (!issues?.length) return res.status(400).json({ error: "No issues provided." });
  const deduped = [...new Set(issues.map((i) => i.trim()).filter(Boolean))];

  const sellerIssues = {};
  const totals = {};

  for (let i = 0; i < deduped.length; i += CONCURRENCY) {
    const batch = deduped.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((issue) => searchEbay(token, issue, 0, zip || null))
    );
    for (let j = 0; j < batch.length; j++) {
      const issue = batch[j];
      const { items, total } = batchResults[j];
      totals[issue] = total;
      buildSellerIssueMap(sellerIssues, issue, items);
    }
  }

  return res.status(200).json({ results: buildRows(sellerIssues), totals });
}
