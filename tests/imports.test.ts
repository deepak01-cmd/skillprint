/* Import centre: CSV / Excel uploads are previewed row by row, then committed in one transaction. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { setup } from "./helpers";
import { parseCsv } from "../src/server/files";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

const preview = async (who: any, entity: string, text: string, extra: any = {}) => (await who.post("/imports/preview", { entity, filename: `${entity}.csv`, text, ...extra })).body;

test("CSV parser handles quotes, embedded new lines, semicolons and a BOM", () => {
  const g = parseCsv('﻿name;definition\n"A; B";"line1\nline2"\nC;"say ""hi"""\n');
  assert.deepEqual(g, [["name", "definition"], ["A; B", "line1\nline2"], ["C", 'say "hi"']]);
});

test("Templates download for every entity and exports round-trip through preview", async () => {
  const hr = await T.as("hr@finedge.demo");
  const ents = (await hr.get("/imports/entities")).body;
  assert.equal(ents.length, 6);
  for (const e of ents) { const t = (await hr.get(`/imports/templates/${e.entity}`)).body; assert.ok(t.content.split("\r\n").length >= 2, e.entity); }
  const exp = (await hr.get("/exports/role_skills")).body;
  const p = await preview(hr, "role_skills", exp.content);
  assert.equal(p.summary.error, 0, JSON.stringify(p.rows.filter((r: any) => r.action === "error").slice(0, 3)));
  assert.equal(p.summary.create, 0, "exported requirements already exist");
  assert.ok(p.summary.skip > 50);
});

test("Skills import: new skills created, existing ones skipped, look-alikes flagged, bad rows reported", async () => {
  const hr = await T.as("hr@finedge.demo");
  const csv = "Skill Name,Description,Category,Aliases\n" +
    "Snowflake,Cloud data warehouse,Software & Platforms,Snowflake Data Cloud\n" +
    "SQL,,,\n" +
    "Power BI Reporting,Reports in Power BI,Technical,\n" +
    "No Definition Skill,,Technical,\n" +
    "Snowflake,dup,,\n";
  const p = await preview(hr, "skills", csv);
  const by = Object.fromEntries(p.rows.map((r: any) => [r.row, r]));
  assert.equal(by[2].action, "create");
  assert.equal(by[3].action, "skip");
  assert.equal(by[4].action, "skip"); assert.match(by[4].messages.join(), /Similar/);
  assert.equal(by[5].action, "error");
  assert.equal(by[6].action, "skip"); assert.match(by[6].messages.join(), /row 2/);
  const c = (await hr.post(`/imports/${p.id}/commit`)).body;
  assert.equal(c.applied.created, 1); assert.equal(c.applied.errors, 1);
  const s = await T.one(T.db, `SELECT * FROM skills WHERE name = 'Snowflake' AND org_id = 'C001'`);
  assert.deepEqual(s.aliases, ["Snowflake Data Cloud"]);
  assert.equal((await hr.post(`/imports/${p.id}/commit`)).status, 409, "a preview commits only once");
  const hist = (await hr.get("/imports")).body;
  assert.equal(hist[0].id, p.id); assert.equal(hist[0].status, "Committed");
});

test("Roles import with inline skills: creates draft roles, departments on request, and existing roles get a new draft version", async () => {
  const hr = await T.as("hr@finedge.demo");
  const csv = "Role,Department,Family,Level,Track,Alt Titles,Summary,Responsibilities,Skills\n" +
    `Treasury Analyst,Finance Ops,Finance,L3,IC,Cash Analyst,"Manages liquidity reporting","Forecast cash; Reconcile bank accounts","SQL:3:Mandatory:High; Excel:4; Unicorn Skill:3"\n` +
    `Financial Data Analyst,Data & Analytics,,,,,Updated summary,,\n` +
    `Broken Role,Nowhere,,,,,,,\n`;
  let p = await preview(hr, "roles", csv);
  assert.equal(p.rows[0].action, "error", "unknown department without the option");
  p = await preview(hr, "roles", csv, { options: { create_departments: true } });
  const [a, b, c] = p.rows;
  assert.equal(a.action, "create"); assert.ok(a.messages.some((m: string) => /Unicorn/.test(m)));
  assert.equal(b.action, "update"); assert.match(b.messages.join(), /new draft version/);
  assert.equal(c.action, "create", "Nowhere is created too");
  const r = (await hr.post(`/imports/${p.id}/commit`)).body;
  assert.equal(r.applied.created, 2); assert.equal(r.applied.updated, 1);
  const role = await T.one(T.db, `SELECT r.*, d.name AS dept FROM job_roles r JOIN departments d ON d.id = r.department_id WHERE r.title = 'Treasury Analyst' AND r.org_id = 'C001'`);
  assert.equal(role.status, "Draft"); assert.equal(role.dept, "Finance Ops"); assert.deepEqual(role.responsibilities, ["Forecast cash", "Reconcile bank accounts"]);
  const maps = await T.q(T.db, `SELECT * FROM role_skill_mapping WHERE role_id = $1`, [role.id]);
  assert.equal(maps.length, 2); assert.ok(maps.every((m: any) => m.approval_status === "Draft"));
  const da = await T.one(T.db, `SELECT status, summary FROM job_roles WHERE id = 'R001'`);
  assert.equal(da.status, "Draft"); assert.equal(da.summary, "Updated summary");
  await T.q(T.db, `UPDATE job_roles SET status = 'Published' WHERE id = 'R001'`);
});

test("Job descriptions become draft roles with responsibilities and extracted skills", async () => {
  const hr = await T.as("hr@finedge.demo");
  const jd = "Responsibilities:\n- Build Power BI dashboards for finance\n- Write SQL queries against the warehouse\n- Automate reports with Python\nRequirements:\n3+ years of experience. Bachelor's degree in a quantitative field.";
  const csv = `Job Title,Department,Job Description\nFinance Reporting Analyst,Data & Analytics,"${jd}"\nBackend Developer,Technology & Engineering,"${jd}"\n`;
  const p = await preview(hr, "job_descriptions", csv);
  assert.equal(p.rows[0].action, "create"); assert.match(p.rows[0].messages[0], /SQL/);
  assert.equal(p.rows[1].action, "skip", "existing roles are skipped by default");
  await hr.post(`/imports/${p.id}/commit`);
  const role = await T.one(T.db, `SELECT * FROM job_roles WHERE title = 'Finance Reporting Analyst'`);
  assert.equal(role.status, "Draft"); assert.ok(role.responsibilities.length >= 3);
  const skills = await T.q(T.db, `SELECT s.name FROM role_skill_mapping m JOIN skills s ON s.id = m.skill_id WHERE m.role_id = $1`, [role.id]);
  for (const n of ["SQL", "Python"]) assert.ok(skills.some((s: any) => s.name.startsWith(n)), n);
});

test("Role-skill requirements: draft mode sends published changes for approval; publish mode needs an approver", async () => {
  const hr = await T.as("hr@finedge.demo");
  const head = await T.as("head.dataanalytics@finedge.demo");
  const cur = await T.one(T.db, `SELECT m.*, s.name FROM role_skill_mapping m JOIN skills s ON s.id = m.skill_id WHERE m.role_id = 'R001' AND m.approval_status = 'Published' AND m.lifecycle_status = 'Active' ORDER BY m.pixel_id LIMIT 1`);
  const newLevel = cur.required_level === 5 ? 4 : cur.required_level + 1;
  const csv = `role,skill,required_level,requirement_type,importance\nFinancial Data Analyst,${cur.name},${newLevel},${cur.requirement_type},${cur.importance}\nFinancial Data Analyst,Snowflake,Advanced,Preferred,High\nFinancial Data Analyst,Nonexistent,3,Mandatory,High\nFinancial Data Analyst,SQL,9,Mandatory,High\n`;
  assert.equal((await head.post("/imports/preview", { entity: "role_skills", filename: "x.csv", text: csv, mode: "publish" })).status, 403);
  const p = await preview(head, "role_skills", csv);
  assert.deepEqual(p.rows.map((r: any) => r.action), ["update", "create", "error", "error"]);
  const r = (await head.post(`/imports/${p.id}/commit`)).body;
  assert.equal(r.applied.change_requests, 2);
  const unchanged = await T.one(T.db, `SELECT required_level FROM role_skill_mapping WHERE pixel_id = $1`, [cur.pixel_id]);
  assert.equal(unchanged.required_level, cur.required_level, "published value unchanged until approved");
  const changes = (await hr.get("/changes?status=In Review")).body;
  const cr = (changes.items || changes).find((c: any) => c.entity_id === cur.pixel_id);
  assert.ok(cr, "change request visible to HR");
  await hr.post(`/changes/${cr.id}/decide`, { decision: "approve" });
  assert.equal((await T.one(T.db, `SELECT required_level FROM role_skill_mapping WHERE pixel_id = $1`, [cur.pixel_id])).required_level, newLevel);
});

test("Employees import from Excel: matched people created with managers, unknown titles queued, nobody dropped", async () => {
  const hr = await T.as("hr@finedge.demo");
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("People");
  ws.addRow(["Employee ID", "Full Name", "Work Email", "Dept", "Job Title", "Manager Email", "Start Date"]);
  ws.addRow(["X1", "Mia Lead", "mia.lead@x.com", "Data & Analytics", "BI Analyst", "", new Date("2024-01-15")]);
  ws.addRow(["X2", "Raj Report", "raj.report@x.com", "Data & Analytics", "Business Intelligence Analyst", "mia.lead@x.com", new Date("2025-02-01")]);
  ws.addRow(["X3", "Zed Quant", "zed.quant@x.com", "Data & Analytics", "Quant Wizard", "", ""]);
  ws.addRow(["X4", "Bad Email", "not-an-email", "Data & Analytics", "BI Analyst", "", ""]);
  const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  const p = (await hr.post("/imports/preview", { entity: "employees", filename: "people.xlsx", base64 })).body;
  assert.deepEqual(p.rows.map((r: any) => r.action), ["create", "create", "queue", "error"]);
  const r = (await hr.post(`/imports/${p.id}/commit`)).body;
  assert.equal(r.applied.created, 2); assert.equal(r.applied.queued, 1);
  const raj = await T.one(T.db, `SELECT e.*, m.email AS mgr FROM employees e LEFT JOIN employees m ON m.id = e.manager_id WHERE e.email = 'raj.report@x.com'`);
  assert.equal(raj.mgr, "mia.lead@x.com"); assert.equal(raj.joining_date.toISOString().slice(0, 10), "2025-02-01");
  const qi = await T.one(T.db, `SELECT * FROM role_resolution_queue WHERE org_id = 'C001' AND raw_title = 'Quant Wizard'`);
  assert.ok(qi, "unknown title waits in the queue");
});

test("Permissions: employees cannot import; missing columns are explained", async () => {
  const emp = await T.as("employee@finedge.demo");
  assert.equal((await emp.post("/imports/preview", { entity: "skills", filename: "s.csv", text: "name\nX" })).status, 403);
  const hr = await T.as("hr@finedge.demo");
  const r = await hr.post("/imports/preview", { entity: "role_skills", filename: "s.csv", text: "role,skill\nA,B" });
  assert.equal(r.status, 422); assert.match(r.body.message || r.body.error?.message || JSON.stringify(r.body), /required_level/);
});

test("Uploads started on a screen inherit its context: a role page needs no role column, a department head's roles land in their department", async () => {
  const hr = await T.as("hr@finedge.demo");
  const t = (await hr.get("/imports/templates/role_skills?without=role")).body;
  assert.ok(!t.content.split("\r\n")[0].split(",").includes("role"), "template for a role page has no role column");
  const missing = await hr.post("/imports/preview", { entity: "role_skills", filename: "x.csv", text: "skill,required_level\nGit,2" });
  assert.equal(missing.status, 422, "without the role context the role column is required");
  const p = (await hr.post("/imports/preview", { entity: "role_skills", filename: "x.csv", text: "skill\tlevel\nGit\t2", options: { role_id: "R003" } })).body;
  assert.equal(p.rows[0].action, "create"); assert.equal(p.rows[0].key, "Git");
  const head = await T.as("head.dataanalytics@finedge.demo");
  const r = (await head.post("/imports/preview", { entity: "roles", filename: "r.csv", text: "title\nRisk Data Steward", options: { default_department: "D001" } })).body;
  assert.equal(r.rows[0].action, "create", JSON.stringify(r.rows[0]));
  const other = (await head.post("/imports/preview", { entity: "roles", filename: "r.csv", text: "title\nRisk Data Steward", options: { default_department: "D002" } })).body;
  assert.equal(other.rows[0].action, "error", "not into another department");
});

test("Look-alike check uses whole words: a one-letter skill such as R is not similar to every name", async () => {
  const { findDuplicates } = await import("../src/server/modules/skills");
  await T.q(T.db, `INSERT INTO skills (org_id, name, definition, category) SELECT NULL, 'R', 'R language', 'Programming & Query Languages' WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = 'R')`);
  const d = await findDuplicates(T.db, "C001", "Hydroponic Farming");
  assert.ok(!d.some((x: any) => x.name === "R"), JSON.stringify(d));
  const sql = await findDuplicates(T.db, "C001", "Advanced SQL");
  assert.ok(sql.some((x: any) => x.name === "SQL"), "whole-word containment still flags");
});
