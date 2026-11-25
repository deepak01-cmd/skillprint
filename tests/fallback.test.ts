/* Role fallback: no role title is missed. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { normalizeTitle } from "../src/server/modules/roleFallback";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("Titles are normalised: abbreviations and punctuation are ignored, and the level word is kept apart", () => {
  assert.equal(normalizeTitle("Sr. Backend Dev").core, "backend developer");
  assert.equal(normalizeTitle("Sr. Backend Dev").seniority, "senior");
  assert.equal(normalizeTitle("Front-End Developer II").core, "frontend developer");
  assert.equal(normalizeTitle("BI Analyst (Contract)").core, "business intelligence analyst");
});

test("Exact and normalised titles match automatically; unknown titles get suggestions", async () => {
  const hr = await T.as("hr@finedge.demo");
  const a = (await hr.get("/roles/resolve?title=Backend Developer")).body;
  assert.equal(a.status, "matched"); assert.equal(a.role.id, "R004"); assert.equal(a.method, "exact");
  const b = (await hr.get("/roles/resolve?title=Back-end Dev")).body;
  assert.equal(b.status, "matched"); assert.equal(b.role.id, "R004"); assert.equal(b.method, "normalized"); assert.ok(b.note.includes("Backend Developer"));
  const sr = (await hr.get("/roles/resolve?title=Sr. Backend Dev")).body;
  assert.equal(sr.status, "unresolved", "a senior title is never matched to the mid-level role");
  const c = (await hr.get("/roles/resolve?title=Python Data Scientist")).body;
  assert.equal(c.status, "unresolved");
  assert.ok(c.inferred_skills.some((s: any) => s.skill_id === "S002"), "Python inferred from the title");
  const d = (await hr.get("/roles/resolve?title=Reporting Analyst")).body;
  assert.ok(d.templates.some((t: any) => t.title === "Data Analyst"), "template alias suggests Data Analyst");
});

test("Employee import: matched rows import, unknown titles wait in the queue with their people; nothing is dropped", async () => {
  const hr = await T.as("hr@finedge.demo");
  const csv = "Employee ID,Name,Email,Department,Role\n" +
    "E1,Asha One,asha.one@x.com,Technology & Engineering,Back-end Dev\n" +
    "E2,Ben Two,ben.two@x.com,Data & Analytics,Reporting Analyst\n" +
    "E3,Cy Three,cy.three@x.com,Data & Analytics,Reporting Analyst\n" +
    "E4,Di Four,di.four@x.com,Data & Analytics,Quant Researcher";
  const dry = (await hr.post("/employees/import", { csv, dry_run: true })).body;
  assert.equal(dry.imported, 0); assert.equal(dry.auto_matched.length, 1); assert.equal(dry.to_queue.length, 3);
  const r = (await hr.post("/employees/import", { csv })).body;
  assert.equal(r.imported, 1); assert.equal(r.queued, 3); assert.equal(r.queue_items.length, 2, "same title grouped into one queue item");
  const q = (await hr.get("/role-queue?status=Open")).body;
  const rep = q.find((x: any) => x.raw_title === "Reporting Analyst");
  assert.equal(rep.pending, 2); assert.equal(rep.occurrences, 2);
  const dash = (await hr.get("/dashboard")).body;
  assert.ok(dash.unresolved_roles >= 2, "dashboard shows unresolved titles");
});

test("Resolving by mapping to an existing role creates the waiting people and learns the title as an alias", async () => {
  const hr = await T.as("hr@finedge.demo");
  const item = (await hr.get("/role-queue?status=Open")).body.find((x: any) => x.raw_title === "Reporting Analyst");
  const r = (await hr.post(`/role-queue/${item.id}/resolve`, { action: "map", role_id: "R002", add_alias: true })).body;
  assert.equal(r.status, "Resolved"); assert.equal(r.employees_created, 2);
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM employees WHERE email IN ('ben.two@x.com','cy.three@x.com') AND role_id = 'R002'`))[0].n, 2);
  const again = (await hr.get("/roles/resolve?title=Reporting Analyst")).body;
  assert.equal(again.status, "matched"); assert.equal(again.role.id, "R002");
});

test("Resolving from a template drafts a role; its people are created when the role is published", async () => {
  const hr = await T.as("hr@finedge.demo");
  const item = (await hr.get("/role-queue?status=Open")).body.find((x: any) => x.raw_title === "Quant Researcher");
  const tpl = (await hr.get("/role-templates?q=data analyst")).body[0];
  const dept = (await hr.get("/org")).body.departments.find((d: any) => d.name === "Data & Analytics").id;
  const r = (await hr.post(`/role-queue/${item.id}/resolve`, { action: "template", template_id: tpl.id, title: "Quantitative Researcher", department_id: dept })).body;
  assert.equal(r.status, "Role drafted");
  assert.equal((await T.q(T.db, `SELECT count(*)::int AS n FROM employees WHERE email = 'di.four@x.com'`))[0].n, 0, "not created before publish");
  const fw = (await hr.get(`/roles/${r.role_id}/skills`)).body;
  assert.ok(fw.drafts.length > 3, "template skills drafted");
  const cr = (await hr.post(`/roles/${r.role_id}/submit`)).body;
  await hr.post(`/changes/${cr.id}/decide`, { decision: "approve" });
  assert.equal((await T.q(T.db, `SELECT role_id FROM employees WHERE email = 'di.four@x.com'`))[0].role_id, r.role_id);
  assert.equal((await T.q(T.db, `SELECT status FROM role_resolution_queue WHERE id = $1`, [item.id]))[0].status, "Resolved");
  assert.ok((await hr.get(`/roles/resolve?title=Quant Researcher`)).body.status === "matched", "raw title kept as an alternative title");
});

test("Add-employee form with an unknown title queues the person instead of failing", async () => {
  const hr = await T.as("hr@finedge.demo");
  const dept = (await hr.get("/org")).body.departments.find((d: any) => d.name === "Risk & Compliance").id;
  const r = (await hr.post("/employees", { name: "Eve Five", email: "eve.five@x.com", department_id: dept, role_title: "Model Validation Specialist" })).body;
  assert.equal(r.status, "queued"); assert.ok(r.queue_id);
  const ok = (await hr.post("/employees", { name: "Fay Six", email: "fay.six@x.com", department_id: dept, role_title: "aml analyst" })).body;
  assert.equal(ok.status, "created"); assert.equal(ok.role_id, "R008");
});

test("Search and job-description import surface the fallback; department heads only resolve their own department", async () => {
  const hr = await T.as("hr@finedge.demo");
  const s = (await hr.get("/search?q=Model Validation Specialist")).body;
  assert.equal(s.roles.length, 0); assert.ok(s.role_fallback);
  const jd = (await hr.post("/roles/parse-description", { text: "Title: Back-end Developer\nResponsibilities:\n- Build REST APIs in Java\n- Write SQL" })).body;
  assert.equal(jd.role_match.status, "matched"); assert.equal(jd.role_match.role.id, "R004");
  const head = await T.as("head.dataanalytics@finedge.demo");
  const item = (await hr.get("/role-queue?status=Open")).body.find((x: any) => x.raw_title === "Model Validation Specialist");
  assert.equal((await head.post(`/role-queue/${item.id}/resolve`, { action: "map", role_id: "R009" })).status, 403);
  assert.equal((await head.get("/role-queue")).body.some((x: any) => x.id === item.id), false);
});
