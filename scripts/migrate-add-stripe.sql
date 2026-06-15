-- Migration: add Stripe billing columns to users table.
-- Run once against the Neon database. Safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx ON users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
