/**
 * Daily digest runner — executed by GitHub Actions once per day.
 * For each opted-in user with saved lists, runs the eBay bundle search
 * and emails full results via Resend.
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   DATABASE_URL, EBAY_APP_ID, EBAY_SECRET, RESEND_API_KEY, BLOB_READ_WRITE_TOKEN
 * Optional:
 *   EBAY_CAMPAIGN_ID
 */

import pg from "pg";
import { Resend } from "resend";
import { put } from "@vercel/blob";
import { titleMatchesQuery } from "../lib/parse-title.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const resend = new Resend(process.env.RESEND_API_KEY);

const EBAY_APP_ID  = process.env.EBAY_APP_ID;
const EBAY_SECRET  = process.env.EBAY_SECRET;
const CAMPAIGN_ID  = process.env.EBAY_CAMPAIGN_ID || "";
const CATEGORY_ID  = "259104";
const MAX_RESULTS  = 200;
const CONCURRENCY  = 8;

// ── eBay helpers ──────────────────────────────────────────────────────────────

let cachedToken = null;
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
  "spider-man","spider-girl","spider-gwen","spider-woman","spider-verse","spider-ham",
  "x-men","x-force","x-factor","x-23","x-statix","x-treme",
  "she-hulk","man-thing","star-lord",
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

async function searchEbay(token, issueName) {
  const EXCLUSIONS = "-lot -set -full -run -collection -bundle -wholesale";
  const filter = `buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}`;
  const encodedFilter = encodeURIComponent(filter)
    .replace(/%7B/g,"{").replace(/%7D/g,"}").replace(/%7C/g,"|")
    .replace(/%5B/g,"[").replace(/%5D/g,"]").replace(/%2C/g,",").replace(/%3A/g,":");

  const seenUrls = new Set();
  const items = [];

  for (const queryName of getQueryVariants(issueName)) {
    const params = new URLSearchParams({
      q: `${queryName} ${EXCLUSIONS}`,
      category_ids: CATEGORY_ID,
      limit: MAX_RESULTS,
    });
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}&filter=${encodedFilter}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data.itemSummaries || []) {
      const rawUrl = item.itemWebUrl || "";
      if (seenUrls.has(rawUrl)) continue;
      seenUrls.add(rawUrl);
      const title = item.title || "";
      if (!titleMatchesQuery(title, issueName)) continue;
      const seller = item.seller?.username || "unknown";
      const price = item.price?.value || "0";
      const itemUrl = makeAffiliateUrl(rawUrl);
      const shippingOpts = item.shippingOptions || [];
      const shipping = shippingOpts.length
        ? (shippingOpts[0].shippingCostType === "FREE" ? "0.00" : shippingOpts[0].shippingCost?.value || "unknown")
        : "unknown";
      const promotions = (item.promotions || []).map(p => p.message || "").filter(Boolean).join(" | ");
      items.push({ seller, price, title, url: itemUrl, shipping, promotions });
    }
  }
  return items;
}

async function runSearch(token, issues) {
  const sellerIssues = {};
  for (let i = 0; i < issues.length; i += CONCURRENCY) {
    const batch = issues.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(issue => searchEbay(token, issue)));
    for (let j = 0; j < batch.length; j++) {
      for (const listing of results[j]) {
        if (!sellerIssues[listing.seller]) sellerIssues[listing.seller] = {};
        if (!sellerIssues[listing.seller][batch[j]]) sellerIssues[listing.seller][batch[j]] = [];
        sellerIssues[listing.seller][batch[j]].push(listing);
      }
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

// ── Dedup ─────────────────────────────────────────────────────────────────────

function dedupeIssues(...lists) {
  const seen = new Set();
  const result = [];
  for (const list of lists) {
    for (const item of (list || [])) {
      const key = item.toLowerCase().trim();
      if (!seen.has(key)) { seen.add(key); result.push(item); }
    }
  }
  return result;
}

// ── Blob ──────────────────────────────────────────────────────────────────────

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function generateId() {
  return Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}

async function saveResultsBlob(rows, issueCount) {
  const id = generateId();
  await put(`results/${id}.json`, JSON.stringify({ rows, issueCount, savedAt: Date.now() }), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return `https://comicbundlefinder.com/results/${id}`;
}

// ── Email ─────────────────────────────────────────────────────────────────────

const PREVIEW_SELLERS = 10;  // max sellers shown inline
const PREVIEW_ISSUES  = 5;   // max issues shown per seller

function buildDigestEmail(rows, issueCount, resultsUrl) {
  // Group by seller, bundle sellers only
  const sellerMap = {};
  for (const r of rows) {
    if (r.bundle_count < 2) continue;
    if (!sellerMap[r.seller]) sellerMap[r.seller] = { bundle_count: r.bundle_count, byIssue: {} };
    if (!sellerMap[r.seller].byIssue[r.issue]) sellerMap[r.seller].byIssue[r.issue] = [];
    sellerMap[r.seller].byIssue[r.issue].push(r);
  }

  const sellers = Object.entries(sellerMap)
    .sort((a, b) => b[1].bundle_count - a[1].bundle_count);

  if (!sellers.length) return null;

  const shown = sellers.slice(0, PREVIEW_SELLERS);
  const remaining = sellers.length - shown.length;

  const sellerHtml = shown.map(([name, data]) => {
    const allIssues = Object.entries(data.byIssue);
    const shownIssues = allIssues.slice(0, PREVIEW_ISSUES);
    const remainingIssues = allIssues.length - shownIssues.length;

    const colHeader = `
        <tr style="background:#1a1a1a">
          <td style="padding:5px 12px;font-size:0.68rem;font-weight:700;color:#fffdf4;text-transform:uppercase;letter-spacing:1px">Issue You Need</td>
          <td style="padding:5px 12px;font-size:0.68rem;font-weight:700;color:#fffdf4;text-transform:uppercase;letter-spacing:1px;width:58px">Price</td>
          <td style="padding:5px 12px;font-size:0.68rem;font-weight:700;color:#fffdf4;text-transform:uppercase;letter-spacing:1px;width:100px">Shipping</td>
        </tr>`;

    const listingRows = shownIssues.map(([issue, listings]) => {
      const best = listings.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
      const price = `$${parseFloat(best.price).toFixed(2)}`;
      const shipping = best.shipping === "0.00" ? "Free shipping"
        : best.shipping === "unknown" ? "Shipping TBD"
        : `+$${parseFloat(best.shipping).toFixed(2)} shipping`;
      return `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e8e0cc;font-size:0.82rem;line-height:1.4">
            <div style="color:#555;font-size:0.75rem;font-weight:700;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.3px">${issue}</div>
            <a href="${best.url}" style="color:#003399;text-decoration:none">${best.title}</a>
          </td>
          <td style="padding:6px 12px;border-bottom:1px solid #e8e0cc;font-size:0.82rem;font-weight:700;color:#1a1a1a;white-space:nowrap;vertical-align:top;width:58px">${price}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e8e0cc;font-size:0.75rem;color:#666;white-space:nowrap;vertical-align:top;width:100px">${shipping}</td>
        </tr>`;
    }).join("");

    const moreIssuesRow = remainingIssues > 0 ? `
        <tr>
          <td colspan="3" style="padding:6px 12px;font-size:0.78rem;color:#888;font-style:italic">
            +${remainingIssues} more issue${remainingIssues === 1 ? "" : "s"} from this seller — see full results
          </td>
        </tr>` : "";

    return `
      <div style="margin-bottom:14px;border:2px solid #1a1a1a">
        <table style="width:100%;border-collapse:collapse;background:#003399">
          <tr>
            <td style="padding:8px 12px">
              <span style="color:#fffdf4;font-family:'Arial Black',sans-serif;font-size:0.88rem;letter-spacing:0.5px">${name}</span>
              <span style="display:inline-block;background:#cc1f00;color:#fffdf4;padding:2px 8px;font-family:'Arial Black',sans-serif;font-size:0.72rem;letter-spacing:1px;margin-left:10px">${data.bundle_count} ISSUES</span>
            </td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;background:#fffdf4;table-layout:fixed">
          <thead>${colHeader}</thead>
          <tbody>${listingRows}${moreIssuesRow}</tbody>
        </table>
      </div>`;
  }).join("");

  const truncationNote = remaining > 0 ? `
    <p style="text-align:center;color:#666;font-size:0.85rem;margin:4px 0 20px">
      …and <strong>${remaining}</strong> more seller${remaining === 1 ? "" : "s"} in the full results.
    </p>` : "";

  const viewFullBtn = `
    <div style="text-align:center;margin:24px 0 8px">
      <a href="${resultsUrl}" style="display:inline-block;background:#cc1f00;color:#fffdf4;text-decoration:none;padding:12px 32px;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:'Arial Black',Gadget,sans-serif;font-size:1rem;letter-spacing:2px">
        VIEW FULL RESULTS &rarr;
      </a>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0e6c4;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <div style="background:#cc1f00;padding:14px 24px;border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a">
      <div style="font-family:'Arial Black',Gadget,sans-serif;font-size:1.6rem;color:#fffdf4;letter-spacing:2px;line-height:1">COMIC BUNDLE FINDER</div>
      <a href="https://comicbundlefinder.com" style="font-size:0.78rem;color:#ffe066;letter-spacing:1px;text-transform:uppercase;margin-top:2px;text-decoration:none;display:block">comicbundlefinder.com</a>
    </div>

    <div style="background:#fffdf4;border:3px solid #1a1a1a;border-top:none;padding:24px;box-shadow:5px 5px 0 #1a1a1a">
      <h2 style="margin:0 0 4px;font-family:'Arial Black',Gadget,sans-serif;font-size:1.3rem;letter-spacing:1px;color:#003399">YOUR DAILY BUNDLE DIGEST</h2>
      <p style="margin:0 0 14px;color:#555;font-size:0.92rem;line-height:1.6">
        Searched <strong>${issueCount} issue${issueCount === 1 ? "" : "s"}</strong> from your wish list and found
        <strong>${sellers.length} seller${sellers.length === 1 ? "" : "s"}</strong> with bundle opportunities today.
      </p>
      ${viewFullBtn}
      <div style="margin-bottom:20px"></div>
      ${sellerHtml}
      ${truncationNote}
      ${viewFullBtn}
    </div>

    <div style="background:#1a1a1a;border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;padding:16px 24px;text-align:center">
      <p style="margin:0 0 6px;color:#fffdf4;font-size:0.78rem;line-height:1.6">
        You're receiving this because you enabled daily digests on
        <a href="https://comicbundlefinder.com" style="color:#ffe066;text-decoration:none">comicbundlefinder.com</a>.
      </p>
      <p style="margin:0 0 6px;color:#aaa;font-size:0.72rem">
        To unsubscribe, <a href="https://comicbundlefinder.com/account" style="color:#ffe066;text-decoration:none">visit your account page</a> and turn off daily digests.
      </p>
      <p style="margin:0;color:#666;font-size:0.68rem">
        Some links may be eBay affiliate links — a small commission may be earned at no extra cost to you.
      </p>
    </div>

  </div>
</body>
</html>`;

  return { html, sellerCount: sellers.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[digest] Starting — ${new Date().toISOString()}`);

  const { rows: users } = await pool.query(`
    SELECT id, email, locg_list, clz_list, manual_list
    FROM users
    WHERE digest_enabled = true
      AND email IS NOT NULL
      AND (locg_list IS NOT NULL OR clz_list IS NOT NULL OR manual_list IS NOT NULL)
  `);

  console.log(`[digest] ${users.length} opted-in user(s)`);
  if (!users.length) { await pool.end(); return; }

  let token;
  try { token = await getEbayToken(); }
  catch (e) { console.error("[digest] eBay auth failed:", e.message); await pool.end(); process.exit(1); }

  let sent = 0, skipped = 0;

  for (const user of users) {
    const issues = dedupeIssues(
      user.locg_list?.items,
      user.clz_list?.items,
      user.manual_list?.items,
    );

    if (!issues.length) { console.log(`[digest] ${user.email} — no issues, skipping`); skipped++; continue; }

    console.log(`[digest] ${user.email} — searching ${issues.length} issues…`);

    try {
      const rows = await runSearch(token, issues);

      // Save full results to blob for "view full results" link
      const resultsUrl = await saveResultsBlob(rows, issues.length);

      const result = buildDigestEmail(rows, issues.length, resultsUrl);

      if (!result) {
        console.log(`[digest] ${user.email} — no bundle results, skipping`);
        skipped++;
        continue;
      }

      await resend.emails.send({
        from: "Comic Bundle Finder <digests@comicbundlefinder.com>",
        to: user.email,
        subject: `Your Daily Comic Bundle Digest — ${issues.length} issue${issues.length === 1 ? "" : "s"} searched`,
        html: result.html,
      });

      await pool.query("UPDATE users SET digest_last_sent = NOW() WHERE id = $1", [user.id]);

      console.log(`[digest] ${user.email} — sent (${result.sellerCount} seller${result.sellerCount === 1 ? "" : "s"})`);
      sent++;
    } catch (e) {
      console.error(`[digest] ${user.email} — error:`, e.message);
    }
  }

  console.log(`[digest] Done — ${sent} sent, ${skipped} skipped`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
