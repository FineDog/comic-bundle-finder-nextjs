// Next week's new comic releases from Metron API.
// Only called from local dev — never deployed to Vercel (Metron bans rotating IPs).

function metronAuth() {
  return Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");
}

// Get the Wednesday of the week containing the given date.
function wednesdayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 3=Wed, 6=Sat
  const diff = (3 - day + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function handler(req, res) {
  // Metron bans Vercel's rotating IPs. This route must never run on Vercel.
  if (process.env.VERCEL) {
    return res.status(403).json({ error: "This route is disabled in production. Run locally only." });
  }
  if (!process.env.METRON_USERNAME || !process.env.METRON_PASSWORD) {
    return res.status(500).json({ error: "METRON_USERNAME / METRON_PASSWORD not set in .env.local" });
  }

  // ?week=YYYY-MM-DD to look up a specific week; defaults to the upcoming Wednesday
  const requestedDate = req.query.week ? new Date(req.query.week) : new Date();
  const wednesday = wednesdayOf(requestedDate);
  // If today is already past Wednesday, jump to next week
  const now = new Date();
  if (wednesday < now && now.getDay() !== 3) {
    wednesday.setDate(wednesday.getDate() + 7);
  }
  const after = wednesday.toISOString().slice(0, 10);
  const beforeDate = new Date(wednesday);
  beforeDate.setDate(beforeDate.getDate() + 6);
  const before = beforeDate.toISOString().slice(0, 10);

  const auth = metronAuth();
  const issues = [];
  let page = 1;

  try {
    while (true) {
      const url =
        `https://metron.cloud/api/issue/?store_date_range_after=${after}` +
        `&store_date_range_before=${before}&page_size=100&page=${page}`;
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return res.status(502).json({ error: `Metron returned ${r.status}: ${text.slice(0, 200)}` });
      }
      const data = await r.json();
      for (const issue of data.results || []) {
        issues.push({
          id: issue.id,
          name: issue.issue,
          number: issue.number,
          series: issue.series?.name || "",
          seriesId: issue.series?.id || null,
          publisher: issue.publisher?.name || issue.series?.publisher?.name || "",
          storeDate: issue.store_date,
          coverDate: issue.cover_date,
          image: issue.image || null,
          desc: issue.desc || "",
          price: issue.price || null,
        });
      }
      if (!data.next) break;
      page++;
    }

    // Sort: publisher (Marvel/DC first), then series name
    issues.sort((a, b) => {
      const pubRank = (p) => {
        if (/marvel/i.test(p)) return 0;
        if (/dc/i.test(p)) return 1;
        return 2;
      };
      const pr = pubRank(a.publisher) - pubRank(b.publisher);
      if (pr !== 0) return pr;
      return a.series.localeCompare(b.series);
    });

    res.status(200).json({ issues, weekOf: after, total: issues.length });
  } catch (err) {
    console.error("Metron releases error:", err);
    res.status(500).json({ error: err.message });
  }
}
