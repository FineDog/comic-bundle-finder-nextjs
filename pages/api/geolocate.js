// pages/api/geolocate.js
// Returns { zip } for US visitors so Browse API can estimate calculated shipping.
// Called once on page load; result is sent with every subsequent search request.
export default async function handler(req, res) {
  // TEMP: inspect which Vercel geo headers are populated on the current plan.
  // Hit the deployed /api/geolocate route, then check the Vercel deployment logs.
  // Remove once we know what Hobby returns.
  console.log("VERCEL_GEO_HEADERS", JSON.stringify({
    country: req.headers["x-vercel-ip-country"] || null,
    region: req.headers["x-vercel-ip-country-region"] || null,
    city: req.headers["x-vercel-ip-city"] || null,
    postal: req.headers["x-vercel-ip-postal-code"] || null,
    lat: req.headers["x-vercel-ip-latitude"] || null,
    lon: req.headers["x-vercel-ip-longitude"] || null,
  }));

  const forwarded = req.headers["x-forwarded-for"];
  const ip = (forwarded ? forwarded.split(",")[0] : req.socket?.remoteAddress || "").trim();

  // Local / private addresses — can't geolocate
  if (!ip || ip === "127.0.0.1" || ip === "::1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
    return res.status(200).json({ zip: null, reason: "local" });
  }

  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "comic-bundle-finder/1.0" },
    });
    if (!r.ok) return res.status(200).json({ zip: null, reason: "api_error" });
    const data = await r.json();

    if (!data.country_code) {
      return res.status(200).json({ zip: null, country: null, reason: "no_country" });
    }

    // For non-US visitors return the country code so the API can still pass
    // X-EBAY-C-ENDUSERCTX with country-only — enough for flat-rate and
    // zone-based international shipping estimates.
    if (data.country_code !== "US" || !data.postal) {
      return res.status(200).json({ zip: null, country: data.country_code, reason: data.country_code !== "US" ? "non_us" : "no_postal" });
    }

    return res.status(200).json({ zip: data.postal, country: "US" });
  } catch {
    return res.status(200).json({ zip: null, reason: "error" });
  }
}
