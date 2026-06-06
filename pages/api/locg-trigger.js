import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

const REPO = "FineDog/comic-bundle-finder-nextjs";
const WORKFLOW = "locg-sync.yml";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Sign in required" });

  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    return res.status(503).json({
      error: "On-demand sync is not configured. Your list syncs automatically each night — check back tomorrow, or upload your export file for an immediate update.",
    });
  }

  const branch = process.env.GITHUB_SYNC_BRANCH || "main";
  const dbUserId = String(session.user.id);

  const ghRes = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: branch, inputs: { db_user_id: dbUserId } }),
    }
  );

  if (!ghRes.ok) {
    const text = await ghRes.text();
    console.error("GitHub dispatch error:", ghRes.status, text);
    return res.status(500).json({
      error: "Could not start sync. Try uploading your export file instead.",
    });
  }

  return res.json({
    ok: true,
    message: "Sync started — your list will update in about a minute. Refresh this page when ready.",
  });
}
