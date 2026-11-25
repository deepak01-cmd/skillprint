/* Seed: the v3 sample workbook (3 companies, 36 roles, 65 skills, 278 mappings: 268 active + 10 archived),
   follows the Developer Guide migration checks, then adds clearly marked synthetic people data so that
   assessments, gaps, readiness and planning can be exercised. All demo passwords: demo1234 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { DEFAULT_ASSUMPTIONS, DEFAULT_CAREER_LEVELS, DEFAULT_LEVELS } from "../src/server/modules/structure";
import { compareRoles } from "../src/server/calc";

const S = JSON.parse(readFileSync(join(process.cwd(), "db", "seed", "sample.json"), "utf8"));
const PASSWORD = "demo1234";

// deterministic RNG so every seed produces the same synthetic data
let seedState = 20261106;
const rnd = () => { seedState = (seedState * 1103515245 + 12345) % 2147483648; return seedState / 2147483648; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const FIRST = ["Aarav", "Ananya", "Rahul", "Priya", "Aman", "Meera", "Kabir", "Isha", "Rohan", "Nisha", "Vikram", "Sara", "Arjun", "Leela", "Dev", "Tara", "Nikhil", "Zoya", "Omar", "Grace",
  "Liam", "Noah", "Maya", "Elena", "Hiro", "Yuki", "Chen", "Lina", "Mateo", "Sofia", "Kofi", "Amara", "Jonas", "Freya", "Ravi", "Divya", "Karan", "Pooja", "Imran", "Fatima"];
const LAST = ["Sharma", "Reddy", "Iyer", "Khan", "Mehta", "Patel", "Nair", "Gupta", "Das", "Singh", "Rao", "Kapoor", "Bose", "Menon", "Joshi", "Chopra", "Verma", "Pillai", "Fernandes", "Ali"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ALIASES: Record<string, string[]> = {
  S001: ["Structured Query Language", "SQL Querying", "Database Querying"], S002: ["Python Programming"], S003: ["Excel", "Spreadsheets"],
  S006: ["Statistics"], S007: ["Data Modeling"], S008: ["ETL", "Extract Transform Load"], S020: ["Version Control"], S022: ["K8s"], S023: ["Amazon Web Services", "AWS"],
  S024: ["Continuous Integration", "Continuous Delivery"], S027: ["FHIR", "HL7"], S028: ["EHR", "EMR"], S040: ["Agile", "Scrum"], S046: ["VBA"], S058: ["dbt"], S059: ["RAG"],
};

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL || "postgres://rsip:rsip@localhost:5432/rsip" });
  await c.connect();
  const Q = (sql: string, p: unknown[] = []) => c.query(sql, p as any[]).then(r => r.rows);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.query("BEGIN");
  try {
    const existing = await Q(`SELECT count(*)::int AS n FROM organisations`);
    if (existing[0].n > 0) throw new Error("Database already has data. Run npm run db:reset to start again.");

    await Q(`INSERT INTO users (org_id, email, name, password_hash, role) VALUES (NULL,'admin@platform.demo','Platform Administrator',$1,'platform_admin')`, [hash]);

    /* ---- organisations, departments, families, levels, roles ---- */
    for (const [id, name, industry, domain] of S.companies) {
      await Q(`INSERT INTO organisations (id, name, industry, domain, settings) VALUES ($1,$2,$3,$4,$5)`, [id, name, industry, domain, JSON.stringify({ archive_policy: { mandatory: true, openAssessments: true, all: false } })]);
      for (const [level, n, d] of DEFAULT_LEVELS) await Q(`INSERT INTO proficiency_levels VALUES ($1,$2,$3,$4)`, [id, level, n, d]);
      for (const [code, n, rank] of DEFAULT_CAREER_LEVELS) await Q(`INSERT INTO career_levels (org_id, code, name, rank) VALUES ($1,$2,$3,$4)`, [id, code, n, rank]);
      await Q(`INSERT INTO assumption_sets (org_id, version, status, data, created_by) VALUES ($1,1,'Published',$2,'Seed')`, [id, JSON.stringify(DEFAULT_ASSUMPTIONS)]);
    }
    const orgByName: Record<string, string> = Object.fromEntries(S.companies.map((c: any) => [c[1], c[0]]));
    const orgSlug: Record<string, string> = Object.fromEntries(S.companies.map((c: any) => [c[0], slug(c[1].split(" ")[0])]));
    const deptId: Record<string, string> = {};
    for (const [id, company, name] of S.departments) { await Q(`INSERT INTO departments (id, org_id, name) VALUES ($1,$2,$3)`, [id, orgByName[company], name]); deptId[`${company}|${name}`] = id; }
    const famId: Record<string, string> = {};
    for (const r of S.roles) {
      const k = `${r[1]}|${r[4]}`;
      if (!famId[k]) famId[k] = (await Q(`INSERT INTO job_families (org_id, name) VALUES ($1,$2) RETURNING id`, [orgByName[r[1]], r[4]]))[0].id;
    }
    const levelId: Record<string, string> = Object.fromEntries((await Q(`SELECT id, org_id FROM career_levels WHERE code = 'L3'`)).map(r => [r.org_id, r.id]));
    const fcpr = (roleId: string) => S.fcpr.filter((f: any) => f[0] === roleId);
    for (const [id, company, dept, title, family, , industry] of S.roles) {
      const org = orgByName[company];
      const f = fcpr(id);
      await Q(`INSERT INTO job_roles (id, org_id, department_id, job_family_id, career_level_id, title, career_track, summary, responsibilities, outcomes, industry, status, version, review_date)
               VALUES ($1,$2,$3,$4,$5,$6,'Individual Contributor',$7,$8,$9,$10,'Published',1,'2027-10-31')`,
        [id, org, deptId[`${company}|${dept}`], famId[`${company}|${family}`], levelId[org], title,
         `${title} in ${dept} at ${company}. Provisional summary from the sample FCPR sheet; requires role-specific generation.`,
         f.map((x: any) => x[4]), f.map((x: any) => x[2]), industry]);
      await Q(`INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,1,$2,'Sample import','Imported from v3 workbook')`, [id, JSON.stringify({ id, title, status: "Published" })]);
    }

    /* ---- skills (global library) ---- */
    for (const [id, name, cat, def, type] of S.skills)
      await Q(`INSERT INTO skills (id, org_id, name, definition, category, type, aliases) VALUES ($1,NULL,$2,$3,$4,$5,$6)`, [id, name, def, cat, type, ALIASES[id] || []]);
    await Q(`INSERT INTO skill_relationships VALUES ('S001','S007'),('S007','S001'),('S001','S008'),('S008','S001'),('S002','S035'),('S035','S002'),('S021','S022'),('S022','S021'),('S027','S032'),('S032','S027')`);
    // skill-specific descriptors for SQL (PRD 9.3), on every organisation
    const sqlDesc = ["Understands tables, rows and columns, and what SQL is used for.", "Writes basic SELECT queries; uses WHERE and ORDER BY; simple filtering.",
      "Writes JOIN queries; uses GROUP BY and aggregates; handles subqueries; independently performs routine extraction.",
      "Optimises complex queries; understands execution plans; designs efficient retrieval logic; handles large datasets.",
      "Defines query design standards; solves complex performance issues; guides other developers; designs organisation-wide best practice."];
    for (const [org] of S.companies) for (let i = 0; i < 5; i++) await Q(`INSERT INTO skill_level_descriptors VALUES ($1,'S001',$2,$3)`, [org, i + 1, sqlDesc[i]]);

    /* ---- mappings (Developer Guide migration steps 2-6) ---- */
    const roleOrg: Record<string, string> = Object.fromEntries(S.roles.map((r: any) => [r[0], orgByName[r[1]]]));
    for (const [pid, role, skill, level, req, imp, trend, dir, why, conf] of S.fw)
      await Q(`INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, observation_period, trend_rationale, confidence_score, approval_status, lifecycle_status, created_by)
               VALUES ($1,'PX-'||$2||'-'||$3,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Published','Active','Sample import')`, [roleOrg[role], role, skill, level, req, imp, trend, dir, S.obs, why, conf]);
    for (const [pid, role, skill, date, cat, reason, last, req, imp, dir, conf] of S.archived) {
      await Q(`INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, observation_period, trend_rationale, confidence_score,
                 approval_status, lifecycle_status, archive_reason_category, archive_reason, archived_on, archived_by, last_required_level, last_requirement_type, last_importance, created_by)
               VALUES ($1,'PX-'||$2||'-'||$3,$2,$3,$4,'Legacy only',$5,'Archived',$6,$7,$8,$9,'Published','Archived',$10,$8,$11,'Sample import',$4,'Legacy only',$5,'Sample import')`,
        [roleOrg[role], role, skill, last, imp, dir, S.obs, reason, conf, cat, date]);
      await Q(`INSERT INTO archive_audit_log (org_id, pixel_id, action, actor, reason_category, reason, prior_trend, at) VALUES ($1,$2,'import_archived','Sample import',$3,$4,NULL,$5::date)`, [roleOrg[role], pid, cat, reason, date]);
    }
    for (const [rs, fw, role, skill] of S.crosswalk) await Q(`INSERT INTO pixel_id_crosswalk VALUES ($1,$2,$3,'PX-'||$4||'-'||$5)`, [rs, fw, roleOrg[role], role, skill]);

    // migration checks (Developer Guide 5): stop if a check fails
    const chk = async (label: string, sql: string, expect: number) => { const n = (await Q(sql))[0].n; if (n !== expect) throw new Error(`Check failed: ${label} = ${n}, expected ${expect}`); console.log(`  ok  ${label} = ${n}`); };
    await chk("stored mappings", `SELECT count(*)::int AS n FROM role_skill_mapping`, 278);
    await chk("distinct Pixel IDs", `SELECT count(DISTINCT pixel_id)::int AS n FROM role_skill_mapping`, 278);
    await chk("crosswalk rows", `SELECT count(*)::int AS n FROM pixel_id_crosswalk`, 278);
    await chk("active", `SELECT count(*)::int AS n FROM v_framework`, 268);
    await chk("archived", `SELECT count(*)::int AS n FROM role_skill_mapping WHERE lifecycle_status = 'Archived'`, 10);
    await chk("archived without reason or date", `SELECT count(*)::int AS n FROM role_skill_mapping WHERE lifecycle_status = 'Archived' AND (archive_reason IS NULL OR archived_on IS NULL)`, 0);

    /* ---- role templates for the fallback (platform library; built from the sample's active role profiles) ---- */
    const TEMPLATE_ALIASES: Record<string, string[]> = {
      "Data Analyst": ["Reporting Analyst", "MIS Analyst", "Business Data Analyst"], "BI Analyst": ["Business Intelligence Analyst", "Power BI Developer", "Reporting Developer"],
      "Backend Developer": ["Back End Engineer", "Server-side Developer", "Java Developer", "API Developer"], "Frontend Developer": ["UI Developer", "React Developer", "Front End Engineer"],
      "Full Stack Developer": ["Full Stack Engineer", "MERN Developer"], "DevOps Engineer": ["Platform Engineer", "Build and Release Engineer"], "Site Reliability Engineer": ["SRE", "Reliability Engineer"],
      "Machine Learning Engineer": ["ML Engineer", "AI Engineer", "MLOps Engineer"], "Data Engineer": ["ETL Developer", "Big Data Engineer"], "QA Automation Engineer": ["SDET", "Test Automation Engineer", "QA Engineer"],
      "Project Manager": ["Delivery Manager", "Program Manager"], "Business Analyst": ["Functional Analyst", "Requirements Analyst"], "AML Analyst": ["KYC Analyst", "Financial Crime Analyst", "Transaction Monitoring Analyst"],
    };
    const seenTemplate = new Set<string>();
    for (const r of S.roles) {
      const key = `${r[3]}|${r[6]}`; if (seenTemplate.has(key)) continue; seenTemplate.add(key);
      const skills = (S.fw as any[]).filter(m => m[1] === r[0]).map(m => ({ skill_id: m[2], required_level: m[3], requirement_type: m[4], importance: m[5] }));
      await Q(`INSERT INTO role_templates (title, aliases, job_family, industry, summary, skills, source) VALUES ($1,$2,$3,$4,$5,$6,'v3 sample workbook')`,
        [r[3], TEMPLATE_ALIASES[r[3]] || [], r[4], r[6], `Starting profile for a ${r[3]} in ${r[6]}. Review every skill and level for your organisation.`, JSON.stringify(skills)]);
    }

    /* ---- synthetic people (clearly flagged) ---- */
    const usedNames = new Set<string>();
    const newName = () => { for (;;) { const n = `${pick(FIRST)} ${pick(LAST)}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } };
    const fwByRole = new Map<string, any[]>();
    for (const m of S.fw) fwByRole.set(m[1], [...(fwByRole.get(m[1]) || []), m]);
    const rolesByDept = new Map<string, any[]>();
    for (const r of S.roles) { const d = deptId[`${r[1]}|${r[2]}`]; rolesByDept.set(d, [...(rolesByDept.get(d) || []), r]); }
    const allEmployees: { id: string; org: string; role: string; dept: string }[] = [];

    async function addEmployee(org: string, dept: string, role: string, manager: string | null, userId: string | null, name = newName()) {
      const email = `${slug(name.split(" ")[0])}.${slug(name.split(" ")[1])}@${orgSlug[org]}.demo`;
      const e = (await Q(`INSERT INTO employees (org_id, user_id, name, email, department_id, role_id, manager_id, location, joining_date, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
        [org, userId, name, email, dept, role, manager, pick(["Bengaluru", "Singapore", "London", "Remote"]), `20${pick(["19", "20", "21", "22", "23", "24"])}-0${1 + Math.floor(rnd() * 9)}-15`]))[0].id;
      allEmployees.push({ id: e, org, role, dept });
      // levels around the requirement; some missing data, a few self-reported only
      for (const m of fwByRole.get(role) || []) {
        const r = rnd();
        if (r < 0.12) continue;                                     // no assessment data
        const lvl = Math.max(0, Math.min(5, m[3] + pick([-2, -1, -1, 0, 0, 0, 1])));
        if (r < 0.22) { await Q(`INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,'self',$4,$5,'2026-09-15')`, [org, e, m[2], Math.min(5, lvl + 1), name]); continue; }
        await Q(`INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,$4,$5,'Seed assessor','2026-09-30')`, [org, e, m[2], rnd() < 0.5 ? "validated" : "manager", lvl]);
      }
      // a few skills from other roles in the organisation, so readiness for other roles is meaningful
      const others = S.fw.filter((m: any) => roleOrg[m[1]] === org && m[1] !== role);
      for (let i = 0; i < 4; i++) {
        const m: any = pick(others);
        await Q(`INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,'manager',$4,'Seed assessor','2026-09-30') ON CONFLICT DO NOTHING`, [org, e, m[2], 1 + Math.floor(rnd() * 4)]);
      }
      // retired skills keep their history (V3-07)
      for (const a of S.archived.filter((x: any) => x[1] === role))
        await Q(`INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,'validated',3,'Seed assessor','2024-05-01') ON CONFLICT DO NOTHING`, [org, e, a[2]]);
      return e;
    }

    const users: Record<string, string> = {};
    const addUser = async (org: string | null, email: string, name: string, role: string, dept: string | null, families: string[] = []) =>
      (users[email] = (await Q(`INSERT INTO users (org_id, email, name, password_hash, role, department_id, job_family_scope) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [org, email, name, hash, role, dept, families]))[0].id);

    for (const [org, company] of S.companies) {
      const s = orgSlug[org];
      const depts = S.departments.filter((d: any) => d[1] === company);
      await addUser(org, `hr@${s}.demo`, `${newName()} (HR)`, "hr_admin", null);
      for (const [d, , dname] of depts) {
        await addUser(org, `head.${slug(dname)}@${s}.demo`, newName(), "dept_head", d);
        const deptRoles = rolesByDept.get(d)!;
        const mgrUser = await addUser(org, `manager.${slug(dname)}@${s}.demo`, newName(), "manager", d);
        const mgrName = (await Q(`SELECT name FROM users WHERE id = $1`, [mgrUser]))[0].name;
        const mgr = await addEmployee(org, d, deptRoles[0][0], null, mgrUser, mgrName);
        for (const r of deptRoles) for (let i = 0; i < 2; i++) await addEmployee(org, d, r[0], mgr, null);
      }
      const families = (await Q(`SELECT f.id FROM job_families f WHERE f.org_id = $1 AND EXISTS (SELECT 1 FROM job_roles r JOIN departments d ON d.id = r.department_id WHERE r.job_family_id = f.id AND d.id = $2)`, [org, depts[0][0]])).map(r => r.id);
      await addUser(org, `expert@${s}.demo`, `${newName()} (SME)`, "expert", null, families);
      // two employees per organisation get logins: the first reports in the first department
      const firstDept = depts[0][0];
      const reports = (await Q(`SELECT e.id, e.name FROM employees e WHERE e.department_id = $1 AND e.manager_id IS NOT NULL ORDER BY e.id LIMIT 2`, [firstDept]));
      for (const [i, r] of reports.entries()) {
        const uid = await addUser(org, i === 0 ? `employee@${s}.demo` : `employee2@${s}.demo`, r.name, "employee", firstDept);
        await Q(`UPDATE employees SET user_id = $2 WHERE id = $1`, [r.id, uid]);
      }
    }

    /* ---- career paths: published lateral paths between the closest roles in each organisation ---- */
    const reqs = (role: string) => (fwByRole.get(role) || []).map((m: any) => ({ skill_id: m[2], required_level: m[3], requirement_type: m[4], importance: m[5] }));
    for (const [org] of S.companies) {
      const rs = S.roles.filter((r: any) => orgByName[r[1]] === org);
      for (const a of rs) {
        const cands = rs.filter((b: any) => b[0] !== a[0]).map((b: any) => ({ b, cmp: compareRoles(reqs(a[0]), reqs(b[0]), DEFAULT_ASSUMPTIONS.difficulty) }))
          .filter((x: any) => x.cmp.skill_overlap >= 0.4).sort((x: any, y: any) => y.cmp.skill_overlap - x.cmp.skill_overlap).slice(0, 2);
        for (const { b } of cands) {
          const sameDept = a[2] === b[2];
          await Q(`INSERT INTO career_paths (org_id, from_role_id, to_role_id, movement_type, typical_months, approval_required, status) VALUES ($1,$2,$3,$4,$5,true,'Published') ON CONFLICT DO NOTHING`,
            [org, a[0], b[0], sameDept ? "Lateral" : "Cross-functional", 18]);
        }
      }
    }

    /* ---- open work so every persona has something to do ---- */
    for (const [org] of S.companies) {
      const s = orgSlug[org];
      const emp = (await Q(`SELECT e.* FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = $1`, [`employee@${s}.demo`]))[0];
      const mgr = (await Q(`SELECT id, name FROM users WHERE email LIKE 'manager.%' AND org_id = $1 AND department_id = $2`, [org, emp.department_id]))[0];
      const expert = (await Q(`SELECT id FROM users WHERE email = $1`, [`expert@${s}.demo`]))[0];
      const roleSkills = (fwByRole.get(emp.role_id) || []).map((m: any) => m[2]);
      const a1 = (await Q(`INSERT INTO assessments (org_id, employee_id, method, assigned_by, due_date) VALUES ($1,$2,'Self-assessment',$3,'2026-12-15') RETURNING id`, [org, emp.id, mgr.name]))[0].id;
      for (const sk of roleSkills.slice(0, 4)) await Q(`INSERT INTO assessment_items (assessment_id, skill_id) VALUES ($1,$2)`, [a1, sk]);
      const a2 = (await Q(`INSERT INTO assessments (org_id, employee_id, method, assigned_by, assessor_id, due_date) VALUES ($1,$2,'Technical quiz',$3,$4,'2026-12-20') RETURNING id`, [org, emp.id, mgr.name, expert.id]))[0].id;
      for (const sk of roleSkills.slice(0, 2)) await Q(`INSERT INTO assessment_items (assessment_id, skill_id, self_level) VALUES ($1,$2,3)`, [a2, sk]);
      // a published path target for the aspiration
      const path = (await Q(`SELECT to_role_id FROM career_paths WHERE from_role_id = $1 AND status = 'Published' LIMIT 1`, [emp.role_id]))[0];
      if (path) await Q(`INSERT INTO aspirations (org_id, employee_id, target_role_id, priority, shared_with_manager) VALUES ($1,$2,$3,'Primary',true)`, [org, emp.id, path.to_role_id]);
      // workforce plan draft
      const as = (await Q(`SELECT id FROM assumption_sets WHERE org_id = $1`, [org]))[0].id;
      const hr = (await Q(`SELECT id FROM users WHERE email = $1`, [`hr@${s}.demo`]))[0].id;
      const plan = (await Q(`INSERT INTO workforce_plans (org_id, name, horizon_months, owner_id, assumption_set_id) VALUES ($1,'FY2027 headcount plan',12,$2,$3) RETURNING id`, [org, hr, as]))[0].id;
      const rs = S.roles.filter((r: any) => orgByName[r[1]] === org);
      for (const r of rs) {
        const hc = allEmployees.filter(e => e.role === r[0]).length;
        await Q(`INSERT INTO workforce_plan_roles (plan_id, role_id, attrition_rate, planned_headcount) VALUES ($1,$2,0.12,$3)`, [plan, r[0], hc + (rnd() < 0.5 ? 1 : 0)]);
      }
      const emerging = [...new Set(S.fw.filter((m: any) => roleOrg[m[1]] === org && m[6] === "Emerging").map((m: any) => m[2]))];
      for (const sk of emerging) await Q(`INSERT INTO workforce_plan_skills (plan_id, skill_id, growth_adjustment) VALUES ($1,$2,0.10)`, [plan, sk]);
    }

    /* ---- evolution evidence from the sample's knowledge-based trends (unverified) ---- */
    const src1 = (await Q(`INSERT INTO evidence_sources (org_id, name, type, licence, reliability) VALUES (NULL,'Sample framework trend assessment (v3 workbook)','Expert review','Internal sample data. Knowledge-based, not verified against postings.','Low') RETURNING id`))[0].id;
    for (const [org] of S.companies) {
      const src2 = (await Q(`INSERT INTO evidence_sources (org_id, name, type, licence, reliability) VALUES ($1,'Internal planned demand (sample)','Company data','Company-owned planning data','Medium') RETURNING id`, [org]))[0].id;
      const bySkill = new Map<string, number[]>();
      for (const m of S.fw.filter((m: any) => roleOrg[m[1]] === org)) {
        const v = m[6] === "Declining" ? -0.6 : m[6] === "Emerging" ? 0.6 : m[7] === "Increasing" ? 0.3 : 0;
        bySkill.set(m[2], [...(bySkill.get(m[2]) || []), v]);
      }
      for (const [sk, vals] of bySkill) {
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100;
        await Q(`INSERT INTO evidence_items (org_id, source_id, skill_id, signal_type, value, summary, evidence_date, created_by) VALUES ($1,$2,$3,'expert_rating',$4,$5,'2026-10-31','Seed')`,
          [org, src1, sk, avg, `Knowledge-based judgement from the v3 sample workbook (average over ${vals.length} role mapping(s)). Unverified.`]);
        if (avg !== 0) await Q(`INSERT INTO evidence_items (org_id, source_id, skill_id, signal_type, value, summary, evidence_date, created_by) VALUES ($1,$2,$3,'internal_demand',$4,$5,'2026-10-31','Seed')`,
          [org, src2, sk, avg > 0 ? 0.5 : -0.4, avg > 0 ? "Planned projects increase demand for this skill (sample)." : "Planned migrations reduce use of this skill (sample)."]);
      }
    }

    // library reviewer: the FinEdge expert can approve proposals for the shared skill library (second person)
    await Q(`UPDATE users SET library_reviewer = true WHERE email = 'expert@finedge.demo'`);
    await Q(`SELECT sync_id_sequences()`);
    await c.query("COMMIT");
    const counts = (await Q(`SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM employees)::int AS employees, (SELECT count(*) FROM career_paths)::int AS paths`))[0];
    console.log(`Seeded: ${counts.users} users, ${counts.employees} synthetic employees, ${counts.paths} career paths. Demo password: ${PASSWORD}`);
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  await c.end();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
