-- Run once against your Postgres database.
-- Adds a tier column to the NextAuth users table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';

-- To promote a user to premium:
-- UPDATE users SET tier = 'premium' WHERE email = 'user@example.com';
