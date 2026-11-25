/* Skill trends and role outlook: the platform's forecast of current, emerging and declining skills. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { knowledgeFor } from "../src/server/outlook/knowledge";
import { labelRole, skillOutlooks } from "../src/server/modules/outlook";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); process.env.AI_PROVIDER = "off"; (await import("../src/server/ai/llm")).resetAiStatus(); });

test("Industry knowledge gives rising and falling skills a labelled reason", () => {
  assert.ok(knowledgeFor("Generative AI").industry!.value > 0);
  assert.ok(knowledgeFor("jQuery").industry!.value < 0);
  assert.ok(knowledgeFor("Data Entry").automation!.value < 0);
  assert.equal(knowledgeFor("Stakeholder Management").industry, null);
});

test("Skill trends: rising skills are Emerging, legacy skills Declining, the rest Current, each with reasons", async () => {
  const org = (await T.one(T.db, `SELECT org_id AS id FROM job_roles ORDER BY id LIMIT 1`)).id;
  const m = await skillOutlooks(T.db, org, [{ skill_id: null, name: "Generative AI" }, { skill_id: null, name: "SOAP" }, { skill_id: null, name: "Stakeholder Management" }]);
  assert.equal(m.get("generative ai")!.trend, "Emerging");
  assert.equal(m.get("soap")!.trend, "Declining");
  assert.equal(m.get("stakeholder management")!.trend, "Current");
  for (const v of m.values()) assert.ok(v.reasons.length >= 1, v.name);
});

test("Role label follows the weighted mix of its skills", () => {
  assert.equal(labelRole([{ trend: "Emerging", score: 0.6, requirement_type: "Mandatory" }, { trend: "Current", score: 0, requirement_type: "Optional" }]).label, "Growing");
  assert.equal(labelRole([{ trend: "Declining", score: -0.6, requirement_type: "Mandatory" }, { trend: "Current", score: 0, requirement_type: "Optional" }]).label, "At risk");
  assert.equal(labelRole([{ trend: "Current", score: 0 }]).label, "Stable");
  assert.equal(labelRole([]).label, "Stable");
});

test("Organisation outlook and role outlook agree, and employees cannot open the organisation view", async () => {
  const hr = await T.as("hr@finedge.demo");
  const o = (await hr.get("/outlook")).body;
  assert.ok(o.roles.length > 0);
  assert.equal(Object.values(o.counts).reduce((a: number, b: any) => a + b, 0), o.roles.length, "counts add up to the roles listed");
  const r0 = o.roles[0];
  const ro = (await hr.get(`/outlook/roles/${r0.id}`)).body;
  assert.equal(ro.label, r0.label, "same label on both screens");
  assert.equal(ro.skills.length, r0.skills);
  assert.ok(ro.advice.length >= 1);
  const emp = await T.as("employee@finedge.demo").catch(() => null);
  if (emp) assert.equal((await emp.get("/outlook")).status, 403);
  const other = await T.one(T.db, `SELECT r.id FROM job_roles r WHERE r.org_id <> (SELECT org_id FROM job_roles WHERE id = $1) LIMIT 1`, [r0.id]);
  if (other) assert.equal((await hr.get(`/outlook/roles/${other.id}`)).status, 404, "another organisation's role is not visible");
});

test("A drafted role profile carries a trend per skill, the role outlook, and finishes at 100%", async () => {
  const hr = await T.as("hr@finedge.demo");
  const r = (await hr.post("/ai/role-drafts", { title: "Generative AI Engineer", wait: true })).body;
  assert.equal(r.draft.status, "Ready");
  assert.equal(r.draft.progress, 100);
  assert.ok(r.draft.payload.skills.every((s: any) => ["Emerging", "Current", "Declining"].includes(s.trend)));
  assert.ok(r.draft.payload.outlook && r.draft.payload.outlook.label);
});
