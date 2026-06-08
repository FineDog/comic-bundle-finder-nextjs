// pages/api/save-results.js
import { put } from "@vercel/blob";

function generateId() {
  return Array.from({ length: 8 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 54)]
  ).join("");
}

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const { rows, issueCount } = req.body;
  if (!rows?.length) return res.status(400).json({ error: "No results to save." });

  const id = generateId();
  await put(`results/${id}.json`, JSON.stringify({ rows, issueCount, savedAt: Date.now() }), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  return res.status(200).json({ id });
}
