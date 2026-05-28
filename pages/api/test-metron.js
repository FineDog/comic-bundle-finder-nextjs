// Temporary diagnostic endpoint — remove after debugging
// GET /api/test-metron?arc=341
export default async function handler(req, res) {
  const arcId = req.query.arc || 341;

  const hasUser = !!process.env.METRON_USERNAME;
  const hasPass = !!process.env.METRON_PASSWORD;
  const userLen = process.env.METRON_USERNAME?.length ?? 0;
  const passLen = process.env.METRON_PASSWORD?.length ?? 0;

  if (!hasUser || !hasPass) {
    return res.status(200).json({
      ok: false,
      step: "env",
      hasUser,
      hasPass,
      userLen,
      passLen,
    });
  }

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "User-Agent": "ComicBundleFinder/1.0",
  };

  let arcStatus, arcBody;
  try {
    const r = await fetch(`https://metron.cloud/api/arc/${arcId}/`, { headers });
    arcStatus = r.status;
    arcBody = await r.text();
  } catch (e) {
    return res.status(200).json({ ok: false, step: "fetch", error: e.message, userLen, passLen });
  }

  let issueCount = null;
  if (arcStatus === 200) {
    try {
      const r2 = await fetch(`https://metron.cloud/api/arc/${arcId}/issue_list/?page_size=10`, { headers });
      const d = await r2.json();
      issueCount = d.count;
    } catch {
      issueCount = "error";
    }
  }

  return res.status(200).json({
    ok: arcStatus === 200,
    step: "metron",
    arcId,
    arcStatus,
    arcBodyPreview: arcBody.slice(0, 200),
    issueCount,
    userLen,
    passLen,
  });
}
