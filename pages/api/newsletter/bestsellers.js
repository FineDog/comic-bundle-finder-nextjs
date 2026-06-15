// Scrapes Bleeding Cool's weekly bestseller list.
// Finds the latest article via the tag page, then parses the numbered list from it.

import * as cheerio from "cheerio";

const TAG_URL = "https://bleedingcool.com/tag/bestseller-list/";

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.text();
}

async function findLatestArticleUrl() {
  const html = await fetchHtml(TAG_URL);
  const $ = cheerio.load(html);

  // Tag pages list articles as anchor tags — find the first one whose href looks
  // like a bestseller article (contains "bestseller" or "top-1" in the path).
  let articleUrl = null;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (
      !articleUrl &&
      href.includes("bleedingcool.com/comics/") &&
      (href.includes("bestseller") || href.includes("top-1"))
    ) {
      articleUrl = href;
    }
  });

  return articleUrl;
}

function parseListFromArticle(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, aside, .sidebar, .ad, .advertisement").remove();

  // Strategy 1: table with a rank/number column (Bleeding Cool's current format)
  // Columns: No | Title | Publisher | Writer | Artist | Price | Ratio
  const tableEntries = [];
  $("table").each((_, tbl) => {
    // Only process tables that look like a ranked list (first cell is a small number)
    $(tbl).find("tr").each((i, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 2) return;
      const firstCell = $(cells[0]).text().trim();
      const secondCell = $(cells[1]).text().trim();
      if (/^\d{1,2}$/.test(firstCell) && secondCell.length > 2) {
        const rank = parseInt(firstCell, 10);
        const publisher = cells.length > 2 ? $(cells[2]).text().trim() : "";
        tableEntries.push({ rank, title: secondCell, publisher });
      }
    });
    if (tableEntries.length >= 5) return false; // stop after first matching table
  });

  if (tableEntries.length >= 5) {
    tableEntries.sort((a, b) => a.rank - b.rank);
    return tableEntries.map((e) =>
      e.publisher ? `${e.title} (${e.publisher})` : e.title
    );
  }

  // Strategy 2: ordered list
  const listEntries = [];
  $("ol li").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 3 && text.length < 200) listEntries.push(text);
  });
  if (listEntries.length >= 5) return listEntries.slice(0, 15);

  // Strategy 3: numbered lines in paragraphs ("1. Batman #XX")
  const bodyText = $("article, .entry-content, .post-content, main").text();
  const numbered = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(\d{1,2})[.)]\s+\S/.test(l) && l.length < 200);

  return numbered.slice(0, 15);
}

export default async function handler(req, res) {
  try {
    const articleUrl = await findLatestArticleUrl();
    if (!articleUrl) {
      return res.status(404).json({
        error: "Could not find a recent Bleeding Cool bestseller article. Check bleedingcool.com/tag/bestseller-list/ manually.",
      });
    }

    const articleHtml = await fetchHtml(articleUrl);
    const $ = cheerio.load(articleHtml);

    // Article title
    const title =
      $("h1").first().text().trim() ||
      $("title").text().trim().split("|")[0].trim();

    // Published date
    const pubDate =
      $("time[datetime]").first().attr("datetime") ||
      $("time").first().text().trim() ||
      null;

    const items = parseListFromArticle(articleHtml);

    if (items.length < 3) {
      return res.status(200).json({
        title,
        articleUrl,
        pubDate,
        items: [],
        warning: "Could not parse list from article — open it directly.",
      });
    }

    // Normalise: strip leading "1." / "1)" if present
    const cleaned = items.map((line) =>
      line.replace(/^\d{1,2}[.)]\s+/, "").trim()
    );

    res.status(200).json({ title, articleUrl, pubDate, items: cleaned });
  } catch (err) {
    console.error("Bestsellers error:", err);
    res.status(500).json({ error: err.message });
  }
}
