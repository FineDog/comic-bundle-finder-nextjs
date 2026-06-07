import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Sign in required." });
  const userId = session.user.id;

  if (req.method === "GET") {
    const { rows } = await pool.query(
      "SELECT locg_list, clz_list, manual_list, digest_enabled, digest_last_sent FROM users WHERE id = $1",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    return res.json({
      locg:             rows[0].locg_list       ?? null,
      clz:              rows[0].clz_list         ?? null,
      manual:           rows[0].manual_list      ?? null,
      digest_enabled:   rows[0].digest_enabled   ?? false,
      digest_last_sent: rows[0].digest_last_sent ?? null,
    });
  }

  if (req.method === "PATCH") {
    const { source, items, username, collectionItems } = req.body;
    if (!["locg", "clz", "manual"].includes(source)) {
      return res.status(400).json({ error: "Invalid source." });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array." });
    }
    const col = source === "locg" ? "locg_list" : source === "clz" ? "clz_list" : "manual_list";
    const payload = {
      items,
      updatedAt: new Date().toISOString(),
      ...(username ? { username } : {}),
      ...(Array.isArray(collectionItems) ? { collectionItems } : {}),
    };
    await pool.query(
      `UPDATE users SET "${col}" = $1 WHERE id = $2`,
      [JSON.stringify(payload), userId]
    );
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed." });
}
