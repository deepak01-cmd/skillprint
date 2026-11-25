/* Market intelligence from job postings: extraction, clustering, role check, fallback and templates. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { buildSkillMatchers, extractCandidates, extractSkills, normalizeJobTitle } from "../src/server/market/extract";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => {
  T = await setup();
  const { tx } = await import("../src/server/db");
  const { createSource, ingestBatch, loadMatchers, refreshAggregates } = await import("../src/server/market/ingest");
  const src = await createSource(T.db, "Test postings", "fixture.csv", null, "test");
  const m = await loadMatchers(T.db);
  const de = (co: string, extra: string) => ({ company: co, job_title: "Senior Data Engineer", location: "Austin, TX", department: "Engineering",
    description: `Build pipelines with Python, SQL and Apache Spark on AWS. ETL experience. ${extra}`, additional_details: JSON.stringify({ country: "US", start_date: "2026-10-01", industry: "Computer Software" }) });
  await tx(c => ingestBatch(c, src, [
    de("Acme", "Agile team, Git."), de("Beta", "Agile, Kubernetes, Docker."), de("Gamma", "Agile ways of working, Git, Airflow."), de("Acme", "Experience with Amazon EMR."),
    { company: "Delta", job_title: "Data Engineer (Contract)", description: "Python, SQL, dbt, Snowflake, Agile, Jira", additional_details: "{}" },
    { company: "Acme", job_title: "Quantum Widget Wrangler", description: "Uses SAP and Salesforce daily. Customer Service.", additional_details: "{}" },
    { company: "Beta", job_title: "Quantum Widget Wrangler", description: "SAP, Salesforce, Microsoft Office. Python a plus.", additional_details: "{}" },
  ], m));
  await tx(c => refreshAggregates(c));
});

test("Market titles are normalised: qualifiers, brackets, seniority and team suffixes removed", () => {
  assert.equal(normalizeJobTitle("JANITORIAL CLEANER (H)").title, "janitorial cleaner");
  assert.equal(normalizeJobTitle("Part Time Retail Sales Consultant").title, "retail sales consultant");
  assert.equal(normalizeJobTitle("Bilingual Spanish Field Sales Representative").title, "field sales representative");
  assert.equal(normalizeJobTitle("Sr. Data Engineer - Payments").title, "data engineer");
});

test("Skill extraction uses names, aliases and synonyms, and avoids ambiguous matches", () => {
  const m = buildSkillMatchers([{ skill_id: "S028", name: "Electronic Health Records (EHR)", aliases: ["EHR", "EMR"] }, { skill_id: "S045", name: "SAS (Base / Enterprise Guide)", aliases: [] },
    { skill_id: "S036", name: "Apache Spark", aliases: [] }]);
  assert.deepEqual(extractSkills("Run jobs on Amazon EMR clusters", m), [], "EMR here is Elastic MapReduce, not health records");
  assert.deepEqual(extractSkills("Epic EHR build experience", m), ["S028"]);
  assert.deepEqual(extractSkills("Statistical programming in SAS", m), ["S045"]);
  assert.deepEqual(extractSkills("Oasis of sass and spark of genius", m), [], "case-sensitive short terms");
  assert.deepEqual(extractSkills("Apache Spark and PySpark", m), ["S036"]);
  assert.deepEqual(extractCandidates("SAP S/4HANA, C++ and Six Sigma"), ["SAP", "C++", "Six Sigma"]);
});

test("Import groups titles, counts skill demand and candidate terms", async () => {
  const c = await T.one(T.db, `SELECT * FROM job_title_clusters WHERE normalized_title = 'data engineer'`);
  assert.equal(c.postings, 5); assert.equal(c.companies, 4);
  const py = c.skill_profile.find((s: any) => s.skill_id === "S002");
  assert.equal(Number(py.share), 1);
  const s = await T.one(T.db, `SELECT * FROM job_skill_stats WHERE skill_id = 'S036'`);
  assert.equal(s.postings, 4);
  const sap = await T.one(T.db, `SELECT * FROM job_candidate_terms WHERE term = 'SAP'`);
  assert.equal(sap.postings, 2); assert.equal(sap.companies, 2);
});

test("Role market check compares the framework with postings for the same title", async () => {
  const hr = await T.as("hr@cloudnova.demo");
  const r = (await hr.get("/market/roles/R031")).body;
  assert.equal(r.postings, 5); assert.equal(r.small_sample, true);
  assert.equal(r.mapped.find((m: any) => m.skill_id === "S036").market_share, 0.8);
  assert.ok(r.not_mapped.some((m: any) => m.skill_id === "S040"), "Agile appears in postings but is not in the R031 framework");
  const emp = await T.as("employee@cloudnova.demo");
  const own = (await T.q(T.db, `SELECT role_id FROM employees WHERE id = $1`, [emp.user.employee_id]))[0].role_id;
  assert.equal((await emp.get(`/market/roles/${own === "R031" ? "R025" : "R031"}`)).status, 403);
});

test("Summary states the caveats: no licence and a single period", async () => {
  const hr = await T.as("hr@finedge.demo");
  const s = (await hr.get("/market/summary")).body;
  assert.ok(s.caveats.some((c: string) => /licence/.test(c))); assert.ok(s.caveats.some((c: string) => /one short period/.test(c)));
  assert.ok(Array.isArray(s.role_coverage));
});

test("Role fallback offers the market title and drafts a role from postings", async () => {
  const hr = await T.as("hr@finedge.demo");
  const res = (await hr.get("/roles/resolve?title=Quantum Widget Wrangler")).body;
  assert.equal(res.status, "unresolved"); assert.equal(res.market[0].normalized_title, "quantum widget wrangler"); assert.equal(res.market[0].postings, 2);
  const q = (await hr.post("/role-queue", { title: "Data Engineer", source: "manual" })).body;
  assert.equal(q.status, "queued");
  const dept = (await hr.get("/org")).body.departments.find((d: any) => d.name === "Data & Analytics").id;
  const r = (await hr.post(`/role-queue/${q.id}/resolve`, { action: "market", normalized_title: "data engineer", department_id: dept })).body;
  assert.equal(r.status, "Role drafted");
  const drafts = (await hr.get(`/roles/${r.role_id}/skills`)).body.drafts;
  assert.ok(drafts.some((d: any) => d.skill_id === "S002" && d.requirement_type === "Mandatory"));
});

test("Platform admin promotes a market title to a template and turns a candidate into a global skill", async () => {
  const admin = await T.as("admin@platform.demo");
  const p = (await admin.post("/market/titles/data%20engineer/promote", { title: "Data Engineer (market)" })).body;
  assert.ok(p.template_id); assert.ok(p.skills >= 4);
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.post("/market/titles/data%20engineer/promote", {})).status, 403);
  assert.equal((await admin.post("/market/candidates/SAP/decide", { action: "add" })).status, 422);
  const a = (await admin.post("/market/candidates/SAP/decide", { action: "add", name: "SAP ERP", category: "Software & Platforms", definition: "Configure and use SAP ERP modules for business processes." })).body;
  assert.equal(a.status, "Added");
  assert.ok((await T.one(T.db, `SELECT aliases FROM skills WHERE id = $1`, [a.skill_id])).aliases.includes("SAP"));
});
