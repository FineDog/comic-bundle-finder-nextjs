const BASE = "https://leagueofcomicgeeks.com";

// Try multiple LOCG pages and selectors to find the numeric user ID.
async function findUserId(impit, cheerio, username) {
  const slug = username.toLowerCase();
  const pages = [
    `${BASE}/profile/${slug}/pull-list`,
    `${BASE}/profile/${slug}`,
    `${BASE}/profile/${slug}/collection`,
    `${BASE}/profile/${slug}/wish-list`,
  ];

  for (const url of pages) {
    try {
      const text = await impit.fetch(url).then(r => r.text());
      const $ = cheerio.load(text);
      let id = 0;
      $("[data-user]").each((_, el) => { if (!id) id = Number($(el).attr("data-user")); });
      if (!id) $("[data-user-id]").each((_, el) => { if (!id) id = Number($(el).attr("data-user-id")); });
      if (id > 0) return id;
      $("script").each((_, el) => {
        if (id) return;
        const src = $(el).html() || "";
        const m = src.match(/"user_id"\s*:\s*(\d+)/) || src.match(/user_id\s*=\s*(\d+)/) || src.match(/"userId"\s*:\s*(\d+)/);
        if (m) id = parseInt(m[1], 10);
      });
      if (id > 0) return id;
    } catch {}
  }
  throw new Error(`Could not find user ID for '${username}' — the profile may be private or the username is incorrect.`);
}

// Parse series entries from a get_comics series-level response
function parseSeries($) {
  const series = [];
  $("li").each((_, el) => {
    const name = $(el).find(".title.color-primary a").text().trim();
    const id = $(el).find("[data-id]").first().attr("data-id");
    if (name && id) series.push({ name, id });
  });
  return series;
}

// Parse individual issues from a get_comics issue-level response
function parseIssues($) {
  const issues = [];
  $("li.issue").each((_, el) => {
    const title = $(el).find(".title.color-primary a").text().trim();
    const dateAttr = $(el).find(".date[data-date]").attr("data-date");
    const year = dateAttr ? new Date(parseInt(dateAttr, 10) * 1000).getFullYear() : null;
    if (title) issues.push(year ? `${title} (${year})` : title);
  });
  return issues;
}

const AJAX_HEADERS = { "X-Requested-With": "XMLHttpRequest" };

// Fetch the series list for a list type (list=2 collection, list=3 wishlist)
async function fetchSeriesList(impit, cheerio, listType, userId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&user_id=${userId}`;
  const res = await impit.fetch(url, { headers: AJAX_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const $ = cheerio.load(json.list || "");
  return parseSeries($);
}

// Fetch individual issues for one series within a list type
async function fetchSeriesIssues(impit, cheerio, listType, seriesId, userId) {
  const url = `${BASE}/comic/get_comics?list=${listType}&series_id=${seriesId}&user_id=${userId}`;
  try {
    const res = await impit.fetch(url, { headers: AJAX_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    const $ = cheerio.load(json.list || "");
    return parseIssues($);
  } catch {
    return [];
  }
}

// Fetch issues for all series in a list, with concurrency limiting
async function fetchAllIssues(impit, cheerio, listType, seriesList, userId, concurrency = 4) {
  const all = [];
  for (let i = 0; i < seriesList.length; i += concurrency) {
    const batch = seriesList.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(s => fetchSeriesIssues(impit, cheerio, listType, s.id, userId))
    );
    all.push(...results.flat());
  }
  return all;
}

export default async function handler(req, res) {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username required" });

  let cheerio, impit;
  try {
    const [{ Impit }, ch] = await Promise.all([import("impit"), import("cheerio")]);
    cheerio = ch;
    impit = new Impit({ browser: "chrome" });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load scraping dependencies." });
  }

  // Resolve user ID
  let userId;
  try {
    // Try comicgeeks fetchUser first (fast path)
    const { fetchUser } = await import("comicgeeks");
    const user = await fetchUser(username);
    if (!user?.id) throw new Error("no id");
    userId = user.id;
  } catch {
    try {
      userId = await findUserId(impit, cheerio, username);
    } catch (e) {
      return res.status(404).json({ error: e.message });
    }
  }

  // Debug mode: show parsed series + raw HTML of first series' issues
  if (req.query.raw) {
    const [wishSeries, collSeries] = await Promise.all([
      fetchSeriesList(impit, cheerio, 3, userId).catch(() => []),
      fetchSeriesList(impit, cheerio, 2, userId).catch(() => []),
    ]);
    let firstIssuesRaw = null;
    if (wishSeries[0]?.id) {
      const url = `${BASE}/comic/get_comics?list=3&series_id=${wishSeries[0].id}&user_id=${userId}`;
      const json = await impit.fetch(url).then(r => r.json()).catch(() => ({}));
      firstIssuesRaw = typeof json.list === "string" ? json.list.slice(0, 2000) : json;
    }
    return res.json({ userId, wishSeries, collSeries, firstIssuesRaw });
  }

  // Fetch all series for wishlist and collection in parallel
  const [wishSeries, collSeries] = await Promise.all([
    fetchSeriesList(impit, cheerio, 3, userId).catch(() => []),
    fetchSeriesList(impit, cheerio, 2, userId).catch(() => []),
  ]);

  // Fetch individual issues for each series
  const [wishlist, collection] = await Promise.all([
    fetchAllIssues(impit, cheerio, 3, wishSeries, userId),
    fetchAllIssues(impit, cheerio, 2, collSeries, userId),
  ]);

  return res.json({ userId, wishlist, collection });
}
