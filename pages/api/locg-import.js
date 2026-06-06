const BASE = "https://leagueofcomicgeeks.com";

// Try multiple LOCG pages and selectors to find the numeric user ID.
// LOCG may use client-side rendering on some pages, so we cast a wide net.
async function findUserId(username) {
  const [{ Impit }, cheerio] = await Promise.all([
    import("impit"),
    import("cheerio"),
  ]);
  const impit = new Impit({ browser: "chrome" });
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

      // Look for data-user / data-user-id on any element
      let id = 0;
      $("[data-user]").each((_, el) => {
        if (!id) id = Number($(el).attr("data-user"));
      });
      if (!id) {
        $("[data-user-id]").each((_, el) => {
          if (!id) id = Number($(el).attr("data-user-id"));
        });
      }
      if (id > 0) return id;

      // Scan inline <script> tags for user_id patterns
      $("script").each((_, el) => {
        if (id) return;
        const src = $(el).html() || "";
        const m = src.match(/"user_id"\s*:\s*(\d+)/) ||
                  src.match(/user_id\s*=\s*(\d+)/) ||
                  src.match(/"userId"\s*:\s*(\d+)/);
        if (m) id = parseInt(m[1], 10);
      });
      if (id > 0) return id;
    } catch {
      // try next page
    }
  }

  throw new Error(
    `Could not find user ID for '${username}' — the profile may be private or the username is incorrect.`
  );
}

export default async function handler(req, res) {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username required" });

  let fetchWishList, fetchCollection, CollectionTypes;
  try {
    const mod = await import("comicgeeks");
    fetchWishList = mod.fetchWishList;
    fetchCollection = mod.fetchCollection;
    CollectionTypes = mod.CollectionTypes;
  } catch (e) {
    console.error("comicgeeks module load error:", e);
    return res.status(500).json({ error: "LOCG import module failed to load." });
  }

  let userId;
  try {
    // Try the comicgeeks fetchUser first (fast path)
    const { fetchUser } = await import("comicgeeks");
    const user = await fetchUser(username);
    if (!user?.id) throw new Error("no id returned");
    userId = user.id;
  } catch (e) {
    console.warn("comicgeeks fetchUser failed, trying manual extraction:", e.message);
    // Fall back to manual multi-page extraction
    try {
      userId = await findUserId(username);
    } catch (e2) {
      console.error("findUserId failed:", e2.message);
      return res.status(404).json({ error: e2.message });
    }
  }

  try {
    const [wishItems, collItems] = await Promise.all([
      fetchWishList(userId, CollectionTypes.Issue).catch(e => { console.error("wishlist:", e.message); return []; }),
      fetchCollection(userId, CollectionTypes.Issue).catch(e => { console.error("collection:", e.message); return []; }),
    ]);

    const wishlist = (wishItems || []).map(c => c.name).filter(Boolean);
    const collection = (collItems || []).map(c => c.name).filter(Boolean);

    if (!wishlist.length && !collection.length) {
      return res.status(200).json({
        wishlist: [],
        collection: [],
        warning: "No items found — the lists may be empty or the profile may be set to private.",
      });
    }

    return res.json({ wishlist, collection });
  } catch (e) {
    console.error("LOCG fetch error:", e);
    return res.status(500).json({
      error: "Found the user but could not load list data. LOCG may have changed their API.",
    });
  }
}
