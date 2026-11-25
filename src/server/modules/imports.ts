/* Import centre: bulk upload of skills, departments, roles, role-skill requirements, job descriptions and employees
   from CSV or Excel. Every upload is previewed row by row (create / update / skip / queue / error) before anything
   is written, then committed in one transaction and kept as a record with its report.
   Modes: "draft" (default) creates drafts and change requests that follow the approval flow;
          "publish" (HR administrators only) applies directly and is recorded as approved by the importer. */
import { z } from "zod";
import { PoolClient } from "pg";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { readTable, splitList, toCsv } from "../files";
import { canonicalSpelling, spellingsOf } from "../terms";
import { applyMappingUpdate, applyRestore, buildPixelId } from "./mapping";
import { findDuplicates } from "./skills";
import { enqueue, normalizeTitle, resolveRoleTitle } from "./roleFallback";
import { parseJobDescription } from "./structure";

type Entity = "skills" | "departments" | "roles" | "role_skills" | "job_descriptions" | "employees";
type Row = Record<string, string>;
interface Plan { row: number; action: "create" | "update" | "skip" | "queue" | "error"; key: string; target?: string | null; messages: string[]; data: Row; extra?: any }

const SPECS: Record<Entity, { fields: Record<string, string[]>; required: string[]; label: string; example: string[][] }> = {
  skills: {
    label: "Skills", required: ["name"],
    fields: { name: ["skill", "skill name", "skillname"], definition: ["description", "desc", "skill definition"], category: ["skill category", "group", "skill group"], aliases: ["synonyms", "alternative names", "alias", "other names"], type: ["skill type"], parent: ["parent skill"] },
    example: [["name", "definition", "category", "aliases", "type", "parent"], ["Snowflake", "Load, model and query data in the Snowflake cloud data warehouse.", "Software & Platforms", "Snowflake Data Cloud", "Technical", "Cloud Data Warehousing"], ["Stakeholder Reporting", "Prepare clear periodic reports for business stakeholders.", "Functional", "", "Functional", ""]],
  },
  departments: {
    label: "Departments", required: ["name"],
    fields: { name: ["department", "department name", "dept"], parent: ["parent department", "parent dept"], location: ["site", "office"] },
    example: [["name", "parent", "location"], ["Data Platform", "Data & Analytics", "Bengaluru"]],
  },
  roles: {
    label: "Roles", required: ["title", "department"],
    fields: { title: ["role", "role name", "role title", "job title", "jobtitle", "position"], department: ["dept", "department name"], job_family: ["family", "jobfamily", "job family name"], career_level: ["level", "grade", "career level code"], career_track: ["track"], alt_titles: ["alternative titles", "alt titles", "other titles", "aliases"], summary: ["role summary", "purpose", "description"], responsibilities: ["duties", "key responsibilities"], outcomes: ["expected outcomes", "deliverables", "kpis"], experience: ["required experience", "years of experience"], education: ["qualification", "qualifications"], skills: ["required skills", "skill requirements"] },
    example: [["title", "department", "job_family", "career_level", "career_track", "alt_titles", "summary", "responsibilities", "outcomes", "experience", "education", "skills"],
      ["Senior Data Analyst", "Data & Analytics", "Data Analyst", "L4", "Individual Contributor", "Reporting Lead; Senior BI Analyst", "Leads analysis for the sales function.", "Build Power BI dashboards; Write SQL for sales data; Present insights to managers", "Trusted weekly reporting; Insights adopted by sales", "5+ years", "Bachelor's degree", "SQL:4:Mandatory:Critical; Power BI:4:Mandatory:High; Python:3:Preferred:Medium"]],
  },
  role_skills: {
    label: "Role skill requirements", required: ["role", "skill", "required_level"],
    fields: { role: ["role name", "role title", "job title", "role id", "roleid"], skill: ["skill name", "skill id", "skillid"], required_level: ["level", "required level", "proficiency", "required proficiency"], requirement_type: ["requirement", "type", "mandatory", "requirement type"], importance: ["priority", "criticality"], trend: ["skill trend"], explanation: ["why", "rationale", "notes", "comment"] },
    example: [["role", "skill", "required_level", "requirement_type", "importance", "trend", "explanation"], ["Financial Data Analyst", "SQL", "4", "Mandatory", "High", "Current", "Queries ledger and market data daily"], ["R001", "Generative AI for Data Analytics", "Foundational", "Optional", "Medium", "Emerging", ""]],
  },
  job_descriptions: {
    label: "Job descriptions", required: ["title", "description"],
    fields: { title: ["job title", "role", "position", "role title"], department: ["dept", "department name"], description: ["job description", "jd", "text", "details", "full description"], job_family: ["family"], career_level: ["level", "grade"] },
    example: [["title", "department", "description", "job_family", "career_level"], ["Reporting Analyst", "Data & Analytics", "Responsibilities:\n- Build Power BI dashboards\n- Write SQL to extract sales data\n- Automate reports in Python\nRequirements:\n3+ years in reporting. Bachelor's degree.", "Data Analyst", "L3"]],
  },
  employees: {
    label: "Employees", required: ["name", "email", "department", "role"],
    fields: { employee_id: ["employee id", "emp id", "staff id", "employee number", "employee no", "employee code", "emp code", "emp no"], name: ["full name", "employee name"], email: ["email address", "work email", "mail"], department: ["dept", "department name"], role: ["job title", "title", "role name", "position", "designation"], manager_email: ["manager", "manager email", "reports to"], location: ["office", "site"], joining_date: ["start date", "hire date", "joining", "date of joining"] },
    example: [["employee_id", "name", "email", "department", "role", "manager_email", "location", "joining_date"], ["E9001", "Asha Rao", "asha.rao@example.com", "Data & Analytics", "BI Analyst", "", "Bengaluru", "2025-04-01"]],
  },
};

const LEVEL_WORDS: Record<string, number> = { awareness: 1, foundational: 2, basic: 2, beginner: 2, competent: 3, intermediate: 3, proficient: 3, advanced: 4, expert: 5, master: 5 };
function parseLevel(v: string): number | null {
  const s = (v || "").toLowerCase().trim();
  const n = s.match(/^l?(\d)/); if (n && +n[1] >= 1 && +n[1] <= 5) return +n[1];
  for (const [w, l] of Object.entries(LEVEL_WORDS)) if (s.includes(w)) return l;
  return null;
}
function parseReq(v: string) {
  const s = (v || "").toLowerCase();
  if (!s) return "Mandatory";
  if (/mand|requir|must|essential|yes|^y$/.test(s)) return "Mandatory";
  if (/prefer|nice|desir/.test(s)) return "Preferred";
  if (/develop|future/.test(s)) return "Developmental";
  if (/option|no|^n$/.test(s)) return "Optional";
  return null;
}
function parseImp(v: string) {
  const s = (v || "").toLowerCase();
  if (!s) return "Medium";
  if (/crit/.test(s)) return "Critical"; if (/high/.test(s)) return "High"; if (/med/.test(s)) return "Medium"; if (/low/.test(s)) return "Low";
  return null;
}
function parseTrend(v: string) {
  const s = (v || "").toLowerCase();
  if (!s || /curr|stable/.test(s)) return "Current"; if (/emerg|grow/.test(s)) return "Emerging"; if (/declin/.test(s)) return "Declining";
  return null;
}
const TRACKS: Record<string, string> = { ic: "Individual Contributor", individual: "Individual Contributor", "individual contributor": "Individual Contributor", management: "Management", manager: "Management", technical: "Technical Leadership", "technical leadership": "Technical Leadership" };

/* ---------- lookups loaded once per import ---------- */
async function loadContext(db: Db, orgId: string | null) {
  const depts = orgId ? await q(db, `SELECT id, name, status FROM departments WHERE org_id = $1`, [orgId]) : [];
  const families = orgId ? await q(db, `SELECT id, name FROM job_families WHERE org_id = $1`, [orgId]) : [];
  const levels = orgId ? await q(db, `SELECT id, code, name, rank FROM career_levels WHERE org_id = $1`, [orgId]) : [];
  const skills = await q(db, `SELECT id, name, aliases, org_id FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const roles = orgId ? await q(db, `SELECT id, title, alt_titles, status, department_id FROM job_roles WHERE org_id = $1 AND status <> 'Archived'`, [orgId]) : [];
  const skillBy = new Map<string, any>();
  // names, aliases and their spelling variants ("dotnet", "Dot Net" and ".NET" find the same skill)
  for (const s of skills) { skillBy.set(s.id.toLowerCase(), s); for (const t of [s.name, ...(s.aliases || [])]) for (const sp of spellingsOf(t)) if (!skillBy.has(sp.toLowerCase())) skillBy.set(sp.toLowerCase(), s); skillBy.set(s.name.toLowerCase(), s); }
  return {
    depts, families, levels, skills, roles, skillBy,
    dept: (name: string) => depts.find(d => d.name.toLowerCase() === name.toLowerCase().trim() || d.id.toLowerCase() === name.toLowerCase().trim()),
    family: (name: string) => families.find(f => f.name.toLowerCase() === name.toLowerCase().trim()),
    level: (v: string) => { const s = v.toLowerCase().trim(); return levels.find(l => l.code.toLowerCase() === s || l.name.toLowerCase() === s || String(l.rank) === s.replace(/^l/, "")); },
    skill: (v: string) => skillBy.get(v.toLowerCase().trim()) || skillBy.get(canonicalSpelling(v).toLowerCase()) || skillBy.get(v.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim()),
    role: (v: string, deptId?: string | null) => {
      const s = v.toLowerCase().trim();
      const byId = roles.find(r => r.id.toLowerCase() === s); if (byId) return byId;
      const all = roles.filter(r => [r.title, ...(r.alt_titles || [])].some((t: string) => t.toLowerCase() === s));
      return (deptId && all.find(r => r.department_id === deptId)) || all[0];
    },
  };
}
type Ctx = Awaited<ReturnType<typeof loadContext>>;

/** Parse "SQL:4:Mandatory:High; Python:3" into requirement lines. */
function parseInlineSkills(v: string, ctx: Ctx) {
  const lines: any[] = [], problems: string[] = [];
  for (const part of splitList(v.replace(/,(?![^()]*\))/g, ";"))) {
    const [name, lvl, req, imp] = part.split(":").map(s => s.trim());
    const sk = ctx.skill(name);
    if (!sk) { problems.push(`unknown skill "${name}"`); continue; }
    lines.push({ skill_id: sk.id, skill_name: sk.name, required_level: parseLevel(lvl || "3") ?? 3, requirement_type: parseReq(req || "") ?? "Mandatory", importance: parseImp(imp || "") ?? "Medium" });
  }
  return { lines, problems };
}

/* ---------- planning: decide what each row will do, without writing ---------- */
async function plan(db: Db, u: User, entity: Entity, rows: Row[], mode: string, options: any): Promise<Plan[]> {
  const orgId = u.org_id;
  const ctx = await loadContext(db, orgId);
  const out: Plan[] = [];
  const seen = new Map<string, number>();
  const dup = (key: string, row: number) => { const k = key.toLowerCase(); if (seen.has(k)) return seen.get(k); seen.set(k, row); return undefined; };

  for (const r of rows) {
    const row = Number(r.__row); const m: string[] = [];
    const push = (action: Plan["action"], key: string, target?: string | null, extra?: any) => out.push({ row, action, key, target, messages: m, data: r, extra });
    if (entity === "skills") {
      const name = r.name;
      if (!name) { m.push("Skill name is empty"); push("error", ""); continue; }
      const d = dup(name, row); if (d) { m.push(`Same skill as row ${d}`); push("skip", name); continue; }
      const existing = ctx.skill(name);
      if (existing) {
        if (existing.org_id && existing.org_id === orgId && (r.definition || r.category || r.aliases)) { m.push(`Updates your company skill ${existing.id}`); push("update", name, existing.id); }
        else { m.push(`Already in the library as ${existing.name} (${existing.id})${existing.org_id ? "" : ", a global skill"}`); push("skip", name, existing.id); }
        continue;
      }
      if (!r.definition) m.push("No definition given; one is required for new skills");
      if (!r.category) m.push("No category given; 'Uncategorised' will be used");
      const sim = (await findDuplicates(db, orgId, name, splitList(r.aliases))).filter(s => !s.exact);
      if (sim.length && !options.create_similar) { m.push(`Similar to ${sim.slice(0, 3).map(s => `${s.name} (${s.id})`).join(", ")}. Skipped; tick "create similar skills" to add anyway`); push("skip", name, sim[0].id); continue; }
      if (sim.length) m.push(`Similar to ${sim.slice(0, 2).map(s => s.name).join(", ")}; created as a separate skill`);
      if (r.parent && !ctx.skill(r.parent) && !rows.some(x => x.name?.toLowerCase() === r.parent.toLowerCase())) m.push(`Parent skill "${r.parent}" not found; ignored`);
      push(r.definition ? "create" : "error", name);
    }
    else if (entity === "departments") {
      if (!r.name) { m.push("Department name is empty"); push("error", ""); continue; }
      if (dup(r.name, row)) { m.push("Duplicate in this file"); push("skip", r.name); continue; }
      const ex = ctx.dept(r.name);
      if (ex) { m.push(`Exists as ${ex.id}`); push(r.parent || r.location ? "update" : "skip", r.name, ex.id); continue; }
      if (r.parent && !ctx.dept(r.parent) && !rows.some(x => x.name?.toLowerCase() === r.parent.toLowerCase())) m.push(`Parent "${r.parent}" not found; created without a parent`);
      push("create", r.name);
    }
    else if (entity === "roles" || entity === "job_descriptions") {
      const title = r.title;
      if (!title) { m.push("Role title is empty"); push("error", ""); continue; }
      const deptName = r.department || options.default_department || "";
      let dept = deptName ? ctx.dept(deptName) : null;
      if (!dept && deptName && options.create_departments) m.push(`Department "${deptName}" will be created`);
      else if (!dept) { m.push(deptName ? `Unknown department "${deptName}". Tick "create missing departments" or fix the name` : "Department is empty"); push("error", title); continue; }
      if (dept && dept.status === "Archived") { m.push(`Department "${dept.name}" is archived`); push("error", title); continue; }
      if (dept && !inDeptScope(u, "roles:write", dept.id)) { m.push("You can import roles only for your department"); push("error", title); continue; }
      const d = dup(`${title}|${deptName}`, row); if (d) { m.push(`Same role as row ${d}`); push("skip", title); continue; }
      if (r.career_level && !ctx.level(r.career_level)) m.push(`Unknown career level "${r.career_level}"; left empty`);
      if (r.career_track && !TRACKS[r.career_track.toLowerCase()]) m.push(`Unknown career track "${r.career_track}"; Individual Contributor used`);
      if (r.job_family && !ctx.family(r.job_family)) m.push(`Job family "${r.job_family}" will be created`);
      let existing = ctx.role(title, dept?.id);
      if (!existing && orgId) {
        const res = await resolveRoleTitle(db, orgId, title, dept?.id);
        if (res.status === "matched") { existing = ctx.roles.find(x => x.id === res.role!.id); if (existing) m.push(`Matched to existing role "${existing.title}" (${res.method === "normalized" ? "same title after normalisation" : "same title"})`); }
      }
      let skillLines: any[] = [];
      if (entity === "roles" && r.skills) { const p = parseInlineSkills(r.skills, ctx); skillLines = p.lines; p.problems.forEach(x => m.push(`Skills: ${x}; that skill is ignored`)); }
      if (entity === "job_descriptions") {
        if ((r.description || "").length < 30) { m.push("Description is too short to extract anything useful"); push("error", title); continue; }
        const jd = await parseJobDescription(db, orgId!, `Title: ${title}\n${r.description}`);
        skillLines = jd.suggested_skills.map((s: any) => ({ skill_id: s.skill_id, skill_name: s.name, required_level: 3, requirement_type: "Mandatory", importance: "Medium", basis: s.matched_term }));
        m.push(`Found ${jd.responsibilities.length} responsibilities and ${skillLines.length} library skills${skillLines.length ? `: ${skillLines.slice(0, 6).map(s => s.skill_name).join(", ")}${skillLines.length > 6 ? "…" : ""}` : ""}`);
        r.__responsibilities = JSON.stringify(jd.responsibilities); r.__outcomes = JSON.stringify(jd.outcomes); r.__experience = jd.experience || ""; r.__education = jd.education || "";
      }
      if (existing) {
        if (entity === "job_descriptions" && !options.update_existing) { m.push(`Role exists (${existing.id}); skipped. Tick "update existing roles" to add the description's details`); push("skip", title, existing.id, { skills: skillLines }); continue; }
        if (existing.status === "In Review") { m.push(`Role ${existing.id} has a change in review; skipped`); push("skip", title, existing.id); continue; }
        m.push(existing.status === "Published" ? (mode === "publish" ? "Updates the published role directly (new version)" : "Creates a new draft version of the published role") : "Updates the draft role");
        push("update", title, existing.id, { skills: skillLines });
      } else push("create", title, null, { skills: skillLines });
    }
    else if (entity === "role_skills") {
      const role = ctx.role(r.role || options.role_id || "");
      const sk = ctx.skill(r.skill || "");
      const lvl = parseLevel(r.required_level), req = parseReq(r.requirement_type), imp = parseImp(r.importance), tr = parseTrend(r.trend);
      if (!role) { const s = r.role && orgId ? await resolveRoleTitle(db, orgId, r.role) : null; m.push(`Unknown role "${r.role}"${s?.candidates?.[0] ? `. Did you mean ${s.candidates[0].title}?` : ""}`); }
      if (!sk) m.push(`Unknown skill "${r.skill}". Import it first on the Skills tab, or check the spelling`);
      if (!lvl) m.push(`Required level "${r.required_level}" is not 1-5 or a level name`);
      if (!req) m.push(`Requirement type "${r.requirement_type}" is not Mandatory, Preferred, Optional or Developmental`);
      if (!imp) m.push(`Importance "${r.importance}" is not Critical, High, Medium or Low`);
      if (!tr) m.push(`Trend "${r.trend}" is not Current, Emerging or Declining`);
      if (!role || !sk || !lvl || !req || !imp || !tr) { push("error", r.role ? `${r.role} / ${r.skill}` : r.skill || ""); continue; }
      if (!inDeptScope(u, "framework:draft", role.department_id)) { m.push("You can change frameworks only for your department"); push("error", `${role.title} / ${sk.name}`); continue; }
      const pid = buildPixelId(role.id, sk.id); const label = options.role_id ? sk.name : `${role.title} · ${sk.name}`;
      const d = dup(pid, row); if (d) { m.push(`Same requirement as row ${d}`); push("skip", label, pid); continue; }
      const ex = await one(db, `SELECT m.*, (SELECT id FROM change_requests c WHERE c.org_id = m.org_id AND c.entity_type = 'mapping' AND c.entity_id = m.pixel_id AND c.status = 'In Review' LIMIT 1) AS pending FROM role_skill_mapping m WHERE m.org_id = $1 AND m.pixel_id = $2`, [orgId, pid]);
      const fields = { required_level: lvl, requirement_type: req, importance: imp, skill_trend: tr, explanation: r.explanation || "" };
      if (!ex) { m.push(role.status === "Published" ? (mode === "publish" ? "New requirement, published directly" : "New requirement as a draft for approval") : "New requirement on a draft role"); push("create", label, role.id, { fields, role_status: role.status, skill_id: sk.id }); continue; }
      if (ex.pending) { m.push(`${pid} has a change in review (${ex.pending}); skipped`); push("skip", label, pid); continue; }
      if (ex.lifecycle_status === "Archived") {
        if (mode === "publish") { m.push(`${pid} is archived; it will be restored with the same Pixel ID and updated`); push("update", label, pid, { fields, restore: true }); }
        else { m.push(`${pid} is archived. Use publish mode to restore it, or restore it on the role page`); push("skip", label, pid); }
        continue;
      }
      const changed = Object.entries(fields).filter(([k, v]) => k !== "explanation" ? ex[k] !== v : v && ex[k] !== v);
      if (!changed.length) { m.push("No change"); push("skip", label, pid); continue; }
      m.push(`Changes ${changed.map(([k, v]) => `${k.replace(/_/g, " ")} ${ex[k]} → ${v}`).join(", ")}${ex.approval_status === "Published" && mode !== "publish" ? " (sent for approval)" : ""}`);
      push("update", label, pid, { fields, published: ex.approval_status === "Published" });
    }
    else if (entity === "employees") {
      const email = (r.email || "").toLowerCase();
      if (!r.name) m.push("Name is empty");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) m.push(`Invalid email "${r.email}"`);
      const dept = r.department ? ctx.dept(r.department) : null;
      if (!dept) m.push(`Unknown department "${r.department}"`);
      if (m.length) { push("error", email); continue; }
      const d = dup(email, row); if (d) { m.push(`Same email as row ${d}`); push("skip", email); continue; }
      // the company's own employee number: kept as given, never used as the system ID, unique within the organisation
      const code = (r.employee_id || "").trim();
      if (code) {
        if (code.length > 40 || !/^[\w./-]+$/.test(code)) { m.push(`Employee number "${code}" may use letters, digits and . / - _ only (up to 40)`); push("error", email); continue; }
        const twin = rows.find(x => x !== r && (x.employee_id || "").trim().toLowerCase() === code.toLowerCase() && (x.email || "").toLowerCase() !== email);
        if (twin) { m.push(`Employee number ${code} is also used by ${twin.email} in row ${twin.__row}`); push("error", email); continue; }
        const owner = await one(db, `SELECT id, name, email FROM employees WHERE org_id = $1 AND lower(employee_code) = lower($2)`, [orgId, code]);
        if (owner && owner.email.toLowerCase() !== email) { m.push(`Employee number ${code} already belongs to ${owner.name} (${owner.id})`); push("error", email); continue; }
      }
      if (r.joining_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.joining_date)) m.push(`Joining date "${r.joining_date}" is not YYYY-MM-DD; left empty`);
      const res = await resolveRoleTitle(db, orgId!, r.role, dept!.id);
      const roleOk = res.status === "matched" && res.role!.status === "Published";
      if (roleOk && res.method !== "exact") m.push(`Role "${r.role}" matched to ${res.role!.title}`);
      if (r.manager_email && !rows.some(x => (x.email || "").toLowerCase() === r.manager_email.toLowerCase()) && !(await one(db, `SELECT 1 FROM employees WHERE org_id = $1 AND lower(email) = lower($2)`, [orgId, r.manager_email])))
        m.push(`Manager ${r.manager_email} not found; left empty`);
      const ex = await one(db, `SELECT id FROM employees WHERE org_id = $1 AND lower(email) = $2`, [orgId, email]);
      if (!roleOk) { m.push(`Role "${r.role}" is not a published role. The person waits in Role resolution until the title is resolved`); push(ex ? "skip" : "queue", email, ex?.id, { dept_id: dept!.id, suggestions: res }); continue; }
      if (ex) { m.push(`Updates employee ${ex.id}`); push("update", email, ex.id, { dept_id: dept!.id, role_id: res.role!.id }); }
      else push("create", email, null, { dept_id: dept!.id, role_id: res.role!.id });
    }
  }
  return out;
}

/* ---------- commit ---------- */
async function commit(c: PoolClient, u: User, job: any): Promise<{ applied: Record<string, number>; results: any[] }> {
  const orgId: string | null = job.org_id; const mode = job.mode; const options = job.options || {};
  const label = mode === "publish" ? `${u.name} (bulk import ${job.id}, approved by importer)` : `${u.name} (bulk import ${job.id})`;
  const ctx = await loadContext(c, orgId);
  const plans: Plan[] = job.rows;
  const applied: Record<string, number> = { created: 0, updated: 0, queued: 0, skipped: 0, errors: 0, change_requests: 0 };
  const results: any[] = [];
  const ensureDept = async (name: string) => {
    let d = ctx.dept(name); if (d) return d;
    d = await one(c, `INSERT INTO departments (org_id, name) VALUES ($1,$2) RETURNING id, name, status`, [orgId, name.trim()]);
    ctx.depts.push(d); await audit(c, u, { entity_type: "department", entity_id: d.id, action: "created", reason: `bulk import ${job.id}` }); return d;
  };
  const ensureFamily = async (name: string) => {
    if (!name) return null; let f = ctx.family(name); if (f) return f;
    f = await one(c, `INSERT INTO job_families (org_id, name) VALUES ($1,$2) RETURNING id, name`, [orgId, name.trim()]); ctx.families.push(f); return f;
  };
  const insertMapping = async (roleId: string, s: any, publish: boolean, explanation: string) => {
    const pid = buildPixelId(roleId, s.skill_id);
    const r = await one(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, trend_rationale, explanation, approval_status, lifecycle_status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,$11,'Active',$12) ON CONFLICT (org_id, role_id, skill_id) DO NOTHING RETURNING pixel_id`,
      [orgId, pid, roleId, s.skill_id, s.required_level, s.requirement_type, s.importance, s.skill_trend || "Current", s.skill_trend === "Emerging" ? "Increasing" : s.skill_trend === "Declining" ? "Decreasing" : "Stable", explanation, publish ? "Published" : "Draft", label]);
    if (r) await audit(c, u, { entity_type: "mapping", entity_id: pid, action: publish ? "imported_published" : "imported_draft", after: s, reason: `bulk import ${job.id}` });
    return !!r;
  };

  for (const p of plans) {
    const r = p.data; let outcome = p.action as string; let target = p.target ?? null; const notes: string[] = [];
    try {
      if (p.action === "error") { applied.errors++; results.push({ row: p.row, outcome: "error", key: p.key, messages: p.messages }); continue; }
      if (p.action === "skip") { applied.skipped++; results.push({ row: p.row, outcome: "skipped", key: p.key, target, messages: p.messages }); continue; }
      if (job.entity === "skills") {
        const parent = r.parent ? ctx.skill(r.parent) : null;
        if (p.action === "create") {
          const s = await one(c, `INSERT INTO skills (org_id, name, definition, category, type, aliases, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, aliases, org_id`,
            [orgId, r.name, r.definition, r.category || "Uncategorised", r.type || "Technical / functional / industry", splitList(r.aliases), parent?.id ?? null]);
          ctx.skillBy.set(s.name.toLowerCase(), s); target = s.id; applied.created++;
          await audit(c, u, { org_id: orgId, entity_type: "skill", entity_id: s.id, action: "imported", after: r, reason: `bulk import ${job.id}` });
        } else {
          await q(c, `UPDATE skills SET definition = coalesce(nullif($2,''), definition), category = coalesce(nullif($3,''), category), aliases = CASE WHEN $4::text[] = '{}' THEN aliases ELSE (SELECT array_agg(DISTINCT x) FROM unnest(aliases || $4::text[]) x) END, version = version + 1 WHERE id = $1`,
            [p.target, r.definition || "", r.category || "", splitList(r.aliases)]);
          applied.updated++;
          await audit(c, u, { org_id: orgId, entity_type: "skill", entity_id: p.target!, action: "updated_by_import", after: r, reason: `bulk import ${job.id}` });
        }
      }
      else if (job.entity === "departments") {
        const parent = r.parent ? ctx.dept(r.parent) : null;
        if (p.action === "create") { const d = await one(c, `INSERT INTO departments (org_id, name, parent_id, location) VALUES ($1,$2,$3,$4) RETURNING id, name, status`, [orgId, r.name, parent?.id ?? null, r.location || null]); ctx.depts.push(d); target = d.id; applied.created++; }
        else { await q(c, `UPDATE departments SET parent_id = coalesce($2, parent_id), location = coalesce(nullif($3,''), location) WHERE id = $1`, [p.target, parent?.id ?? null, r.location || ""]); applied.updated++; }
        await audit(c, u, { entity_type: "department", entity_id: target!, action: p.action === "create" ? "imported" : "updated_by_import", after: r, reason: `bulk import ${job.id}` });
      }
      else if (job.entity === "roles" || job.entity === "job_descriptions") {
        const dept = await ensureDept(r.department || options.default_department);
        const fam = await ensureFamily(r.job_family);
        const lvl = r.career_level ? ctx.level(r.career_level) : null;
        const track = TRACKS[(r.career_track || "").toLowerCase()] || "Individual Contributor";
        const resp = job.entity === "job_descriptions" ? JSON.parse(r.__responsibilities || "[]") : splitList(r.responsibilities);
        const outc = job.entity === "job_descriptions" ? JSON.parse(r.__outcomes || "[]") : splitList(r.outcomes);
        const summary = job.entity === "job_descriptions" ? r.description.replace(/\s+/g, " ").slice(0, 400) : r.summary || "";
        const experience = job.entity === "job_descriptions" ? r.__experience : r.experience;
        const education = job.entity === "job_descriptions" ? r.__education : r.education;
        const publish = mode === "publish";
        const skills: any[] = p.extra?.skills || [];
        if (p.action === "create") {
          const org = await one(c, `SELECT industry FROM organisations WHERE id = $1`, [orgId]);
          const role = await one(c, `INSERT INTO job_roles (org_id, department_id, job_family_id, career_level_id, title, alt_titles, career_track, summary, responsibilities, outcomes, experience, education, industry, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, title, alt_titles, status, department_id`,
            [orgId, dept.id, fam?.id ?? null, lvl?.id ?? null, r.title, splitList(r.alt_titles), track, summary, resp, outc, experience || null, education || null, org.industry, publish ? "Published" : "Draft"]);
          ctx.roles.push(role); target = role.id;
          let n = 0; for (const s of skills) if (await insertMapping(role.id, s, publish, job.entity === "job_descriptions" ? `Extracted from the job description ("${s.basis}")` : "Imported")) n++;
          if (publish) await q(c, `INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,1,$2,$3,'Published by bulk import')`, [role.id, JSON.stringify(role), label]);
          await audit(c, u, { entity_type: "role", entity_id: role.id, action: publish ? "imported_published" : "imported_draft", after: { title: r.title, skills: n }, reason: `bulk import ${job.id}` });
          notes.push(`${n} skill requirement(s)`); applied.created++;
        } else {
          const ex = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 FOR UPDATE`, [p.target, orgId]);
          if (!ex || ex.status === "In Review" || ex.status === "Archived") { outcome = "skipped"; notes.push("Role changed since the preview"); applied.skipped++; results.push({ row: p.row, outcome, key: p.key, target, messages: [...p.messages, ...notes] }); continue; }
          const bump = ex.status === "Published";
          const newStatus = bump && !publish ? "Draft" : ex.status;
          await q(c, `UPDATE job_roles SET job_family_id = coalesce($2, job_family_id), career_level_id = coalesce($3, career_level_id), career_track = $4,
              alt_titles = (SELECT coalesce(array_agg(DISTINCT x), '{}') FROM unnest(alt_titles || $5::text[]) x), summary = CASE WHEN $6 = '' THEN summary ELSE $6 END,
              responsibilities = CASE WHEN cardinality($7::text[]) = 0 THEN responsibilities ELSE $7 END, outcomes = CASE WHEN cardinality($8::text[]) = 0 THEN outcomes ELSE $8 END,
              experience = coalesce(nullif($9,''), experience), education = coalesce(nullif($10,''), education), status = $11, version = version + $12, updated_at = now() WHERE id = $1`,
            [ex.id, fam?.id ?? null, lvl?.id ?? null, r.career_track ? track : ex.career_track, splitList(r.alt_titles), summary, resp, outc, experience || "", education || "", newStatus, bump ? 1 : 0]);
          if (bump && publish) await q(c, `INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,$2,$3,$4,'Updated by bulk import') ON CONFLICT DO NOTHING`, [ex.id, ex.version + 1, JSON.stringify({ ...ex, version: ex.version + 1 }), label]);
          let n = 0; for (const s of skills) if (await insertMapping(ex.id, s, publish && newStatus === "Published", "Imported")) n++;
          await audit(c, u, { entity_type: "role", entity_id: ex.id, action: bump && !publish ? "new_version_by_import" : "updated_by_import", after: { fields: Object.keys(r).filter(k => !k.startsWith("__") && r[k]), new_skills: n }, reason: `bulk import ${job.id}` });
          if (n) notes.push(`${n} new skill requirement(s)`); applied.updated++;
        }
      }
      else if (job.entity === "role_skills") {
        const f = p.extra.fields;
        if (p.action === "create") {
          const role = await one(c, `SELECT id, status FROM job_roles WHERE id = $1`, [p.target]);
          const publish = mode === "publish" && role.status === "Published";
          const sid = p.extra.skill_id;
          if (await insertMapping(role.id, { skill_id: sid, ...f }, publish, f.explanation || "Imported")) {
            target = buildPixelId(role.id, sid);
            if (!publish && role.status === "Published") {
              await q(c, `UPDATE role_skill_mapping SET approval_status = 'In Review' WHERE org_id = $1 AND pixel_id = $2`, [orgId, target]);
              await q(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, origin, requested_by, requested_by_name) VALUES ($1,'mapping',$2,'publish',$3,'user',$4,$5)`, [orgId, target, JSON.stringify({ reason: `bulk import ${job.id}` }), u.id, label]);
              applied.change_requests++; notes.push("sent for approval");
            }
            applied.created++;
          } else { outcome = "skipped"; applied.skipped++; notes.push("Already exists"); }
        } else {
          const m = await one(c, `SELECT m.*, s.name AS skill_name, r.title AS role_name FROM role_skill_mapping m JOIN skills s ON s.id = m.skill_id JOIN job_roles r ON r.id = m.role_id WHERE m.org_id = $1 AND m.pixel_id = $2 FOR UPDATE OF m`, [orgId, p.target]);
          if (p.extra.restore) await applyRestore(c, m, u, label, `Restored by bulk import ${job.id}`, null);
          if (m.approval_status !== "Published" || mode === "publish") await applyMappingUpdate(c, { ...m, ...(p.extra.restore ? { lifecycle_status: "Active", skill_trend: "Declining", requirement_type: "Optional" } : {}) }, u, f);
          else {
            await q(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, origin, requested_by, requested_by_name) VALUES ($1,'mapping',$2,'update',$3,'user',$4,$5)`,
              [orgId, m.pixel_id, JSON.stringify({ fields: f, reason: `bulk import ${job.id}`, before: { required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, skill_trend: m.skill_trend } }), u.id, label]);
            applied.change_requests++; notes.push("sent for approval");
          }
          applied.updated++;
        }
      }
      else if (job.entity === "employees") {
        if (p.action === "queue") {
          target = await enqueue(c, orgId!, r.role, p.extra.dept_id, "employee_import", [{ kind: "employee", name: r.name, email: r.email.toLowerCase(), department_id: p.extra.dept_id }], p.extra.suggestions);
          applied.queued++; notes.push(`waiting in Role resolution (${target})`);
        } else if (p.action === "create") {
          const e = await one(c, `INSERT INTO employees (org_id, name, email, department_id, role_id, location, joining_date, employee_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [orgId, r.name, r.email.toLowerCase(), p.extra.dept_id, p.extra.role_id, r.location || null, /^\d{4}-\d{2}-\d{2}$/.test(r.joining_date || "") ? r.joining_date : null, (r.employee_id || "").trim() || null]);
          target = e.id; applied.created++;
        } else {
          await q(c, `UPDATE employees SET name = $2, department_id = $3, role_id = $4, location = coalesce(nullif($5,''), location), employee_code = coalesce(nullif($6,''), employee_code) WHERE id = $1`, [p.target, r.name, p.extra.dept_id, p.extra.role_id, r.location || "", (r.employee_id || "").trim()]);
          applied.updated++;
        }
      }
      results.push({ row: p.row, outcome: outcome === "create" ? "created" : outcome === "update" ? "updated" : outcome === "queue" ? "queued" : outcome, key: p.key, target, messages: [...p.messages, ...notes] });
    } catch (e: any) {
      throw new Error(`Row ${p.row} (${p.key}): ${e.detail || e.message}`);
    }
  }
  // second pass: managers by email (people may appear before their managers in the file)
  if (job.entity === "employees") {
    for (const p of plans) if ((p.action === "create" || p.action === "update") && p.data.manager_email) {
      await q(c, `UPDATE employees e SET manager_id = m.id FROM employees m WHERE e.org_id = $1 AND lower(e.email) = lower($2) AND m.org_id = $1 AND lower(m.email) = lower($3) AND m.id <> e.id`, [orgId, p.data.email, p.data.manager_email]);
    }
    await audit(c, u, { entity_type: "employee", entity_id: job.id, action: "imported", after: applied });
  }
  return { applied, results };
}

/* ---------- permissions per entity ---------- */
function assertCanImport(u: User, entity: Entity, mode: string) {
  const ok = entity === "skills" ? (u.role === "platform_admin" || has(u, "skills:write"))
    : entity === "departments" ? has(u, "org:manage")
    : entity === "employees" ? has(u, "employees:manage")
    : has(u, "roles:write");
  if (!ok) throw forbidden(`You do not have permission to import ${SPECS[entity].label.toLowerCase()}`);
  if (u.role === "platform_admin" && entity !== "skills") throw forbidden("Platform administrators import global skills only");
  if (mode === "publish" && !(has(u, "approve") || u.role === "platform_admin")) throw forbidden("Only HR administrators can publish directly; use draft mode so the changes go through approval", "publish_requires_approver");
}

const previewSchema = z.object({
  entity: z.enum(["skills", "departments", "roles", "role_skills", "job_descriptions", "employees"]),
  mode: z.enum(["draft", "publish"]).default("draft"),
  options: z.object({ create_similar: z.boolean().optional(), create_departments: z.boolean().optional(), update_existing: z.boolean().optional(), default_department: z.string().optional(), role_id: z.string().optional() }).default({}),
});

function summarise(plans: Plan[]) {
  const s: Record<string, number> = { create: 0, update: 0, skip: 0, queue: 0, error: 0, with_notes: 0 };
  for (const p of plans) { s[p.action]++; if (p.messages.length) s.with_notes++; }
  return s;
}

export const routes: Route[] = [
  { method: "GET", pattern: "/imports/entities", handler: async ({ user }) =>
    (Object.keys(SPECS) as Entity[]).map(e => ({ entity: e, label: SPECS[e].label, required: SPECS[e].required, columns: Object.keys(SPECS[e].fields),
      allowed: (() => { try { assertCanImport(user, e, "draft"); return true; } catch { return false; } })(), can_publish: has(user, "approve") || user.role === "platform_admin" })) },
  { method: "GET", pattern: "/imports/templates/:entity", handler: async ({ params, query }) => {
    const spec = SPECS[params.entity as Entity]; if (!spec) throw notFound("Template");
    const drop = (query.get("without") || "").split(",").filter(Boolean);   // e.g. without=role on a role's own page
    const keep = spec.example[0].map((h, i) => drop.includes(h) ? -1 : i).filter(i => i >= 0);
    return { file: `${params.entity}-template.csv`, content: toCsv(keep.map(i => spec.example[0][i]), spec.example.slice(1).map(r => keep.map(i => r[i]))) };
  } },
  // Upload: multipart (file + entity + mode + options JSON) or JSON {entity, filename, text | base64}
  { method: "POST", pattern: "/imports/preview", handler: async ({ db, user, body }) => {
    const meta = parse(previewSchema, { entity: body.entity, mode: body.mode, options: typeof body.options === "string" ? JSON.parse(body.options || "{}") : body.options });
    const mode = meta.mode || "draft"; const options = meta.options || {};
    assertCanImport(user, meta.entity, mode);
    const filename = String(body.filename || body.file?.name || "upload.csv");
    const buf: Buffer | undefined = body.file?.buffer ?? (body.base64 ? Buffer.from(String(body.base64), "base64") : undefined);
    if (!buf && typeof body.text !== "string") throw bad("Attach a CSV or Excel file");
    if (buf && buf.length > 25 * 1024 * 1024) throw unprocessable("file_too_large", "Files up to 25 MB. Split larger files.");
    const spec = SPECS[meta.entity];
    // context from the screen the upload starts on (a role page, a department) makes that column optional
    const required = spec.required.filter(c => !(c === "role" && options.role_id) && !(c === "department" && options.default_department));
    const table = await readTable({ buf, text: body.text, filename }, spec.fields, required);
    const plans = await plan(db, user, meta.entity, table.rows, mode, options);
    const summary = summarise(plans);
    const job = await one(db, `INSERT INTO import_jobs (org_id, entity, file_name, mode, options, total_rows, summary, rows, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
      [user.org_id, meta.entity, filename, mode, JSON.stringify(options), plans.length, JSON.stringify({ planned: summary, unknown_columns: table.unknown_columns, columns: table.columns }), JSON.stringify(plans), user.id, user.name]);
    return { id: job.id, entity: meta.entity, mode, file_name: filename, total_rows: plans.length, summary, unknown_columns: table.unknown_columns, columns: table.columns,
      rows: plans.slice(0, 1000).map(p => ({ row: p.row, action: p.action, key: p.key, target: p.target, messages: p.messages })) };
  } },
  { method: "POST", pattern: "/imports/:id/commit", handler: async ({ user, params }) => tx(async c => {
    const job = await one(c, `SELECT * FROM import_jobs WHERE id = $1 AND (org_id = $2 OR (org_id IS NULL AND $2::text IS NULL)) FOR UPDATE`, [params.id, user.org_id]);
    if (!job) throw notFound("Import");
    if (job.created_by !== user.id) throw forbidden("Only the person who uploaded the file can commit it");
    if (job.status !== "Previewed") throw conflict("not_previewed", `This import is ${job.status}`);
    assertCanImport(user, job.entity, job.mode);
    if (Date.now() - new Date(job.created_at).getTime() > 24 * 3600e3) throw conflict("preview_expired", "The preview is older than 24 hours. Upload the file again so it is checked against current data");
    const { applied, results } = await commit(c, user, job);
    await q(c, `UPDATE import_jobs SET status = 'Committed', committed_at = now(), summary = summary || $2, rows = $3 WHERE id = $1`, [job.id, JSON.stringify({ applied }), JSON.stringify(results)]);
    await audit(c, user, { entity_type: "import", entity_id: job.id, action: "committed", after: { entity: job.entity, file: job.file_name, mode: job.mode, ...applied } });
    return { id: job.id, status: "Committed", applied };
  }) },
  { method: "POST", pattern: "/imports/:id/discard", handler: async ({ db, user, params }) => {
    const r = await one(db, `UPDATE import_jobs SET status = 'Discarded', rows = '[]' WHERE id = $1 AND created_by = $2 AND status = 'Previewed' RETURNING id`, [params.id, user.id]);
    if (!r) throw notFound("Import preview");
    return { status: "Discarded" };
  } },
  { method: "GET", pattern: "/imports", handler: async ({ db, user }) =>
    q(db, `SELECT id, entity, file_name, mode, status, total_rows, summary, created_by_name, created_at, committed_at FROM import_jobs WHERE (org_id = $1 OR (org_id IS NULL AND $1::text IS NULL)) ORDER BY created_at DESC LIMIT 100`, [user.org_id]) },
  { method: "GET", pattern: "/imports/:id", handler: async ({ db, user, params }) => {
    const j = await one(db, `SELECT * FROM import_jobs WHERE id = $1 AND (org_id = $2 OR (org_id IS NULL AND $2::text IS NULL))`, [params.id, user.org_id]);
    if (!j) throw notFound("Import");
    return j;
  } },
  // Round trip: export current data in the template format
  { method: "GET", pattern: "/exports/:entity", handler: async ({ db, user, params }) => {
    const orgId = user.org_id;
    const e = params.entity as Entity;
    if (e === "skills") {
      const rows = await q(db, `SELECT s.name, s.definition, s.category, array_to_string(s.aliases, '; ') AS aliases, s.type, p.name AS parent FROM skills s LEFT JOIN skills p ON p.id = s.parent_id WHERE s.org_id IS NULL OR s.org_id = $1 ORDER BY s.id`, [orgId]);
      return { file: "skills.csv", content: toCsv(SPECS.skills.example[0], rows.map(r => Object.values(r))) };
    }
    if (!orgId) throw forbidden("Exports of organisation data need an organisation user");
    if (e === "departments") {
      if (!has(user, "org:read")) throw forbidden();
      const rows = await q(db, `SELECT d.name, p.name AS parent, d.location FROM departments d LEFT JOIN departments p ON p.id = d.parent_id WHERE d.org_id = $1 AND d.status = 'Active' ORDER BY d.name`, [orgId]);
      return { file: "departments.csv", content: toCsv(SPECS.departments.example[0], rows.map(r => Object.values(r))) };
    }
    if (e === "roles") {
      if (!has(user, "roles:read")) throw forbidden();
      const rows = await q(db, `SELECT r.title, d.name AS department, f.name AS job_family, l.code AS career_level, r.career_track, array_to_string(r.alt_titles, '; '), r.summary, array_to_string(r.responsibilities, '; '), array_to_string(r.outcomes, '; '), r.experience, r.education,
          (SELECT string_agg(s.name || ':' || v.required_level || ':' || v.requirement_type || ':' || v.importance, '; ' ORDER BY s.name) FROM v_framework v JOIN skills s ON s.id = v.skill_id WHERE v.role_id = r.id)
        FROM job_roles r JOIN departments d ON d.id = r.department_id LEFT JOIN job_families f ON f.id = r.job_family_id LEFT JOIN career_levels l ON l.id = r.career_level_id WHERE r.org_id = $1 AND r.status <> 'Archived' ORDER BY d.name, r.title`, [orgId]);
      return { file: "roles.csv", content: toCsv(SPECS.roles.example[0], rows.map(r => Object.values(r))) };
    }
    if (e === "role_skills") {
      if (scopeOf(user, "framework:read") !== "org") throw forbidden("Exporting every requirement needs organisation-wide framework access");
      const rows = await q(db, `SELECT r.title, s.name, v.required_level, v.requirement_type, v.importance, v.skill_trend, v.explanation FROM v_framework v JOIN job_roles r ON r.id = v.role_id JOIN skills s ON s.id = v.skill_id WHERE v.org_id = $1 ORDER BY r.title, s.name`, [orgId]);
      return { file: "role-skills.csv", content: toCsv(SPECS.role_skills.example[0], rows.map(r => Object.values(r))) };
    }
    if (e === "employees") {
      if (!has(user, "employees:manage")) throw forbidden();
      const rows = await q(db, `SELECT coalesce(e.employee_code, ''), e.name, e.email, d.name, r.title, m.email, e.location, to_char(e.joining_date, 'YYYY-MM-DD') FROM employees e JOIN departments d ON d.id = e.department_id JOIN job_roles r ON r.id = e.role_id LEFT JOIN employees m ON m.id = e.manager_id WHERE e.org_id = $1 AND e.status = 'Active' ORDER BY e.name`, [orgId]);
      return { file: "employees.csv", content: toCsv(SPECS.employees.example[0], rows.map(r => Object.values(r))) };
    }
    throw notFound("Export");
  } },
];
export { normalizeTitle };
