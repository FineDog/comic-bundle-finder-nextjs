// pages/api/email-results.js
import { Resend } from "resend";
import { put } from "@vercel/blob";

const resend = new Resend(process.env.RESEND_API_KEY);

function generateId() {
  return Array.from({ length: 8 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 54)]
  ).join("");
}

function buildEmailHtml(rows, issueCount, resultsUrl) {
  // Group to bundle sellers only
  const sellers = {};
  for (const r of rows) {
    if (!sellers[r.seller]) sellers[r.seller] = { bundle_count: r.bundle_count, listings: [] };
    sellers[r.seller].listings.push(r);
  }
  const bundleSellers = Object.entries(sellers)
    .filter(([, d]) => d.bundle_count >= 2)
    .sort((a, b) => b[1].bundle_count - a[1].bundle_count);

  const sellerRows = bundleSellers.slice(0, 5).map(([name, data]) => {
    const issues = [...new Set(data.listings.map(l => l.issue))].slice(0, 3).join(", ");
    const overflow = [...new Set(data.listings.map(l => l.issue))].length > 3
      ? ` +${[...new Set(data.listings.map(l => l.issue))].length - 3} more` : "";
    const minPrice = Math.min(...data.listings.map(l => parseFloat(l.price) || 0));
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #d4c9a8;font-weight:600;color:#1a1a1a">${name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #d4c9a8;text-align:center;font-family:Impact,Arial,sans-serif;font-size:1.1rem;color:#cc1f00">${data.bundle_count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #d4c9a8;font-size:0.85rem;color:#444">${issues}${overflow}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #d4c9a8;white-space:nowrap;color:#333">from $${minPrice.toFixed(2)}</td>
      </tr>`;
  }).join("");

  const moreSellers = bundleSellers.length > 5
    ? `<p style="text-align:center;color:#666;font-size:0.85rem;margin-top:0">…and ${bundleSellers.length - 5} more seller${bundleSellers.length - 5 === 1 ? "" : "s"}. View the full list below.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0e6c4;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <div style="background:#cc1f00;padding:14px 24px;border:3px solid #1a1a1a;box-shadow:5px 5px 0 #1a1a1a;margin-bottom:0">
      <div style="font-family:Impact,Arial,sans-serif;font-size:1.8rem;color:#fffdf4;letter-spacing:3px;line-height:1">COMIC BUNDLE FINDER</div>
      <div style="font-size:0.78rem;color:#ffcccc;letter-spacing:1px;text-transform:uppercase;margin-top:2px">comicbundlefinder.com</div>
    </div>

    <div style="background:#fffdf4;border:3px solid #1a1a1a;border-top:none;padding:24px;box-shadow:5px 5px 0 #1a1a1a">
      <h2 style="margin:0 0 8px;font-family:Impact,Arial,sans-serif;font-size:1.6rem;letter-spacing:2px;color:#003399">YOUR RESULTS ARE READY</h2>
      <p style="margin:0 0 20px;color:#444;line-height:1.6;font-size:0.95rem">
        You searched for <strong>${issueCount} issue${issueCount === 1 ? "" : "s"}</strong> and found
        <strong>${bundleSellers.length} seller${bundleSellers.length === 1 ? "" : "s"}</strong> with bundle opportunities.
      </p>

      ${bundleSellers.length > 0 ? `
      <h3 style="margin:0 0 10px;font-family:Impact,Arial,sans-serif;font-size:1.1rem;letter-spacing:1px;color:#1a1a1a;text-transform:uppercase">Top Bundle Sellers</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:0.88rem">
        <thead>
          <tr style="background:#1a1a1a">
            <th style="padding:7px 12px;text-align:left;color:#fffdf4;font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;font-weight:600">Seller</th>
            <th style="padding:7px 12px;text-align:center;color:#fffdf4;font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;font-weight:600">Issues</th>
            <th style="padding:7px 12px;text-align:left;color:#fffdf4;font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;font-weight:600">Your Issues</th>
            <th style="padding:7px 12px;text-align:left;color:#fffdf4;font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;font-weight:600">Price</th>
          </tr>
        </thead>
        <tbody style="background:#fffdf4">${sellerRows}</tbody>
      </table>
      ${moreSellers}
      ` : `<p style="color:#666;font-style:italic">No bundle opportunities were found for this search.</p>`}

      <div style="text-align:center;margin:28px 0 20px">
        <a href="${resultsUrl}" style="display:inline-block;background:#cc1f00;color:#fffdf4;text-decoration:none;padding:12px 36px;border:3px solid #1a1a1a;box-shadow:4px 4px 0 #1a1a1a;font-family:Impact,Arial,sans-serif;font-size:1.25rem;letter-spacing:2px">
          VIEW FULL RESULTS &rarr;
        </a>
      </div>

      <p style="margin:20px 0 0;color:#999;font-size:0.72rem;text-align:center;border-top:1px solid #d4c9a8;padding-top:14px;line-height:1.5">
        This link will always take you back to your complete results on Comic Bundle Finder.<br>
        Some links in your results may be affiliate links — a small commission may be earned at no cost to you.
      </p>
    </div>

  </div>
</body>
</html>`;
}

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const { email, rows, issueCount, savedId } = req.body;
  if (!email || !rows?.length) return res.status(400).json({ error: "Missing required fields." });

  try {
    // Reuse existing saved blob or create a new one
    let id = savedId;
    if (!id) {
      id = generateId();
      await put(`results/${id}.json`, JSON.stringify({ rows, issueCount, savedAt: Date.now() }), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });
    }

    const resultsUrl = `https://comicbundlefinder.com/results/${id}`;

    await resend.emails.send({
      from: "results@results.comicbundlefinder.com",
      to: email,
      subject: `Your Comic Bundle Finder Results — ${issueCount} issue${issueCount === 1 ? "" : "s"} searched`,
      html: buildEmailHtml(rows, issueCount, resultsUrl),
    });

    return res.status(200).json({ id });
  } catch (e) {
    console.error("[email-results]", e);
    return res.status(500).json({ error: e.message || "Failed to send email." });
  }
}
