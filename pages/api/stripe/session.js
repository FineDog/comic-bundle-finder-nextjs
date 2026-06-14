// Returns the email associated with a completed Checkout session, so the
// post-checkout /welcome page can send the new user a sign-in link.
// GET ?session_id=cs_...
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "session_id required." });

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    const email =
      checkoutSession.customer_details?.email ||
      checkoutSession.customer_email ||
      null;
    if (!email) return res.status(404).json({ error: "No email on this session." });
    return res.status(200).json({ email });
  } catch (e) {
    return res.status(400).json({ error: "Could not look up that session." });
  }
}
