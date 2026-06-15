import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed." });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Sign in required." });

  const userId = session.user.id;
  const email = session.user.email;

  // verification_tokens has no FK to users, so clear by email first
  if (email) {
    await pool.query("DELETE FROM verification_tokens WHERE identifier = $1", [email]);
  }

  // accounts and sessions cascade from users(id)
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);

  return res.json({ ok: true });
}
