// pages/api/geolocate.js
// Returns { zip, country } so the Browse API can estimate calculated shipping.
// Called once on page load; result is sent with every subsequent search request.
//
// Source: Vercel's edge geolocation headers (x-vercel-ip-*), populated on every
// request including the Hobby plan. The visitor's IP never leaves our stack — no
// third-party geolocation service is contacted. IP geolocation is metro-accurate
// at best (it may resolve to a nearby city), but shipping is zone-based so a
// representative ZIP for the right region is all eBay needs.
export default async function handler(req, res) {
  const country = (req.headers["x-vercel-ip-country"] || "").toUpperCase();
  const postal = req.headers["x-vercel-ip-postal-code"] || "";

  // No country resolved (local dev, private network, or an IP Vercel can't place).
  if (!country) {
    return res.status(200).json({ zip: null, country: null, reason: "no_country" });
  }

  // US visitor with a ZIP — full context for accurate domestic shipping estimates.
  if (country === "US" && postal) {
    return res.status(200).json({ zip: postal, country: "US" });
  }

  // Non-US, or US without a ZIP: return country only so the eBay call can still
  // pass X-EBAY-C-ENDUSERCTX with country-level context for zone-based estimates.
  return res.status(200).json({
    zip: null,
    country,
    reason: country !== "US" ? "non_us" : "no_postal",
  });
}
