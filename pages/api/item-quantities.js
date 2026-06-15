import { getEbayToken, fetchItemQuantities } from "../../lib/ebay.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { itemIds } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) {
    return res.status(400).json({ error: "itemIds array required." });
  }

  let token;
  try {
    token = await getEbayToken();
  } catch (e) {
    return res.status(500).json({ error: `eBay auth failed: ${e.message}` });
  }

  const quantities = await fetchItemQuantities(token, itemIds);
  return res.status(200).json({ quantities });
}
