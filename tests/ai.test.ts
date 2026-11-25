/* Never-empty role search: drafts from a local model (stand-in Ollama server here) or from the app's own data. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
let server: Server; let reply: () => string = () => "{}"; let calls = 0;
before(async () => {
  T = await setup();
  server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
      if (req.url === "/api/chat") { calls++; const b = JSON.parse(body); assert.equal(b.model, "test-model"); return res.end(JSON.stringify({ model: "test-model", message: { role: "assistant", content: reply() } })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
});
after(() => server.close());
const useModel = async (on: boolean) => {
  process.env.AI_PROVIDER = "ollama"; process.env.AI_MODEL = "test-model";
  process.env.AI_BASE_URL = on ? `http://127.0.0.1:${(server.address() as any).port}` : "http://127.0.0.1:9";
  (await import("../src/server/ai/llm")).resetAiStatus();
};

test("No model connected: a search for a missing role still returns a draft, built from the app's own data, and waits for review", async () => {
  await useModel(false);
  const hr = await T.as("hr@finedge.demo");
  const st = (await hr.get("/ai/status")).body; assert.equal(st.connected, false); assert.ok(st.reason);
  const r = (await hr.post("/ai/role-drafts", { title: "Senior Risk Data Analyst", wait: true })).body;
  assert.equal(r.draft.status, "Ready"); assert.equal(r.draft.method, "rules");
  assert.ok(r.draft.payload.skills.length >= 3, JSON.stringify(r.draft.payload.skills));
  assert.ok(r.draft.payload.summary.length > 10);
  assert.ok(r.draft.payload.notes.some((n: string) => /own data|No local model/.test(n)));
  const qi = await T.one(T.db, `SELECT * FROM role_resolution_queue WHERE id = $1`, [r.draft.queue_id]);
  assert.equal(qi.status, "Open", "waits in Role resolution for HR");
  const again = (await hr.post("/ai/role-drafts", { title: "Sr. Risk Data Analyst" })).body;
  assert.equal(again.draft.id, r.draft.id, "the same title (any spelling, same level) reuses the draft");
  const existing = (await hr.post("/ai/role-drafts", { title: "Back-end Dev" })).body;
  assert.equal(existing.matched.id, "R004", "titles in the framework (any spelling, same level) are never drafted");
  const senior = (await hr.post("/ai/role-drafts", { title: "Sr Backend Dev", wait: true })).body;
  assert.ok(senior.draft && !senior.matched, "a senior title is drafted, not matched to the mid-level role");
});

test("Model connected: its answer is validated, skills are mapped to the library under any spelling, unknown skills are kept apart", async () => {
  await useModel(true);
  reply = () => "Here is the profile:\n```json\n" + JSON.stringify({
    title: "MLOps Engineer", summary: "Builds and runs the platform that trains and serves machine-learning models.",
    alt_titles: ["Machine Learning Platform Engineer", "MLOps Engineer"],
    responsibilities: ["Build CI/CD pipelines for model training", "Run models in containers on Kubernetes", "Monitor model drift", "Automate data pipelines"],
    skills: [{ name: "python", required_level: 4, requirement_type: "Mandatory", importance: "High", why: "core language" },
      { name: "K8s", required_level: 9, requirement_type: "Must", importance: "Huge" },
      { name: "Docker", required_level: 3, requirement_type: "Mandatory", importance: "High" },
      { name: "Kubeflow", required_level: 3, requirement_type: "Preferred", importance: "Medium" }],
    new_skills: [{ name: "Kubeflow", definition: "Run machine-learning workflows on Kubernetes with Kubeflow.", category: "Frameworks & Technologies" }],
  }) + "\n```";
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.get("/ai/status")).body.connected, true);
  const r = (await hr.post("/ai/role-drafts", { title: "MLOps Engineer", wait: true })).body;
  const p = r.draft.payload;
  assert.equal(r.draft.method, "ai"); assert.equal(r.draft.model, "test-model");
  const k8s = p.skills.find((s: any) => s.name === "Kubernetes");
  assert.ok(k8s, "K8s mapped to the Kubernetes skill"); assert.equal(k8s.required_level, 5, "level clamped to 1-5"); assert.equal(k8s.requirement_type, "Preferred", "unknown type replaced"); assert.equal(k8s.importance, "Medium");
  assert.ok(p.skills.some((s: any) => s.skill_id === "S002"), "python -> Python");
  assert.ok(p.new_skills.some((s: any) => s.name === "Kubeflow" && s.definition), "unknown skill kept apart for review");
  assert.ok(!p.alt_titles.includes("MLOps Engineer"));
  assert.equal(p.responsibilities.length, 4);
});

test("A broken model answer never fails the search: the draft falls back to the app's own data", async () => {
  await useModel(true);
  reply = () => "Sorry, I cannot help with that.";
  const hr = await T.as("hr@finedge.demo");
  const r = (await hr.post("/ai/role-drafts", { title: "Payments Data Engineer", wait: true })).body;
  assert.equal(r.draft.status, "Ready"); assert.equal(r.draft.method, "rules");
  assert.ok(r.draft.payload.notes.some((n: string) => /could not draft/.test(n)));
});

test("HR approves a draft into a draft role (normal approval follows); new skills become company skills; reject allows a fresh draft", async () => {
  const hr = await T.as("hr@finedge.demo"), emp = await T.as("employee@finedge.demo");
  const d = (await hr.get("/ai/role-drafts?status=Ready")).body.find((x: any) => x.query === "MLOps Engineer");
  assert.equal((await emp.post(`/ai/role-drafts/${d.id}/approve`, { department_id: "D002" })).status, 403);
  const a = (await hr.post(`/ai/role-drafts/${d.id}/approve`, { department_id: "D002", new_skills: [{ name: "Kubeflow", definition: "Run machine-learning workflows on Kubernetes with Kubeflow.", as: "company" }] })).body;
  assert.ok(a.role_id, JSON.stringify(a));
  const role = await T.one(T.db, `SELECT * FROM job_roles WHERE id = $1`, [a.role_id]);
  assert.equal(role.status, "Draft"); assert.equal(role.responsibilities.length, 4); assert.match(role.summary, /machine-learning models/);
  const maps = await T.q(T.db, `SELECT m.approval_status, s.name, s.org_id FROM role_skill_mapping m JOIN skills s ON s.id = m.skill_id WHERE m.role_id = $1`, [a.role_id]);
  assert.ok(maps.length >= 4 && maps.every((m: any) => m.approval_status === "Draft"));
  assert.ok(maps.some((m: any) => m.name === "Kubeflow" && m.org_id === "C001"), "new skill created as a company skill and required");
  assert.equal((await T.one(T.db, `SELECT status FROM ai_role_drafts WHERE id = $1`, [d.id])).status, "Approved");
  assert.equal((await hr.post("/ai/role-drafts", { title: "MLOps Engineer" })).body.matched?.id, a.role_id, "the title now resolves to the new role");
  const other = (await hr.get("/ai/role-drafts?status=Ready")).body.find((x: any) => x.query === "Payments Data Engineer");
  assert.equal((await hr.post(`/ai/role-drafts/${other.id}/reject`, { note: "Not a role we hire for" })).body.status, "Rejected");
  await useModel(false);
  const fresh = (await hr.post("/ai/role-drafts", { title: "Payments Data Engineer", wait: true })).body;
  assert.notEqual(fresh.draft.id, other.id, "a rejected draft can be drafted again later");
});
