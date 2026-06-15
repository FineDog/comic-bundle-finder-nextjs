// Fetches top posts from comic subreddits via RSS (Atom feed).
// Reddit's public JSON endpoint now blocks server-side requests without OAuth;
// RSS still works without authentication.
// Score and comment count are not available in the feed — posts come pre-sorted by top.

const SUBREDDITS = [
  { name: "comicbooks", label: "r/comicbooks" },
  { name: "Marvel", label: "r/Marvel" },
  { name: "DCcomics", label: "r/DCcomics" },
];

function parseAtom(xml, label) {
  const posts = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const get = (tag) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
      return m ? m[1].trim() : "";
    };
    const title = get("title")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#32;/g, " ");
    const link = (entry.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "";
    const id = get("id").replace(/^t3_/, "");
    const updated = get("updated");

    if (title && link) {
      posts.push({ id, title, url: link, subreddit: label, updated });
    }
  }
  return posts;
}

export default async function handler(req, res) {
  try {
    const results = await Promise.all(
      SUBREDDITS.map(async ({ name, label }) => {
        try {
          const r = await fetch(
            `https://www.reddit.com/r/${name}/top/.rss?t=week&limit=15`,
            {
              headers: { "User-Agent": "ComicBundleFinder/1.0" },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (!r.ok) return [];
          const xml = await r.text();
          return parseAtom(xml, label);
        } catch {
          return [];
        }
      })
    );

    // Interleave subreddits so the feed isn't all one sub then another
    const [a, b, c] = results;
    const interleaved = [];
    const max = Math.max(a.length, b.length, c.length);
    for (let i = 0; i < max; i++) {
      if (a[i]) interleaved.push(a[i]);
      if (b[i]) interleaved.push(b[i]);
      if (c[i]) interleaved.push(c[i]);
    }

    res.status(200).json({ posts: interleaved });
  } catch (err) {
    console.error("Reddit RSS error:", err);
    res.status(500).json({ error: err.message });
  }
}
