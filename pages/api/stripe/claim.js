// Post-checkout claim: given a completed Checkout session_id, verify it with
// Stripe and grant premium to the buyer's account synchronously. This is the
// primary grant path for guest signups — it does not depend on the Stripe
// webhook reaching this particular deployment. Returns the buyer's email so the
// /welcome page can send them a sign-in link.
// POST { sessionId }
import Stripe from "stripe";
import { getStripePool, grantPremium } from "../../../lib/stripe-grant";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required." });

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

    if (checkoutSession.mode !== "subscription") {
      return res.status(400).json({ error: "Not a subscription checkout." });
    }
    // Only grant once Stripe confirms payment went through.
    if (checkoutSession.payment_status !== "paid") {
      return res.status(409).json({ error: "Payment not completed yet." });
    }

    const email =
      checkoutSession.customer_details?.email ||
      checkoutSession.customer_email ||
      null;
    if (!email) return res.status(422).json({ error: "No email on this session." });

    await grantPremium(getStripePool(), {
      customerId: checkoutSession.customer,
      subscriptionId: checkoutSession.subscription,
      email,
    });

    return res.status(200).json({ email });
  } catch (err) {
    console.error("[stripe/claim] failed:", err);
    return res.status(500).json({ error: "Could not finish setting up your account." });
  }
}
