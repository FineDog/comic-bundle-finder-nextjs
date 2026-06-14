// Stripe webhook handler — updates user tier based on subscription events.
// IMPORTANT: body parsing must be disabled so we can verify the raw signature.
import Stripe from "stripe";
import pkg from "pg";
const { Pool } = pkg;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = globalThis._stripePool ?? (globalThis._stripePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
}));

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

        // 1. Logged-in / returning customer — already linked by stripe_customer_id.
        const byCustomer = await pool.query(
          "UPDATE users SET tier = 'premium', stripe_subscription_id = $1 WHERE stripe_customer_id = $2",
          [subscriptionId, customerId]
        );

        if (byCustomer.rowCount === 0 && email) {
          // 2. Guest checkout — match an existing account by email and link it.
          const byEmail = await pool.query(
            `UPDATE users
               SET tier = 'premium',
                   stripe_customer_id = $1,
                   stripe_subscription_id = $2
             WHERE lower(email) = lower($3)`,
            [customerId, subscriptionId, email]
          );

          if (byEmail.rowCount === 0) {
            // 3. Brand-new user — create the account during checkout. They finish
            //    signing in via the magic link sent from /welcome.
            await pool.query(
              `INSERT INTO users (id, email, "emailVerified", tier, stripe_customer_id, stripe_subscription_id)
               VALUES (gen_random_uuid()::text, $1, now(), 'premium', $2, $3)`,
              [email, customerId, subscriptionId]
            );
          }
        }

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
