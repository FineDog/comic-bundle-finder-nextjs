// pages/api/search.js
import { getEbayToken, searchEbay } from "../../lib/ebay.js";
import { Pool } from "pg";
import { createHash } from "node:crypto";

let _pool = null;
function getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

function hashIp(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
  return createHash("sha256").update(ip).digest("hex");
}

async function logSearch(queries, ipHash) {
  try {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      "INSERT INTO search_logs (queries, query_count, ip_hash) VALUES ($1, $2, $3)",
      [JSON.stringify(queries), queries.length, ipHash]
    );
  } catch {}
}

const CONCURRENCY = 8;

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
        });
      }
    }
  }
  rows.sort((a, b) => b.bundle_count - a.bundle_count || a.seller.localeCompare(b.seller));
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

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

  logSearch(deduped, hashIp(req)).catch(() => {});

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
