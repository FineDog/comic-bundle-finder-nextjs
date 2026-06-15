// Shared premium-grant logic, used by both the Stripe webhook and the
// post-checkout /welcome claim endpoint. Keeping it in one place means the
// "create or link the user account" rules can't drift between the two paths.

import pkg from "pg";
const { Pool } = pkg;

export function getStripePool() {
  return (
    globalThis._stripePool ??
    (globalThis._stripePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    }))
  );
}

// Marks the user behind a completed subscription checkout as premium, creating
// or linking their account. Resolution order:
//   1. existing customer linked by stripe_customer_id (logged-in / returning)
//   2. existing account matched by email (e.g. a prior free account)
//   3. brand-new guest — insert a premium account keyed off the checkout email
//
// The webhook and the /welcome claim endpoint can both fire for the same
// checkout, so the email branch runs inside a transaction guarded by a
// transaction-scoped advisory lock. That serializes concurrent grants for the
// same email and prevents two racing INSERTs from creating duplicate accounts —
// without needing a unique constraint on the email column.
// Idempotent and safe to re-run (including on Stripe webhook retries).
export async function grantPremium(pool, { customerId, subscriptionId, email }) {
  // Fast path: the customer is already linked to an account (logged-in /
  // returning). No lock needed — the row already exists.
  const byCustomer = await pool.query(
    "UPDATE users SET tier = 'premium', stripe_subscription_id = $1 WHERE stripe_customer_id = $2",
    [subscriptionId, customerId]
  );
  if (byCustomer.rowCount > 0) return "linked-by-customer";

  if (!email) return "noop";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize all grants for this email (webhook vs. claim) so only one of
    // them can create the account.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)))", [email]);

    const byEmail = await client.query(
      `UPDATE users
         SET tier = 'premium',
             stripe_customer_id = $1,
             stripe_subscription_id = $2
       WHERE lower(email) = lower($3)`,
      [customerId, subscriptionId, email]
    );
    if (byEmail.rowCount > 0) {
      await client.query("COMMIT");
      return "linked-by-email";
    }

    await client.query(
      `INSERT INTO users (id, email, "emailVerified", tier, stripe_customer_id, stripe_subscription_id)
       VALUES (gen_random_uuid()::text, $1, now(), 'premium', $2, $3)`,
      [email, customerId, subscriptionId]
    );
    await client.query("COMMIT");
    return "created";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
