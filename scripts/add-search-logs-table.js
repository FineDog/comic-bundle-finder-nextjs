import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const env = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch {}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`
  CREATE TABLE IF NOT EXISTS search_logs (
    id SERIAL PRIMARY KEY,
    queries JSONB NOT NULL,
    query_count INT NOT NULL,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS search_logs_created_at ON search_logs (created_at DESC);
`);

console.log("search_logs table created.");
await pool.end();
