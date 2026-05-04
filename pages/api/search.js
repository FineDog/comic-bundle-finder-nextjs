// pages/api/search.js
// Runs on Vercel's servers — credentials and logic never reach the browser.

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_SECRET = process.env.EBAY_SECRET;
const CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || "";
const CATEGORY_ID = "259104"; // eBay: Comics > Single Issues
const MAX_RESULTS  = 200;
const PAUSE_MS     = 100;

// ─── eBay auth ────────────────────────────────────────────────────────────────

async function getEbayToken() {
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
  return data.access_token;
}

// ─── Matching helpers ─────────────────────────────────────────────────────────

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
  return (
    issueName
      .replace(/#\d+/, "")
      .replace(/\(\d{4}\)/, "")
      .toLowerCase()
      .match(/[a-z']+/g)
      ?.filter((w) => !stopwords.has(w) && w.length > 1) || []
  );
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
      if (prevWords.length) {
        const normPrev = normalize(prevWords[prevWords.length - 1]);
        if (normalizedKeywords.has(normPrev) || normPrev === seriesSlug) {
          foundValid = true;
          break;
        }
      }
    }
    if (!foundValid) return false;
  }

  const normTitle = normalize(titleLower);
  for (const kw of keywords) {
    if (!normTitle.includes(normalize(kw))) return false;
  }
  return true;
}

// ─── Affiliate URL ────────────────────────────────────────────────────────────

function makeAffiliateUrl(url) {
  if (!CAMPAIGN_ID || !url) return url;
  const suffix = `mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${CAMPAIGN_ID}&toolid=10001&mkevt=1`;
  return url.includes("?") ? `${url}&${suffix}` : `${url}?${suffix}`;
}

// ─── eBay search ──────────────────────────────────────────────────────────────

async function searchEbay(token, issueName, maxPrice) {
  // Append exclusion terms to filter out lot/set/bundle listings
  const EXCLUSIONS = "-lot -set -full -run -collection -bundle -wholesale";
  const params = new URLSearchParams({
    q: `${issueName} ${EXCLUSIONS}`,
    category_ids: CATEGORY_ID,
    limit: MAX_RESULTS,
  });
  const filter = `price:[0..${maxPrice}],buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}`;
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

    if (parseFloat(priceStr) > maxPrice) continue;
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!EBAY_APP_ID || !EBAY_SECRET) return res.status(500).json({ error: "eBay credentials not configured." });

  const issues = [...new Set((req.body.issues || []).map((i) => i.trim()).filter(Boolean))];
  const maxPrice = parseFloat(req.body.max_price) || 10.0;

  if (!issues.length) return res.status(400).json({ error: "No issues provided." });

  let token;
  try {
    token = await getEbayToken();
  } catch (e) {
    return res.status(500).json({ error: `eBay authentication failed: ${e.message}` });
  }

  const sellerIssues = {};

  for (const issue of issues) {
    const results = await searchEbay(token, issue, maxPrice);
    for (const listing of results) {
      if (!sellerIssues[listing.seller]) sellerIssues[listing.seller] = {};
      if (!sellerIssues[listing.seller][issue]) sellerIssues[listing.seller][issue] = [];
      sellerIssues[listing.seller][issue].push(listing);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

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
        });
      }
    }
  }

  rows.sort((a, b) => b.bundle_count - a.bundle_count || a.seller.localeCompare(b.seller));
  return res.status(200).json({ results: rows });
}
