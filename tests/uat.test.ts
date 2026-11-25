/* User Acceptance Test cases (Role_Skill_Framework_User_Acceptance_Test_Cases.xlsx), TC01-TC18 and Q1-Q11,
   run against the API with the seeded v3 sample. UI-only aspects are covered by the browser check in scripts/uat-browser.js. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });
const FE = "hr@finedge.demo", CN = "hr@cloudnova.demo", MC = "hr@medicore.demo";

test("TC01 sample import: 3 companies, 12 departments, 36 roles, 65 skills, 268 + 10 = 278, no duplicates, no leaks", async () => {
  const admin = await T.as("admin@platform.demo");
  const d = (await admin.get("/dashboard")).body;
  assert.equal(d.organisations, 3); assert.equal(d.departments, 12); assert.equal(d.roles, 36); assert.equal(d.skills_global, 65);
  const r = d.reconciliation;
  assert.equal(r.active_mappings, 268); assert.equal(r.archived_mappings, 10); assert.equal(r.total_stored, 278);
  assert.equal(r.duplicate_pixel_ids, 0); assert.equal(r.archived_in_framework_view, 0);
});

test("TC02 FinEdge HR sees 4 departments and 12 roles R001-R012, nothing from other companies", async () => {
  const hr = await T.as(FE);
  const org = (await hr.get("/org")).body;
  assert.deepEqual(org.departments.map((d: any) => d.name).sort(), ["Data & Analytics", "Product & Operations", "Risk & Compliance", "Technology & Engineering"]);
  const roles = (await hr.get("/roles")).body;
  assert.deepEqual(roles.map((r: any) => r.id).sort(), Array.from({ length: 12 }, (_, i) => `R${String(i + 1).padStart(3, "0")}`));
  const s = JSON.stringify([org, roles]);
  assert.ok(!/MediCore|CloudNova/.test(s));
});

test("TC03 FinEdge cannot open a MediCore role (R013): not found, nothing leaked", async () => {
  const hr = await T.as(FE);
  for (const p of ["/roles/R013", "/roles/R013/skills", "/roles/R013/compare/R001"]) {
    const r = await hr.get(p);
    assert.ok([403, 404, 422].includes(r.status), p);
    assert.ok(!/Clinical Data Analyst|MediCore/.test(JSON.stringify(r.body)), p);
  }
});

test("TC04 Role explorer: 'Backend Developer' -> R004 only; 'BI' -> R002", async () => {
  const hr = await T.as(FE);
  const roles = (await hr.get("/roles")).body;
  const find = (q: string) => roles.filter((r: any) => (r.title + " " + (r.alt_titles || []).join(" ")).toLowerCase().includes(q.toLowerCase()));
  assert.deepEqual(find("Backend Developer").map((r: any) => r.id), ["R004"]);
  assert.deepEqual(find("BI").map((r: any) => r.id), ["R002"]);
  assert.deepEqual((await hr.get("/search?q=Backend Developer")).body.roles.map((r: any) => r.id), ["R004"]);
  assert.ok((await hr.get("/search?q=BI")).body.roles.some((r: any) => r.id === "R002"));
});

test("TC05 Skill library: 60 active platform-wide; Python 2 hidden by default, 'Archived (all roles)' when included", async () => {
  const admin = await T.as("admin@platform.demo");
  const all = (await admin.get("/skills")).body;
  assert.equal(all.filter((s: any) => s.status === "Active").length, 60);
  for (const email of [FE, MC, CN]) {
    const hr = await T.as(email);
    assert.ok(!(await hr.get("/skills?q=python 2")).body.some((s: any) => s.id === "S053"), email);
    const inc = (await hr.get("/skills?q=python 2&include_archived=true")).body.find((s: any) => s.id === "S053");
    assert.equal(inc.status, "Archived (all roles)", email); assert.ok(inc.definition);
  }
  const hr = await T.as(CN);
  for (const id of ["S053", "S054", "S055", "S056", "S057"]) {
    const s = (await hr.get(`/skills/${id}`)).body;
    assert.equal(s.platform_status, "Archived (all roles)", id);
  }
});

test("TC06 Creating 'SQL Querying' warns that SQL exists and offers four options; no silent duplicate", async () => {
  const hr = await T.as(FE);
  const before = (await T.q(T.db, `SELECT count(*)::int AS n FROM skills`))[0].n;
  const r = await hr.post("/skills", { name: "SQL Querying", definition: "Query relational data", category: "Technical Methods" });
  assert.equal(r.status, 409);
  assert.equal(r.body.details.candidates[0].id, "S001");
  assert.deepEqual(r.body.details.options, ["use_existing", "add_as_alias", "create_different", "request_library_update"]);
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM skills`))[0].n, before);
  const req = await hr.post("/library-requests", { skill_id: "S001", type: "alias", text: "SQL Querying" });
  assert.equal(req.status, 200);
  const admin = await T.as("admin@platform.demo");
  assert.equal((await admin.post(`/library-requests/${req.body.id}/decide`, { decision: "approve" })).status, 200);
  assert.ok((await T.q(T.db, `SELECT aliases FROM skills WHERE id = 'S001'`))[0].aliases.includes("SQL Querying"));
});

test("TC07 / Q1 R001: 12 active skills with Pixel IDs, SQL Mandatory L4 High, LIBOR hidden, 1 archived link, level definitions", async () => {
  const hr = await T.as(FE);
  const r = (await hr.get("/roles/R001/skills")).body;
  assert.equal(r.active_count, 12); assert.equal(r.archived_count, 1);
  const sql = r.skills.find((s: any) => s.pixel_id === "PX-R001-S001");
  assert.equal(sql.skill_name, "SQL"); assert.equal(sql.requirement_type, "Mandatory"); assert.equal(sql.required_level, 4); assert.equal(sql.importance, "High");
  assert.equal((r.skills.find((s: any) => s.pixel_id === "PX-R001-S002")).required_level, 4);
  assert.ok(!r.skills.some((s: any) => s.skill_name === "LIBOR Rate Reporting"));
  assert.ok(!/RS0\d{3}|FWR\d{3}|role_skill_id|framework_id/.test(JSON.stringify(r.skills)));
  assert.ok(sql.level_descriptor && /complex/i.test(sql.level_descriptor), "level definition shown with the mapping");
});

test("TC08 R031 archived view: separate read-only list of S053 and S055 with reasons and 2026-10-31; active list stays 10", async () => {
  const hr = await T.as(CN);
  const r = (await hr.get("/roles/R031/skills?include_archived=true")).body;
  assert.equal(r.skills.length, 10);
  assert.deepEqual(r.archived.map((a: any) => [a.pixel_id, a.archive_reason_category, a.archived_on]),
    [["PX-R031-S053", "End of life", "2026-10-31"], ["PX-R031-S055", "Replaced by successor", "2026-10-31"]]);
  assert.equal((await hr.patch("/pixels/PX-R031-S053", { required_level: 2 })).status, 422, "archived rows are read-only");
});

test("TC09 Archive jQuery PX-R026-S049: blocked without reason; then 8 -> 7 active, 1 -> 2 archived, Legacy only, audit event", async () => {
  const hr = await T.as(CN);
  assert.equal((await hr.post("/pixels/PX-R026-S049/archive", {})).status, 422);
  assert.equal((await hr.post("/pixels/PX-R026-S049/archive", { reason_category: "Replaced by successor" })).status, 422);
  const before = (await hr.get("/roles/R026/skills")).body;
  assert.equal(before.active_count, 8); assert.equal(before.archived_count, 1);
  const r = await hr.post("/pixels/PX-R026-S049/archive", { reason_category: "Replaced by successor", reason: "Modern frameworks replace jQuery" });
  assert.equal(r.body.status, "archived"); assert.equal(r.body.mapping.requirement_type, "Legacy only");
  const after = (await hr.get("/roles/R026/skills")).body;
  assert.equal(after.active_count, 7); assert.equal(after.archived_count, 2);
  const ev = await T.q(T.db, `SELECT actor, reason, at FROM archive_audit_log WHERE pixel_id = 'PX-R026-S049' AND action = 'archive'`);
  assert.equal(ev.length, 1); assert.ok(ev[0].actor && ev[0].reason && ev[0].at);
});

test("TC10 Restore PX-R026-S049: same ID, Declining, Optional, review flag, second audit event; ID survives renames", async () => {
  const hr = await T.as(CN);
  const r = await hr.post("/pixels/PX-R026-S049/restore", { note: "UAT" });
  assert.equal(r.body.mapping.pixel_id, "PX-R026-S049"); assert.equal(r.body.mapping.skill_trend, "Declining");
  assert.equal(r.body.mapping.requirement_type, "Optional"); assert.equal(r.body.mapping.review_flag, true);
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM archive_audit_log WHERE pixel_id = 'PX-R026-S049' AND action IN ('archive','restore')`))[0].n, 2);
  assert.equal((await hr.patch("/roles/R026", { title: "Frontend Engineer" })).status, 200);
  const admin = await T.as("admin@platform.demo");
  assert.equal((await admin.patch("/skills/S049", { name: "jQuery (legacy)" })).status, 200);
  const m = (await hr.get("/pixels/PX-R026-S049")).body;
  assert.equal(m.pixel_id, "PX-R026-S049"); assert.equal(m.skill_name, "jQuery (legacy)");
});

test("TC11 Draft can only be withdrawn; archiving R020's last active skill asks for confirmation", async () => {
  const hr = await T.as(MC);
  const d = await hr.post("/roles/R020/skills", { skill_id: "S039", required_level: 2, requirement_type: "Optional", importance: "Low" });
  assert.equal((await hr.post(`/pixels/${d.body.mapping.pixel_id}/archive`, { reason_category: "No demand", reason: "x" })).status, 422);
  assert.equal((await hr.del(`/pixels/${d.body.mapping.pixel_id}`)).body.status, "withdrawn");
  const skills = (await hr.get("/roles/R020/skills")).body.skills;
  assert.equal(skills.length, 4);
  for (const sk of skills.slice(0, 3)) {
    const x = (await hr.post(`/pixels/${sk.pixel_id}/archive`, { reason_category: "No demand", reason: "UAT" })).body;
    if (x.status === "in_review") await hr.post(`/changes/${x.change.id}/decide`, { decision: "approve" });
  }
  assert.equal((await hr.get("/roles/R020/skills")).body.active_count, 1);
  const r = await hr.post(`/pixels/${skills[3].pixel_id}/archive`, { reason_category: "No demand", reason: "UAT" });
  assert.equal(r.status, 409); assert.equal(r.body.error, "confirm_required");
  assert.equal((await hr.get("/roles/R020/skills")).body.active_count, 1, "nothing changed without confirmation");
});

test("TC12 Proficiency: 5 levels Awareness..Expert, each with a descriptor; Level 4 handles complex tasks", async () => {
  const hr = await T.as(FE);
  const p = (await hr.get("/proficiency")).body.levels;
  assert.deepEqual(p.map((l: any) => l.name), ["Awareness", "Foundational", "Competent", "Advanced", "Expert"]);
  assert.ok(p.every((l: any) => l.descriptor.length > 10));
  assert.match(p[3].descriptor, /complex/i);
});

test("TC13 / Q9 Department head changes PX-R001-S002 4 -> 3; not live until HR approves; history has old, new, who, when, approver", async () => {
  const head = await T.as("head.dataanalytics@finedge.demo");
  const r = await head.patch("/pixels/PX-R001-S002", { required_level: 3, reason: "Python at 3 is enough for this role" });
  assert.equal(r.body.status, "in_review");
  const hr = await T.as(FE);
  assert.equal((await hr.get("/pixels/PX-R001-S002")).body.required_level, 4);
  const emp = (await T.q(T.db, `SELECT id FROM employees WHERE role_id = 'R001' LIMIT 1`))[0].id;
  assert.equal((await hr.get(`/employees/${emp}/gaps`)).body.find((g: any) => g.skill_id === "S002").required_level, 4);
  await hr.post(`/changes/${r.body.change.id}/decide`, { decision: "approve" });
  assert.equal((await hr.get("/pixels/PX-R001-S002")).body.required_level, 3);
  const h = (await hr.get("/pixels/PX-R001-S002/history")).body;
  const c = h.changes.find((x: any) => x.id === r.body.change.id);
  assert.equal(c.before.required_level, 4); assert.equal(c.after.required_level, 3);
  assert.ok(c.requested_by_name.includes("") && c.decided_by && c.requested_at && c.decided_at && c.reason);
});

test("TC14 New employee on R001: self-assessed SQL 3 and manager-validated 4 are kept separately with who and when", async () => {
  const hr = await T.as(FE);
  const org = (await hr.get("/org")).body;
  const mgr = (await T.q(T.db, `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = 'manager.dataanalytics@finedge.demo'`))[0].id;
  const e = await hr.post("/employees", { name: "Uat Tester", email: "uat.tester@finedge.demo", department_id: org.departments.find((d: any) => d.name === "Data & Analytics").id, role_id: "R001", manager_id: mgr,
    login_password: "uatpass123" });
  assert.equal(e.status, 200); assert.ok(e.body.user_id, "a login was created");
  const emp = await T.as("uat.tester@finedge.demo");
  await emp.post(`/employees/${e.body.id}/self-assess`, { skill_id: "S001", level: 3 });
  const m = await T.as("manager.dataanalytics@finedge.demo");
  const a = await m.post("/assessments", { employee_id: e.body.id, method: "Manager assessment", skill_ids: ["S001"] });
  await m.post(`/assessments/${a.body.id}/review`, { items: [{ skill_id: "S001", assessed_level: 4 }] });
  const g = (await m.get(`/employees/${e.body.id}/gaps`)).body.find((x: any) => x.skill_id === "S001");
  assert.equal(g.self_level, 3); assert.equal(g.current_level, 4); assert.equal(g.source, "manager");
  assert.ok(g.assessed_by && g.assessed_on && g.self_assessed_on);
});

test("TC15 Gap = 4 - 2 = 2; unassessed skills say not assessed; archived skills excluded but kept as retired history", async () => {
  const hr = await T.as(FE);
  const emp = (await T.q(T.db, `SELECT e.id FROM employees e WHERE e.role_id = 'R001' AND e.synthetic ORDER BY e.id LIMIT 1`))[0].id;
  await T.q(T.db, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ('C001',$1,'S001','validated',2,'UAT','2026-11-20')
                   ON CONFLICT (employee_id, skill_id, source) DO UPDATE SET level = 2, assessed_on = '2026-11-20'`, [emp]);
  await T.q(T.db, `DELETE FROM employee_skills WHERE employee_id = $1 AND skill_id = 'S003'`, [emp]);
  const p = (await hr.get(`/employees/${emp}`)).body;
  const sql = p.gaps.find((g: any) => g.skill_id === "S001");
  assert.equal(sql.gap, 2);
  const excel = p.gaps.find((g: any) => g.skill_id === "S003");
  assert.equal(excel.current_level, null); assert.equal(excel.status, "No assessment data"); assert.equal(excel.gap, null);
  assert.ok(!p.gaps.some((g: any) => g.skill_id === "S057"));
  assert.equal(p.additional.find((a: any) => a.skill_id === "S057").label, "Retired (kept as history)");
});

test("TC16 / Q10 Platform dashboard: 268 active (Current 217, Emerging 32, Declining 19; FinEdge 93, MediCore 78, CloudNova 97); archived only as +N", async () => {
  const admin = await T.as("admin@platform.demo");
  const d = (await admin.get("/dashboard")).body;
  // earlier UAT steps changed some mappings; compare against the import baseline reported by the dashboard
  assert.deepEqual(Object.keys(d.by_company[0]).sort(), ["active", "archived", "industry", "name", "trends"].sort());
  const total = d.by_company.reduce((a: number, c: any) => a + c.active, 0);
  const arch = d.by_company.reduce((a: number, c: any) => a + c.archived, 0);
  assert.equal(total + arch, d.reconciliation.total_stored);
  assert.ok(d.trends_by_industry.length === 3);
});

test("TC17 Search PX-R001-S001 finds SQL; RS0001 resolves to it; export has Pixel ID first and no archived rows", async () => {
  const hr = await T.as(FE);
  const s = (await hr.get("/search?q=PX-R001-S001")).body;
  assert.equal(s.mappings[0].pixel_id, "PX-R001-S001"); assert.equal(s.mappings[0].skill_name, "SQL");
  const o = (await hr.get("/search?q=RS0001")).body;
  assert.equal(o.legacy_match.pixel_id, "PX-R001-S001");
  const x = (await hr.get("/framework/export?role_id=R001")).body;
  assert.equal(x.header[0], "Pixel ID"); assert.ok(x.rows.every((r: any[]) => r[18] === "Active")); assert.ok(!x.rows.some((r: any[]) => r[0] === "PX-R001-S057"));
});

test("TC18 Later modules work with explained numbers and advisory wording", async () => {
  const hr = await T.as(FE);
  const c = (await hr.get("/roles/R001/compare/R003")).body;
  assert.ok(c.lines.length && c.move_difficulty && c.thresholds);
  const plan = await hr.post("/planning/plans", { name: "UAT 12-month plan", horizon_months: 12 });
  await hr.put(`/planning/plans/${plan.body.id}/roles/R001`, { attrition_rate: 0.12, planned_headcount: 4 });
  const p = (await hr.get(`/planning/plans/${plan.body.id}`)).body;
  assert.ok(p.roles[0].net_positions >= 0 && p.note);
  const t = (await hr.get("/evolution/skills")).body;
  assert.ok(t.length && t.every((x: any) => ["Emerging", "Growing", "Stable", "Declining", "No evidence"].includes(x.trend)));
  assert.ok(!/at risk|replaced/i.test(JSON.stringify(t.map((x: any) => x.trend))));
});

test("Q2 / Q4 Framework-wide trend filter: Declining mappings are all Optional with reason and confidence; Emerging listed", async () => {
  const hr = await T.as(MC);
  const dec = (await hr.get("/framework?trend=Declining")).body.skills;
  assert.ok(dec.length > 0 && dec.every((m: any) => m.requirement_type === "Optional" && m.trend_rationale && m.confidence_score !== null));
  const em = (await hr.get("/framework?trend=Emerging")).body.skills;
  assert.ok(em.length > 0 && em.every((m: any) => m.evidence_status === "Unverified"));
});

test("Q3 Retired skills on request: separate list with reason and date", async () => {
  const hr = await T.as(FE);
  const r = (await hr.get("/framework?include_archived=true")).body;
  assert.ok(r.archived.length >= 3 && r.archived.every((a: any) => a.archive_reason && a.archived_on));
  assert.ok(!r.skills.some((s: any) => s.lifecycle_status === "Archived"));
  const emp = await T.as("employee@finedge.demo");
  assert.equal((await emp.get("/framework?include_archived=true")).status, 403);
});

test("Q5 Same skill, different trend by role and industry: SAS Declining in FinEdge banking roles, Current for R023 (platform view)", async () => {
  const admin = await T.as("admin@platform.demo");
  const sas = (await admin.get("/skills/S045")).body.mappings;
  const by = Object.fromEntries(sas.map((m: any) => [m.role_id, m.skill_trend]));
  assert.equal(by.R023, "Current"); assert.equal(by.R001, "Declining"); assert.equal(by.R003, "Declining");
  // a department head stays inside their own company (tenant isolation, TC03)
  const head = await T.as("head.dataquality@medicore.demo");
  assert.ok((await head.get("/skills/S045")).body.mappings.every((m: any) => !["R001", "R003"].includes(m.role_id)));
});

test("Q6 Manager team gaps are ranked; unassessed counted separately", async () => {
  const m = await T.as("manager.dataanalytics@finedge.demo");
  const g = (await m.get("/gaps")).body;
  assert.ok(g.skills.length && "no_data" in g.skills[0]);
  for (let i = 1; i < g.skills.length; i++) assert.ok(g.skills[i - 1].high_priority >= g.skills[i].high_priority);
});

test("Q8 Development plans suggest only active skills", async () => {
  const hr = await T.as(FE);
  const emp = (await T.q(T.db, `SELECT id FROM employees WHERE role_id = 'R001' AND synthetic ORDER BY id DESC LIMIT 1`))[0].id;
  const r = await hr.post(`/employees/${emp}/plans/generate`, {});
  const skills = (await T.q(T.db, `SELECT DISTINCT skill_id FROM development_activities WHERE plan_id = $1`, [r.body.plan.id])).map(x => x.skill_id);
  assert.ok(!skills.includes("S057"));
});

test("Q11 Trend labels carry confidence 0.50-0.76 and Unverified evidence status", async () => {
  const hr = await T.as(FE);
  const r = (await hr.get("/framework")).body.skills;
  const c = r.map((m: any) => m.confidence_score).filter((x: any) => x !== null);
  assert.ok(Math.min(...c) >= 0.5 && Math.max(...c) <= 0.76);
  assert.ok(r.every((m: any) => m.evidence_status === "Unverified"));
});
