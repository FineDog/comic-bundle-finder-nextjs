import { searchForValuationBatch } from "../../lib/valuation-search.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { issues } = req.body ?? {};
  if (!Array.isArray(issues) || issues.length === 0) {
    return res.status(400).json({ error: "issues must be a non-empty array" });
  }
  if (issues.length > 50) {
    return res.status(400).json({ error: "Max 50 issues per request" });
  }

  try {
    const results = await searchForValuationBatch(issues);
    return res.status(200).json({ results });
  } catch (err) {
    console.error("valuation-test error:", err);
    return res.status(500).json({ error: err.message });
  }
}
