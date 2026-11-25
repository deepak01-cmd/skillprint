import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL || "postgres://rsip:rsip@localhost:5432/rsip";
  const c = new Client({ connectionString: url });
  await c.connect();
  if (process.argv.includes("--reset")) {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    console.log("Schema reset");
  }
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map(r => r.name));
  const dir = join(process.cwd(), "db", "migrations");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await c.query("BEGIN");
    try {
      await c.query(readFileSync(join(dir, f), "utf8"));
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      await c.query("COMMIT");
      console.log("Applied", f);
    } catch (e) { await c.query("ROLLBACK"); throw e; }
  }
  // keep generated IDs ahead of any ID already stored (cheap; runs on every start)
  await c.query("SELECT sync_id_sequences()").catch(() => { /* before migration 013 */ });
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
