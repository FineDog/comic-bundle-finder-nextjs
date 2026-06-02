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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Sign in required." });

  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: "priceId required." });

  const userId = session.user.id;
  const email = session.user.email;

  // Look up or create the Stripe customer for this user
  let { rows } = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [userId]
  );
  let customerId = rows[0]?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });
    customerId = customer.id;
    await pool.query(
      "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
      [customerId, userId]
    );
  }

  const origin = req.headers.origin || process.env.NEXTAUTH_URL || "https://comicbundlefinder.com";

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/account?upgraded=1`,
    cancel_url: `${origin}/upgrade`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId },
    },
  });

  return res.status(200).json({ url: checkoutSession.url });
}
