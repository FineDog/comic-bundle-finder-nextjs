// GET /api/arc/[id]/issues
//
// Returns the issue list for a Metron story arc, read from the static
// public/data/arc-issues.json file committed nightly by GitHub Actions.
//
// No Vercel Blob reads or writes — arc issues are static files in the repo.
//
// On cache miss (arc not yet in the file), returns { issues: null }.

import fs from "fs";
import path from "path";

let arcIssuesCache = null;

function loadArcIssues() {
  if (arcIssuesCache) return arcIssuesCache;
  try {
    const filePath = path.join(process.cwd(), "public", "data", "arc-issues.json");
    arcIssuesCache = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    arcIssuesCache = {};
  }
  return arcIssuesCache;
}

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const arcId = parseInt(req.query.id, 10);
  if (!arcId) return res.status(400).json({ error: "Invalid arc ID." });

  const issues = loadArcIssues()[arcId];
  if (issues) {
    return res.status(200).json({ issues });
  }

  return res.status(200).json({ issues: null, cached: false });
}
