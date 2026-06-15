-- Migration: add premium plan support
-- Run this against the Neon Postgres database once.
-- Safe to re-run (all statements use IF NOT EXISTS / IF NOT EXISTS checks).

-- 1. Ensure users table has all columns NextAuth expects
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerified" TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;

-- 2. The tier column already exists in this DB (no-op — kept as a note)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';

-- 3. NextAuth OAuth accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  "userId"             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,
  provider             TEXT NOT NULL,
  "providerAccountId"  TEXT NOT NULL,
  refresh_token        TEXT,
  access_token         TEXT,
  expires_at           BIGINT,
  token_type           TEXT,
  scope                TEXT,
  id_token             TEXT,
  session_state        TEXT,
  UNIQUE(provider, "providerAccountId")
);

-- 4. NextAuth database sessions (kept even if using JWT strategy, for future flexibility)
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId"       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL
);

-- 5. NextAuth email magic-link tokens
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- 6. Index for faster session/account lookups
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts("userId");
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions("userId");
