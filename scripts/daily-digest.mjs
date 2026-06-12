/**
 * Daily digest runner — executed by GitHub Actions once per day.
 * For each opted-in user with saved lists, runs the eBay bundle search
 * and emails full results via Resend — but only when the results contain
 * at least one (seller, issue) bundle pair not present in the last digest
 * sent to that user (tracked in users.digest_last_bundles).
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   DATABASE_URL, EBAY_APP_ID, EBAY_SECRET, RESEND_API_KEY
 * Optional:
 *   EBAY_CAMPAIGN_ID
 */

import pg from "pg";
import { Resend } from "resend";
import { getEbayToken, searchEbay } from "../lib/ebay.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const resend = new Resend(process.env.RESEND_API_KEY);

const CONCURRENCY = 8;

async function runSearch(token, issues) {
  const sellerIssues = {};
  for (let i = 0; i < issues.length; i += CONCURRENCY) {
    const batch = issues.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(issue => searchEbay(token, issue)));
    for (let j = 0; j < batch.length; j++) {
      for (const listing of results[j].items) {
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

// ── Bundle fingerprinting ─────────────────────────────────────────────────────
// A digest is only sent when it contains at least one (seller, issue) pair the
// user hasn't been emailed before. Pairs from the last sent digest are stored
// in users.digest_last_bundles (JSONB array of keys).

const pairKey = (seller, issue) => `${seller}|${issue}`;

function bundlePairs(rows) {
  const pairs = new Set();
  for (const r of rows) {
    if (r.bundle_count >= 2) pairs.add(pairKey(r.seller, r.issue));
  }
  return pairs;
}

// ── Email ─────────────────────────────────────────────────────────────────────

function buildDigestEmail(rows, issueCount, newPairs) {
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

  const sellerHtml = sellers.map(([name, data]) => {
    const listingRows = Object.entries(data.byIssue).map(([issue, listings]) => {
      // Show cheapest listing per issue
      const best = listings.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
      const price = `$${parseFloat(best.price).toFixed(2)}`;
      const shipping = best.shipping === "0.00" ? "Free shipping"
        : best.shipping === "unknown" ? "Shipping TBD"
        : `+$${parseFloat(best.shipping).toFixed(2)} shipping`;
      const newBadge = newPairs.has(pairKey(name, issue))
        ? `<span style="background:#ffe066;color:#1a1a1a;padding:1px 6px;margin-right:6px;font-family:'Arial Black',sans-serif;font-size:0.62rem;letter-spacing:1px;vertical-align:middle">NEW</span>`
        : "";
      return `
        <tr>
          <td style="padding:7px 14px;border-bottom:1px solid #e8e0cc;font-size:0.85rem">
            ${newBadge}<a href="${best.url}" style="color:#003399;text-decoration:none">${best.title}</a>
          </td>
          <td style="padding:7px 14px;border-bottom:1px solid #e8e0cc;font-size:0.85rem;white-space:nowrap;color:#1a1a1a;font-weight:600">${price}</td>
          <td style="padding:7px 14px;border-bottom:1px solid #e8e0cc;font-size:0.78rem;color:#666;white-space:nowrap">${shipping}</td>
        </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:16px;border:2px solid #1a1a1a">
        <div style="background:#1a1a1a;padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <span style="color:#fffdf4;font-family:'Arial Black',sans-serif;font-size:0.9rem;letter-spacing:0.5px">${name}</span>
          <span style="background:#cc1f00;color:#fffdf4;padding:2px 10px;font-family:'Arial Black',sans-serif;font-size:0.75rem;letter-spacing:1px">${data.bundle_count} ISSUES</span>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fffdf4">
          <tbody>${listingRows}</tbody>
        </table>
      </div>`;
  }).join("");

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
      <p style="margin:0 0 20px;color:#555;font-size:0.92rem;line-height:1.6">
        Searched <strong>${issueCount} issue${issueCount === 1 ? "" : "s"}</strong> from your wish list and found
        <strong>${sellers.length} seller${sellers.length === 1 ? "" : "s"}</strong> with bundle opportunities today,
        including <strong>${newPairs.size} new match${newPairs.size === 1 ? "" : "es"}</strong> since your last digest.
      </p>
      ${sellerHtml}
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

  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_last_bundles JSONB");

  const { rows: users } = await pool.query(`
    SELECT id, email, locg_list, clz_list, manual_list, digest_last_bundles
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

      const currentPairs = bundlePairs(rows);
      const previousPairs = new Set(user.digest_last_bundles || []);
      const newPairs = new Set([...currentPairs].filter(p => !previousPairs.has(p)));

      if (currentPairs.size && !newPairs.size) {
        console.log(`[digest] ${user.email} — ${currentPairs.size} bundle pair(s), none new, skipping`);
        skipped++;
        continue;
      }

      const result = buildDigestEmail(rows, issues.length, newPairs);

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

      await pool.query(
        "UPDATE users SET digest_last_sent = NOW(), digest_last_bundles = $2 WHERE id = $1",
        [user.id, JSON.stringify([...currentPairs])],
      );

      console.log(`[digest] ${user.email} — sent (${result.sellerCount} seller${result.sellerCount === 1 ? "" : "s"}, ${newPairs.size} new pair${newPairs.size === 1 ? "" : "s"})`);
      sent++;
    } catch (e) {
      console.error(`[digest] ${user.email} — error:`, e.message);
    }
  }

  console.log(`[digest] Done — ${sent} sent, ${skipped} skipped`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
