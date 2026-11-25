/* Give every demo account (emails ending in .demo) a new password, for example on a server others can reach.
   npm run demo:password -- "a-long-new-password"     (Docker: docker compose exec app npm run demo:password -- "...") */
import { pool, q } from "../src/server/db";
import { hashPassword } from "../src/server/auth";
async function main() {
  const pw = process.argv[2] || "";
  if (pw.length < 12) { console.error("Give a new password of at least 12 characters."); process.exit(1); }
  const db = pool();
  const r = await q(db, `UPDATE users SET password_hash = $1, must_change_password = false WHERE email LIKE '%.demo' RETURNING email`, [await hashPassword(pw)]);
  await q(db, `DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%.demo')`).catch(() => {});
  console.log(`New password set for ${r.length} demo accounts; their open sessions were signed out.`);
  await db.end();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
