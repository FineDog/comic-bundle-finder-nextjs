const SUBREDDITS = [
  { name: "comicbooks", label: "r/comicbooks" },
  { name: "Marvel", label: "r/Marvel" },
  { name: "DCcomics", label: "r/DCcomics" },
];

export default async function handler(req, res) {
  try {
    const results = await Promise.all(
      SUBREDDITS.map(async ({ name, label }) => {
        const r = await fetch(
          `https://www.reddit.com/r/${name}/top.json?t=week&limit=15`,
          { headers: { "User-Agent": "ComicBundleFinder/1.0" } }
        );
        if (!r.ok) return [];
        const data = await r.json();
        return (data.data?.children || []).map((p) => ({
          id: p.data.id,
          title: p.data.title,
          score: p.data.score,
          comments: p.data.num_comments,
          url: `https://reddit.com${p.data.permalink}`,
          thumbnail: p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : null,
          subreddit: label,
          created: p.data.created_utc,
          flair: p.data.link_flair_text || null,
        }));
      })
    );

    const allPosts = results.flat().sort((a, b) => b.score - a.score);
    res.status(200).json({ posts: allPosts });
  } catch (err) {
    console.error("Reddit error:", err);
    res.status(500).json({ error: err.message });
  }
}
