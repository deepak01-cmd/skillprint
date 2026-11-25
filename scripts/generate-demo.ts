/* Large demo organisation: synthetic employees with skill ratings, for load tests and realistic demos.
   Usage: npx tsx scripts/generate-demo.ts [--org C001] [--employees 5000]
   Every generated person is flagged synthetic = true. Uses the organisation's published roles and their framework. */
import { pool, tx } from "../src/server/db";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const orgId = opt("org", "C001"); const total = Number(opt("employees", "5000"));
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Arjun", "Sara", "Vikram", "Ananya", "Liam", "Olivia", "Noah", "Emma", "Mateo", "Sofia", "Yuki", "Chen", "Amara", "Omar", "Leila", "Jonas", "Nina", "Ravi", "Priya", "Tom", "Ava", "Ethan", "Mia", "Lucas"];
const LAST = ["Sharma", "Patel", "Iyer", "Khan", "Reddy", "Smith", "Garcia", "Müller", "Tanaka", "Wang", "Okafor", "Haddad", "Silva", "Novak", "Kumar", "Singh", "Brown", "Rossi", "Kim", "Nair"];
const CITIES = ["Bengaluru", "Pune", "Hyderabad", "London", "Austin", "Singapore", "Berlin", "Remote"];

async function main() {
  const t0 = Date.now();
  const roles = (await pool().query(`SELECT r.id, r.department_id FROM job_roles r WHERE r.org_id = $1 AND r.status = 'Published'`, [orgId])).rows;
  if (!roles.length) throw new Error(`No published roles in ${orgId}`);
  const fw = (await pool().query(`SELECT role_id, skill_id, required_level FROM v_framework WHERE org_id = $1`, [orgId])).rows;
  const byRole = new Map<string, any[]>(); for (const m of fw) (byRole.get(m.role_id) || byRole.set(m.role_id, []).get(m.role_id)!).push(m);
  const start = Number((await pool().query(`SELECT count(*)::int AS n FROM employees WHERE org_id = $1`, [orgId])).rows[0].n);
  const mgrByDept = new Map<string, string[]>();
  for (const r of (await pool().query(`SELECT id, department_id FROM employees WHERE org_id = $1 AND status = 'Active'`, [orgId])).rows) (mgrByDept.get(r.department_id) || mgrByDept.set(r.department_id, []).get(r.department_id)!).push(r.id);
  let made = 0;
  while (made < total) {
    const n = Math.min(1000, total - made);
    await tx(async c => {
      const emp: any[] = [];
      for (let i = 0; i < n; i++) {
        const k = start + made + i + 1; const role = pick(roles); const name = `${pick(FIRST)} ${pick(LAST)}`;
        const mgrs = mgrByDept.get(role.department_id) || [];
        emp.push([orgId, name, `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${k}@${orgId.toLowerCase()}.synthetic`, role.department_id, role.id, mgrs.length && rnd() < 0.95 ? pick(mgrs.slice(0, 50)) : null, pick(CITIES), new Date(Date.now() - rnd() * 3650 * 864e5).toISOString().slice(0, 10)]);
      }
      const cols = 8; const ph = emp.map((_, i) => `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(",")},true)`).join(",");
      const ids = (await c.query(`INSERT INTO employees (org_id, name, email, department_id, role_id, manager_id, location, joining_date, synthetic) VALUES ${ph} RETURNING id, role_id, department_id`, emp.flat())).rows;
      for (const e of ids) if (rnd() < 0.1) (mgrByDept.get(e.department_id) || mgrByDept.set(e.department_id, []).get(e.department_id)!).push(e.id);
      const sk: any[] = [];
      for (const e of ids) for (const m of byRole.get(e.role_id) || []) {
        if (rnd() < 0.08) continue;                                 // some skills not yet assessed
        const self = Math.max(0, Math.min(5, m.required_level + Math.round((rnd() - 0.45) * 3)));
        sk.push([orgId, e.id, m.skill_id, "self", self]);
        if (rnd() < 0.6) sk.push([orgId, e.id, m.skill_id, "manager", Math.max(0, Math.min(5, self - (rnd() < 0.4 ? 1 : 0)))]);
      }
      for (let i = 0; i < sk.length; i += 5000) {
        const part = sk.slice(i, i + 5000);
        await c.query(`INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level) VALUES ${part.map((_, j) => `($${j * 5 + 1},$${j * 5 + 2},$${j * 5 + 3},$${j * 5 + 4},$${j * 5 + 5})`).join(",")} ON CONFLICT DO NOTHING`, part.flat());
      }
    });
    made += n; console.log(`  ${made.toLocaleString()} / ${total.toLocaleString()} employees`);
  }
  console.log(`Generated ${made} synthetic employees in ${orgId} in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await pool().end();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
