import { useEffect } from "react";

// Gated Umami loader. The analytics script only loads when ALL of these pass,
// so your own testing — local dev, preview deploys, automated browsers, and
// your personal devices — never counts as real traffic.
//
//   Layer 1: only real production hosts (kills localhost + Vercel previews)
//   Layer 2: skip automation/headless browsers (Claude's test browser, bots)
//   Layer 3: per-device opt-out cookie you set once via ?notrack=1
//
// All three gate the loader itself, so this stays valid if GA4 (or anything
// else) is added later — register it behind the same checks.

// Hosts where analytics should actually run. Everything else is excluded.
export const PRODUCTION_HOSTS = new Set([
  "comicbundlefinder.com",
  "www.comicbundlefinder.com",
  "comic-bundle-finder.vercel.app",
]);

const UMAMI_SRC = "https://cloud.umami.is/script.js";
const UMAMI_WEBSITE_ID = "552861dd-8b3d-476b-b129-fdc57a380c81";

// Long-lived first-party cookie that silences analytics on this device.
// Set it once per device by visiting any page with ?notrack=1 (and clear it
// again with ?notrack=0). Because it lives on the device, it works regardless
// of IP or network — e.g. your phone on cellular while you're out.
export const OPT_OUT_COOKIE = "cbf_notrack";
const FIVE_YEARS_SECONDS = 60 * 60 * 24 * 365 * 5;

// Pure: does a cookie string already carry the opt-out flag?
export function cookieHasOptOut(cookieString) {
  return (cookieString || "")
    .split("; ")
    .some((c) => c === `${OPT_OUT_COOKIE}=1`);
}

// Pure: read ?notrack from a query string. Returns true (opt out), false
// (opt back in via ?notrack=0), or null (param absent — leave as-is).
export function optOutFromSearch(search) {
  const params = new URLSearchParams(search || "");
  if (!params.has("notrack")) return null;
  return params.get("notrack") !== "0";
}

// Pure: the full Layer 1–3 decision. Kept separate from the DOM so it can be
// unit-tested without a browser.
export function shouldLoadAnalytics({ hostname, webdriver, cookieString }) {
  if (!PRODUCTION_HOSTS.has(hostname)) return false; // Layer 1
  if (webdriver) return false; // Layer 2
  if (cookieHasOptOut(cookieString)) return false; // Layer 3
  return true;
}

function setOptOutCookie(enabled) {
  const maxAge = enabled ? FIVE_YEARS_SECONDS : 0;
  document.cookie = `${OPT_OUT_COOKIE}=1; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export default function UmamiAnalytics() {
  useEffect(() => {
    // Layer 3 (setter): honor ?notrack=1 / ?notrack=0 to toggle this device.
    // Runs first so visiting ?notrack=1 both sets the cookie AND suppresses
    // this very pageview (document.cookie updates synchronously).
    const optOut = optOutFromSearch(window.location.search);
    if (optOut !== null) setOptOutCookie(optOut);

    if (
      !shouldLoadAnalytics({
        hostname: window.location.hostname,
        webdriver: navigator.webdriver,
        cookieString: document.cookie,
      })
    ) {
      return;
    }

    // Don't double-inject across route changes / fast refresh.
    if (document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`)) {
      return;
    }

    const s = document.createElement("script");
    s.defer = true;
    s.src = UMAMI_SRC;
    s.setAttribute("data-website-id", UMAMI_WEBSITE_ID);
    document.head.appendChild(s);
  }, []);

  return null;
}
