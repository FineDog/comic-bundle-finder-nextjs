import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { canAccess } from "@/lib/features";
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

  // Daily digest is a premium (email-alerts) feature. Free users may turn it
  // off (e.g. after a downgrade) but not on.
  if (digest_enabled && !canAccess(session.user.plan ?? "free", "email-alerts")) {
    return res.status(403).json({ error: "premium_required", feature: "email-alerts" });
  }

  await pool.query(
    "UPDATE users SET digest_enabled = $1 WHERE id = $2",
    [digest_enabled, session.user.id]
  );

  return res.json({ ok: true });
}
