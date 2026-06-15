-- Run once in Neon SQL editor.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digest_last_sent TIMESTAMPTZ;
