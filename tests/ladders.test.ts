/* Demo career ladders: roles at other levels, vertical paths and the skill upgrades a promotion needs. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { addCareerLadders } from "../src/server/demo/ladders";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("Each demo organisation gets junior, senior, lead and manager roles with vertical paths; running again adds nothing", async () => {
  const r = await addCareerLadders(T.db, "C003");
  assert.ok(r.roles >= 8 && r.paths >= 10 && r.people >= 10, JSON.stringify(r));
  assert.deepEqual(await addCareerLadders(T.db, "C003"), { roles: 0, paths: 0, people: 0 });
  const types = (await T.q(T.db, `SELECT DISTINCT movement_type FROM career_paths WHERE org_id = 'C003'`)).map(x => x.movement_type);
  for (const t of ["Vertical", "Vertical (skip-level)", "Vertical (track change)", "Lateral"]) assert.ok(types.includes(t), t);
});

test("A promotion asks for higher levels and new skills; the management track relies less on hands-on skills", async () => {
  const req = async (title: string) => new Map((await T.q(T.db, `SELECT s.name, m.required_level, m.requirement_type FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id JOIN skills s ON s.id = m.skill_id
    WHERE r.org_id = 'C003' AND r.title = $1 AND m.lifecycle_status = 'Active'`, [title])).map(x => [x.name, x]));
  const mid = await req("Backend Developer"), senior = await req("Senior Backend Developer"), lead = await req("Engineering Lead"), mgr = await req("Engineering Manager");
  assert.equal(senior.get("Java")!.required_level, Math.min(5, mid.get("Java")!.required_level + 1));
  assert.ok(senior.has("Stakeholder Management") && !mid.has("Stakeholder Management"), "senior adds stakeholder management");
  assert.equal(lead.get("Software Architecture")!.requirement_type, "Mandatory");
  assert.equal(mgr.get("Leadership")!.requirement_type, "Mandatory");
  assert.equal(mgr.get("Java")!.requirement_type, "Preferred", "hands-on skills are no longer mandatory for a manager");
  // the career mobility screen shows the level change and the skill gap of the promotion
  const hr = await T.as("hr@cloudnova.demo");
  const list = (await hr.get("/career-paths")).body;
  const up = list.find((p: any) => p.from_title === "Backend Developer" && p.to_title === "Senior Backend Developer");
  assert.equal(up.movement_type, "Vertical"); assert.equal(up.level_change, 1);
  assert.ok(list.every((p: any) => p.level_change == null || p.level_change <= 2), "never more than two levels up");
  const skip = list.find((p: any) => p.movement_type === "Vertical (skip-level)" && p.to_title === "Engineering Lead");
  assert.equal(skip.level_change, 2);
  assert.equal(list.find((p: any) => p.movement_type === "Vertical (track change)").to_title, "Engineering Manager");
  // a two-level path must be marked skip-level; three levels are refused
  const ids = Object.fromEntries((await T.q(T.db, `SELECT title, id FROM job_roles WHERE org_id = 'C003' AND title IN ('Associate Software Engineer', 'Backend Developer', 'Senior Backend Developer', 'Engineering Lead', 'Director of Engineering')`)).map(x => [x.title, x.id]));
  const bad = await hr.post("/career-paths", { from_role_id: ids["Associate Software Engineer"], to_role_id: ids["Senior Backend Developer"], movement_type: "Vertical" });
  assert.equal(bad.status, 422); assert.equal(bad.body.error, "skip_level_type");
  const three = await hr.post("/career-paths", { from_role_id: ids["Associate Software Engineer"], to_role_id: ids["Engineering Lead"], movement_type: "Vertical (skip-level)" });
  assert.equal(three.status, 422); assert.equal(three.body.error, "too_many_levels");
  // the track of a skip-level move goes through the senior role: the lead keeps the senior's skills and adds its own
  const t = (await hr.get(`/career-paths/${skip.id}/track`)).body;
  assert.deepEqual(t.steps.map((s: any) => s.title), ["Backend Developer", "Senior Backend Developer", "Engineering Lead"]);
  assert.equal(t.step_by_step_months, 48);
  const sm = t.skills.find((k: any) => k.name === "Stakeholder Management");
  assert.equal(sm.kind, "new"); assert.equal(sm.first_step, 1, "first needed at senior level");
  assert.ok(t.skills.find((k: any) => k.name === "Leadership").first_step === 2, "leadership is new at lead level");
  assert.ok(!t.skills.some((k: any) => k.kind === "dropped" && k.cells[1]?.requirement_type !== "Optional"), "nothing the senior needs is lost at lead level");
});

test("Roles with shifting skills show as Transforming and At risk in the outlook, with the declining and rising skills named", async () => {
  const { addChangingRoles } = await import("../src/server/demo/ladders");
  const r = await addChangingRoles(T.db, "C003");
  assert.equal(r.roles, 2);
  assert.equal((await addChangingRoles(T.db, "C003")).roles, 0, "running again adds nothing");
  const hr = await T.as("hr@cloudnova.demo");
  const o = (await hr.get("/outlook")).body;
  const cm = o.roles.find((x: any) => x.title === "Configuration Management Engineer");
  const li = o.roles.find((x: any) => x.title === "Legacy Integration Developer");
  assert.equal(cm.label, "Transforming", JSON.stringify(cm));
  assert.ok(cm.declining.length && cm.emerging.length);
  assert.equal(li.label, "At risk", JSON.stringify(li));
  assert.ok(o.declining.some((k: any) => k.name === "SOAP Web Services" && k.people_with_it > 0), "people to reskill are counted");
});
