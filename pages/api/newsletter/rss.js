const FEEDS = [
  { name: "CBR", url: "https://www.cbr.com/feed/" },
  { name: "Bleeding Cool", url: "https://bleedingcool.com/feed/" },
];

function parseRSS(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag) => {
      const m = item.match(
        new RegExp(`<${tag}(?:[^>]*)>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i")
      );
      return m ? m[1].trim() : "";
    };
    const title = getTag("title");
    const link =
      item.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ||
      item.match(/<link[^/]*\/>/)?.[0] ||
      "";
    const pubDate = getTag("pubDate");
    const description = getTag("description")
      .replace(/<[^>]+>/g, "")
      .slice(0, 200);
    if (title) {
      items.push({ title, link, pubDate, description, source: sourceName });
    }
  }
  return items;
}

export default async function handler(req, res) {
  try {
    const results = await Promise.all(
      FEEDS.map(async ({ name, url }) => {
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": "ComicBundleFinder/1.0" },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) return [];
          const xml = await r.text();
          return parseRSS(xml, name);
        } catch {
          return [];
        }
      })
    );

    // Interleave sources rather than dump one then the other
    const [a, b] = results;
    const interleaved = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i]) interleaved.push(a[i]);
      if (b[i]) interleaved.push(b[i]);
    }

    res.status(200).json({ items: interleaved.slice(0, 40) });
  } catch (err) {
    console.error("RSS error:", err);
    res.status(500).json({ error: err.message });
  }
}
