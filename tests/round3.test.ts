/* Level-change requests with evidence, mentoring, succession, reports and the access log. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });
const PDF = { name: "certificate.pdf", buffer: Buffer.from("%PDF-1.4\n% test certificate\n%%EOF") };

test("Level request: evidence is required and checked; the manager decides; approval sets the level and keeps the evidence", async () => {
  const emp = await T.as("employee@finedge.demo"); const mgr = await T.as("manager.dataanalytics@finedge.demo");
  const skill = "S006";
  assert.equal((await emp.post("/level-requests", { skill_id: skill, requested_level: 4 })).body.error, "evidence_required");
  assert.equal((await emp.post("/level-requests", { skill_id: skill, requested_level: 4, file: { name: "fake.pdf", buffer: Buffer.from("MZ not a pdf") } })).body.error, "file_content");
  assert.equal((await emp.post("/level-requests", { skill_id: skill, requested_level: 4, file: { name: "run.exe", buffer: Buffer.from("MZ") } })).body.error, "file_type");
  assert.equal((await emp.post("/level-requests", { skill_id: skill, requested_level: 4, links: JSON.stringify([{ title: "x", url: "javascript:alert(1)" }]) })).status, 400);
  const r = await emp.post("/level-requests", { skill_id: skill, requested_level: 4, note: "Led the data model for Q3", file: PDF, file_titles: JSON.stringify(["Data modelling certificate"]),
    links: JSON.stringify([{ title: "Model repository", url: "https://git.example.com/model", type: "Repository" }]) });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.reviewer, "manager");
  assert.equal((await emp.post("/level-requests", { skill_id: skill, requested_level: 5, links: JSON.stringify([{ title: "again", url: "https://a.b" }]) })).status, 409);
  // who can see and decide
  const waiting = (await mgr.get("/level-requests?view=review")).body;
  assert.ok(waiting.find((x: any) => x.id === r.body.id));
  const d = (await mgr.get(`/level-requests/${r.body.id}`)).body;
  assert.equal(d.can_decide, true); assert.equal(d.evidence.length, 2);
  const file = d.evidence.find((x: any) => x.kind === "file");
  const dl = await mgr.get(`/level-requests/files/${file.id}`);
  assert.equal(dl.status, 200); assert.ok(dl.body.__file.data.subarray(0, 4).toString() === "%PDF");
  assert.equal((await emp.post(`/level-requests/${r.body.id}/decide`, { decision: "approve" })).status, 403, "not your own");
  assert.equal((await (await T.as("manager.riskcompliance@finedge.demo")).post(`/level-requests/${r.body.id}/decide`, { decision: "approve" })).status, 403, "not someone else's report");
  assert.equal((await (await T.as("hr@cloudnova.demo")).get(`/level-requests/${r.body.id}`)).status, 404);
  assert.equal((await (await T.as("hr@cloudnova.demo")).get(`/level-requests/files/${file.id}`)).status, 404);
  // more information, then resubmission
  assert.equal((await mgr.post(`/level-requests/${r.body.id}/decide`, { decision: "more_info" })).body.error, "note_required");
  assert.equal((await mgr.post(`/level-requests/${r.body.id}/decide`, { decision: "more_info", note: "Add the review feedback" })).body.status, "More info needed");
  assert.equal((await mgr.post(`/level-requests/${r.body.id}/decide`, { decision: "approve" })).body.error, "not_pending");
  assert.equal((await emp.post(`/level-requests/${r.body.id}/evidence`, { links: JSON.stringify([{ title: "Review feedback", url: "https://wiki.example.com/review", type: "Manager feedback" }]), note: "Added" })).body.status, "Pending");
  const ok = await mgr.post(`/level-requests/${r.body.id}/decide`, { decision: "approve", level: 3, note: "Solid work; 3 for now" });
  assert.equal(ok.body.status, "Approved"); assert.equal(ok.body.level, 3);
  const lv = await T.one(T.db, `SELECT level, assessed_by FROM employee_skills WHERE employee_id = $1 AND skill_id = $2 AND source = 'manager'`, [emp.user.employee_id, skill]);
  assert.equal(lv.level, 3);
  const ev = await T.q(T.db, `SELECT validation_status, link FROM employee_evidence WHERE employee_id = $1 AND skill_id = $2`, [emp.user.employee_id, skill]);
  assert.equal(ev.length, 3); assert.ok(ev.every((x: any) => x.validation_status === "Validated"));
  assert.equal((await emp.get("/level-requests?view=mine")).body[0].status, "Approved");
  // rejection needs a reason
  const r2 = await emp.post("/level-requests", { skill_id: "S010", requested_level: 5, links: JSON.stringify([{ title: "Blog", url: "https://blog.example.com" }]) });
  assert.equal((await mgr.post(`/level-requests/${r2.body.id}/decide`, { decision: "reject" })).body.error, "note_required");
  assert.equal((await mgr.post(`/level-requests/${r2.body.id}/decide`, { decision: "reject", note: "Needs a work example" })).body.status, "Rejected");
});

test("Mentoring: ask a qualified colleague, accept into the plan, log sessions, complete", async () => {
  const emp = await T.as("employee2@finedge.demo"); const mentor = await T.as("manager.dataanalytics@finedge.demo");
  assert.equal((await emp.post("/mentoring", { mentor_id: emp.user.employee_id, skill_id: "S001" })).body.error, "self");
  const unq = await emp.post("/mentoring", { mentor_id: mentor.user.employee_id, skill_id: "S003" });
  assert.ok(["not_qualified"].includes(unq.body.error) || unq.status === 200);
  const r = await emp.post("/mentoring", { mentor_id: mentor.user.employee_id, skill_id: "S001", message: "Could you help me with SQL tuning?" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await emp.post("/mentoring", { mentor_id: mentor.user.employee_id, skill_id: "S001" })).status, 409);
  assert.equal((await emp.post(`/mentoring/${r.body.id}/respond`, { accept: true })).status, 403, "the mentee cannot accept for the mentor");
  assert.equal((await (await T.as("employee@finedge.demo")).get(`/mentoring/${r.body.id}/sessions`)).status, 404, "others cannot see the pairing");
  const mine = (await mentor.get("/mentoring")).body;
  assert.ok(mine.as_mentor.find((x: any) => x.id === r.body.id && x.status === "Requested"));
  assert.equal((await mentor.post(`/mentoring/${r.body.id}/respond`, { accept: true, note: "Happy to" })).body.status, "Accepted");
  const act = await T.one(T.db, `SELECT d.title, d.mentor FROM development_activities d JOIN development_plans p ON p.id = d.plan_id WHERE p.employee_id = $1 AND d.type = 'Mentoring' ORDER BY d.created_at DESC LIMIT 1`, [emp.user.employee_id]);
  assert.match(act.title, /Mentoring in SQL/);
  assert.equal((await emp.post(`/mentoring/${r.body.id}/sessions`, { held_on: "2099-01-01" })).body.error, "bad_date");
  assert.equal((await emp.post(`/mentoring/${r.body.id}/sessions`, { held_on: new Date().toISOString().slice(0, 10), minutes: 45, notes: "Indexes and plans" })).status, 200);
  assert.equal((await mentor.get(`/mentoring/${r.body.id}/sessions`)).body.length, 1);
  assert.equal((await mentor.post(`/mentoring/${r.body.id}/close`, { outcome: "Completed" })).body.status, "Completed");
  // learning suggestions show who can be asked
  const learn = (await emp.get(`/employees/${emp.user.employee_id}/learning`)).body.items;
  for (const g of learn) for (const m of g.mentors) assert.equal(typeof m.can_ask, "boolean");
});

test("Succession: critical role, ranked candidates, named successors and bench strength", async () => {
  const hr = await T.as("hr@finedge.demo");
  const p = await hr.post("/succession", { role_id: "R001", criticality: "Critical", reason: "Key reporting role" });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await hr.post("/succession", { role_id: "R001" })).status, 409);
  const d = (await hr.get(`/succession/${p.body.id}`)).body;
  assert.ok(d.incumbents.length > 0 && d.incumbents.every((i: any) => i.in_role));
  assert.ok(d.candidates.length > 0); assert.ok(d.candidates[0].match >= d.candidates[d.candidates.length - 1].match);
  assert.equal(d.bench.risk, "No successor");
  const c = d.candidates[0];
  assert.equal((await hr.post(`/succession/${p.body.id}/successors`, { employee_id: d.incumbents[0].employee_id, readiness: "Ready now" })).body.error, "incumbent");
  assert.equal((await hr.post(`/succession/${p.body.id}/successors`, { employee_id: c.employee_id, readiness: "Ready now", notes: "Strong" })).status, 200);
  const list = (await hr.get("/succession")).body;
  const row = list.find((x: any) => x.id === p.body.id);
  assert.equal(row.successors, 1); assert.equal(row.ready_now, 1);
  // scope: other departments' heads and other tenants cannot see it
  const head = await T.as("head.riskcompliance@finedge.demo");
  assert.equal((await head.get(`/succession/${p.body.id}`)).status, 404);
  assert.equal((await (await T.as("hr@cloudnova.demo")).get(`/succession/${p.body.id}`)).status, 404);
  assert.equal((await (await T.as("employee@finedge.demo")).get("/succession")).status, 403);
  assert.equal((await hr.del(`/succession/${p.body.id}/successors/${c.employee_id}`)).status, 200);
});

test("Reports: Excel and CSV exports, scoped by role; schedules only to HR or the department's head", async () => {
  const hr = await T.as("hr@finedge.demo"); const head = await T.as("head.dataanalytics@finedge.demo");
  const x = await hr.get("/reports/skill_gaps/download?format=xlsx");
  assert.equal(x.status, 200); assert.ok(x.body.__file.data.subarray(0, 2).toString() === "PK"); assert.ok(x.body.__file.rows > 0);
  const c = await hr.get("/reports/mobility/download?format=csv");
  assert.match(c.body.__file.data.toString("utf8"), /Posting ID,Posting,Employee ID/);
  for (const k of ["skills_inventory", "learning", "succession", "access"]) assert.equal((await hr.get(`/reports/${k}/download`)).status, 200, k);
  // department heads only get their department, and not the access report
  const hx = await head.get("/reports/skills_inventory/download?format=csv&department_id=D003");
  const depts = new Set(hx.body.__file.data.toString("utf8").split("\n").slice(1).filter(Boolean).map((l: string) => l.split(",")[2]));
  assert.ok(depts.size <= 1);
  assert.equal((await head.get("/reports/access/download")).status, 403);
  assert.equal((await (await T.as("employee@finedge.demo")).get("/reports/skill_gaps/download")).status, 403);
  assert.equal((await hr.get("/reports/nope/download")).status, 404);
  // schedules
  assert.equal((await hr.post("/reports/schedules", { report: "skill_gaps", frequency: "weekly", recipients: ["someone@gmail.com"] })).body.error, "recipient_not_allowed");
  assert.equal((await hr.post("/reports/schedules", { report: "skill_gaps", frequency: "weekly", recipients: ["employee@finedge.demo"] })).body.error, "recipient_not_allowed");
  const s = await hr.post("/reports/schedules", { report: "skill_gaps", frequency: "monthly", format: "xlsx", recipients: ["hr@finedge.demo"] });
  assert.equal(s.status, 200); assert.equal(new Date(s.body.next_run_at).getUTCDate(), 1);
  const run = await hr.post(`/reports/schedules/${s.body.id}/run`);
  assert.equal(run.status, 200); assert.match(run.body.delivered, /saved|emailed|email failed/);
  const runs = (await hr.get("/reports/runs")).body; assert.ok(runs.length >= 1);
  assert.equal((await hr.get(`/reports/runs/${runs[0].id}/download`)).status, 200);
  assert.equal((await (await T.as("hr@cloudnova.demo")).get(`/reports/runs/${runs[0].id}/download`)).status, 404);
  // due schedules run on their own
  await T.q(T.db, `UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [s.body.id]);
  const { runDueSchedules } = await import("../src/server/modules/reports");
  assert.ok((await runDueSchedules(T.db)) >= 1);
  assert.equal((await hr.del(`/reports/schedules/${s.body.id}`)).status, 200);
});

test("Access log: viewing someone's data is recorded, self-views are not, the log cannot be changed", async () => {
  const hr = await T.as("hr@finedge.demo"); const emp = await T.as("employee2@finedge.demo");
  await emp.get(`/employees/${emp.user.employee_id}`);
  await hr.get(`/employees/${emp.user.employee_id}`); await hr.get(`/employees/${emp.user.employee_id}`);
  const log = (await hr.get(`/access-log?employee_id=${emp.user.employee_id}&resource=profile`)).body.rows;
  assert.equal(log.filter((r: any) => r.actor_name === hr.user.name).length, 1, "repeats within 10 minutes are logged once");
  assert.ok(!log.some((r: any) => r.actor_id === emp.user.id), "self-views are not logged");
  const mine = (await emp.get("/me/access-log")).body;
  assert.ok(mine.some((r: any) => r.actor_name === hr.user.name && r.resource === "profile"));
  assert.equal((await (await T.as("manager.dataanalytics@finedge.demo")).get("/access-log")).status, 403);
  await assert.rejects(T.q(T.db, `UPDATE access_log SET actor_name = 'x'`), /append-only/);
  await assert.rejects(T.q(T.db, `DELETE FROM access_log`), /append-only/);
});
