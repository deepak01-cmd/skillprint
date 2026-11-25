/* Growing the data: skills catalogue, boilerplate-aware re-scan, bulk templates, draft roles from market titles. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { stripBoilerplate } from "../src/server/market/catalogue";
import { buildSkillMatchers, extractSkills } from "../src/server/market/extract";

let T: Awaited<ReturnType<typeof setup>>;
const BLURB = "Omega serves a wide range of market sectors including commercial real estate, robotics, logistics and distribution worldwide. We offer competitive compensation and benefits to all staff.";
before(async () => {
  T = await setup();
  const { tx } = await import("../src/server/db");
  const { createSource, ingestBatch, loadMatchers, refreshAggregates } = await import("../src/server/market/ingest");
  const src = await createSource(T.db, "Scale fixture", "scale.csv", null, "test");
  const m = await loadMatchers(T.db);
  const rows: any[] = [];
  for (let i = 0; i < 6; i++) rows.push({ company: "Omega", job_title: "Warehouse Associate", description: `${BLURB}\nPick and pack orders #${i}. Forklift operation required. Strong attention to detail.`, additional_details: "{}" });
  for (const co of ["Omega", "Sigma", "Tau", "Rho"]) for (let i = 0; i < 3; i++)
    rows.push({ company: co, job_title: "Salesforce Administrator", description: `${co === "Omega" ? BLURB + "\n" : ""}Administer Salesforce CRM and build reports #${i}. Use Jira and Confluence. Excel and SQL.`, additional_details: "{}" });
  await tx(c => ingestBatch(c, src, rows, m));
  await tx(c => refreshAggregates(c));
});

test("Acronyms match only in capitals; employer boilerplate is removed before extraction", () => {
  const m = buildSkillMatchers([{ skill_id: "X1", name: "SAP ERP", aliases: ["SAP"] }, { skill_id: "X2", name: "Basic Life Support", aliases: ["BLS"] }]);
  assert.deepEqual(extractSkills("Uses SAP daily", m), ["X1"]);
  assert.deepEqual(extractSkills("sap the tree; bls", m), []);
  const out = stripBoilerplate([`${BLURB}\nDuty one is here and it is long enough to count.`, `${BLURB}\nAnother duty sentence that is long enough to count.`, `${BLURB}\nA third duty sentence that is long enough to count too.`]);
  assert.ok(out.every(d => !/real estate/.test(d) && /duty/i.test(d)));
});

test("Platform admin loads the catalogue: library grows, postings are re-scanned, covered candidates close", async () => {
  const admin = await T.as("admin@platform.demo");
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.post("/data/catalogue/load")).status, 403);
  const before = (await admin.get("/data/scale")).body;
  assert.ok(before.catalogue_missing > 200);
  const r = (await admin.post("/data/catalogue/load", { wait: true })).body;
  assert.ok(r.added > 200, JSON.stringify(r)); assert.ok(r.rescan.changed > 0);
  const again = (await admin.post("/data/catalogue/load", { wait: true })).body;
  assert.equal(again.added, 0, "idempotent");
  const sk = async (name: string) => (await T.one(T.db, `SELECT id FROM skills WHERE name = $1 AND org_id IS NULL`, [name])).id;
  const [sf, fork, re] = [await sk("Salesforce"), await sk("Forklift Operation"), await sk("Real Estate Management")];
  const wh = await T.q(T.db, `SELECT skill_ids FROM job_postings WHERE raw_title = 'Warehouse Associate'`);
  assert.ok(wh.every((p: any) => p.skill_ids.includes(fork)), "job-specific skill kept");
  assert.ok(wh.every((p: any) => !p.skill_ids.includes(re)), "boilerplate 'commercial real estate' ignored");
  const admin2 = (await T.q(T.db, `SELECT skill_ids FROM job_postings WHERE raw_title = 'Salesforce Administrator'`));
  assert.ok(admin2.every((p: any) => p.skill_ids.includes(sf)));
  const cand = await T.one(T.db, `SELECT status FROM job_candidate_terms WHERE term = 'Salesforce'`);
  assert.equal(cand?.status ?? "Added", "Added");
});

test("Bulk templates from market titles feed the role fallback; HR drafts roles from market titles in bulk", async () => {
  const admin = await T.as("admin@platform.demo");
  const t = (await admin.post("/data/templates/bulk", { min_postings: 3 })).body;
  assert.ok(t.created + t.updated >= 1, JSON.stringify(t));   // the re-scan before already builds templates automatically
  const tpl = await T.one(T.db, `SELECT * FROM role_templates WHERE cluster_title = 'salesforce administrator'`);
  assert.ok(tpl && tpl.skills.length >= 3);
  const hr = await T.as("hr@finedge.demo");
  const res = (await hr.get("/roles/resolve?title=Salesforce Admin")).body;
  assert.equal(res.status, "unresolved");
  const r = (await hr.post("/roles/from-market", { department_id: "D004", titles: [{ normalized_title: "salesforce administrator" }, { normalized_title: "no such title" }] })).body;
  assert.equal(r.created, 1);
  const role = await T.one(T.db, `SELECT * FROM job_roles WHERE id = $1`, [r.results[0].role_id]);
  assert.equal(role.status, "Draft");
  const maps = await T.q(T.db, `SELECT * FROM role_skill_mapping WHERE role_id = $1`, [role.id]);
  assert.ok(maps.length >= 3 && maps.every((m: any) => m.approval_status === "Draft"));
  const dup = (await hr.post("/roles/from-market", { department_id: "D004", titles: [{ normalized_title: "salesforce administrator" }] })).body;
  assert.equal(dup.results[0].status, "exists");
  const head = await T.as("head.dataanalytics@finedge.demo");
  assert.equal((await head.post("/roles/from-market", { department_id: "D004", titles: [{ normalized_title: "warehouse associate" }] })).status, 403);
});

test("Long jobs run in the background with progress; automatic growth adds strongly demanded skills marked for review", async () => {
  const admin = await T.as("admin@platform.demo");
  const start = (await admin.post("/data/rescan")).body;
  assert.equal(start.started, true, "answers at once");
  let st = (await admin.get("/data/scale")).body;
  for (let i = 0; i < 100 && st.running; i++) { await new Promise(r => setTimeout(r, 100)); st = (await admin.get("/data/scale")).body; }
  assert.equal(st.running, null); assert.equal(st.last.kind, "re-scan"); assert.ok(st.last.result.scanned > 0);
  await T.q(T.db, `INSERT INTO job_candidate_terms (term, postings, companies, share, top_titles, kind, suggested_category) VALUES ('Quantum Widget Tuning', 40, 12, 0.1, '[{"title":"widget engineer","n":40}]', 'discovered', 'Technical Methods'), ('Salesforce Widgets', 40, 12, 0.1, '[]', 'discovered', NULL)`);
  await T.q(T.db, `UPDATE job_candidate_terms SET suggested_skill_id = (SELECT id FROM skills WHERE name = 'Salesforce' AND org_id IS NULL) WHERE term = 'Salesforce Widgets'`);
  const cand = { term: "Quantum Widget Tuning", companies: 12 };
  const before = Number((await T.one(T.db, `SELECT count(*)::int AS n FROM skills WHERE org_id IS NULL`)).n);
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.put("/data/settings", { skill_auto_add: { enabled: true, min_employers: 3 } })).status, 403);
  await admin.put("/library/settings", { two_step: false });   // immediate additions; two-step approval is tested in library.test.ts
  const r = (await admin.put("/data/settings", { skill_auto_add: { enabled: true, min_employers: cand.companies } })).body;
  assert.ok(r.added_now >= 1, JSON.stringify(r));
  const after = Number((await T.one(T.db, `SELECT count(*)::int AS n FROM skills WHERE org_id IS NULL`)).n);
  assert.equal(after - before, r.added_now, "the library grew");
  const s = await T.one(T.db, `SELECT s.* FROM job_candidate_terms c JOIN skills s ON s.id = c.skill_id WHERE c.term = $1`, [cand.term]);
  assert.ok(s.review_date, "marked for review"); assert.match(s.definition, /review this definition/);
  assert.equal((await T.one(T.db, `SELECT status FROM job_candidate_terms WHERE term = 'Salesforce Widgets'`)).status, "Candidate", "look-alikes always wait for a person");
  await admin.put("/data/settings", { skill_auto_add: { enabled: false, min_employers: 10 } });
  await admin.put("/library/settings", { two_step: true });
});
