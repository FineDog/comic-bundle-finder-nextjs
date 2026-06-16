# Testing Stripe Locally

How to exercise the subscription flow (including the 7-day trial and the
downgrade-on-cancel behavior) on `localhost` without touching live Stripe or
creating real charges.

## Golden rules

- **Test on `localhost`, never the live site.** The live site uses `sk_live_…`
  keys and will reject test cards — that's correct, not a bug.
- **`.env.local` must be all-test-mode.** A live secret key paired with test
  price IDs (or vice versa) fails with `No such price` → the UI shows the generic
  *"Could not start checkout. Please try again."* All four Stripe values must be
  the **same mode**: secret key, webhook secret, and both price IDs.
- **Live keys live only in Vercel.** Keeping `.env.local` test-only means local
  dev can never accidentally charge a real card.

## One-time setup

### 1. Stripe CLI

Installed via winget (`Stripe.StripeCli`). If `stripe` isn't found, open a fresh
terminal (winget added it to PATH) or call it directly:

```
C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\stripe.exe
```

Then authenticate (opens a browser pairing flow):

```powershell
stripe login
```

### 2. `.env.local` — test mode

Set every Stripe value to test mode. Get the test keys/prices from the Stripe
Dashboard with the **"Test mode" toggle ON** → Developers → API keys / Products.

```
STRIPE_SECRET_KEY="sk_test_…"
NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID=price_…   # test-mode price
NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID=price_…    # test-mode price
STRIPE_WEBHOOK_SECRET="whsec_…"               # from `stripe listen`, see below — ONE line only
```

> Verify the price IDs resolve for the configured key before bothering with the
> card flow — a quick `stripe prices retrieve <id>` (test mode) should succeed.

## Running the flow

Use three terminals.

**Terminal 1 — webhook forwarder** (leave running):

```powershell
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

It prints `Ready! Your webhook signing secret is whsec_xxxx`. This is a
**different** secret than the Dashboard one — paste it into `.env.local` as
`STRIPE_WEBHOOK_SECRET`, then restart the dev server.

**Terminal 2 — dev server:**

```powershell
npm run dev
```

**Terminal 3 — trigger events as needed** (see below).

### Happy path (trial signup)

1. Go to `http://localhost:3000/upgrade` → **Start 7-Day Free Trial**.
2. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
3. Confirm in the DB:

   ```sql
   SELECT email, tier, stripe_subscription_id FROM users WHERE email = '<email used>';
   ```

   Expect `tier = 'premium'`. In the Stripe Dashboard (test mode) the
   subscription shows status **Trialing**, trial ending ~7 days out.

### Downgrade path (trial lapses / subscription canceled)

Simulate the cancellation event:

```powershell
stripe trigger customer.subscription.deleted
```

Watch Terminal 1 forward the event, then re-check the DB — the user should flip
to `tier = 'free'`. On `/account`, saved lists now show the 🔒 locked summary
(*"N items saved — upgrade to use"*) instead of usable lists; the data is
retained in Postgres but can't feed a search or the gap analyzer, and the daily
digest stops including them.

## How the trial works in code

- `pages/api/stripe/checkout.js` adds `trial_period_days: 7` to the subscription,
  **but only for first-time subscribers** — `hasTrialedBefore()` (matched by
  Stripe customer id, then email) withholds the trial from returning customers.
  Guest emails always read as first-time (accepted limitation).
- Stripe Checkout collects a card up front, so at day 7 it auto-charges. The
  webhook's `checkout.session.completed` fires immediately (status `trialing`)
  and grants premium.
- If the eventual renewal charge fails, Stripe dunning retries and ultimately
  fires `customer.subscription.deleted`, which the webhook handles by setting
  `tier = 'free'`. Everything else (feature gates, digest, locked lists)
  cascades from that one column.

## Verifying production (live mode)

Local testing can't prove the **live** webhook is wired up. Confirm the live
endpoint is subscribed to the needed events (read-only):

```powershell
stripe webhook_endpoints list --live
```

Expect an `enabled`, `livemode: true` endpoint at
`https://comicbundlefinder.com/api/stripe/webhook` whose `enabled_events`
include at least:

- `checkout.session.completed`
- `customer.subscription.deleted`
- `customer.subscription.updated`
- `invoice.payment_failed`

If `customer.subscription.deleted` is missing, the trial-expiry downgrade won't
fire in production.

## When you're done

Leave `.env.local` on test-mode keys permanently — production stays all-live in
Vercel. There's nothing to "restore."
