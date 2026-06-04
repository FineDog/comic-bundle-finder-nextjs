# Comic Bundle Finder — Project Brief for Claude Code

## What This Is

A web tool for comic book collectors that searches eBay for listings and identifies sellers
who carry multiple issues the user is looking for — making it easy to bundle purchases and
save on shipping. Results are ranked by bundle count (sellers with the most matching issues
appear first). Single-issue sellers are filtered out entirely.

Live URL: https://comic-bundle-finder.vercel.app  
GitHub repo: github.com/FineDog/comic-bundle-finder-nextjs (branch: main)

---

## Active Development Notice

**The site is currently mid-redesign.** Two separate branches and Vercel projects are in use:

- **`main` branch → `comic-bundle-finder-nextjs` Vercel project** — the live production site.
  Backend changes (API routes, scripts, lib/) are fine here. Do not touch the live UI pages
  (`pages/index.js` and other user-facing pages) unless specifically asked.
- **`ui-redesign` branch → `comic-bundle-finder-preview` Vercel project** — where all UI
  redesign work happens. Frontend changes go here.

Some things (e.g. GitHub Actions scripts) must land on `main` to work correctly, but the
default assumption is: backend changes to `main`, UI changes to `ui-redesign`.

---

## Stack

- **Framework:** Next.js (16.2.4) with Turbopack
- **Hosting:** Vercel (auto-deploys on every push to `main`)
- **Language:** JavaScript (no TypeScript)
- **Key dependencies:** `xlsx` (client-side Excel parsing), `next-auth` (auth), `resend` (email)
- **External API:** eBay Browse API (OAuth2 client credentials flow)
- **Database:** Postgres (via `DATABASE_URL`) — user accounts, saved lists, digest opt-in

All search logic runs server-side in Next.js API routes. No separate backend.
Credentials are stored as Vercel environment variables — never in code.

---

## Environment Variables (Vercel)

### eBay

| Variable | Purpose |
|---|---|
| `EBAY_APP_ID` | eBay OAuth client ID |
| `EBAY_SECRET` | eBay OAuth client secret |
| `EBAY_CAMPAIGN_ID` | eBay Partner Network campaign ID (affiliate links) — optional |

### Auth & Database

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string — user accounts, saved lists, digest opt-in |
| `NEXTAUTH_SECRET` | Session signing/encryption key |
| `NEXTAUTH_URL` | Canonical URL for NextAuth redirects (e.g. `https://comicbundlefinder.com`) |

### Email

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key — powers daily digest emails and one-off email results |

### Storage

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token — arc/series eBay result caching and issue lists |

### Metron

| Variable | Purpose |
|---|---|
| `METRON_USERNAME` | Metron API credentials (arc/series metadata) |
| `METRON_PASSWORD` | Metron API credentials |

To add/update: Vercel Dashboard → Project → Settings → Environment Variables.
After changing env vars, trigger a manual redeploy from the Deployments tab.

---

## Features Currently Live

### Main Search (`pages/index.js`)

**Input**
- Manual textarea, one issue per line
- File upload button and drag-and-drop zone accept `.xlsx`, `.csv`, and `.txt`
  - **ComicGeeks `.xlsx`:** Detected by "Full Title" + "In Wish List" columns. Filters to
    `In Wish List >= 1`. Formats each as `Full Title (Year)` using `Release Date`.
  - **CLZ `.csv`:** Detected by "Series" + "Issue" columns. If a "Collection Status" column
    is present, filters to wish-list rows only. Formats as `Series #Issue (Year)`.
  - **Plain `.txt` or generic `.csv`:** Each line treated as a search term as-is.
  - After parsing, textarea is populated for review/edit before searching. A confirmation
    message shows item count (e.g. "✓ Loaded 42 wish list items from League of Comic Geeks export.").

**Search**
- Two-wave eBay search via `lib/ebay-search.js` → `runEbaySearch`:
  - **Wave 1:** Searches all issues at `offset=0` (up to 200 results each). Results render
    immediately as soon as Wave 1 returns.
  - **Wave 2:** For any issue where `total > 200`, fires parallel offset requests to fetch
    remaining results. A spinner banner shows while Wave 2 is in flight. Results are merged
    and deduplicated (by URL) via `mergeAndRecount`, and bundle counts are recomputed.
- Geolocation on mount: calls `/api/geolocate` to resolve a zip from the user's IP. Passed
  as `zip` on every eBay call so calculated-shipping listings return accurate estimates. Falls
  back to "~$4–$6" range display if geolocation fails or returns no result.
- Animated progress bar with staged messages during Wave 1.

**Results**
- Sellers grouped by name, ranked by bundle count (most matching issues first)
- Per-seller header shows: seller name, issue count badge, subtotal (from cheapest listing
  per issue), estimated price per issue, and estimated shipping savings vs buying separately
- Each seller's listings shown in a table: Issue | Listing Title | Price | Est. Shipping | Link
- "Est. Shipping" column: FREE / dollar amount / fallback range / "calc." if zip resolved
- Stats row: Issues Searched / Total Sellers Found / Bundle Opportunities
- Single-issue mode (one issue searched): bundle badge shows listing count instead of issue count

**Filter & Sort**
- Collapsible panel, toggled by "Filter & Sort" button. Active filters shown with a red dot.
- **Price per issue:** min and max dollar inputs
- **Free shipping:** Any / Free only / No free
- **Min issues per bundle:** numeric input (min 2)
- **Sort by:** Bundle size (default) / Lowest est. price per issue / Lowest est. shipping
- **Required issues:** Checkbox list of all searched issues — only show sellers who carry all
  checked issues. Select All / Deselect All shortcut.
- Reset button clears all filters and sort back to defaults.

**Save & Share**
- "Save Results" button: POSTs rows to `/api/save-results`, gets back a shareable ID, auto-copies
  the URL to clipboard
- "Email Results" button: reveals an email form; POSTs to `/api/email-results` which sends
  a styled HTML results email via Resend
- eBay affiliate disclosure shown in results footer per eBay Partner Network ToS

---

### Series Browser

**Collection Guides index** (`pages/collection-guides.js`)  
Lists all browsable series. Entry point for series and arc pages.

**Series pages** (`pages/series/[slug].js` + `pages/api/series/[slug]/results.js`)  
Paginated eBay bundle search across an entire series run (e.g. Amazing Spider-Man Vol. 1).

- Issues shown 10 at a time by default (slider adjusts 5–50 per page)
- eBay results fetched 50 issues at a time ("fetch block") — navigating within a block is
  instant (client-side slice). A new API call only fires when the user crosses a 50-issue boundary.
- **Two-wave search:** Wave 1 from the cached series API route; Wave 2 fires to `/api/search`
  for any issue where `total > 200`. After Wave 2, merged results are POSTed back to
  `pages/api/series/[slug]/results.js` to update the Blob cache with complete data.
- **Auto-advance:** If no raw bundle opportunities exist in the current window (any seller
  with 2+ issues at any price), the page automatically pages forward (up to 30 consecutive
  empty pages). Wraps to the beginning if it reaches the end with nothing found.
- Breadcrumb links back to the series-guide page; Prev Vol / Next Vol buttons on the right
  (greyed if at first/last volume). Local series siblings come from `SERIES_GROUPS`;
  dynamic metron-* series do one extra Metron call at build time to find siblings.
- Results rendered by `<ResultsPanel>` — see below
- Geolocation on mount; zip passed to API for accurate shipping estimates
- "Updated X hours ago" badge shows cache freshness

**Series groups** (`pages/series-guide/[slug].js`)  
Groups multiple volumes of the same series (e.g. all Amazing Spider-Man volumes).

---

### Arc Pages (`pages/arc/[slug].js`)

Story arc bundle search. Issue list fetched from Blob cache (written nightly by
`scripts/refresh-arc-index.js` via GitHub Actions — never from a live Metron call).

- Full two-wave search via `runEbaySearch` once issue list is available
- Geolocation on mount; zip passed to search
- Results rendered by `<ResultsPanel>` — see below
- Shows "not yet indexed" message if nightly script hasn't run for this arc yet

---

### Gap Analyzer (`pages/gap-analyzer.js`)

Upload your comic collection and find the issues you're missing from a run.

- Accepts LOCG `.xlsx` (reads owned issues from the collection sheet) or CLZ `.csv`
- Detects gaps: parses out which issue numbers you have and identifies the missing ones
  within a contiguous run
- Displays gap list grouped by series
- "Search for these on eBay" button pushes the gap list to the main search page
  via `sessionStorage` and fires the search automatically

---

### User Accounts

- Sign-in via NextAuth.js (email magic link)
- Account page (`pages/account.js`): upload/manage saved want lists (LOCG, CLZ, manual)
- Saved lists stored in Postgres; combined on search for daily digest
- Daily digest email opt-in toggle on account page

---

### Daily Digest (`scripts/daily-digest.mjs`)

GitHub Actions nightly job. For each user with `digest_enabled = true`:
- Merges their LOCG, CLZ, and manual lists (deduplicated)
- Searches eBay for all issues using `searchEbay` from `lib/ebay.js` (Wave 1 only — digest
  doesn't need Wave 2 since it's not interactive)
- Emails bundle results as styled HTML via Resend if any bundles found
- Updates `digest_last_sent` timestamp in Postgres

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

1. **Premium features buildout** — tier system is implemented. See below for details.

2. **eBay Price Data (Premium)** — show historical price data / price trends from eBay
   listings as a premium feature. Slug `ebay-price-data` is already registered in
   `lib/features.js`; implementation not yet built.

3. **Upgrade / payment flow** — no payment processor is wired up yet. To manually upgrade
   a user: `UPDATE users SET plan = 'premium' WHERE email = '...'` directly in Neon.

4. **Auth sign-in/verify pages** — `pages/auth/signin.js` and `pages/auth/verify.js` need
   to be built. NextAuth falls back to its default pages until they exist.

---

## Premium Tier System

Free and premium tiers are defined in `lib/features.js`. This is the single source of truth
for what's gated.

**Free tier:** manual search, collection guides.
**Premium tier:** file upload, gap analyzer, save results, email results, email alerts,
saved searches, eBay price data (future).

### Adding a new gated feature

1. Add an entry to `FEATURES` in `lib/features.js` with the required plan.
2. **API routes:** call `requireFeature(req, res, 'slug')` from `lib/premium-guard.js`.
3. **UI:** wrap with `<PremiumGate feature="slug">` (full-panel) or `<PremiumLock feature="slug">`
   (inline button) from `components/PremiumGate.js`.

### Database

Run `scripts/migrate-add-plan.sql` against Neon to add the `plan` column and NextAuth tables.
The `plan` column defaults to `'free'` for all existing and new users.

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
| Series eBay results | `dynamic-series/metron-{id}/ebay/{start}-{count}.json` | 1h | Client POST to `/api/series/[slug]/results` after Wave 2 completes |

### Required secrets

`BLOB_READ_WRITE_TOKEN` must be set in **both**:
- Vercel project environment variables (all environments: Production, Preview, Development)
- GitHub repository secrets (used by `refresh-arc-index.yml` to write Blob cache)

---

## Canonical eBay Search Engine

All eBay searching goes through `lib/ebay.js`. Do not add eBay API calls anywhere else.

- **`searchEbay(token, issueName, offset=0, zip=null)`** — canonical search function. Returns
  `{ items, total }`. `total` is eBay's full result count (may exceed 200); `items` is the
  filtered, de-duped page. Pass `offset` for Wave 2 fetches; pass `zip` for calculated-shipping
  estimates via `X-EBAY-C-ENDUSERCTX`.
- **`searchEbayBatch(token, issues, concurrency=8)`** — batch helper for scripts/server routes
  that don't need Wave 2 (daily digest, nightly cache refresh). Returns `{ issue, listings[] }[]`.
- **`getEbayToken()`** — cached OAuth token fetch. Import from here, never re-implement.
- **`aggregateRows(issueListings)`** — groups flat listings into seller-keyed result rows.

### Two-wave client orchestration

Pages that display live eBay results must show Wave 1 immediately and stream Wave 2 in the
background. Use `lib/ebay-search.js` for this:

```js
import { runEbaySearch, mergeAndRecount, EBAY_PAGE_SIZE } from "../lib/ebay-search";

await runEbaySearch(issues, userZip, {
  onWave1(rows)    { /* render immediately */ },
  onWave2Start()   { /* show spinner      */ },
  onWave2(merged)  { /* update results    */ },
  onWave2End()     { /* hide spinner      */ },
});
```

Series/arc pages with Blob caching: Wave 1 comes from the cached API route; Wave 2 goes to
`/api/search` directly. After Wave 2 completes, POST the merged rows back to the series
results endpoint so the cache contains complete results for future visitors.

---

## ResultsPanel — Shared Collection Guide Presentation

**`components/ResultsPanel.js`** is the single source of truth for how collection guide
results are displayed. All filter/sort state, seller metric computation, seller cards,
badges, stats row, wave-2 banner, and affiliate disclosure live here.

**Do not duplicate this logic in a new guide page.** Import and render the component:

```jsx
import ResultsPanel from "../../components/ResultsPanel";

// Inside the page, once data is ready:
<ResultsPanel
  rows={rows}            // flat eBay listing rows from runEbaySearch / cache
  issues={issues}        // ordered array of issue name strings
  wave2Loading={bool}    // true while Wave 2 is still fetching
  defaultMaxPrice="10"   // initial value of the max-price filter (string)
  hint="…"               // optional text beside the Filter & Sort button
  resetKey={someValue}   // optional: when this value changes, requiredIssues clears
/>
```

### What ResultsPanel renders

- **Wave 2 banner** — "Loading additional results…" spinner while Wave 2 is in flight
- **Filter & Sort panel** (collapsible) — price range, min bundle size, free-shipping
  radio, sort order, and a Required Issues checkbox list (Select/Deselect All)
- **Stats row** — Issues Searched / Total Sellers Found / Bundle Opportunities
- **Seller cards** — seller name, bundle-count badge, subtotal badge, `~$x/issue`
  badge, `save ~$x shipping` badge (when calculable), listings table
- **Disclosure** — eBay affiliate disclosure

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `rows` | array | `[]` | Flat listing rows from eBay search |
| `issues` | array | `[]` | Issue name strings; drives the Required Issues filter and Issues Searched stat |
| `wave2Loading` | bool | `false` | Shows the loading banner |
| `defaultMaxPrice` | string | `"10"` | Initial max-price value; also used by Reset |
| `hint` | string | — | Short text beside the Filter toggle (series pages use "All prices cached…") |
| `resetKey` | any | — | When this value changes, requiredIssues is cleared. Series page passes `startIdx` so selections reset on page navigation |

### Also exported

`groupResults(rows, filters, sortBy)` is a named export from `ResultsPanel.js`. Import
it if a page needs to compute filtered bundle counts outside the component (e.g. the
series page's auto-advance logic uses it to check whether a window has any raw bundles).

---

## Adding a New Collection Guide Page

1. **Create the page** at `pages/<type>/[slug].js`. It is responsible for:
   - Fetching the issue list (from Blob cache, Metron, or a static data file)
   - Running the eBay search (via `runEbaySearch` from `lib/ebay-search.js`)
   - Rendering page chrome: breadcrumb, header card, any page-specific controls
   - Handing off to `<ResultsPanel>` once data is available

2. **Use ResultsPanel for all results output.** Do not re-implement the filter panel,
   seller cards, or badge logic. Pass `defaultMaxPrice` appropriate for the guide type
   (series uses `"10"`, arcs use `"15"`).

3. **Wire up geolocation** with `fetch("/api/geolocate")` on mount and pass `zip` to
   `runEbaySearch` so calculated-shipping listings return accurate estimates.

4. **Add a breadcrumb** linking back to `/collection-guides` (or to an intermediate
   grouping page if one exists).

5. **Register the page** in `pages/collection-guides.js` so it appears in the index.

---

## Shared Parser Utilities

Comic import parsers (CSV line splitting, date parsing, series name cleaning) live in
`lib/parse-utils.js`. Import from there — do not copy-paste into pages.

Exports: `parseCSVLine`, `yearFromDateString`, `monthYearFromDateString`, `yearAfterMonths`,
`cleanSeriesName`, `parseIssueNum`.

---

## Notes for Claude Code

- The eBay API token is fetched and cached in `lib/ebay.js` — do not add token logic elsewhere.
- The `xlsx` package handles all spreadsheet parsing client-side in the browser; no server
  involvement for file uploads.
- When adding features to the results table, keep the retro aesthetic consistent —
  new UI elements should use the existing color tokens and border style.

### Vercel Blob — Advanced Operations Budget

The Vercel Blob plan has a limit of **2,000 advanced operations per month**. This was nearly
exhausted by an earlier version of the series page caching. Rules:

- **Read from cache** using a plain `fetch()` to the public CDN URL — this is bandwidth only,
  not an advanced operation.
- **Write to cache** (`put()`) only on a cache miss — this is a Simple Operation (cheap).
- **Never use** `list()` or `head()` in hot paths — these are Advanced Operations and will
  burn through the budget fast.
- If a new feature would require frequent `list()` or `head()` calls, find an alternative
  (e.g. store a manifest in a known key, or use Postgres).
