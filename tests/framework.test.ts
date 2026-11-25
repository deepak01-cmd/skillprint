/* Developer Guide 9.1 reconciliation, 9.2 test cases, and PRD 33.4 scenarios V3-01 to V3-08, run against PostgreSQL. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

const HR_CN = "hr@cloudnova.demo", HR_FE = "hr@finedge.demo";

test("9.1 reconciliation matches the sample Summary sheet", async () => {
  const hr = await T.as(HR_CN);
  const r = (await hr.get("/reconciliation")).body.platform;
  assert.equal(r.active_mappings, 268); assert.equal(r.archived_mappings, 10); assert.equal(r.total_stored, 278);
  assert.equal(r.duplicate_pixel_ids, 0); assert.equal(r.archived_in_framework_view, 0); assert.equal(r.invalid_trends_in_view, 0);
  assert.deepEqual(r.roles_without_active_skills, []); assert.equal(r.skills_active, 60); assert.equal(r.skills_archived_all_roles, 5);
  assert.equal(r.crosswalk_rows, 278); assert.equal(r.crosswalk_unresolved, 0);
});

test("9.2 Pixel ID equals PX-role-skill for every row and matches the regex", async () => {
  const rows = await T.q(T.db, `SELECT pixel_id, role_id, skill_id FROM role_skill_mapping`);
  for (const r of rows) { assert.equal(r.pixel_id, `PX-${r.role_id}-${r.skill_id}`); assert.match(r.pixel_id, /^PX-R\d{3,}-S\d{3,}$/); }
});

test("9.2 constraints: an Archived row with no reason is rejected; Pixel ID cannot change", async () => {
  await assert.rejects(T.q(T.db, `UPDATE role_skill_mapping SET lifecycle_status = 'Archived', skill_trend = 'Archived', requirement_type = 'Legacy only' WHERE pixel_id = 'PX-R001-S001'`), /ck_archived_fields/);
  await assert.rejects(T.q(T.db, `UPDATE role_skill_mapping SET lifecycle_status = 'Archived' WHERE pixel_id = 'PX-R001-S002'`), /ck_archived_consistent/);
  await assert.rejects(T.q(T.db, `UPDATE role_skill_mapping SET pixel_id = 'PX-R001-S099' WHERE pixel_id = 'PX-R001-S001'`));
  await assert.rejects(T.q(T.db, `DELETE FROM archive_audit_log`), /append-only/);
});

test("V3-01 R001 + S001 is Published and Active with Pixel ID PX-R001-S001", async () => {
  const r = await (await T.as(HR_FE)).get("/pixels/PX-R001-S001");
  assert.equal(r.status, 200); assert.equal(r.body.approval_status, "Published"); assert.equal(r.body.lifecycle_status, "Active");
});

test("V3-02 / 9.2 default read: R031 shows archived_count 2 and no archived item in skills", async () => {
  const r = await (await T.as(HR_CN)).get("/roles/R031/skills");
  assert.equal(r.status, 200); assert.equal(r.body.archived_count, 2); assert.equal(r.body.archived, undefined);
  assert.ok(r.body.skills.every((s: any) => s.lifecycle_status === "Active"));
  assert.equal(r.body.active_count, r.body.skills.length);
});

test("V3-04 / 9.2 on request: permitted user gets two arrays; others get 403", async () => {
  const ok = await (await T.as(HR_CN)).get("/roles/R031/skills?include_archived=true");
  assert.deepEqual(ok.body.archived.map((a: any) => a.pixel_id), ["PX-R031-S053", "PX-R031-S055"]);
  assert.ok(ok.body.archived.every((a: any) => a.archive_reason && a.archived_on && a.last_required_level && a.confidence_score !== null));
  assert.ok(!ok.body.skills.some((s: any) => s.lifecycle_status === "Archived"));
  const head = await (await T.as("head.dataai@cloudnova.demo")).get("/roles/R031/skills?include_archived=true");
  assert.equal(head.status, 200, "department head reads archived for own department");
  assert.equal((await (await T.as("head.softwareengineering@cloudnova.demo")).get("/roles/R031/skills?include_archived=true")).status, 403);
  assert.equal((await (await T.as("manager.dataai@cloudnova.demo")).get("/roles/R031/skills?include_archived=true")).status, 403);
});

test("9.2 leak test: search, export, counts, gaps and dashboards contain no archived Pixel IDs", async () => {
  const archived = new Set((await T.q(T.db, `SELECT pixel_id FROM role_skill_mapping WHERE lifecycle_status = 'Archived'`)).map(r => r.pixel_id));
  const hr = await T.as(HR_CN);
  const exp = await hr.get("/framework/export");
  assert.ok(exp.body.rows.every((r: any[]) => !archived.has(r[0]))); assert.equal(exp.body.header[0], "Pixel ID");
  const s = await hr.get("/search?q=python");
  assert.ok(s.body.mappings.every((m: any) => !archived.has(m.pixel_id)));
  assert.ok(!s.body.skills.some((x: any) => x.id === "S053"), "Python 2 is archived everywhere and not in default search");
  const lib = await hr.get("/skills");
  assert.ok(!lib.body.some((x: any) => x.id === "S053"));
  const libAll = await hr.get("/skills?include_archived=true");
  assert.equal(libAll.body.find((x: any) => x.id === "S053").status, "Archived (all roles)");
  const emps = await T.q(T.db, `SELECT id FROM employees WHERE role_id = 'R031'`);
  const g = await hr.get(`/employees/${emps[0].id}/gaps`);
  assert.ok(g.body.every((x: any) => !archived.has(x.pixel_id)));
  const roles = await hr.get("/roles");
  const r031 = roles.body.find((r: any) => r.id === "R031");
  assert.equal(r031.active_skills, 10, "sample data: R031 has 10 active mappings (the guide example says 11)"); assert.equal(r031.archived_skills, 2);
});

test("9.2 crosswalk: each of 278 old IDs resolves to exactly one Pixel ID in its own organisation", async () => {
  const rows = await T.q(T.db, `SELECT x.old_role_skill_id, x.pixel_id, o.id AS org FROM pixel_id_crosswalk x JOIN organisations o ON o.id = x.org_id`);
  assert.equal(rows.length, 278);
  const hrBy: Record<string, any> = { C001: await T.as(HR_FE), C002: await T.as("hr@medicore.demo"), C003: await T.as(HR_CN) };
  for (const r of rows) {
    const res = await hrBy[r.org].get(`/pixels/legacy/${r.old_role_skill_id}`);
    assert.equal(res.body.pixel_id, r.pixel_id);
  }
  const fw = await hrBy.C001.get("/pixels/legacy/FWR001");
  assert.equal(fw.body.role_id, "R001");
  assert.equal((await hrBy.C001.get("/pixels/legacy/RS0257")).body.lifecycle_status, "Archived");
  assert.equal((await hrBy.C003.get("/pixels/legacy/RS0257")).status, 404, "another tenant's old ID reads as not found");
});

test("V3-03 archiving a Mandatory mapping with approval policy on goes to review, then hides it and logs", async () => {
  const hr = await T.as(HR_FE);
  const r = await hr.post("/pixels/PX-R002-S001/archive", { reason_category: "End of life", reason: "Test archive" });
  assert.equal(r.status, 200); assert.equal(r.body.status, "in_review");
  assert.ok((await hr.get("/roles/R002/skills")).body.skills.some((s: any) => s.pixel_id === "PX-R002-S001"), "still active before approval");
  const d = await hr.post(`/changes/${r.body.change.id}/decide`, { decision: "approve" });
  assert.equal(d.status, 200);
  assert.ok(!(await hr.get("/roles/R002/skills")).body.skills.some((s: any) => s.pixel_id === "PX-R002-S001"));
  const log = await T.q(T.db, `SELECT * FROM archive_audit_log WHERE pixel_id = 'PX-R002-S001' AND action = 'archive'`);
  assert.equal(log.length, 1); assert.equal(log[0].change_id, r.body.change.id);
});

test("DG 7 errors: 422 without reason, 409 already_archived, 409 not_archived, 403 without archive:write", async () => {
  const hr = await T.as(HR_FE);
  const opt = (await hr.get("/roles/R001/skills")).body.skills.find((s: any) => s.requirement_type === "Optional");
  assert.equal((await hr.post(`/pixels/${opt.pixel_id}/archive`, { reason_category: "No demand" })).status, 422);
  assert.equal((await hr.post(`/pixels/PX-R001-S057/archive`, { reason_category: "No demand", reason: "x" })).body.error, "already_archived");
  assert.equal((await hr.post(`/pixels/PX-R001-S001/restore`, {})).body.error, "not_archived");
  const emp = await T.as("employee@finedge.demo");
  assert.equal((await emp.post(`/pixels/${opt.pixel_id}/archive`, { reason_category: "No demand", reason: "x" })).status, 403);
});

test("V3-05 archiving a role's last active mapping returns 409 confirm_required and changes nothing", async () => {
  const hr = await T.as("hr@medicore.demo");
  await hr.patch("/org/settings", { archive_policy: { mandatory: false, openAssessments: false, all: false } });
  const skills = (await hr.get("/roles/R020/skills")).body.skills;
  for (const s of skills.slice(0, -1)) assert.equal((await hr.post(`/pixels/${s.pixel_id}/archive`, { reason_category: "No demand", reason: "setup" })).body.status, "archived");
  const last = skills[skills.length - 1].pixel_id;
  const r = await hr.post(`/pixels/${last}/archive`, { reason_category: "No demand", reason: "test" });
  assert.equal(r.status, 409); assert.equal(r.body.error, "confirm_required");
  assert.equal((await hr.get("/roles/R020/skills")).body.active_count, 1);
  const ok = await hr.post(`/pixels/${last}/archive`, { reason_category: "No demand", reason: "test", confirm: true });
  assert.equal(ok.body.status, "archived");
  await hr.patch("/org/settings", { archive_policy: { mandatory: true, openAssessments: true, all: false } });
});

test("V3-06 restoring PX-R031-S053 keeps the Pixel ID, sets Declining, Optional and a review flag", async () => {
  const hr = await T.as(HR_CN);
  const before = (await hr.get("/roles/R031/skills")).body.active_count;
  const r = await hr.post("/pixels/PX-R031-S053/restore", { note: "test" });
  assert.equal(r.body.status, "restored");
  assert.equal(r.body.mapping.pixel_id, "PX-R031-S053"); assert.equal(r.body.mapping.skill_trend, "Declining");
  assert.equal(r.body.mapping.requirement_type, "Optional"); assert.equal(r.body.mapping.review_flag, true);
  assert.equal((await hr.get("/roles/R031/skills")).body.active_count, before + 1);
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM archive_audit_log WHERE pixel_id = 'PX-R031-S053' AND action = 'restore'`))[0].n, 1);
});

test("V3-07 AngularJS archived in R005: profile keeps history, gaps exclude it, open activities are flagged", async () => {
  const hr = await T.as(HR_FE);
  const e = (await T.q(T.db, `SELECT id FROM employees WHERE role_id = 'R005' LIMIT 1`))[0];
  const prof = (await hr.get(`/employees/${e.id}`)).body;
  assert.equal(prof.additional.find((a: any) => a.skill_id === "S054").label, "Retired (kept as history)");
  assert.ok(!prof.gaps.some((g: any) => g.skill_id === "S054"));
  // an open activity for an active skill gets flagged when that skill is archived
  const pid = (await hr.get("/roles/R005/skills")).body.skills.find((s: any) => s.requirement_type === "Optional").pixel_id;
  const skill = pid.split("-")[2];
  const plan = (await hr.post(`/employees/${e.id}/plans/generate`, { skills: [{ skill_id: skill, target: 3 }] })).body.plan;
  await hr.post(`/pixels/${pid}/archive`, { reason_category: "Replaced by successor", reason: "test" });
  const acts = await T.q(T.db, `SELECT flag FROM development_activities WHERE plan_id = $1`, [plan.id]);
  assert.ok(acts.length && acts.every(a => a.flag));
});

test("Re-mapping an archived skill restores the same Pixel ID instead of creating a duplicate (7.8)", async () => {
  const hr = await T.as(HR_CN);
  const r = await hr.post("/roles/R033/skills", { skill_id: "S053", required_level: 2, requirement_type: "Optional", importance: "Low" });
  assert.equal(r.body.restored_existing, true); assert.equal(r.body.mapping.pixel_id, "PX-R033-S053");
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE role_id = 'R033' AND skill_id = 'S053'`))[0].n, 1);
});

test("Draft mappings are invisible to the framework, cannot be archived, and Published ones cannot be deleted", async () => {
  const hr = await T.as(HR_FE);
  const d = await hr.post("/roles/R001/skills", { skill_id: "S059", required_level: 2, requirement_type: "Preferred", importance: "Medium", skill_trend: "Emerging" });
  assert.equal(d.body.status, "draft");
  const fw = (await hr.get("/roles/R001/skills")).body;
  assert.ok(!fw.skills.some((s: any) => s.pixel_id === "PX-R001-S059")); assert.ok(fw.drafts.some((s: any) => s.pixel_id === "PX-R001-S059"));
  assert.equal((await hr.post("/pixels/PX-R001-S059/archive", { reason_category: "No demand", reason: "x" })).status, 422);
  assert.equal((await hr.del("/pixels/PX-R001-S001")).status, 405);
  const cr = await hr.post("/pixels/PX-R001-S059/submit");
  await hr.post(`/changes/${cr.body.id}/decide`, { decision: "approve" });
  assert.ok((await hr.get("/roles/R001/skills")).body.skills.some((s: any) => s.pixel_id === "PX-R001-S059"));
});

test("Tenant isolation: one company cannot read another company's roles, mappings or employees", async () => {
  const hr = await T.as(HR_FE);
  assert.equal((await hr.get("/roles/R031/skills")).status, 404);
  assert.equal((await hr.get("/pixels/PX-R031-S001")).status, 404);
  const other = (await T.q(T.db, `SELECT id FROM employees WHERE org_id = 'C003' LIMIT 1`))[0].id;
  assert.equal((await hr.get(`/employees/${other}`)).status, 404);
});

test("Employees read only their own role's framework; managers their team's roles", async () => {
  const emp = await T.as("employee@finedge.demo");
  const own = (await T.q(T.db, `SELECT role_id FROM employees WHERE id = $1`, [emp.user.employee_id]))[0].role_id;
  assert.equal((await emp.get(`/roles/${own}/skills`)).status, 200);
  const other = own === "R002" ? "R003" : "R002";
  assert.equal((await emp.get(`/roles/${other}/skills`)).status, 403);
  assert.equal((await emp.get(`/roles/R010/skills`)).status, 403);
});
