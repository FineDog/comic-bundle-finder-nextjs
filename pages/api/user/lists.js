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
      "SELECT locg_list, clz_list, manual_list FROM users WHERE id = $1",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    return res.json({
      locg:   rows[0].locg_list   ?? [],
      clz:    rows[0].clz_list    ?? [],
      manual: rows[0].manual_list ?? [],
    });
  }

  if (req.method === "PATCH") {
    const { source, items } = req.body;
    if (!["locg", "clz", "manual"].includes(source)) {
      return res.status(400).json({ error: "Invalid source." });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array." });
    }
    const col = source === "locg" ? "locg_list" : source === "clz" ? "clz_list" : "manual_list";
    await pool.query(
      `UPDATE users SET "${col}" = $1 WHERE id = $2`,
      [JSON.stringify(items), userId]
    );
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed." });
}
