/* Sign-in security, learning suggestions and internal job postings. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });
const login = async (email: string, password: string, ip = "10.0.0.1") => {
  const { dispatch } = await import("../src/server/http/router");
  return dispatch("POST", "/auth/login", null, { body: { email, password }, meta: { ip } });
};

test("Sessions are server-side: logout and password changes end them", async () => {
  const { userFromToken } = await import("../src/server/auth");
  const { dispatch } = await import("../src/server/http/router");
  const a = await login("employee2@finedge.demo", "demo1234"); const b = await login("employee2@finedge.demo", "demo1234");
  const ua = await userFromToken(a.body.token); const ub = await userFromToken(b.body.token);
  assert.ok(ua?.session_id && ub?.session_id && ua.session_id !== ub.session_id);
  assert.equal((await userFromToken("garbage")), null);
  // weak and wrong passwords are refused
  assert.equal((await dispatch("POST", "/auth/password", ua, { body: { current: "demo1234", next: "short" } })).body.error, "weak_password");
  assert.equal((await dispatch("POST", "/auth/password", ua, { body: { current: "wrong", next: "longenough123" } })).body.error, "wrong_password");
  assert.equal((await dispatch("POST", "/auth/password", ua, { body: { current: "demo1234", next: "NewPassword2026" } })).status, 200);
  assert.ok(await userFromToken(a.body.token), "the session that changed the password stays");
  assert.equal(await userFromToken(b.body.token), null, "other sessions end");
  await dispatch("POST", "/auth/logout", ua);
  assert.equal(await userFromToken(a.body.token), null);
  assert.equal((await login("employee2@finedge.demo", "demo1234")).status, 401);
  assert.equal((await login("employee2@finedge.demo", "NewPassword2026")).status, 200);
});

test("Repeated wrong passwords lock the account; HR unlocks and resets", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login("manager.productoperations@finedge.demo", "bad", `10.1.0.${i}`)).status, 401);
  const locked = await login("manager.productoperations@finedge.demo", "demo1234", "10.1.0.9");
  assert.equal(locked.status, 429); assert.equal(locked.body.error, "account_locked");
  const hr = await T.as("hr@finedge.demo");
  const users = (await hr.get("/users?q=manager.productoperations")).body;
  assert.equal(users.length, 1); assert.equal(users[0].locked, true);
  assert.equal((await hr.post(`/users/${users[0].id}/unlock`)).status, 200);
  assert.equal((await login("manager.productoperations@finedge.demo", "demo1234")).status, 200);
  // reset: a temporary password that must be changed before anything else works
  const reset = await hr.post(`/users/${users[0].id}/reset-password`);
  assert.match(reset.body.temporary_password, /^[A-Za-z]{10}\d\d$/);
  const l = await login("manager.productoperations@finedge.demo", reset.body.temporary_password);
  assert.equal(l.body.must_change_password, true);
  const { userFromToken } = await import("../src/server/auth"); const { dispatch } = await import("../src/server/http/router");
  const u = await userFromToken(l.body.token);
  assert.equal((await dispatch("GET", "/roles", u)).body.error, "password_change_required");
  assert.equal((await dispatch("POST", "/auth/password", u, { body: { current: reset.body.temporary_password, next: "Manager2026x" } })).status, 200);
  const u2 = await userFromToken(l.body.token);
  assert.equal((await dispatch("GET", "/roles", u2)).status, 200);
  // tenant isolation and self-protection
  const other = await T.as("hr@cloudnova.demo");
  assert.equal((await other.post(`/users/${users[0].id}/reset-password`)).status, 404);
  assert.equal((await hr.patch(`/users/${hr.user.id}`, { active: false })).body.error, "own_account");
  assert.equal((await (await T.as("employee@finedge.demo")).get("/users")).status, 403);
});

test("Bad input gives a clear 4xx, never a server error", async () => {
  const hr = await T.as("hr@finedge.demo");
  const { dispatch } = await import("../src/server/http/router");
  assert.equal((await dispatch("POST", "/auth/login", null, { body: [1, 2] as any })).status, 400);
  assert.equal((await dispatch("POST", "/auth/login", null, { body: { email: "x".repeat(300) + "@a.b", password: "p" } })).status, 400);
  assert.equal((await hr.post("/ijp/jobs", { role_id: "R001", closes_on: "2026-02-31x" })).status, 400);
  assert.equal((await hr.post("/learning/resources", { skill_id: "S001", title: "Bad link", type: "Course", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await hr.get("/employees/%E0%A4%A")).status, 404);
});

test("Learning suggestions cover each gap and go into a plan without duplicates", async () => {
  const emp = await T.as("employee@finedge.demo");
  const r = await emp.get(`/employees/${emp.user.employee_id}/learning`);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length > 0);
  const it = r.body.items[0];
  assert.equal(it.search.length, 4); assert.ok(it.search[0].url.startsWith("https://"));
  assert.ok(it.steps.length >= 1); assert.ok(it.gap >= 1 || it.unassessed);
  const withRes = r.body.items.find((x: any) => x.resources.length);
  assert.ok(withRes, "the catalogue has something for at least one gap");
  const add = await emp.post(`/employees/${emp.user.employee_id}/learning/plan`, { items: [{ skill_id: withRes.skill_id, target_level: withRes.target, resource_id: withRes.resources[0].id }] });
  assert.equal(add.body.added, 1);
  const again = await emp.post(`/employees/${emp.user.employee_id}/learning/plan`, { items: [{ skill_id: withRes.skill_id, target_level: withRes.target, resource_id: withRes.resources[0].id }] });
  assert.equal(again.body.skipped, 1);
  const after = await emp.get(`/employees/${emp.user.employee_id}/learning`);
  assert.ok(after.body.items.find((x: any) => x.skill_id === withRes.skill_id).resources[0].in_plan);
  // another person's learning stays private
  assert.equal((await emp.get(`/employees/E1002/learning`)).status, 403);
  assert.equal((await (await T.as("employee@cloudnova.demo")).get(`/employees/${emp.user.employee_id}/learning`)).status, 404);
  // HR adds a company course; it appears first for that skill
  const hr = await T.as("hr@finedge.demo");
  const c = await hr.post("/learning/resources", { skill_id: withRes.skill_id, title: "FinEdge academy course", type: "Workshop", level_from: 0, level_to: 5, hours: 6, cost: "Company paid" });
  assert.equal(c.status, 200);
  const s = (await emp.get(`/employees/${emp.user.employee_id}/learning`)).body.items.find((x: any) => x.skill_id === withRes.skill_id);
  assert.equal(s.resources[0].company, true);
  assert.equal((await (await T.as("hr@cloudnova.demo")).patch(`/learning/resources/${c.body.id}`, { status: "Retired" })).status, 404);
  assert.equal((await emp.post("/learning/resources", { skill_id: "S001", title: "Mine", type: "Course" })).status, 403);
});

test("IJP: HR posts, employees see their match and apply, HR moves applicants through to hire", async () => {
  const hr = await T.as("hr@finedge.demo");
  const roles = (await hr.get("/roles")).body.filter((r: any) => r.status === "Published");
  const target = roles.find((r: any) => r.id !== "R001");
  const job = await hr.post("/ijp/jobs", { role_id: target.id, location: "Pune", work_mode: "Hybrid", openings: 1, description: "Join the team", closes_on: "2099-01-01" });
  assert.equal(job.status, 200); assert.match(job.body.id, /^IJ\d{5}$/);
  const emp = await T.as("employee@finedge.demo");
  const list = (await emp.get("/ijp/jobs")).body;
  const mine = list.find((j: any) => j.id === job.body.id);
  assert.ok(mine && typeof mine.match_pct === "number" && mine.match_pct >= 0 && mine.match_pct <= 100);
  assert.equal(mine.applicants, undefined, "employees do not see applicant counts");
  const detail = (await emp.get(`/ijp/jobs/${job.body.id}`)).body;
  assert.ok(detail.match.lines.length > 0); assert.equal(detail.can_apply, true);
  const ap = await emp.post(`/ijp/jobs/${job.body.id}/apply`, { note: "Keen to grow" });
  assert.equal(ap.status, 200); assert.equal(ap.body.status, "Applied");
  assert.equal((await emp.post(`/ijp/jobs/${job.body.id}/apply`, {})).status, 409);
  assert.equal((await emp.get("/ijp/applications/mine")).body.filter((a: any) => a.job_id === job.body.id).length, 1);
  // withdraw and apply again
  assert.equal((await emp.post(`/ijp/applications/${ap.body.id}/withdraw`)).body.status, "Withdrawn");
  const ap2 = await emp.post(`/ijp/jobs/${job.body.id}/apply`, {});
  assert.equal(ap2.status, 200);
  // the pipeline
  const apps = (await hr.get(`/ijp/jobs/${job.body.id}/applications`)).body;
  assert.equal(apps.filter((a: any) => a.status !== "Withdrawn").length, 1); assert.ok("match_now" in apps[0]);
  assert.equal((await hr.post(`/ijp/applications/${ap2.body.id}/status`, { status: "Hired" })).body.error, "bad_transition");
  for (const s of ["Interview", "Offered"]) assert.equal((await hr.post(`/ijp/applications/${ap2.body.id}/status`, { status: s })).status, 200);
  assert.equal((await emp.post(`/ijp/applications/${ap2.body.id}/status`, { status: "Hired" })).status, 404, "applicants cannot move themselves");
  const hired = await hr.post(`/ijp/applications/${ap2.body.id}/status`, { status: "Hired", note: "Welcome" });
  assert.equal(hired.body.job_closed, true, "filling the last opening closes the job");
  assert.equal((await emp.post(`/ijp/applications/${ap2.body.id}/withdraw`)).body.error, "final");
  assert.ok(!(await emp.get("/ijp/jobs")).body.find((j: any) => j.id === job.body.id));
});

test("IJP rules: own role, minimum match, other tenants, department heads, drafts", async () => {
  const hr = await T.as("hr@finedge.demo");
  const emp = await T.as("employee@finedge.demo");
  const own = await hr.post("/ijp/jobs", { role_id: "R001" });
  assert.equal((await emp.post(`/ijp/jobs/${own.body.id}/apply`, {})).body.error, "current_role");
  const roles = (await hr.get("/roles")).body.filter((r: any) => r.status === "Published" && r.id !== "R001");
  const hard = await hr.post("/ijp/jobs", { role_id: roles[roles.length - 1].id, min_match: 100 });
  const d = (await emp.get(`/ijp/jobs/${hard.body.id}`)).body;
  if (d.match.match_pct < 100) { assert.equal(d.can_apply, false); assert.equal((await emp.post(`/ijp/jobs/${hard.body.id}/apply`, {})).body.error, "below_min_match"); }
  assert.equal((await (await T.as("employee@cloudnova.demo")).get(`/ijp/jobs/${hard.body.id}`)).status, 404);
  assert.equal((await (await T.as("hr@cloudnova.demo")).patch(`/ijp/jobs/${hard.body.id}`, { status: "Closed" })).status, 404);
  // a department head posts only for their own department
  const head = await T.as("head.riskcompliance@finedge.demo");
  const otherDept = roles.find((r: any) => r.department_id !== head.user.department_id);
  assert.equal((await head.post("/ijp/jobs", { role_id: otherDept.id })).status, 403);
  assert.equal((await head.patch(`/ijp/jobs/${hard.body.id}`, { status: "Closed" })).status, hard.body.department_id === head.user.department_id ? 200 : 403);
  // drafts are invisible to employees; past closing dates are refused
  const draft = await hr.post("/ijp/jobs", { role_id: roles[0].id, status: "Draft" });
  assert.equal((await emp.get(`/ijp/jobs/${draft.body.id}`)).status, 404);
  assert.equal((await hr.post("/ijp/jobs", { role_id: roles[0].id, closes_on: "2020-01-01" })).body.error, "closes_in_past");
  assert.equal((await emp.post("/ijp/jobs", { role_id: roles[0].id })).status, 403);
});

test("IJP upload: preview checks every row, commit creates the valid postings", async () => {
  const hr = await T.as("hr@finedge.demo");
  const roles = (await hr.get("/roles")).body.filter((r: any) => r.status === "Published");
  const csv = ["role,title,location,work_mode,openings,min_match,closes_on,status",
    `${roles[0].title},Opening A,Pune,Hybrid,2,40,2099-05-01,Open`,
    `${roles[1].id},,Remote city,wfh,1,,15/06/2099,Draft`,
    `Underwater Basket Weaver,,,,1,,,`,
    `${roles[0].title},Bad,,Spaceship,0,140,2020-01-01,Maybe`].join("\n");
  const p = await hr.post("/ijp/upload/preview", { text: csv, filename: "jobs.csv" });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.summary, { create: 2, error: 2 });
  assert.equal(p.body.rows[1].data.work_mode, "Remote"); assert.equal(p.body.rows[1].data.closes_on, "2099-06-15");
  assert.ok(p.body.rows[3].messages.length >= 4);
  assert.equal((await (await T.as("hr@cloudnova.demo")).post(`/ijp/upload/${p.body.id}/commit`)).status, 404);
  const c = await hr.post(`/ijp/upload/${p.body.id}/commit`);
  assert.equal(c.body.created, 2);
  assert.equal((await hr.post(`/ijp/upload/${p.body.id}/commit`)).status, 409, "a preview is applied once");
  const list = (await hr.get("/ijp/jobs?view=manage")).body;
  assert.ok(list.find((j: any) => j.title === "Opening A" && j.openings === 2));
  assert.equal((await (await T.as("employee@finedge.demo")).post("/ijp/upload/preview", { text: csv })).status, 403);
});

test("Framework upload fills in levels, types, families and new skills; approval links waiting skills", async () => {
  const admin = await T.as("admin@platform.demo");
  const csv = ["role,skill,required_level,requirement_type,industry",
    "Senior Data Engineer,Python,,,Cross-industry",
    "Senior Data Engineer,k8s,4,Mandatory,Cross-industry",
    "Senior Data Engineer,Quantum Widget Tuning,,,Cross-industry",
    "Junior QA Engineer,SQL,,,",
    "Junior QA Engineer,SQL,,,",
    "Bad Row,Python,9,,"].join("\n");
  const p = await admin.post("/framework-upload/preview", { text: csv, filename: "fw.csv" });
  assert.equal(p.status, 200);
  assert.equal(p.body.summary.templates, 2); assert.equal(p.body.errors.length, 1);
  const sde = p.body.templates.find((t: any) => t.title === "Senior Data Engineer");
  assert.equal(sde.job_family, "Data Engineer");
  const py = sde.lines.find((l: any) => l.skill === "Python");
  assert.ok(py.level >= 2 && py.level_from.includes("seniority"));
  assert.equal(sde.lines.find((l: any) => l.matched_as === "k8s").skill, "Kubernetes");
  const nw = p.body.new_skills.find((n: any) => n.name === "Quantum Widget Tuning");
  assert.ok(nw.category && /Review this definition/.test(nw.definition));
  const qa = p.body.templates.find((t: any) => t.title === "Junior QA Engineer");
  assert.equal(qa.lines.length, 1); assert.ok(qa.notes[0].includes("twice"));
  assert.equal((await (await T.as("hr@finedge.demo")).post("/framework-upload/preview", { text: csv })).status, 403);
  const c = await admin.post(`/framework-upload/${p.body.id}/commit`);
  assert.equal(c.status, 200);
  assert.equal(c.body.applied.templates_created, 2);
  assert.equal(c.body.applied.skills_proposed, 1, "two-step approval: the new skill is proposed");
  assert.equal(c.body.applied.requirements_waiting_for_approval, 1);
  const t = await T.one(T.db, `SELECT skills, pending_skills FROM role_templates WHERE title = 'Senior Data Engineer'`);
  assert.equal(t.pending_skills.length, 1); assert.equal(t.skills.length, 2);
  // a second person approves; the template picks the skill up
  const rev = await T.as("expert@finedge.demo");
  const ok = await rev.post("/library/proposals/decide", { terms: ["quantum widget tuning"], decision: "approve" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const t2 = await T.one(T.db, `SELECT skills, pending_skills FROM role_templates WHERE title = 'Senior Data Engineer'`);
  assert.equal(t2.pending_skills.length, 0); assert.equal(t2.skills.length, 3);
  // uploading again updates instead of duplicating
  const p2 = await admin.post("/framework-upload/preview", { text: "role,skill,industry\nSenior Data Engineer,SQL,Cross-industry", filename: "fw2.csv" });
  assert.equal(p2.body.templates[0].action, "update");
});
