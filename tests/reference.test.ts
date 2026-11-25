/* Reference data (O*NET and other publishers): loading in any format, licence gate, releases, role links, outlook signals. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); process.env.AI_PROVIDER = "off"; (await import("../src/server/ai/llm")).resetAiStatus(); });

const f = (name: string, text: string) => ({ name, buffer: Buffer.from(text) });
const OCC = f("occupation_data.csv", `O*NET-SOC Code,Title,Description
13-2051.00,Financial and Investment Analysts,"Conduct quantitative analyses of information involving investment programs or financial data."
15-1252.00,Software Developers,"Research, design, and develop computer and network software."
51-9151.00,Photographic Process Workers and Processing Machine Operators,"Develop film."
29-1141.00,Registered Nurses,"Assess patient health problems and needs."`);
// tab-separated, like the O*NET text download
const TITLES = f("Alternate Titles.txt", ["O*NET-SOC Code\tTitle\tJob Title\tShort Title\tSource(s)",
  "13-2051.00\tFinancial and Investment Analysts\tFinancial Data Analyst\t\t08", "13-2051.00\tFinancial and Investment Analysts\tInvestment Analyst\t\t08",
  "15-1252.00\tSoftware Developers\tFull Stack Developer\t\t08", "51-9151.00\tPhotographic Process Workers and Processing Machine Operators\tFull Stack Developer\t\t08"].join("\n"));
const SKILLS = f("essential_skills.csv", `O*NET-SOC Code,Title,Element ID,Element Name,Scale ID,Scale Name,Data Value,N,Standard Error,Lower CI Bound,Upper CI Bound,Recommend Suppress,Not Relevant,Date,Domain Source
13-2051.00,Financial and Investment Analysts,2.A.1.e,Mathematics,IM,Importance,4.25,8,,,,N,,08/2023,Analyst
13-2051.00,Financial and Investment Analysts,2.A.1.e,Mathematics,LV,Level,5.10,8,,,,N,N,08/2023,Analyst
13-2051.00,Financial and Investment Analysts,2.A.2.a,Critical Thinking,IM,Importance,4.00,8,,,,N,,08/2023,Analyst
13-2051.00,Financial and Investment Analysts,2.A.2.a,Critical Thinking,LV,Level,4.00,8,,,,Y,N,08/2023,Analyst`);
const STYLES = f("work_styles.csv", `O*NET-SOC Code,Title,Element ID,Element Name,Scale ID,Scale Name,Data Value,Date,Domain Source
13-2051.00,Financial and Investment Analysts,1.D.3.a,Attention to Detail,WI,Work Styles Impact,2.60,12/2025,AI/Expert
13-2051.00,Financial and Investment Analysts,1.D.3.a,Attention to Detail,DR,Distinctiveness Rank,1,12/2025,AI/Expert`);
const SOFTWARE = f("software_skills.csv", `O*NET-SOC Code,Title,Workplace Example,Element ID,Element Name,Hot Technology,In Demand
13-2051.00,Financial and Investment Analysts,Python,2.E.6.a,Object or component oriented development software,Y,Y
13-2051.00,Financial and Investment Analysts,Microsoft Excel,2.E.2.a,Spreadsheet software,Y,Y
15-1252.00,Software Developers,Python,2.E.6.a,Object or component oriented development software,Y,Y
15-1252.00,Software Developers,SQL,2.E.6.b,Development environment software,Y,N
15-1252.00,Software Developers,Git,2.E.6.b,Development environment software,Y,N`);
// the O*NET OnLine export has a title block above the header
const BRIGHT = f("All_Bright_Outlook_Occupations.csv", `Browse Bright Outlook Occupations,,
All Bright Outlook Occupations,,
,,
Code,Occupation,Categories
13-2051.00,Financial and Investment Analysts,Rapid Growth; Numerous Job Openings
29-1141.00,Registered Nurses,Rapid Growth`);
const TASKS = f("emerging_tasks.csv", `O*NET-SOC Code,Title,Task,Category,Original Task ID,Original Task,Date,Domain Source
13-2051.00,Financial and Investment Analysts,Use machine learning models to forecast returns.,New,,,08/2025,Incumbent
13-2051.00,Financial and Investment Analysts,Evaluate ESG factors in investment decisions.,New,,,08/2025,Incumbent`);

async function zipOf(files: { name: string; buffer: Buffer }[]) { const z = new JSZip(); for (const x of files) z.file(`onet/${x.name}`, x.buffer); return { name: "onet.zip", buffer: await z.generateAsync({ type: "nodebuffer" }) }; }

let src = "";
test("Only the platform administrator manages reference data", async () => {
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.get("/reference/sources")).status, 403);
  assert.equal((await hr.post("/reference/sources", { publisher: "O*NET", name: "O*NET Database" })).status, 403);
});

test("Files in any order and format are recognised and loaded; unknown files are reported, not loaded", async () => {
  const pa = await T.as("admin@platform.demo");
  const c = await pa.post("/reference/sources", { publisher: "O*NET", name: "O*NET Database", version: "31.0" });
  assert.equal(c.status, 200, JSON.stringify(c.body)); src = c.body.id;
  const r = await pa.post(`/reference/sources/${src}/files`, { wait: true, files: [SOFTWARE, BRIGHT, await zipOf([OCC, TITLES]), SKILLS, STYLES, TASKS, f("notes.csv", "foo,bar\n1,2")] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.results.map((x: any) => [x.file, x]));
  assert.equal(by["occupation_data.csv"].format, "occupations");
  assert.equal(by["Alternate Titles.txt"].format, "alternate");
  assert.equal(by["essential_skills.csv"].format, "ratings");
  assert.equal(by["software_skills.csv"].format, "technology");
  assert.equal(by["All_Bright_Outlook_Occupations.csv"].format, "bright", "header found below the title block");
  assert.equal(by["emerging_tasks.csv"].format, "tasks");
  assert.equal(by["notes.csv"].format, null); assert.ok(by["notes.csv"].warnings[0]);
  assert.equal(r.body.counts.occupations, 4);
  assert.equal(r.body.counts.outlook_flags, 3);
  assert.equal(r.body.counts.ratings, 5, "the suppressed rating is left out");
  assert.ok(r.body.counts.skills_linked >= 3, "Python, SQL, Microsoft Excel... matched to the library");
  const d = (await pa.get(`/reference/sources/${src}`)).body;
  assert.equal(d.status, "Draft");
});

test("Nothing is published without a licence and attribution; a new release retires the old one, which can be put back", async () => {
  const pa = await T.as("admin@platform.demo");
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.get("/reference/roles/R001")).body.available, false, "drafts are not visible to organisations");
  const p1 = await pa.post(`/reference/sources/${src}/publish`);
  assert.equal(p1.status, 422); assert.equal(p1.body.error, "licence_required");
  assert.equal((await pa.patch(`/reference/sources/${src}`, { publisher: "O*NET", name: "O*NET Database", version: "31.0", licence: "CC BY 4.0", attribution: "Includes O*NET 31.0 data (USDOL/ETA), CC BY 4.0." })).status, 200);
  assert.equal((await pa.post(`/reference/sources/${src}/publish`)).body.status, "Active");
  assert.equal((await pa.post(`/reference/sources/${src}/files`, { files: [OCC] })).status, 422, "a published release is not changed");
  // a second release of the same dataset
  const c2 = (await pa.post("/reference/sources", { publisher: "O*NET", name: "O*NET Database", version: "31.1", licence: "CC BY 4.0", attribution: "Includes O*NET data." })).body.id;
  await pa.post(`/reference/sources/${c2}/files`, { wait: true, files: [OCC] });
  const p2 = (await pa.post(`/reference/sources/${c2}/publish`)).body;
  assert.deepEqual(p2.retired, [src]);
  assert.equal((await pa.del(`/reference/sources/${c2}`)).status, 422, "a published release cannot be deleted");
  assert.equal((await pa.post(`/reference/sources/${src}/publish`)).body.retired[0], c2, "putting the old release back retires the new one");
  const list = (await pa.get("/reference/sources")).body.sources;
  assert.equal(list.filter((s: any) => s.status === "Active").length, 1);
});

test("A role is linked to its occupation automatically; HR confirms or changes it within their organisation", async () => {
  const hr = await T.as("hr@finedge.demo");
  const r = (await hr.get("/reference/roles/R001")).body;
  assert.equal(r.available, true);
  assert.equal(r.link.code, "13-2051.00"); assert.equal(r.link.method, "auto");
  assert.equal(r.profile.title, "Financial and Investment Analysts");
  assert.deepEqual(r.profile.flags.sort(), ["Numerous Job Openings", "Rapid Growth"]);
  assert.equal(r.profile.work_styles[0].name, "Attention to Detail");
  assert.equal(r.profile.skills[0].name, "Mathematics"); assert.equal(r.profile.skills[0].level, 4, "O*NET level 5.1 of 7 -> 4");
  assert.equal(r.profile.emerging_tasks.length, 2);
  assert.ok(r.profile.attribution[0].attribution.includes("O*NET"));
  assert.ok(r.profile.technologies.some((t: any) => t.example === "Python" && t.in_demand && t.skill_id === "S002"));
  assert.equal((await hr.put("/reference/roles/R001", { code: "99-9999.99" })).status, 404, "unknown occupation");
  assert.equal((await hr.put("/reference/roles/R001", { code: "13-2051.00" })).body.method, "confirmed");
  const other = await T.as("hr@medicore.demo").catch(() => null);
  if (other) assert.equal((await other.put("/reference/roles/R001", { code: "29-1141.00" })).status, 404, "another organisation's role");
  const emp = await T.as("employee@finedge.demo");
  assert.equal((await emp.put("/reference/roles/R001", { code: "29-1141.00" })).status, 403);
});

test("Title ties are broken by the role's skills, and the keyword fallback handles .NET-style names", async () => {
  const { matchOccupations } = await import("../src/server/modules/reference");
  const m = await matchOccupations(T.db, "Full Stack Developer", 3, ["S001", "S002"]);
  assert.equal(m[0].title, "Software Developers", JSON.stringify(m));
});

test("The outlook uses the occupation's Bright Outlook flags and new tasks, and O*NET demand for skills, with reasons", async () => {
  const hr = await T.as("hr@finedge.demo");
  const o = (await hr.get("/outlook/roles/R001")).body;
  assert.equal(o.occupation.code, "13-2051.00");
  assert.ok(o.occupation.reasons.some((x: string) => /Bright Outlook/.test(x)));
  assert.ok(o.occupation.reasons.some((x: string) => /new tasks/.test(x)));
  assert.ok(o.advice.some((a: any) => /projected to grow/.test(a.text)));
  assert.ok(o.attribution.length >= 1);
  const py = o.skills.find((s: any) => s.skill_id === "S002");
  if (py) assert.ok(py.reasons.some((x: string) => /O\*NET/.test(x)), JSON.stringify(py.reasons));
  const org = (await hr.get("/outlook")).body;
  const row = org.roles.find((r: any) => r.id === "R001");
  assert.equal(row.label, o.label, "organisation view and role view agree");
  assert.deepEqual(row.outlook_flags.sort(), ["Numerous Job Openings", "Rapid Growth"]);
});

test("A drafted profile names its closest occupation, with the outlook signal", async () => {
  const hr = await T.as("hr@finedge.demo");
  const r = (await hr.post("/ai/role-drafts", { title: "Investment Analyst", wait: true })).body;
  assert.equal(r.draft.status, "Ready", JSON.stringify(r));
  assert.equal(r.draft.payload.reference?.code, "13-2051.00");
  assert.ok(r.draft.payload.outlook.occupation?.flags.includes("Rapid Growth"));
});
