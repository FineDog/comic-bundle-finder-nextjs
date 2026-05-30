import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed." });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Sign in required." });

  const { digest_enabled } = req.body;
  if (typeof digest_enabled !== "boolean") {
    return res.status(400).json({ error: "digest_enabled must be a boolean." });
  }

  await pool.query(
    "UPDATE users SET digest_enabled = $1 WHERE id = $2",
    [digest_enabled, session.user.id]
  );

  return res.json({ ok: true });
}
