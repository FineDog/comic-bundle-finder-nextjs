export default async function handler(req, res) {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username required" });

  let fetchUser, fetchWishList, fetchCollection, CollectionTypes;
  try {
    const mod = await import("comicgeeks");
    fetchUser = mod.fetchUser;
    fetchWishList = mod.fetchWishList;
    fetchCollection = mod.fetchCollection;
    CollectionTypes = mod.CollectionTypes;
  } catch (e) {
    console.error("comicgeeks module load error:", e);
    return res.status(500).json({ error: "LOCG import module failed to load." });
  }

  try {
    const user = await fetchUser(username);
    if (!user?.id) return res.status(404).json({ error: "User not found on LOCG." });

    const [wishItems, collItems] = await Promise.all([
      fetchWishList(user.id, CollectionTypes.Issue).catch(() => []),
      fetchCollection(user.id, CollectionTypes.Issue).catch(() => []),
    ]);

    const wishlist = (wishItems || []).map(c => c.name).filter(Boolean);
    const collection = (collItems || []).map(c => c.name).filter(Boolean);

    return res.json({ wishlist, collection, username: user.name });
  } catch (e) {
    console.error("LOCG import error:", e);
    return res.status(500).json({
      error: "Could not fetch data from League of Comic Geeks. The profile may be private, or the service may have changed. Try uploading your export file instead.",
    });
  }
}
