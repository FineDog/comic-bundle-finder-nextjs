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

// Adds raw-line logging (queries/query_count stay deduped) plus a per-browser
// visitor_id so search_logs rows can be joined to their Umami events.
await pool.query(`
  ALTER TABLE search_logs ADD COLUMN IF NOT EXISTS raw_queries JSONB;
  ALTER TABLE search_logs ADD COLUMN IF NOT EXISTS raw_count INT;
  ALTER TABLE search_logs ADD COLUMN IF NOT EXISTS visitor_id TEXT;
  CREATE INDEX IF NOT EXISTS search_logs_visitor_id ON search_logs (visitor_id);
`);

console.log("search_logs: raw_queries, raw_count, visitor_id columns added.");
await pool.end();
