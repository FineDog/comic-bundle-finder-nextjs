export default async function handler(req, res) {
  const q = (req.query.q || "").trim();
  if (q.length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");

  let metronRes;
  try {
    metronRes = await fetch(
      `https://metron.cloud/api/series/?name=${encodeURIComponent(q)}&page_size=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
  } catch {
    return res.status(502).json({ error: "Could not reach Metron API" });
  }

  if (!metronRes.ok) {
    return res.status(502).json({ error: `Metron API returned ${metronRes.status}` });
  }

  const data = await metronRes.json();
  return res.json({
    count: data.count,
    results: (data.results || []).map((s) => ({
      id: s.id,
      name: s.series,        // Metron uses "series" field, not "name"
      yearBegan: s.year_began || null,
    })),
  });
}
