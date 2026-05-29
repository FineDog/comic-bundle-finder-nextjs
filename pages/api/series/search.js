export default async function handler(req, res) {
  const q = (req.query.q || "").trim();
  const full = req.query.full === "1"; // paginate for full search results

  if (q.length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");

  const baseUrl = `https://metron.cloud/api/series/?name=${encodeURIComponent(q)}&page_size=100`;

  // Fetch first page
  let firstRes;
  try {
    firstRes = await fetch(baseUrl, { headers: { Authorization: `Basic ${auth}` } });
  } catch {
    return res.status(502).json({ error: "Could not reach Metron API" });
  }
  if (!firstRes.ok) {
    return res.status(502).json({ error: `Metron API returned ${firstRes.status}` });
  }

  const firstData = await firstRes.json();
  let allResults = firstData.results || [];
  const totalCount = firstData.count || 0;

  // For full searches, paginate through up to 4 pages total to get a complete result set
  // (Metron hard-caps page_size at 100, so 400 results max).
  // Pages are fetched in parallel so all 4 resolve in ~200ms instead of ~800ms sequentially.
  if (full && firstData.next) {
    const extraPages = await Promise.all(
      [2, 3, 4].map((page) =>
        fetch(`${baseUrl}&page=${page}`, { headers: { Authorization: `Basic ${auth}` } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    for (const pageData of extraPages) {
      if (pageData && pageData.results) {
        allResults = allResults.concat(pageData.results);
      }
    }
  }

  return res.json({
    count: totalCount,
    results: allResults.map((s) => ({
      id: s.id,
      name: s.series,          // Metron uses "series" field, not "name"
      issueCount: s.issue_count || 0,
      yearBegan: s.year_began || null,
    })),
  });
}
