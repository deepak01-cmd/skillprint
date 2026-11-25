import { execSync } from "node:child_process";

export const TEST_DB = process.env.TEST_DATABASE_URL || "postgres://rsip:rsip@localhost:5432/rsip_test";
let ready = false;

/** Reset and seed the test database once per process, then point the app at it. */
export async function setup() {
  process.env.DATABASE_URL = TEST_DB;
  if (!ready) {
    execSync("npx tsx scripts/migrate.ts --reset && npx tsx scripts/seed.ts", { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "pipe" });
    ready = true;
  }
  const { ensureRoutes } = await import("../src/server/routes");
  ensureRoutes();
  const { dispatch } = await import("../src/server/http/router");
  const { loadUser } = await import("../src/server/auth");
  const { pool, one, q } = await import("../src/server/db");
  async function as(email: string) {
    const row = await one(pool(), `SELECT id FROM users WHERE email = $1`, [email]);
    if (!row) throw new Error(`No user ${email}`);
    const user = await loadUser(pool(), row.id);
    const call = async (method: string, path: string, body?: any) => {
      const [p, qs] = path.split("?");
      return dispatch(method, p, user, { body, query: new URLSearchParams(qs || "") });
    };
    return { user: user!, get: (p: string) => call("GET", p), post: (p: string, b?: any) => call("POST", p, b ?? {}), patch: (p: string, b: any) => call("PATCH", p, b),
      put: (p: string, b: any) => call("PUT", p, b), del: (p: string) => call("DELETE", p) };
  }
  return { as, db: pool(), one, q };
}
