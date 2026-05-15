// GET /api/series/asm-vol1/refresh?start=0&count=80&secret=REFRESH_SECRET
//
// Refreshes Vercel Blob cache for a slice of ASM Vol. 1 issues by fetching
// fresh eBay results. Called nightly by GitHub Actions in paginated batches.

import { put } from "@vercel/blob";
import { getEbayToken, searchEbay } from "../../../../lib/ebay";
import allIssues from "../../../../data/asm-vol1-issues.json";

const BLOB_PREFIX = "series/asm-vol1/issue-";
const CACHE_MAX_PRICE = 30;
const CONCURRENCY = 8;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const secret = process.env.REFRESH_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const startIdx = Math.max(0, parseInt(req.query.start || "0", 10));
  const count = Math.min(100, Math.max(1, parseInt(req.query.count || "80", 10)));
  const batchIssues = allIssues.slice(startIdx, startIdx + count);

  if (!batchIssues.length) return res.status(400).json({ error: "No issues in that range." });

  let token;
  try {
    token = await getEbayToken();
  } catch (e) {
    return res.status(500).json({ error: `eBay auth failed: ${e.message}` });
  }

  let refreshed = 0;
  const errors = [];

  for (let i = 0; i < batchIssues.length; i += CONCURRENCY) {
    const batch = batchIssues.slice(i, i + CONCURRENCY);
    const listings = await Promise.all(
      batch.map((issue) =>
        searchEbay(token, issue.issueName, CACHE_MAX_PRICE).catch((e) => {
          errors.push(`${issue.issueName}: ${e.message}`);
          return [];
        })
      )
    );
    await Promise.all(
      batch.map((issue, j) =>
        put(
          `${BLOB_PREFIX}${issue.number}.json`,
          JSON.stringify({ issueName: issue.issueName, listings: listings[j] }),
          { access: "public", addRandomSuffix: false, contentType: "application/json" }
        ).then(() => { refreshed++; }).catch((e) => {
          errors.push(`blob write ${issue.number}: ${e.message}`);
        })
      )
    );
  }

  return res.status(200).json({
    refreshed,
    total: batchIssues.length,
    startIdx,
    errors: errors.length ? errors : undefined,
  });
}
