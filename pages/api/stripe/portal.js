// Redirects the signed-in user to their Stripe Customer Portal
// so they can manage billing, cancel, or update payment method.
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

  const { rows } = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [session.user.id]
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return res.status(400).json({ error: "No billing account found." });

  const origin = req.headers.origin || process.env.NEXTAUTH_URL || "https://comicbundlefinder.com";
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/account`,
  });

  return res.status(200).json({ url: portalSession.url });
}
