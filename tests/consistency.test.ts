/* The same figure must be the same on every screen that shows it, and IDs must never clash. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("HR dashboard figures equal the lists and pages they summarise", async () => {
  const hr = await T.as("hr@finedge.demo");
  const d = (await hr.get("/dashboard")).body;
  const emps = (await hr.get("/employees")).body;
  assert.equal(d.employees, emps.length, "employees");
  const g = (await hr.get("/gaps")).body;
  assert.equal(d.open_gaps, g.skills.reduce((a: number, s: any) => a + (s.with_gap || 0), 0), "open gaps = gaps page");
  assert.equal(d.high_priority_gaps, g.skills.reduce((a: number, s: any) => a + (s.high_priority || 0), 0), "high-priority gaps");
  assert.equal(d.missing_assessments, g.skills.reduce((a: number, s: any) => a + (s.no_data || 0), 0), "not assessed");
  const roles = (await hr.get("/roles")).body;
  assert.equal(d.roles_published, roles.filter((r: any) => r.status === "Published").length, "published roles");
  const fw = (await hr.get("/framework")).body;
  assert.equal(d.mappings_active, fw.count, "active mappings = framework explorer");
  assert.equal(fw.count, roles.reduce((a: number, r: any) => a + r.active_skills, 0), "framework = sum of role skill counts");
  for (const r of roles.filter((r: any) => r.status === "Published").slice(0, 4))
    assert.equal((await hr.get(`/roles/${r.id}/skills`)).body.active_count, r.active_skills, `role ${r.id} skills`);
  // the skill-gaps report has one row per person and required skill
  const rep = await hr.get("/reports/skill_gaps/download?format=csv");
  const lines = rep.body.__file.data.toString("utf8").trim().split(/\r?\n/).length - 1;
  const reqs = await T.one(T.db, `SELECT count(*)::int AS n FROM employees e JOIN v_framework v ON v.role_id = e.role_id WHERE e.org_id = 'C001' AND e.status = 'Active'`);
  assert.equal(lines, reqs.n, "report rows");
});

test("Department heads see one department everywhere on their dashboard", async () => {
  const head = await T.as("head.dataanalytics@finedge.demo");
  const d = (await head.get("/dashboard")).body;
  const fw = await T.one(T.db, `SELECT count(*)::int AS n FROM v_framework v JOIN job_roles r ON r.id = v.role_id WHERE r.department_id = $1`, [head.user.department_id]);
  assert.equal(d.mappings_active, fw.n);
  const trendTotal = d.trends_by_industry.reduce((a: number, t: any) => a + t.n, 0);
  assert.equal(trendTotal, d.mappings_active, "trend chart total = active mappings");
  const emps = (await head.get("/employees")).body;
  assert.equal(d.employees, emps.length);
});

test("One match percentage per person and role, wherever it is shown", async () => {
  const hr = await T.as("hr@finedge.demo"); const emp = await T.as("employee@finedge.demo");
  const me = (await emp.get("/dashboard")).body.me;
  const prof = (await emp.get(`/employees/${emp.user.employee_id}`)).body;
  assert.equal(me.match_pct, prof.match.match_pct, "dashboard = profile");
  assert.equal(me.met, prof.match.skills_met); assert.equal(me.required, prof.match.skills_required);
  assert.equal(me.met, prof.gaps.filter((g: any) => g.status === "Met").length);
  // the same role through an internal posting and through succession
  const role = prof.employee.role_id;
  const job = await hr.post("/ijp/jobs", { role_id: role, title: "Consistency check", location: "Test" });
  const seen = (await emp.get(`/ijp/jobs/${job.body.id}`)).body.match;
  assert.equal(seen.match_pct, me.match_pct, "internal job = dashboard");
  const plan = await hr.post("/succession", { role_id: role });
  const sp = (await hr.get(`/succession/${plan.body.id}`)).body;
  assert.equal(sp.incumbents.find((i: any) => i.employee_id === emp.user.employee_id).match, me.match_pct, "succession = dashboard");
  // learning lists every gap and every unassessed requirement
  const learn = (await emp.get(`/employees/${emp.user.employee_id}/learning`)).body.items;
  assert.equal(learn.length, me.gaps + me.no_data);
});

test("Applicant counts agree between the job list, the posting and the pipeline", async () => {
  const hr = await T.as("hr@finedge.demo");
  const roles = (await hr.get("/roles")).body.filter((r: any) => r.status === "Published" && r.id !== "R001");
  const job = await hr.post("/ijp/jobs", { role_id: roles[0].id, title: "Count check", location: "X" });
  for (const who of ["employee@finedge.demo", "employee2@finedge.demo"]) { const u = await T.as(who); if (u.user.employee_id) await u.post(`/ijp/jobs/${job.body.id}/apply`, {}); }
  const e2 = await T.as("employee2@finedge.demo");
  const mine = (await e2.get("/ijp/applications/mine")).body.find((a: any) => a.job_id === job.body.id);
  if (mine) await e2.post(`/ijp/applications/${mine.id}/withdraw`);
  const list = (await hr.get("/ijp/jobs?view=manage")).body.find((j: any) => j.id === job.body.id);
  const apps = (await hr.get(`/ijp/jobs/${job.body.id}/applications`)).body;
  const det = (await hr.get(`/ijp/jobs/${job.body.id}`)).body;
  const active = apps.filter((a: any) => a.status !== "Withdrawn").length;
  assert.equal(list.applicants, active);
  assert.equal(det.counts.filter((c: any) => c.status !== "Withdrawn").reduce((a: number, c: any) => a + c.n, 0), active);
  // a duplicate posting is refused
  assert.equal((await hr.post("/ijp/jobs", { role_id: roles[0].id, title: "Count check", location: "x" })).body.error, "duplicate_posting");
});

test("Platform totals add up across organisations and industries", async () => {
  const admin = await T.as("admin@platform.demo");
  const d = (await admin.get("/dashboard")).body;
  assert.equal(d.by_company.reduce((a: number, c: any) => a + c.active, 0), d.reconciliation.active_mappings);
  assert.equal(d.trends_by_industry.reduce((a: number, c: any) => a + c.active, 0), d.reconciliation.active_mappings);
  for (const c of d.by_company) assert.equal(Object.values(c.trends as Record<string, number>).reduce((a, n) => a + n, 0), c.active, `${c.name} trend mix`);
});

test("System IDs never clash with stored IDs; company employee numbers are kept separately", async () => {
  // generated IDs stay ahead of the highest stored ID, even for rows loaded with fixed IDs
  await T.q(T.db, `INSERT INTO departments (id, org_id, name) VALUES ('D950', 'C001', 'Fixed ID dept')`);
  await T.q(T.db, `SELECT sync_id_sequences()`);
  const d = await T.one(T.db, `INSERT INTO departments (org_id, name) VALUES ('C001', 'Generated dept') RETURNING id`);
  assert.ok(Number(d.id.slice(1)) > 950, d.id);
  // employee numbers from the company: stored as given, unique per organisation, never the system ID
  const hr = await T.as("hr@finedge.demo");
  const csv = ["employee_id,name,email,department,role", "FIN-0042,Kiran Iyer,kiran.iyer@example.com,Data & Analytics,Financial Data Analyst",
    "FIN-0042,Someone Else,someone.else@example.com,Data & Analytics,Financial Data Analyst"].join("\n");
  const p = await hr.post("/imports/preview", { entity: "employees", text: csv, filename: "e.csv", mode: "publish" });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.rows[0].action, "error"); assert.match(p.body.rows[0].messages.join(" "), /also used by/);
  const p2 = await hr.post("/imports/preview", { entity: "employees", text: csv.split("\n").slice(0, 2).join("\n"), filename: "e.csv", mode: "publish" });
  assert.equal(p2.body.rows[0].action, "create");
  assert.equal((await hr.post(`/imports/${p2.body.id}/commit`)).status, 200);
  const e = await T.one(T.db, `SELECT id, employee_code FROM employees WHERE email = 'kiran.iyer@example.com'`);
  assert.equal(e.employee_code, "FIN-0042"); assert.match(e.id, /^E\d+$/);
  // the same number in another organisation is fine; in the same organisation it is refused
  const other = await T.as("hr@cloudnova.demo");
  const od = (await other.get("/org")).body; const orole = (await other.get("/roles")).body.find((r: any) => r.status === "Published");
  assert.equal((await other.post("/employees", { name: "Other Kiran", email: "kiran2@example.com", department_id: orole.department_id, role_id: orole.id, employee_code: "FIN-0042" })).status, 200, JSON.stringify(od).slice(0, 10));
  const role = (await hr.get("/roles")).body.find((r: any) => r.status === "Published");
  assert.equal((await hr.post("/employees", { name: "Dup Code", email: "dup.code@example.com", department_id: role.department_id, role_id: role.id, employee_code: "fin-0042" })).body.error, "employee_code_taken");
  assert.equal((await hr.post("/employees", { name: "Weak Pw", email: "weak.pw@example.com", department_id: role.department_id, role_id: role.id, login_password: "short1" })).body.error, "weak_password");
});
