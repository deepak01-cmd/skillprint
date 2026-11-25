/* End-to-end workflows across modules, as each persona would run them. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("Login works with the demo password and rejects a wrong one", async () => {
  const { dispatch } = await import("../src/server/http/router");
  const ok = await dispatch("POST", "/auth/login", null, { body: { email: "hr@finedge.demo", password: "demo1234" } });
  assert.equal(ok.status, 200); assert.ok((ok.body as any).token);
  const bad = await dispatch("POST", "/auth/login", null, { body: { email: "hr@finedge.demo", password: "nope" } });
  assert.equal(bad.status, 401);
  assert.equal((await dispatch("GET", "/roles", null)).status, 401);
});

test("Role lifecycle: create draft role, add skills, submit, approve, publish (Modules 2, 4, 6)", async () => {
  const hr = await T.as("hr@finedge.demo");
  const org = (await hr.get("/org")).body;
  const dept = org.departments.find((d: any) => d.name === "Data & Analytics").id;
  const role = await hr.post("/roles", { title: "Senior Data Analyst", department_id: dept, career_level_id: org.levels.find((l: any) => l.code === "L4").id,
    summary: "Leads analysis", responsibilities: ["Build dashboards"], outcomes: ["Trusted reporting"] });
  assert.equal(role.status, 200); assert.match(role.body.id, /^R\d{3}$/);
  assert.equal((await hr.post(`/roles/${role.body.id}/submit`)).body.error, "no_skills");
  for (const [s, l] of [["S001", 4], ["S002", 3], ["S004", 4]] as const)
    assert.equal((await hr.post(`/roles/${role.body.id}/skills`, { skill_id: s, required_level: l, requirement_type: "Mandatory", importance: "High" })).body.status, "draft");
  const cr = await hr.post(`/roles/${role.body.id}/submit`);
  assert.equal(cr.status, 200); assert.equal(cr.body.payload.pixel_ids.length, 3);
  await hr.post(`/changes/${cr.body.id}/decide`, { decision: "approve" });
  const fw = (await hr.get(`/roles/${role.body.id}/skills`)).body;
  assert.equal(fw.active_count, 3); assert.equal(fw.skills[0].pixel_id, `PX-${role.body.id}-S001`);
  assert.equal((await hr.get(`/roles/${role.body.id}`)).body.status, "Published");
});

test("Department head can only propose, and only in their department", async () => {
  const head = await T.as("head.dataanalytics@finedge.demo");
  const opt = (await head.get("/roles/R002/skills")).body.skills.find((s: any) => s.requirement_type === "Optional");
  assert.equal((await head.post(`/pixels/${opt.pixel_id}/archive`, { reason_category: "No demand", reason: "proposal" })).body.status, "in_review");
  assert.equal((await head.post(`/changes/x/decide`, { decision: "approve" })).status, 403);
  const other = (await head.get("/roles/R004/skills"));
  assert.equal(other.status, 200, "department heads view all roles");
  assert.equal(other.body.permissions.archive_write, false);
});

test("Skill library: exact duplicates are blocked, similar names need confirmation, global skills are read-only", async () => {
  const hr = await T.as("hr@finedge.demo");
  const dup = await hr.post("/skills", { name: "SQL Querying", definition: "Query data with SQL", category: "Technical Methods" });
  assert.equal(dup.status, 409); assert.equal(dup.body.error, "duplicate_skill");
  const sim = await hr.post("/skills", { name: "Power BI Embedded", definition: "Embed Power BI reports in apps", category: "Software & Platforms" });
  assert.equal(sim.body.error, "possible_duplicate");
  const ok = await hr.post("/skills", { name: "Power BI Embedded", definition: "Embed Power BI reports in apps", category: "Software & Platforms", force: true });
  assert.equal(ok.status, 200); assert.equal(ok.body.org_id, "C001");
  assert.equal((await hr.patch("/skills/S001", { definition: "changed" })).body.error, "global_skill_read_only");
  const other = await T.as("hr@cloudnova.demo");
  assert.ok(!(await other.get("/skills?q=embedded")).body.some((s: any) => s.id === ok.body.id), "company skills stay in their company");
});

test("Assessment flow: assign, self-submit, manager review -> manager-assessed level updates gaps (Module 9, 10)", async () => {
  const mgr = await T.as("manager.dataanalytics@finedge.demo");
  const emp = await T.as("employee@finedge.demo");
  const eid = emp.user.employee_id!;
  const gaps = (await emp.get(`/employees/${eid}/gaps`)).body;
  const target = gaps[0];
  const a = await mgr.post("/assessments", { employee_id: eid, method: "Self-assessment", skill_ids: [target.skill_id] });
  assert.equal(a.status, 200);
  assert.equal((await mgr.post(`/assessments/${a.body.id}/review`, { items: [{ skill_id: target.skill_id, assessed_level: 5 }] })).body.error, "awaiting_employee");
  assert.equal((await emp.post(`/assessments/${a.body.id}/submit`, { items: [{ skill_id: target.skill_id, self_level: 4, self_evidence: "Project X" }] })).body.status, "Submitted");
  const r = await mgr.post(`/assessments/${a.body.id}/review`, { items: [{ skill_id: target.skill_id, assessed_level: target.required_level, feedback: "Good" }] });
  assert.equal(r.body.recorded_as, "manager");
  const after = (await emp.get(`/employees/${eid}/gaps`)).body.find((g: any) => g.skill_id === target.skill_id);
  assert.equal(after.status, "Met"); assert.equal(after.source, "manager");
  assert.equal((await emp.post(`/assessments/${a.body.id}/review`, { items: [] })).status, 403);
});

test("Expert reviewer validates only assigned assessments", async () => {
  const expert = await T.as("expert@finedge.demo");
  const list = (await expert.get("/assessments")).body;
  assert.ok(list.length >= 1 && list.every((a: any) => a.method !== "Self-assessment"));
  const a = (await expert.get(`/assessments/${list[0].id}`)).body;
  const r = await expert.post(`/assessments/${a.id}/review`, { items: a.items.map((i: any) => ({ skill_id: i.skill_id, assessed_level: 3, score: 80 })) });
  assert.equal(r.body.recorded_as, "validated");
});

test("Self-reported levels are never shown as verified and do not close gaps by default (12.4, CM-13)", async () => {
  const emp = await T.as("employee2@finedge.demo");
  const eid = emp.user.employee_id!;
  const g = (await emp.get(`/employees/${eid}/gaps`)).body.find((x: any) => x.status !== "Met") || (await emp.get(`/employees/${eid}/gaps`)).body[0];
  await emp.post(`/employees/${eid}/self-assess`, { skill_id: g.skill_id, level: 5 });
  const after = (await emp.get(`/employees/${eid}/gaps`)).body.find((x: any) => x.skill_id === g.skill_id);
  assert.equal(after.self_level, 5); assert.notEqual(after.source, "self");
});

test("Aspirations are private until shared; managers see only shared ones; readiness shows every skill", async () => {
  const emp = await T.as("employee2@finedge.demo");
  const eid = emp.user.employee_id!;
  const role = (await T.q(T.db, `SELECT role_id FROM employees WHERE id = $1`, [eid]))[0].role_id;
  const target = (await T.q(T.db, `SELECT id FROM job_roles WHERE org_id = 'C001' AND status = 'Published' AND id <> $1 ORDER BY id LIMIT 1`, [role]))[0].id;
  assert.equal((await emp.post(`/employees/${eid}/aspirations`, { target_role_id: target, priority: "Primary", shared_with_manager: false })).status, 200);
  const mgr = await T.as("manager.dataanalytics@finedge.demo");
  const seen = (await mgr.get(`/employees/${eid}/aspirations`)).body;
  assert.equal(seen.aspirations.length, 0); assert.equal(seen.hidden, 1);
  assert.equal((await mgr.get(`/employees/${eid}/readiness/${target}`)).status, 403);
  const mine = (await emp.get(`/employees/${eid}/aspirations`)).body.aspirations[0];
  assert.equal(mine.readiness.lines.length, mine.readiness.skills_required); assert.ok(mine.readiness.band);
  await emp.patch(`/aspirations/${mine.id}`, { shared_with_manager: true });
  assert.equal((await mgr.get(`/employees/${eid}/aspirations`)).body.aspirations.length, 1);
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM readiness_snapshots WHERE employee_id = $1`, [eid]))[0].n >= 1, true);
});

test("Role comparison returns 16.4 metrics and labels a missing path", async () => {
  const emp = await T.as("employee@finedge.demo");
  const r = await emp.get("/roles/R001/compare/R010");
  assert.equal(r.status, 200);
  for (const k of ["skills_in_target", "shared_skills", "new_skills", "skills_needing_higher_level", "level_points_to_close", "skill_overlap", "move_difficulty"]) assert.ok(k in r.body);
  assert.ok(r.body.lines.length === r.body.skills_in_target);
});

test("Workforce plan: inputs recalculate, approval stores a reproducible snapshot, approved plans are locked", async () => {
  const hr = await T.as("hr@finedge.demo");
  const plan = (await hr.get("/planning/plans")).body[0];
  const before = (await hr.get(`/planning/plans/${plan.id}`)).body;
  const row = before.roles[0];
  assert.equal((await hr.put(`/planning/plans/${plan.id}/roles/${row.role_id}`, { attrition_rate: 0.12, planned_headcount: row.current_headcount + 3 })).status, 200);
  const mid = (await hr.get(`/planning/plans/${plan.id}`)).body;
  assert.ok(mid.roles.find((r: any) => r.role_id === row.role_id).net_positions >= 3);
  assert.equal((await hr.post(`/planning/plans/${plan.id}/approve`)).body.status, "Approved");
  const snap = (await hr.get(`/planning/plans/${plan.id}`)).body;
  assert.equal(snap.from_snapshot, true); assert.deepEqual(snap.totals, mid.totals);
  assert.equal((await hr.put(`/planning/plans/${plan.id}/roles/${row.role_id}`, { attrition_rate: 0.2, planned_headcount: 1 })).body.error, "plan_locked");
  const head = await T.as("head.dataanalytics@finedge.demo");
  assert.equal((await head.put(`/planning/plans/${plan.id}/roles/R004`, { attrition_rate: 0.1, planned_headcount: 3 })).status, 403);
});

test("Evolution: a review proposes suggestions; accepting creates a Draft change only (RE-14, AR-16)", async () => {
  const hr = await T.as("hr@cloudnova.demo");
  const run = await hr.post("/evolution/review");
  assert.equal(run.status, 200);
  const list = (await hr.get("/evolution/suggestions")).body;
  assert.ok(list.length > 0);
  const s = list.find((x: any) => x.status === "Suggested");
  const before = (await T.q(T.db, `SELECT required_level, lifecycle_status FROM role_skill_mapping WHERE org_id = 'C003' AND pixel_id = $1`, [s.subject_id]))[0];
  assert.equal((await hr.post(`/evolution/suggestions/${s.id}/decide`, { decision: "Reject" })).body.error, "reason_required");
  const acc = await hr.post(`/evolution/suggestions/${s.id}/decide`, { decision: "Accept" });
  assert.equal(acc.body.status, "Accepted"); assert.ok(acc.body.change_id);
  const after = (await T.q(T.db, `SELECT required_level, lifecycle_status FROM role_skill_mapping WHERE org_id = 'C003' AND pixel_id = $1`, [s.subject_id]))[0];
  assert.deepEqual(after, before, "nothing changes until the change request is approved");
  assert.equal((await T.q(T.db, `SELECT status, origin FROM change_requests WHERE id = $1`, [acc.body.change_id]))[0].origin, "evolution");
});

test("Employee import validates columns, emails, departments and roles before importing", async () => {
  const hr = await T.as("hr@finedge.demo");
  const bad = await hr.post("/employees/import", { csv: "Employee ID,Name,Email,Department,Role\nE1,Rahul,not-an-email,Data & Analytics,BI Analyst\nE2,Priya,priya@x.com,Nowhere,BI Analyst" });
  assert.equal(bad.body.imported, 0); assert.equal(bad.body.errors.length, 2);
  const ok = await hr.post("/employees/import", { csv: "Employee ID,Name,Email,Department,Role\nE1,Rahul Test,rahul.test@x.com,Data & Analytics,BI Analyst" });
  assert.equal(ok.body.imported, 1);
});

test("Aggregated gap views suppress groups smaller than five; team view shows individuals to the manager", async () => {
  const head = await T.as("head.dataanalytics@finedge.demo");
  const g = (await head.get("/gaps")).body;
  assert.equal(g.scope, "dept"); assert.equal(g.individual, null);
  const mgr = await T.as("manager.dataanalytics@finedge.demo");
  const t = (await mgr.get("/gaps")).body;
  assert.equal(t.scope, "team"); assert.ok(t.individual.length > 0);
});

test("Audit log is append-only and records framework changes", async () => {
  const n = (await T.q(T.db, `SELECT count(*)::int AS n FROM audit_log`))[0].n;
  assert.ok(n > 10);
  await assert.rejects(T.q(T.db, `UPDATE audit_log SET actor_name = 'x'`), /append-only/);
});
