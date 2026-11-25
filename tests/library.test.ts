/* Governance of the shared skill library, and companies' own job postings. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

const cand = (term: string, companies = 12) => T.q(T.db, `INSERT INTO job_candidate_terms (term, postings, companies, share, top_titles, kind, suggested_category) VALUES ($1, 50, $2, 0.1, '[{"title":"data engineer","n":20}]', 'discovered', 'Frameworks & Technologies') ON CONFLICT DO NOTHING`, [term, companies]);
const globals = async () => Number((await T.one(T.db, `SELECT count(*)::int AS n FROM skills WHERE org_id IS NULL AND status = 'Active'`)).n);

test("Two-step approval: the platform administrator proposes, a different person approves; nobody approves their own proposal", async () => {
  const admin = await T.as("admin@platform.demo"), expert = await T.as("expert@finedge.demo"), hr = await T.as("hr@finedge.demo");
  await cand("Polars"); await cand("Dask");
  const before = await globals();
  const p = (await admin.post("/market/candidates/bulk", { action: "add", items: [{ term: "Polars", category: "Frameworks & Technologies", definition: "Process data frames quickly with Polars." }] })).body;
  assert.equal(p.proposed, 1);
  assert.equal(await globals(), before, "nothing enters the library on a proposal");
  const self = (await admin.post("/library/proposals/decide", { terms: ["Polars"], decision: "approve" })).body;
  assert.equal(self.results[0].status, "skipped"); assert.match(self.results[0].reason, /second person/);
  assert.equal((await hr.get("/library/proposals")).status, 403, "HR is not a library reviewer");
  const list = (await expert.get("/library/proposals")).body;
  assert.ok(list.some((x: any) => x.term === "Polars" && x.can_decide && x.proposed_by_name));
  const ok = (await expert.post("/library/proposals/decide", { terms: ["Polars"], decision: "approve" })).body;
  assert.equal(ok.results[0].status, "Added");
  assert.equal(await globals(), before + 1);
  // reject sends it back for review
  await admin.post("/market/candidates/bulk", { action: "add", items: [{ term: "Dask", category: "Frameworks & Technologies", definition: "Scale Python data work with Dask." }] });
  const no = (await expert.post("/library/proposals/decide", { terms: ["Dask"], decision: "reject", comment: "too niche" })).body;
  assert.equal(no.results[0].status, "Rejected");
  assert.equal((await T.one(T.db, `SELECT status FROM job_candidate_terms WHERE term = 'Dask'`)).status, "Candidate");
  // a nominated HR administrator can also be a reviewer
  assert.equal((await admin.post("/library/reviewers", { email: "hr@medicore.demo" })).status, 200);
  assert.equal((await (await T.as("hr@medicore.demo")).get("/library/proposals")).status, 200);
  assert.equal((await admin.post("/library/reviewers", { email: "employee@finedge.demo" })).status, 422, "employees cannot be reviewers");
});

test("Retire keeps the skill's history but stops detection and offers; skills in use cannot be retired; merge folds a duplicate in", async () => {
  const admin = await T.as("admin@platform.demo"), hr = await T.as("hr@finedge.demo");
  const s = await T.one(T.db, `SELECT id FROM skills WHERE name = 'Polars'`);
  assert.equal((await hr.post(`/skills/${s.id}/retire`, { reason: "test" })).status, 403, "global skills belong to the platform");
  assert.equal((await admin.post(`/skills/${s.id}/retire`, { reason: "Added by mistake" })).body.status, "Retired");
  assert.ok(!(await hr.get("/skills")).body.some((x: any) => x.id === s.id), "not offered");
  assert.ok((await hr.get("/skills?include_retired=true")).body.some((x: any) => x.id === s.id && x.status === "Retired"), "history on request");
  const { loadMatchers } = await import("../src/server/market/ingest");
  const { extractSkills } = await import("../src/server/market/extract");
  assert.deepEqual(extractSkills("Experience with Polars", await loadMatchers(T.db)).filter(x => x === s.id), [], "no longer detected");
  assert.equal((await admin.post(`/skills/${s.id}/reinstate`)).body.status, "Active");
  assert.equal((await admin.post(`/skills/S001/retire`, { reason: "not needed" })).status, 422, "SQL is required by roles");
  // merge
  const dup = await T.one(T.db, `INSERT INTO skills (org_id, name, definition, category, aliases) VALUES (NULL, 'Polars DataFrames', 'Duplicate', 'Frameworks & Technologies', '{"py-polars"}') RETURNING id`);
  const m = (await admin.post(`/skills/${dup.id}/merge`, { into: s.id })).body;
  assert.deepEqual(m.names_moved.sort(), ["Polars DataFrames", "py-polars"]);
  const after = await T.one(T.db, `SELECT s.aliases, d.status, d.merged_into FROM skills s, skills d WHERE s.id = $1 AND d.id = $2`, [s.id, dup.id]);
  assert.ok(after.aliases.includes("py-polars")); assert.equal(after.status, "Retired"); assert.equal(after.merged_into, s.id);
  assert.equal((await admin.post(`/skills/S002/merge`, { into: "S001" })).status, 422, "skills with role mappings keep their Pixel IDs");
});

test("Automatic additions are listed by run and can be undone with one click", async () => {
  const admin = await T.as("admin@platform.demo");
  await admin.put("/library/settings", { two_step: false });
  await cand("Great Expectations", 15); await cand("Soda Core", 14);
  const r = (await admin.put("/data/settings", { skill_auto_add: { enabled: true, min_employers: 14 } })).body;
  assert.ok(r.added_now >= 2, JSON.stringify(r));
  const runs = (await admin.get("/library/runs")).body;
  const run = runs.find((x: any) => x.skills.some((s: any) => s.name === "Great Expectations"));
  assert.ok(run && run.mode === "automatic");
  const undo = (await admin.post(`/library/runs/${run.id}/retire`)).body;
  assert.ok(undo.retired >= 2);
  assert.equal((await T.one(T.db, `SELECT status FROM job_candidate_terms WHERE term = 'Great Expectations'`)).status, "Ignored", "not added again automatically");
  await admin.put("/data/settings", { skill_auto_add: { enabled: false, min_employers: 10 } });
  // with two-step approval on, automatic growth only proposes
  await admin.put("/library/settings", { two_step: true }); await cand("Monte Carlo Data", 20);
  const before = await globals();
  const p = (await admin.put("/data/settings", { skill_auto_add: { enabled: true, min_employers: 20 } })).body;
  assert.ok(p.proposed_now >= 1); assert.equal(await globals(), before);
  await admin.put("/data/settings", { skill_auto_add: { enabled: false, min_employers: 10 } });
});

test("HR uploads the company's own postings: private to the company; they grow company skills, new draft roles and existing frameworks", async () => {
  const hr = await T.as("hr@finedge.demo"), other = await T.as("hr@medicore.demo"), admin = await T.as("admin@platform.demo");
  const shared = Number((await admin.get("/data/scale")).body.postings);
  const rows = ["company,job_title,location,department,description,additional_details"];
  for (let i = 0; i < 4; i++) rows.push(`FinEdge,Sr. Financial Data Analyst,Mumbai,Data,"Build SQL and Python models on Apache Spark. Experience with Murex and Bloomberg Terminal. Power BI dashboards. Posting ${i}.",{}`);
  for (let i = 0; i < 3; i++) rows.push(`FinEdge,Quant Developer,Mumbai,Data,"Write Python and SQL for pricing. Experience with Murex, KDB+ and Bloomberg Terminal. Posting ${i}.",{}`);
  const up = await hr.post("/data/job-postings", { wait: true, name: "FinEdge careers", file: { name: "finedge-jobs.csv", buffer: Buffer.from(rows.join("\n")) } });
  assert.equal(up.status, 200, JSON.stringify(up.body)); assert.equal(up.body.imported, 7); assert.equal(up.body.company, true);
  // private
  assert.equal((await hr.get("/company-postings")).body.postings, 7);
  assert.equal((await other.get("/company-postings")).body.postings, 0, "another company sees nothing");
  assert.equal(Number((await admin.get("/data/scale")).body.postings), shared, "shared market figures do not include company postings");
  // titles: existing role gets missing skills, new title becomes a draft role
  const titles = (await hr.get("/company-postings/titles")).body;
  const fda = titles.find((t: any) => t.role?.id === "R001");
  assert.ok(fda, JSON.stringify(titles.map((t: any) => [t.display_title, t.role])));
  assert.ok(fda.missing_skills.some((s: any) => s.skill_id === "S036"), "Apache Spark is asked for but not in R001's framework");
  const quant = titles.find((t: any) => !t.role && /quant/i.test(t.display_title));
  const res = (await hr.post("/company-postings/roles", { department_id: "D001", titles: [{ normalized_title: fda.normalized_title }, { normalized_title: quant.normalized_title }] })).body;
  assert.equal(res.extended, 1); assert.equal(res.created, 1);
  const pid = await T.one(T.db, `SELECT approval_status FROM role_skill_mapping WHERE pixel_id = 'PX-R001-S036'`);
  assert.equal(pid.approval_status, "Draft", "added to the framework as a draft for approval");
  // skill candidates from the company's postings become company skills
  const cands = (await hr.get("/company-postings/candidates")).body;
  const murex = cands.find((c: any) => c.term.toLowerCase() === "murex");
  assert.ok(murex && murex.status === "Candidate", JSON.stringify(cands.map((c: any) => c.term)));
  const add = (await hr.post("/company-postings/candidates/bulk", { action: "add", items: [{ term: murex.term, category: "Software & Platforms", definition: "Use the Murex trading and risk platform." }] })).body;
  assert.equal(add.results[0].status, "Added");
  const sk = await T.one(T.db, `SELECT org_id FROM skills WHERE id = $1`, [add.results[0].skill_id]);
  assert.equal(sk.org_id, "C001", "a company skill, not global");
  assert.equal((await (await T.as("employee@finedge.demo")).post("/company-postings/candidates/bulk", { action: "ignore", items: [{ term: "x" }] })).status, 403);
});
