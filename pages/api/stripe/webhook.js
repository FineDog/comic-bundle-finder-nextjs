// Stripe webhook handler — updates user tier based on subscription events.
// IMPORTANT: body parsing must be disabled so we can verify the raw signature.
import Stripe from "stripe";
import { getStripePool, grantPremium } from "../../../lib/stripe-grant";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = getStripePool();

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const email = session.customer_details?.email || session.customer_email || null;

        // Shared with the /welcome claim endpoint: links the customer, an
        // existing account by email, or creates a new premium account.
        await grantPremium(pool, { customerId, subscriptionId, email });

        console.log(`[stripe/webhook] upgraded customer ${customerId}${email ? ` (${email})` : ""}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          "UPDATE users SET tier = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1",
          [sub.customer]
        );
        console.log(`[stripe/webhook] downgraded customer ${sub.customer}`);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        // Handle reactivation after cancellation (cancel_at_period_end cleared)
        if (sub.status === "active") {
          await pool.query(
            "UPDATE users SET tier = 'premium', stripe_subscription_id = $1 WHERE stripe_customer_id = $2",
            [sub.id, sub.customer]
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        // Optional: could email the user here
        console.warn(`[stripe/webhook] payment failed for customer ${event.data.object.customer}`);
        break;
      }

      default:
        // Ignore unhandled event types
    }
  } catch (err) {
    console.error("[stripe/webhook] handler error:", err);
    return res.status(500).json({ error: "Webhook handler failed." });
  }

  return res.status(200).json({ received: true });
}
