/* Spelling variants and title grouping: the same role and skill however people write them; skill discovery and review. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { normalizeTitle } from "../src/server/modules/roleFallback";
import { buildSkillMatchers, buildTitleVocab, canonicalTitle, discoverTerms, extractSkills, normalizeJobTitle } from "../src/server/market/extract";
import { canonicalSpelling } from "../src/server/terms";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

const DOTNET = [".NET Developer", ".net dev", "Dotnet Developer", "Dot Net Developer", "dot-net dev", ".Net Engineer", ".NET Developer II"];
// other levels of the same title are different roles
const DOTNET_OTHER_LEVEL = ["Senior .NET Developer", "Sr. Dot Net Developer", "Lead Dot-Net Developer"];

test("Every way of writing a .NET developer title normalises to the same title, in roles and in the job market", () => {
  const spelled = DOTNET.filter(t => !/engineer/i.test(t));
  assert.deepEqual([...new Set(spelled.map(t => normalizeTitle(t).core))], ["dotnet developer"]);
  assert.deepEqual([...new Set(spelled.map(t => normalizeJobTitle(t).title))], ["dotnet developer"]);
  assert.equal(normalizeTitle("Sr NodeJS Dev").core, normalizeTitle("Node JS Developer").core);
  assert.equal(normalizeTitle("Senior C Sharp Engineer").core, normalizeTitle("C# Engineer").core);
});

test("A skill is found under every spelling; candidate terms use one canonical spelling", () => {
  const m = buildSkillMatchers([{ skill_id: "X", name: ".NET", aliases: [] }, { skill_id: "N", name: "Node.js", aliases: [] }, { skill_id: "P", name: "Power BI", aliases: [] }]);
  for (const s of ["5 years of .NET", "dotnet core apps", "Dot Net framework", "C# and .Net"]) assert.deepEqual(extractSkills(s, m), ["X"], s);
  assert.deepEqual(extractSkills("NodeJS and node js", m), ["N"]);
  assert.deepEqual(extractSkills("PowerBI dashboards", m), ["P"]);
  assert.equal(canonicalSpelling("NodeJS"), "Node.js");
  assert.equal(canonicalSpelling("MS Excel"), "Microsoft Excel");
  assert.equal(canonicalSpelling("k8s"), "Kubernetes");
});

test("Noise in market titles is removed: numbers, plurals, freshers and words only one employer uses", () => {
  const rows = [
    { norm: normalizeJobTitle("2027 Software Engineer").title, companies: ["A"] },
    { norm: normalizeJobTitle("NEO SOC1 Embedded Software Engineer").title, companies: ["B"] },
    { norm: normalizeJobTitle("30 Fresher Embedded Software Engineers").title, companies: ["C"] },
    { norm: normalizeJobTitle("Embedded Software Engineer").title, companies: ["D", "E"] },
    { norm: normalizeJobTitle("Software Engineer").title, companies: ["F", "G"] },
  ];
  const { vocab } = buildTitleVocab(rows);
  assert.deepEqual(rows.map(r => canonicalTitle(r.norm, vocab)), ["software engineer", "embedded software engineer", "embedded software engineer", "embedded software engineer", "software engineer"]);
});

test("Skill terms are discovered in posting text after phrases like 'experience with' and 'tools such as'", () => {
  const t = discoverTerms("Requirements: experience with Python, PySpark and Snowflake. Knowledge of Terraform or Azure Functions. Tools such as JIRA, Confluence. Strong communication skills.");
  for (const x of ["Python", "PySpark", "Snowflake", "Terraform", "Azure Functions", "JIRA", "Confluence"]) assert.ok(t.includes(x), x);
  assert.ok(!t.some(x => /communication/i.test(x)));
});

test("Role search and role resolution find a .NET role however the title is written", async () => {
  const hr = await T.as("hr@finedge.demo");
  const r = (await hr.post("/roles", { title: ".NET Developer", department_id: "D002", career_track: "Individual Contributor" })).body;
  await T.q(T.db, `UPDATE job_roles SET status = 'Published' WHERE id = $1`, [r.id]);
  for (const t of DOTNET) {
    const res = (await hr.get(`/roles/resolve?title=${encodeURIComponent(t)}`)).body;
    assert.equal(res.status, "matched", t); assert.equal(res.role.id, r.id, t);
    const s = (await hr.get(`/search?q=${encodeURIComponent(t)}`)).body;
    assert.ok(s.roles.some((x: any) => x.id === r.id), `search: ${t}`);
  }
  for (const t of DOTNET_OTHER_LEVEL) assert.equal((await hr.get(`/roles/resolve?title=${encodeURIComponent(t)}`)).body.status, "unresolved", t);
  const { findDuplicates } = await import("../src/server/modules/skills");
  await T.q(T.db, `INSERT INTO skills (org_id, name, definition, category) VALUES (NULL, '.NET', 'Build applications on .NET', 'Frameworks & Technologies')`);
  const d = await findDuplicates(T.db, "C001", "Dot Net");
  assert.ok(d.some((x: any) => x.name === ".NET" && x.exact), "uploading 'Dot Net' is recognised as the existing .NET skill");
  const p = (await hr.post("/imports/preview", { entity: "role_skills", filename: "x.csv", text: "skill,required_level\ndotnet,3", options: { role_id: r.id } })).body;
  assert.equal(p.rows[0].action, "create"); assert.equal(p.rows[0].key, ".NET");
});

test("Candidates: covered spellings close by themselves; the rest can be added as aliases or new skills in bulk", async () => {
  const { tx } = await import("../src/server/db");
  const { createSource, ingestBatch, loadMatchers, refreshAggregates } = await import("../src/server/market/ingest");
  const src = await createSource(T.db, "Variants fixture", "v.csv", null, "test");
  const m = await loadMatchers(T.db);
  const rows = ["Acme", "Beta", "Gamma", "Delta"].map(co => ({ company: co, job_title: "Platform Engineer", description: "Requirements: experience with Datadog, Grafana Loki and PowerBI. Tools such as K8s and Terraform.", additional_details: "{}" }));
  await tx(c => ingestBatch(c, src, rows, m));
  await tx(c => refreshAggregates(c));
  const cands = await T.q(T.db, `SELECT term, status, skill_id FROM job_candidate_terms`);
  const byTerm = Object.fromEntries(cands.map((x: any) => [x.term.toLowerCase(), x]));
  assert.equal(byTerm["power bi"]?.status, "Added", "PowerBI is the existing Power BI skill");
  assert.equal(byTerm["datadog"]?.status, "Candidate");
  const admin = await T.as("admin@platform.demo");
  await admin.put("/library/settings", { two_step: false });   // immediate decisions; two-step approval is tested in library.test.ts
  const a = (await admin.post("/market/candidates/bulk", { action: "alias", items: [{ term: byTerm["datadog"].term, skill_id: "S026" }] })).body;
  assert.equal(a.done, 1);
  assert.ok((await T.one(T.db, `SELECT aliases FROM skills WHERE id = 'S026'`)).aliases.includes(byTerm["datadog"].term));
  const loki = byTerm["grafana loki"];
  assert.ok(loki, JSON.stringify(Object.keys(byTerm)));
  const n = (await admin.post("/market/candidates/bulk", { action: "add", items: [{ term: loki.term, category: "Tools & Applications", definition: "Collect and query application logs with Grafana Loki." }] })).body;
  assert.equal(n.done, 1);
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.post("/market/candidates/bulk", { action: "ignore", items: [{ term: "x" }] })).status, 403);
});

test("Variation handling is general, not .NET only: titles across industries and skills across tools", () => {
  const key = (t: string) => normalizeTitle(t).core.replace(/[\s-]+/g, "");
  const groups = [
    ["Senior Java Developer", "Sr. Java Dev", "Java Developer III", "Lead Java Developer"],
    ["Front End Developer", "Front-End Developer", "Frontend Developer", "Sr FrontEnd Dev"],
    ["Software Development Engineer", "SDE II", "SDE 2", "Sr SDE"],
    ["Site Reliability Engineer", "SRE", "Senior SRE"],
    ["Registered Nurse", "RN", "Registered Nurse (RN) - ICU", "Staff RN"],
    ["Customer Service Representative", "Customer Service Rep", "CSR", "Cust Service Rep"],
    ["Sales Development Representative", "SDR", "Sales Dev Rep"],
    ["Human Resources Business Partner", "HRBP", "HR Business Partner", "Sr. HRBP"],
    ["Accountant", "Acct", "Senior Accountant"],
    ["Vice President Finance", "VP Finance", "VP, Finance"],
    ["Machine Learning Engineer", "ML Engineer", "Sr. ML Engg", "MLE"],
    ["Data Analyst", "Data Analyst II", "Sr. Data Analyst", "DataAnalyst"],
    ["E-commerce Manager", "Ecommerce Manager", "eCommerce Mgr"],
    ["Business Analyst", "BA", "Sr. Business Analyst"],
  ];
  for (const g of groups) assert.equal(new Set(g.map(key)).size, 1, g.join(" / ") + " -> " + g.map(key).join(" / "));
  const skills: [string, string[], string[]][] = [
    ["Salesforce", [], ["SalesForce", "SFDC"]], ["MongoDB", [], ["Mongo DB", "mongo db", "Mongo"]],
    ["Spring Boot", [], ["SpringBoot", "spring-boot"]], ["SolidWorks", [], ["Solid Works", "solidworks"]], ["AutoCAD", [], ["Auto CAD"]],
    ["TensorFlow", [], ["Tensor Flow"]], ["scikit-learn", [], ["scikit learn", "sklearn"]], ["SharePoint", [], ["Share Point"]],
    ["SAP ERP", ["SAP S/4HANA"], ["S/4HANA", "S4HANA"]], ["Generative AI", [], ["GenAI", "Gen AI", "Gen-AI"]], ["Six Sigma", [], ["6 Sigma", "six-sigma"]],
    ["Microsoft Dynamics", [], ["D365", "Dynamics 365", "MS Dynamics"]], ["T-SQL", [], ["TSQL", "Transact-SQL"]], ["QuickBooks", [], ["Quick Books"]],
    ["Data Visualisation", [], ["data visualization", "Data-Visualisation"]], ["Data Modelling", [], ["data modeling"]], ["REST API", [], ["REST APIs"]],
  ];
  for (const [name, aliases, texts] of skills) {
    const m = buildSkillMatchers([{ skill_id: "X", name, aliases }]);
    for (const t of texts) assert.deepEqual(extractSkills(`We need ${t} experience.`, m), ["X"], `${name}: ${t}`);
  }
  const rails = buildSkillMatchers([{ skill_id: "R", name: "Ruby on Rails", aliases: [] }]);
  assert.deepEqual(extractSkills("Install guard rails on the line", rails), [], "plain 'rails' is not the framework");
  const sf = buildSkillMatchers([{ skill_id: "S", name: "Salesforce", aliases: [] }, { skill_id: "C", name: "Adobe Creative Suite", aliases: ["InDesign"] }]);
  assert.deepEqual(extractSkills("Lead a sales force of 20 people with experience in design reviews", sf), [], "ordinary phrases are not tools");
  const az = buildSkillMatchers([{ skill_id: "A", name: "Microsoft Azure", aliases: [] }]);
  assert.deepEqual(extractSkills("Deploy with Azure Functions", az), ["A"]);
});
