# Comic Bundle Finder — Project Brief for Claude Code

## What This Is

A web tool for comic book collectors that searches eBay for listings and identifies sellers
who carry multiple issues the user is looking for — making it easy to bundle purchases and
save on shipping. Results are ranked by bundle count (sellers with the most matching issues
appear first). Single-issue sellers are filtered out entirely.

Live URL: https://comic-bundle-finder.vercel.app  
GitHub repo: github.com/FineDog/comic-bundle-finder-nextjs (branch: main)

---

## Stack

- **Framework:** Next.js (16.2.4) with Turbopack
- **Hosting:** Vercel (auto-deploys on every push to `main`)
- **Language:** JavaScript (no TypeScript)
- **Key dependency:** `xlsx` npm package (client-side Excel parsing)
- **External API:** eBay Browse API (OAuth2 client credentials flow)
- **Optional API:** Anthropic (for "Did you mean?" typo correction feature)

All search logic runs server-side in Next.js API routes. No separate backend.
Credentials are stored as Vercel environment variables — never in code.

---

## Environment Variables (Vercel)

| Variable | Purpose |
|---|---|
| `EBAY_APP_ID` | eBay OAuth client ID |
| `EBAY_SECRET` | eBay OAuth client secret |
| `EBAY_CAMPAIGN_ID` | eBay Partner Network campaign ID (affiliate links) |
| `ANTHROPIC_API_KEY` | Powers "Did you mean?" typo correction (optional) |

To add/update: Vercel Dashboard → Project → Settings → Environment Variables.
After changing env vars, trigger a manual redeploy from the Deployments tab.

---

## Features Currently Live

- **Manual input:** Textarea, one issue per line
- **File upload + drag-and-drop** for want list imports:
  - **ComicGeeks (.xlsx):** Detected by presence of "Full Title" and "In Wish List" columns.
    Filters to rows where `In Wish List >= 1`. Formats each as `Full Title (Year)` using
    year extracted from the `Release Date` column.
  - **CLZ (.csv):** Detected by "Series" and "Issue" columns. CLZ exports are always wish
    lists (collection vs. want list are separate exports in CLZ). Formats as `Series #Issue (Year)`.
  - **Plain .txt or generic .csv:** Each line treated as one search term as-is.
  - After parsing, textarea is populated with extracted titles so user can review/edit before
    searching. A confirmation message shows item count (e.g. "✓ Loaded 42 wish list items
    from League of Comic Geeks export.").
- **Price cap input:** User-configurable max price filter
- **Progress bar:** Shows search progress as issues are queried
- **Bundle filtering:** Only sellers with 2+ matching issues are shown
- **Stats row:** Issues Searched / Total Sellers Found / Bundle Opportunities
- **Subtotals per seller:** Shows total cost per seller across matching listings
- **"Did you mean?" typo correction:** Uses Anthropic API to suggest corrections for
  unrecognized issue names. Inactive if `ANTHROPIC_API_KEY` is not set.
- **eBay affiliate links:** Applied when `EBAY_CAMPAIGN_ID` is set (3% promoted listings
  rate matches the seller automation stack)
- **eBay affiliate disclosure:** Displayed in results footer per eBay Partner Network ToS

---

## Design

Retro comic book / newsprint aesthetic. Key design tokens:

- **Background:** `#f0e6c4` (aged newsprint) with dot-grid pattern
- **Panels:** `#fffdf4` with `3px solid #1a1a1a` border, `6px 6px 0 #1a1a1a` box shadow
- **Accent/header:** `#cc1f00` (comic book red)
- **Highlight:** `#ffe066` (yellow caption boxes, promo pills)
- **Display font:** Bangers (Google Fonts) — used for the main title
- **Body font:** Oswald (Google Fonts)

---

## Deployment Workflow

```bash
# Make changes locally, then:
git add .
git commit -m "describe the change"
git push
# Vercel auto-deploys within ~1 minute
```

To test a major change before replacing the live page, save it as `pages/preview.js`
(export default function name must match: `Preview`). It'll be available at
`/preview` without touching the live index.

---

## Outstanding To-Do Items

These were planned but not yet built:

1. **Upload Collection**: Functionality where users can upload their collection list and the app will identify gaps and generate a search list from the gaps.

---

## History / What Was Retired

The original version was a Python/FastAPI backend hosted on Render + a static `index.html`
frontend. This was fully migrated to Next.js on Vercel. The Render backend and old static
HTML are no longer in use. All search logic now lives in Next.js API routes.

---

## Metron API — Rules (CRITICAL, do not violate)

The site uses the Metron comic database API (metron.cloud) for series/arc metadata.
The account was suspended once for rate-limit abuse. These rules are mandatory.

**Rate limits:** 20 requests/minute · 5,000 requests/day  
**Guidelines:** https://metron-project.github.io/blog/api-best-practices  
**API rules:** https://metron.cloud/wiki/api/api-guidelines/

### The Golden Rule: No live Metron calls from Vercel

Vercel serverless functions use **rotating IP addresses** — each invocation may come
from a different IP. Metron treats this as a distributed attack and disables the account.

**NEVER add code that calls the Metron API from:**
- Any file under `pages/api/` (Next.js API routes)
- Any `getServerSideProps` function
- Any client-side code (browser fetch)

**The ONLY place Metron API calls are allowed:**
- `scripts/refresh-arc-index.js` — nightly GitHub Actions job (single stable IP)
- `lib/metron-issues.js` functions called from `getStaticProps` only (ISR, not per-request)

### Rate limiting rules for scripts

```js
const REQUEST_DELAY_MS = 3500; // ~17 req/min, safely under 20/min burst limit
// After each fetch:
await sleep(REQUEST_DELAY_MS);
// Check headers proactively:
const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") ?? "999", 10);
if (remaining <= 3) await sleep(65000); // pause a full minute
// Retry only on 429 (honour Retry-After) or 5xx. Never retry other 4xx.
```

### Architecture for arc/series data

- **Nightly script** fetches from Metron → writes to **Vercel Blob** cache
- **Live API routes** read from Blob cache only (`getBlobBaseUrl()` + plain `fetch()`)
- **On cache miss**: return `{ issues: null }` — show "not yet indexed" message to user
- Never fall back to a live Metron call on cache miss in a Vercel function

### Blob cache keys

| Data | Blob key | TTL | Writer |
|---|---|---|---|
| Arc issue list | `arc-issues/{arcId}.json` | none (static) | `scripts/refresh-arc-index.js` |
| Series issue list | `dynamic-series/metron-{id}/issues.json` | 7d | `lib/metron-issues.js` (getStaticProps only) |
| Series eBay results | `dynamic-series/metron-{id}/ebay/{start}-{count}.json` | 1h | `pages/api/series/[slug]/results.js` |

### Required secrets

`BLOB_READ_WRITE_TOKEN` must be set in **both**:
- Vercel project environment variables (all environments: Production, Preview, Development)
- GitHub repository secrets (used by `refresh-arc-index.yml` to write Blob cache)

---

## Notes for Claude Code

- The eBay API token is fetched fresh via client credentials OAuth on each request — there
  is no token caching or refresh cycle in this app.
- The `xlsx` package handles all spreadsheet parsing client-side in the browser; no server
  involvement for file uploads.
- When adding features to the results table, keep the retro aesthetic consistent —
  new UI elements should use the existing color tokens and border style.
- Gap analysis (finding missing issues within a run) was discussed as a future feature but
  not scoped yet. CLZ collection exports (vs. wish list exports) would be the input for that.
