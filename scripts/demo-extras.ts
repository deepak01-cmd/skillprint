/* Demo organisations only (accounts ending in .demo): a few open internal jobs, some applications and company courses,
   so the job board and learning screens have something to show. Runs once per organisation; safe to run again. */
import { pool, q, one } from "../src/server/db";
import { matchMany } from "../src/server/modules/ijp";
import { ensureCatalogue } from "../src/server/modules/learning";
import { addCareerLadders, addChangingRoles } from "../src/server/demo/ladders";

const LOC = ["Bengaluru", "Pune", "Hyderabad", "Gurugram", "Chennai"];
async function main() {
  if (process.env.DEMO_MODE === "false") return;
  const db = pool();
  await ensureCatalogue(db);
  const orgs = await q(db, `SELECT DISTINCT o.id, o.name FROM organisations o JOIN users u ON u.org_id = o.id WHERE u.email LIKE '%.demo'`);
  for (const o of orgs) {
    const lad = await addCareerLadders(db, o.id);
    if (lad.roles) console.log(`${o.name}: ${lad.roles} roles at other levels, ${lad.paths} career paths, ${lad.people} people`);
    const chg = await addChangingRoles(db, o.id);
    if (chg.roles) console.log(`${o.name}: ${chg.roles} roles with shifting skills, ${chg.people} people`);
    await extras(db, o);
    if ((await one(db, `SELECT 1 FROM internal_jobs WHERE org_id = $1`, [o.id]))) continue;
    const hr = await one(db, `SELECT id, name FROM users WHERE org_id = $1 AND role = 'hr_admin' AND active ORDER BY id LIMIT 1`, [o.id]);
    const roles = await q(db, `SELECT r.id, r.title, r.department_id, r.summary, count(m.*)::int AS n FROM job_roles r JOIN v_framework m ON m.role_id = r.id
      WHERE r.org_id = $1 AND r.status = 'Published' GROUP BY r.id ORDER BY count(m.*) DESC, r.title LIMIT 6`, [o.id]);
    const jobs = [];
    for (const [i, r] of roles.entries()) {
      const j = await one(db, `INSERT INTO internal_jobs (org_id, role_id, department_id, title, location, work_mode, openings, description, min_match, closes_on, status, posted_by, posted_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, current_date + $10::int, 'Open', $11, $12) RETURNING *`,
        [o.id, r.id, r.department_id, r.title, LOC[i % LOC.length], ["Hybrid", "Onsite", "Remote"][i % 3], 1 + (i % 2), /provisional|sample|generation/i.test(r.summary || "") ? "" : (r.summary || ""), i % 3 === 0 ? 40 : 0, 21 + i * 4, hr?.id, hr?.name]);
      jobs.push(j);
    }
    // a handful of applications from people in other roles, so HR sees a pipeline
    const emps = await q(db, `SELECT * FROM employees WHERE org_id = $1 AND status = 'Active' ORDER BY id LIMIT 40`, [o.id]);
    let made = 0;
    for (const j of jobs.slice(0, 3)) {
      for (const e of emps.filter(e => e.role_id !== j.role_id && !e.user_id)) {
        if (made >= 9) break;
        const m = (await matchMany(db, e, [j.role_id])).get(j.role_id);
        if (m.match_pct < Math.max(j.min_match, 30)) continue;
        const snap = { match_pct: m.match_pct, band: m.band, skills_met: m.skills_met, skills_required: m.skills_required, gaps: m.lines.filter((l: any) => !l.met).map((l: any) => ({ skill: l.skill_name, current: l.current_level, required: l.required_level, type: l.requirement_type })) };
        const st = ["Applied", "Screening", "Interview"][made % 3];
        const hist = [{ status: "Applied", at: new Date(Date.now() - 6 * 864e5).toISOString(), by: e.name }, ...(st !== "Applied" ? [{ status: st, at: new Date(Date.now() - 2 * 864e5).toISOString(), by: hr?.name }] : [])];
        await q(db, `INSERT INTO job_applications (org_id, job_id, employee_id, status, match_pct, snapshot, history) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [o.id, j.id, e.id, st, m.match_pct, JSON.stringify(snap), JSON.stringify(hist)]);
        made++;
        if (made % 3 === 0) break;
      }
    }
    // two company courses for skills the organisation uses most
    const top = await q(db, `SELECT m.skill_id, s.name AS skill_name FROM v_framework m JOIN skills s ON s.id = m.skill_id WHERE m.org_id = $1 GROUP BY m.skill_id, s.name ORDER BY count(*) DESC LIMIT 2`, [o.id]);
    for (const s of top) await q(db, `INSERT INTO learning_resources (org_id, skill_id, title, provider, type, level_from, level_to, hours, cost, created_by) VALUES ($1,$2,$3,$4,'Workshop',1,4,6,'Company paid','demo')`,
      [o.id, s.skill_id, `${s.skill_name} in practice`, `${o.name} Academy`]);
    console.log(`${o.name}: ${jobs.length} internal jobs, ${made} applications`);
  }
  await db.end();
}
/** A pending level request with evidence, a mentoring request and a succession plan, once per demo organisation. */
async function extras(db: any, o: any) {
  const emp = await one(db, `SELECT e.* FROM employees e JOIN users u ON u.id = e.user_id WHERE e.org_id = $1 AND u.role = 'employee' AND e.manager_id IS NOT NULL ORDER BY u.email LIMIT 1`, [o.id]);
  if (emp && !(await one(db, `SELECT 1 FROM level_requests WHERE org_id = $1`, [o.id]))) {
    const g = await one(db, `SELECT v.skill_id, v.required_level FROM v_framework v WHERE v.role_id = $1 ORDER BY v.required_level DESC, v.pixel_id LIMIT 1 OFFSET 2`, [emp.role_id]);
    if (g) {
      const cur = await one(db, `SELECT max(level)::int AS l FROM employee_skills WHERE employee_id = $1 AND skill_id = $2 AND source IN ('manager','validated')`, [emp.id, g.skill_id]);
      const want = Math.min(5, Math.max((cur?.l ?? 0) + 1, g.required_level));
      if (want !== cur?.l) {
        const r = await one(db, `INSERT INTO level_requests (org_id, employee_id, skill_id, current_level, requested_level, note, reviewer_id, history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [o.id, emp.id, g.skill_id, cur?.l ?? null, want, "Completed the advanced course and used it on the quarterly close project.", emp.manager_id, JSON.stringify([{ status: "Pending", at: new Date(Date.now() - 2 * 864e5).toISOString(), by: emp.name }])]);
        await q(db, `INSERT INTO level_request_evidence (request_id, kind, type, title, url) VALUES ($1,'link','Certification','Course certificate','https://learn.example.com/certificates/demo'), ($1,'link','Project','Quarterly close project summary','https://wiki.example.com/projects/quarterly-close')`, [r.id]);
      }
    }
  }
  if (!(await one(db, `SELECT 1 FROM mentoring_requests WHERE org_id = $1`, [o.id]))) {
    const pair = await one(db, `SELECT a.id AS mentee, m.id AS mentor, es.skill_id FROM employees a JOIN users ua ON ua.id = a.user_id AND ua.role = 'employee'
      JOIN employees m ON m.id = a.manager_id JOIN users um ON um.id = m.user_id JOIN employee_skills es ON es.employee_id = m.id AND es.source IN ('manager','validated') AND es.level >= 4
      WHERE a.org_id = $1 ORDER BY ua.email DESC, es.level DESC LIMIT 1`, [o.id]);
    if (pair) await q(db, `INSERT INTO mentoring_requests (org_id, mentee_id, mentor_id, skill_id, message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [o.id, pair.mentee, pair.mentor, pair.skill_id, "Would you mentor me for a couple of months? I'd like to get to the next level."]);
  }
  if (!(await one(db, `SELECT 1 FROM succession_plans WHERE org_id = $1`, [o.id]))) {
    const role = await one(db, `SELECT r.id FROM job_roles r WHERE r.org_id = $1 AND r.status = 'Published' AND EXISTS (SELECT 1 FROM employees e WHERE e.role_id = r.id) ORDER BY (SELECT count(*) FROM v_framework v WHERE v.role_id = r.id) DESC LIMIT 1`, [o.id]);
    if (role) {
      const p = await one(db, `INSERT INTO succession_plans (org_id, role_id, criticality, reason, created_by) VALUES ($1,$2,'Critical','Few people hold it and it is hard to hire for','demo') RETURNING id`, [o.id, role.id]);
      const { rankFor } = await import("../src/server/modules/succession");
      const top = (await rankFor(db, o.id, role.id)).filter(x => !x.in_role).slice(0, 2);
      for (const [i, t] of top.entries()) await q(db, `INSERT INTO successors (plan_id, employee_id, readiness, added_by) VALUES ($1,$2,$3,'demo')`, [p.id, t.employee_id, i === 0 ? "Ready in 1-2 years" : "Ready in 3+ years"]);
    }
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
