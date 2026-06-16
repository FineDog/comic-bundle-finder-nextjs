// Creates a Stripe Checkout session and redirects the user to Stripe's hosted page.
// POST { priceId }
import Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth].js";
import pkg from "pg";
const { Pool } = pkg;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = globalThis._stripePool ?? (globalThis._stripePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
}));

// Returns true if this person has subscribed before (any status, including
// cancelled) — used to withhold the free trial from returning customers so it
// can't be reused. Best-effort: a brand-new email always reads as first-time,
// which is the accepted limitation (closing it would require identity friction).
async function hasTrialedBefore({ customerId, email }) {
  try {
    if (customerId) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
      if (subs.data.length) return true;
    }
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length) {
        const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "all", limit: 1 });
        if (subs.data.length) return true;
      }
    }
  } catch (err) {
    // Never block checkout on the guard — on error, just offer the trial.
    console.error("[stripe/checkout] trial-history check failed:", err.message);
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Session is OPTIONAL. Logged-in users get their existing Stripe customer
  // reused; logged-out users go through guest checkout — Stripe collects their
  // email, and the webhook creates/links their account afterward.
  const session = await getServerSession(req, res, authOptions);

  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: "priceId required." });

  const origin = req.headers.origin || process.env.NEXTAUTH_URL || "https://comicbundlefinder.com";

  const params = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    cancel_url: `${origin}/upgrade`,
    allow_promotion_codes: true,
    subscription_data: { metadata: {} },
  };

  // Identity for the trial-history check below. For guests we don't know the
  // email until Stripe collects it at checkout, so they always read as
  // first-time (and get the trial) — the accepted limitation.
  let customerId = null;
  let trialEmail = null;

  if (session) {
    // ── Logged-in user: reuse or create their Stripe customer, link by userId ──
    const userId = session.user.id;
    const email = session.user.email;
    trialEmail = email;

    let { rows } = await pool.query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [userId]
    );
    customerId = rows[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
        [customerId, userId]
      );
    }

    params.customer = customerId;
    params.subscription_data.metadata.userId = userId;
    params.success_url = `${origin}/account?upgraded=1`;
  } else {
    // ── Guest checkout: Stripe collects the email and creates the customer. ──
    // (In subscription mode a customer is always created — customer_creation is
    // not a valid param here.) The account is created/linked in the webhook;
    // /welcome then signs them in.
    params.success_url = `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`;
  }

  // 7-day free trial, but only for first-time subscribers. Stripe Checkout
  // collects a card up front (its default in subscription mode), so at trial end
  // it auto-charges. The webhook's checkout.session.completed fires immediately
  // (status `trialing`) and grants premium, so trial users get full access for
  // the 7 days. If the renewal charge later fails, Stripe dunning eventually
  // fires customer.subscription.deleted, which downgrades them to free.
  // Returning customers (resolved by stripe_customer_id or email) don't get a
  // second free trial; they subscribe and are charged immediately.
  if (!(await hasTrialedBefore({ customerId, email: trialEmail }))) {
    params.subscription_data.trial_period_days = 7;
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create(params);
    return res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[stripe/checkout] failed to create session:", err);
    return res.status(500).json({ error: "Could not start checkout. Please try again." });
  }
}
