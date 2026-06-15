import * as cheerio from "cheerio";

async function fetchChart(year, month) {
  const mm = String(month).padStart(2, "0");
  const url = `https://www.comichron.com/monthlycomicssales/${year}/${year}-${mm}.html`;
  let r;
  try {
    r = await fetch(url, {
      headers: { "User-Agent": "ComicBundleFinder/1.0" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return null;
  }
  if (!r.ok) return null;

  const html = await r.text();
  const $ = cheerio.load(html);

  const rows = [];
  // Their tables have a data-sortable or standard structure; grab the first substantial table
  let targetTable = null;
  $("table").each((_, tbl) => {
    if (!targetTable && $(tbl).find("tr").length > 10) targetTable = tbl;
  });
  if (!targetTable) return null;

  $(targetTable)
    .find("tr")
    .each((i, tr) => {
      if (i === 0) return; // header row
      const cells = $(tr).find("td");
      if (cells.length < 3) return;
      const rank = $(cells[0]).text().trim();
      const title = $(cells[1]).text().trim();
      const publisher = $(cells[2]).text().trim();
      const price = cells.length > 3 ? $(cells[3]).text().trim() : "";
      const sales = cells.length > 4 ? $(cells[4]).text().trim() : "";
      if (rank && title && !isNaN(parseInt(rank))) {
        rows.push({ rank, title, publisher, price, sales });
      }
    });

  if (rows.length < 5) return null;
  return { rows: rows.slice(0, 50), year, month, url };
}

export default async function handler(req, res) {
  const now = new Date();
  // Comichron publishes ~6 weeks after cover date, so check 2–5 months back
  const candidates = [];
  for (let i = 2; i <= 5; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    candidates.push([d.getFullYear(), d.getMonth() + 1]);
  }

  for (const [year, month] of candidates) {
    const chart = await fetchChart(year, month);
    if (chart) {
      res.status(200).json(chart);
      return;
    }
  }

  res.status(404).json({ error: "No recent chart found — check comichron.com directly" });
}
