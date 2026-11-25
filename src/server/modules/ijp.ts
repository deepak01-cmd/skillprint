/* Internal job postings (IJP): HR and department heads post openings for published roles; employees see how well
   they match each one, what the gaps are, and apply. A hire never changes anyone's role by itself: HR records the move. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound, unprocessable } from "../errors";
import { User } from "../permissions";
import { orgOf } from "../scope";
import { Route } from "../http/router";
import { logAccess } from "../access";
import { readTable, toCsv } from "../files";
import { resolveRoleTitle } from "./roleFallback";
import { effectiveLevel, readiness, weightedMatch } from "../calc";
import { listActive } from "./mapping";
import { levelsFor } from "./people";
import { currentAssumptions } from "./structure";

const FINAL = new Set(["Hired", "Not selected", "Withdrawn"]);
const NEXT: Record<string, string[]> = {
  Applied: ["Screening", "Interview", "Not selected"], Screening: ["Interview", "Not selected"],
  Interview: ["Offered", "Not selected"], Offered: ["Hired", "Not selected"],
};
const MAX_ACTIVE_APPLICATIONS = 5;
const today = () => new Date().toISOString().slice(0, 10);

/** Match of one employee to many roles: weighted share of each required level reached (Mandatory counts most). */
export async function matchMany(db: Db, emp: any, roleIds: string[]) {
  const out = new Map<string, any>();
  if (!roleIds.length) return out;
  const A = (await currentAssumptions(db, emp.org_id)).data;
  const reqs = await listActive(db, emp.org_id, { roleIds });
  const lv = (await levelsFor(db, [emp.id])).get(emp.id) || new Map();
  for (const rid of roleIds) {
    const rs = reqs.filter(r => r.role_id === rid);
    const eff = new Map(rs.map(r => [r.skill_id, effectiveLevel(lv.get(r.skill_id) || [], A.count_self_assessed)]));
    const lines = rs.map(r => {
      const cur = eff.get(r.skill_id)?.level ?? null;
      return { skill_id: r.skill_id, skill_name: r.skill_name, skill_category: r.skill_category, required_level: r.required_level, requirement_type: r.requirement_type,
        importance: r.importance, current_level: cur, source: eff.get(r.skill_id)?.source ?? null, gap: Math.max(0, r.required_level - (cur ?? 0)), met: cur !== null && cur >= r.required_level };
    });
    const band = readiness(rs.map(r => ({ skill_id: r.skill_id, skill_name: r.skill_name, required_level: r.required_level, requirement_type: r.requirement_type, importance: r.importance, pixel_id: r.pixel_id })), eff, A.readiness).band;
    const order: Record<string, number> = { Mandatory: 0, Preferred: 1, Optional: 2, Developmental: 3 };
    const wm = weightedMatch(lines.map(l => ({ required_level: l.required_level, requirement_type: l.requirement_type, current: l.current_level })));
    out.set(rid, { ...wm, band, unassessed: lines.filter(l => l.current_level === null).length,
      lines: lines.sort((a, b) => Number(a.met) - Number(b.met) || (order[a.requirement_type] ?? 9) - (order[b.requirement_type] ?? 9) || b.gap - a.gap) });
  }
  return out;
}

const canManageAny = (u: User) => u.role === "hr_admin" || u.role === "dept_head";
const canManage = (u: User, job: { department_id: string }) => u.role === "hr_admin" || (u.role === "dept_head" && u.department_id === job.department_id);
async function jobInOrg(db: Db, u: User, id: string) {
  const j = await one(db, `SELECT j.*, d.name AS department_name, r.title AS role_title, r.status AS role_status, l.name AS career_level FROM internal_jobs j JOIN departments d ON d.id = j.department_id
      JOIN job_roles r ON r.id = j.role_id LEFT JOIN career_levels l ON l.id = r.career_level_id WHERE j.id = $1 AND j.org_id = $2`, [id, orgOf(u)]);
  if (!j || (j.status === "Draft" && !canManage(u, j))) throw notFound("Job");
  return j;
}
const isOpen = (j: any) => j.status === "Open" && (!j.closes_on || String(j.closes_on).slice(0, 10) >= today());
async function me(db: Db, u: User) {
  return u.employee_id ? one(db, `SELECT * FROM employees WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [u.employee_id, orgOf(u)]) : null;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(d => !isNaN(Date.parse(d)), "Not a real date");
const jobSchema = z.object({
  role_id: z.string().max(40), title: z.string().trim().min(3).max(160).optional(), location: z.string().trim().max(120).optional().nullable(),
  work_mode: z.enum(["Onsite", "Hybrid", "Remote"]).default("Onsite"), openings: z.coerce.number().int().min(1).max(500).default(1),
  description: z.string().trim().max(8000).default(""), min_match: z.coerce.number().int().min(0).max(100).default(0),
  closes_on: date.nullable().optional(), status: z.enum(["Draft", "Open"]).default("Open"),
});
const patchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(), location: z.string().trim().max(120).nullable().optional(), work_mode: z.enum(["Onsite", "Hybrid", "Remote"]).optional(),
  openings: z.coerce.number().int().min(1).max(500).optional(), description: z.string().trim().max(8000).optional(), min_match: z.coerce.number().int().min(0).max(100).optional(),
  closes_on: date.nullable().optional(), status: z.enum(["Draft", "Open", "On hold", "Closed"]).optional(),
});

/* ---------- bulk upload of postings ---------- */
const UPLOAD_FIELDS: Record<string, string[]> = {
  role: ["role title", "role id", "job role", "framework role"], title: ["posting title", "job title", "position", "opening"], department: ["dept", "department name"],
  location: ["office", "site", "city"], work_mode: ["mode", "work mode", "work type", "remote"], openings: ["positions", "vacancies", "headcount", "number of openings"],
  description: ["job description", "details", "about the role", "jd"], min_match: ["minimum match", "min match %", "eligibility", "minimum match %"],
  closes_on: ["closing date", "close date", "deadline", "apply by", "last date"], status: ["posting status", "publish"],
};
const UPLOAD_EXAMPLE = [["role", "title", "department", "location", "work_mode", "openings", "description", "min_match", "closes_on", "status"],
  ["Financial Data Analyst", "Financial Data Analyst – Treasury", "Data & Analytics", "Pune", "Hybrid", "2", "Join the treasury analytics team.", "50", "2027-01-31", "Open"],
  ["R004", "", "", "Bengaluru", "Onsite", "1", "", "", "", "Draft"]];
function toDate(v: string): string | null | undefined {
  const s = (v || "").trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isNaN(Date.parse(s.slice(0, 10))) ? undefined : s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // day/month/year
  if (m) { const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return isNaN(Date.parse(d)) ? undefined : d; }
  const n = Number(s); if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10); // Excel serial date
  return undefined;
}
async function planUpload(db: Db, u: User, rows: Record<string, string>[]) {
  const orgId = orgOf(u);
  const roles = await q(db, `SELECT id, title, alt_titles, status, department_id FROM job_roles WHERE org_id = $1 AND status <> 'Archived'`, [orgId]);
  const depts = await q(db, `SELECT id, name FROM departments WHERE org_id = $1 AND status = 'Active'`, [orgId]);
  const out = []; const seen = new Map<string, number>();
  for (const r of rows) {
    const msgs: string[] = []; let ok = true; const row = Number(r.__row);
    const dept = r.department ? depts.find(d => d.name.toLowerCase() === r.department.toLowerCase().trim() || d.id.toLowerCase() === r.department.toLowerCase().trim()) : null;
    if (r.department && !dept) { msgs.push(`Unknown department "${r.department}"`); ok = false; }
    let role = roles.find(x => x.id.toLowerCase() === (r.role || "").toLowerCase().trim())
      || roles.filter(x => [x.title, ...(x.alt_titles || [])].some((t: string) => t.toLowerCase() === (r.role || "").toLowerCase().trim())).sort((a, b) => (dept && a.department_id === dept.id ? -1 : 0) - (dept && b.department_id === dept.id ? -1 : 0))[0];
    if (!role && r.role) {
      const res: any = await resolveRoleTitle(db, orgId, r.role, dept?.id);
      if (res.status === "matched") { role = roles.find(x => x.id === res.role.id); msgs.push(`"${r.role}" matched to ${res.role.title}`); }
      else { msgs.push(`No role "${r.role}" in the framework${res.candidates?.length ? `; closest: ${res.candidates.slice(0, 3).map((c: any) => c.title).join(", ")}` : ""}`); ok = false; }
    }
    if (!r.role) { msgs.push("No role"); ok = false; }
    if (role && role.status !== "Published") { msgs.push(`${role.title} is not published yet`); ok = false; }
    if (role && dept && role.department_id !== dept.id) msgs.push(`${role.title} belongs to another department; its own department is used`);
    if (role && u.role === "dept_head" && role.department_id !== u.department_id) { msgs.push("Department heads post only for their own department"); ok = false; }
    const mode = (r.work_mode || "").toLowerCase(); const work_mode = !mode ? "Onsite" : /remote|wfh|home/.test(mode) ? "Remote" : /hybrid/.test(mode) ? "Hybrid" : /onsite|office|on-site/.test(mode) ? "Onsite" : null;
    if (!work_mode) { msgs.push(`Work mode "${r.work_mode}" is not Onsite, Hybrid or Remote`); ok = false; }
    const openings = r.openings ? Number(r.openings) : 1; if (!Number.isInteger(openings) || openings < 1 || openings > 500) { msgs.push(`Openings "${r.openings}" must be 1–500`); ok = false; }
    const mm = r.min_match ? Number(String(r.min_match).replace("%", "")) : 0; if (!Number.isFinite(mm) || mm < 0 || mm > 100) { msgs.push(`Minimum match "${r.min_match}" must be 0–100`); ok = false; }
    const closes = toDate(r.closes_on); if (closes === undefined) { msgs.push(`"${r.closes_on}" is not a date (use YYYY-MM-DD)`); ok = false; }
    else if (closes && closes < today()) { msgs.push(`Closing date ${closes} is in the past`); ok = false; }
    const st = (r.status || "").toLowerCase(); const status = !st || /open|publish|yes|live/.test(st) ? "Open" : /draft|no/.test(st) ? "Draft" : null;
    if (!status) { msgs.push(`Status "${r.status}" is not Open or Draft`); ok = false; }
    const title = (r.title || role?.title || r.role || "").trim().slice(0, 160);
    if (title.length < 3) { msgs.push("Title too short"); ok = false; }
    if (ok && role) {
      const key = `${role.id}|${title.toLowerCase()}|${(r.location || "").trim().toLowerCase()}`;
      if (seen.has(key)) { msgs.push(`Same posting as row ${seen.get(key)}`); ok = false; }
      else if (await one(db, `SELECT 1 FROM internal_jobs WHERE org_id = $1 AND role_id = $2 AND lower(title) = $3 AND lower(coalesce(location,'')) = $4 AND status IN ('Open','Draft','On hold')`, [orgId, role.id, title.toLowerCase(), (r.location || "").trim().toLowerCase()])) { msgs.push("Already posted"); ok = false; }
      seen.set(key, row);
    }
    out.push({ row, action: ok ? "create" : "error", key: title, messages: msgs,
      data: ok ? { role_id: role!.id, department_id: role!.department_id, title, location: (r.location || "").slice(0, 120) || null, work_mode, openings, description: (r.description || "").slice(0, 8000), min_match: Math.round(mm), closes_on: closes || null, status } : null });
  }
  return out;
}

export const routes: Route[] = [
  { method: "GET", pattern: "/ijp/upload/template", handler: async ({ user }) => {
    if (!canManageAny(user)) throw forbidden();
    return { file: "internal-jobs-template.csv", content: toCsv(UPLOAD_EXAMPLE[0], UPLOAD_EXAMPLE.slice(1)) };
  } },
  { method: "POST", pattern: "/ijp/upload/preview", handler: async ({ db, user, body }) => {
    if (!canManageAny(user)) throw forbidden();
    const filename = String(body.filename || body.file?.name || "jobs.csv").slice(0, 200);
    const buf: Buffer | undefined = body.file?.buffer;
    if (!buf && typeof body.text !== "string") throw bad("Attach a CSV or Excel file");
    if (buf && buf.length > 10 * 1024 * 1024) throw unprocessable("file_too_large", "Files up to 10 MB");
    const table = await readTable({ buf, text: body.text, filename }, UPLOAD_FIELDS, ["role"]);
    if (table.rows.length > 1000) throw unprocessable("too_many_rows", "Up to 1,000 postings per file");
    const plans = await planUpload(db, user, table.rows);
    const summary = { create: plans.filter(p => p.action === "create").length, error: plans.filter(p => p.action === "error").length };
    const job = await one(db, `INSERT INTO import_jobs (org_id, entity, file_name, mode, total_rows, summary, rows, created_by, created_by_name) VALUES ($1,'ijp_jobs',$2,'publish',$3,$4,$5,$6,$7) RETURNING id`,
      [orgOf(user), filename, plans.length, JSON.stringify({ planned: summary, unknown_columns: table.unknown_columns }), JSON.stringify(plans), user.id, user.name]);
    return { id: job.id, file_name: filename, summary, unknown_columns: table.unknown_columns, rows: plans.map(p => ({ row: p.row, action: p.action, key: p.key, messages: p.messages, data: p.data })) };
  } },
  { method: "POST", pattern: "/ijp/upload/:id/commit", handler: async ({ user, params }) => tx(async c => {
    if (!canManageAny(user)) throw forbidden();
    const job = await one(c, `SELECT * FROM import_jobs WHERE id = $1 AND org_id = $2 AND entity = 'ijp_jobs' FOR UPDATE`, [params.id, orgOf(user)]);
    if (!job) throw notFound("Upload");
    if (job.created_by !== user.id) throw forbidden("Only the person who uploaded the file can apply it");
    if (job.status !== "Previewed") throw conflict("not_previewed", `This upload is ${job.status}`);
    let created = 0;
    for (const p of job.rows as any[]) {
      if (p.action !== "create") continue;
      const d = p.data;
      // checked again: the framework may have changed since the preview
      const role = await one(c, `SELECT id, department_id, status FROM job_roles WHERE id = $1 AND org_id = $2`, [d.role_id, job.org_id]);
      if (!role || role.status !== "Published" || !canManage(user, role)) continue;
      const j = await one(c, `INSERT INTO internal_jobs (org_id, role_id, department_id, title, location, work_mode, openings, description, min_match, closes_on, status, posted_by, posted_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [job.org_id, role.id, role.department_id, d.title, d.location, d.work_mode, d.openings, d.description, d.min_match, d.closes_on, d.status, user.id, user.name]);
      await audit(c, user, { entity_type: "internal_job", entity_id: j.id, action: "created", after: { ...d, upload: job.id } });
      created++;
    }
    await q(c, `UPDATE import_jobs SET status = 'Committed', committed_at = now(), summary = summary || $2 WHERE id = $1`, [job.id, JSON.stringify({ applied: { created } })]);
    return { id: job.id, status: "Committed", created };
  }) },

  { method: "GET", pattern: "/ijp/jobs", handler: async ({ db, user, query }) => {
    const orgId = orgOf(user);
    const manage = canManageAny(user) && query.get("view") === "manage";
    const text = (query.get("q") || "").trim().toLowerCase().slice(0, 100);
    const where = [`j.org_id = $1`]; const p: unknown[] = [orgId];
    if (manage) { if (user.role === "dept_head") { p.push(user.department_id); where.push(`j.department_id = $${p.length}`); } }
    else where.push(`j.status = 'Open' AND (j.closes_on IS NULL OR j.closes_on >= current_date)`);
    if (text) { p.push(text); where.push(`(lower(j.title) LIKE '%' || $${p.length} || '%' OR lower(d.name) LIKE '%' || $${p.length} || '%' OR lower(coalesce(j.location,'')) LIKE '%' || $${p.length} || '%')`); }
    const dept = query.get("department_id"); if (dept) { p.push(dept); where.push(`j.department_id = $${p.length}`); }
    const jobs = await q(db, `SELECT j.id, j.role_id, j.department_id, d.name AS department_name, j.title, j.location, j.work_mode, j.openings, j.min_match, j.closes_on, j.status, j.created_at, j.posted_by_name,
        r.title AS role_title, l.name AS career_level, left(j.description, 240) AS teaser,
        (SELECT count(*)::int FROM job_applications a WHERE a.job_id = j.id AND a.status <> 'Withdrawn') AS applicants,
        (SELECT count(*)::int FROM job_applications a WHERE a.job_id = j.id AND a.status = 'Hired') AS hired
      FROM internal_jobs j JOIN departments d ON d.id = j.department_id JOIN job_roles r ON r.id = j.role_id LEFT JOIN career_levels l ON l.id = r.career_level_id
      WHERE ${where.join(" AND ")} ORDER BY j.created_at DESC LIMIT 300`, p);
    const emp = manage ? null : await me(db, user);
    if (!emp) return jobs.map(j => ({ ...j, applicants: manage ? j.applicants : undefined }));
    const m = await matchMany(db, emp, [...new Set(jobs.map(j => j.role_id))]);
    const apps = await q(db, `SELECT job_id, id, status FROM job_applications WHERE employee_id = $1 AND status <> 'Withdrawn'`, [emp.id]);
    return jobs.map(j => { const x = m.get(j.role_id); return { ...j, applicants: undefined, current_role: j.role_id === emp.role_id,
      match_pct: x.match_pct, band: x.band, skills_met: x.skills_met, skills_required: x.skills_required, mandatory_gaps: x.mandatory_gaps,
      top_gaps: x.lines.filter((l: any) => !l.met).slice(0, 3).map((l: any) => l.skill_name), application: apps.find(a => a.job_id === j.id) || null }; })
      .sort((a, b) => b.match_pct - a.match_pct);
  } },
  { method: "GET", pattern: "/ijp/jobs/:id", handler: async ({ db, user, params }) => {
    const j = await jobInOrg(db, user, params.id);
    const emp = await me(db, user);
    const match = emp ? (await matchMany(db, emp, [j.role_id])).get(j.role_id) : null;
    const reqs = match ? null : (await listActive(db, j.org_id, { roleId: j.role_id })).map(r => ({ skill_id: r.skill_id, skill_name: r.skill_name, required_level: r.required_level, requirement_type: r.requirement_type, importance: r.importance }));
    const app = emp ? await one(db, `SELECT id, status, match_pct, note, history, created_at FROM job_applications WHERE job_id = $1 AND employee_id = $2 AND status <> 'Withdrawn'`, [j.id, emp.id]) : null;
    const counts = canManage(user, j) ? await q(db, `SELECT status, count(*)::int AS n FROM job_applications WHERE job_id = $1 GROUP BY status`, [j.id]) : null;
    return { ...j, open: isOpen(j), can_manage: canManage(user, j), current_role: emp?.role_id === j.role_id, match, requirements: reqs, application: app, counts,
      can_apply: !!emp && isOpen(j) && !app && emp.role_id !== j.role_id && (match?.match_pct ?? 0) >= j.min_match };
  } },
  { method: "POST", pattern: "/ijp/jobs", handler: async ({ db, user, body }) => {
    if (!canManageAny(user)) throw forbidden();
    const b = jobSchema.parse(body);
    const role = await one(db, `SELECT id, title, department_id, status FROM job_roles WHERE id = $1 AND org_id = $2`, [b.role_id, orgOf(user)]);
    if (!role) throw notFound("Role");
    if (role.status !== "Published") throw unprocessable("role_not_published", "Post openings for published roles only");
    if (!canManage(user, role)) throw forbidden("Department heads post openings for their own department");
    if (b.closes_on && b.closes_on < today()) throw unprocessable("closes_in_past", "The closing date is in the past");
    const same = await one(db, `SELECT id FROM internal_jobs WHERE org_id = $1 AND role_id = $2 AND lower(title) = lower($3) AND lower(coalesce(location,'')) = lower($4) AND status IN ('Open','Draft','On hold')`,
      [orgOf(user), role.id, b.title || role.title, b.location || ""]);
    if (same) throw conflict("duplicate_posting", `This opening is already posted (${same.id}). Raise its openings instead of posting it twice`);
    const j = await one(db, `INSERT INTO internal_jobs (org_id, role_id, department_id, title, location, work_mode, openings, description, min_match, closes_on, status, posted_by, posted_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [orgOf(user), role.id, role.department_id, b.title || role.title, b.location || null, b.work_mode, b.openings, b.description, b.min_match, b.closes_on || null, b.status, user.id, user.name]);
    await audit(db, user, { entity_type: "internal_job", entity_id: j.id, action: "created", after: { ...b, title: j.title } });
    return j;
  } },
  { method: "PATCH", pattern: "/ijp/jobs/:id", handler: async ({ db, user, params, body }) => {
    const j = await jobInOrg(db, user, params.id);
    if (!canManage(user, j)) throw forbidden();
    const b = patchSchema.parse(body);
    if (b.closes_on && b.closes_on < today() && b.status !== "Closed") throw unprocessable("closes_in_past", "The closing date is in the past");
    if (b.status === "Open" && j.role_status !== "Published") throw unprocessable("role_not_published", "The role is no longer published");
    const after = await one(db, `UPDATE internal_jobs SET title = coalesce($2, title), location = CASE WHEN $3 THEN $4 ELSE location END, work_mode = coalesce($5, work_mode), openings = coalesce($6, openings),
        description = coalesce($7, description), min_match = coalesce($8, min_match), closes_on = CASE WHEN $9 THEN $10::date ELSE closes_on END, status = coalesce($11, status), updated_at = now() WHERE id = $1 RETURNING *`,
      [j.id, b.title ?? null, b.location !== undefined, b.location ?? null, b.work_mode ?? null, b.openings ?? null, b.description ?? null, b.min_match ?? null, b.closes_on !== undefined, b.closes_on ?? null, b.status ?? null]);
    await audit(db, user, { entity_type: "internal_job", entity_id: j.id, action: "updated", before: { status: j.status }, after: b });
    return after;
  } },

  /* ---------- applying ---------- */
  { method: "POST", pattern: "/ijp/jobs/:id/apply", handler: async ({ user, params, body }) => tx(async c => {
    const b = z.object({ note: z.string().trim().max(2000).default("") }).parse(body);
    const j = await jobInOrg(c, user, params.id);
    const emp = await me(c, user);
    if (!emp) throw forbidden("Only employees can apply");
    if (!isOpen(j)) throw unprocessable("job_closed", "This opening is no longer taking applications");
    if (emp.role_id === j.role_id) throw unprocessable("current_role", "You already hold this role");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [emp.id]); // one application at a time per person
    if (await one(c, `SELECT 1 FROM job_applications WHERE job_id = $1 AND employee_id = $2 AND status <> 'Withdrawn'`, [j.id, emp.id])) throw conflict("already_applied", "You have already applied");
    const active = await one(c, `SELECT count(*)::int AS n FROM job_applications WHERE employee_id = $1 AND status NOT IN ('Withdrawn','Hired','Not selected')`, [emp.id]);
    if (active!.n >= MAX_ACTIVE_APPLICATIONS) throw unprocessable("too_many_applications", `You can have up to ${MAX_ACTIVE_APPLICATIONS} active applications. Withdraw one first`);
    const m = (await matchMany(c, emp, [j.role_id])).get(j.role_id);
    if (m.match_pct < j.min_match) throw unprocessable("below_min_match", `This opening needs at least a ${j.min_match}% match; yours is ${m.match_pct}%`);
    const snap = { match_pct: m.match_pct, band: m.band, skills_met: m.skills_met, skills_required: m.skills_required, gaps: m.lines.filter((l: any) => !l.met).map((l: any) => ({ skill: l.skill_name, current: l.current_level, required: l.required_level, type: l.requirement_type })) };
    const a = await one(c, `INSERT INTO job_applications (org_id, job_id, employee_id, match_pct, snapshot, note, history) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, match_pct, created_at`,
      [j.org_id, j.id, emp.id, m.match_pct, JSON.stringify(snap), b.note, JSON.stringify([{ status: "Applied", at: new Date().toISOString(), by: user.name }])]);
    await audit(c, user, { entity_type: "job_application", entity_id: a.id, action: "applied", after: { job: j.id, match: m.match_pct } });
    return a;
  }) },
  { method: "GET", pattern: "/ijp/applications/mine", handler: async ({ db, user }) => {
    if (!user.employee_id) return [];
    return q(db, `SELECT a.id, a.status, a.match_pct, a.created_at, a.updated_at, a.history, j.id AS job_id, j.title, j.status AS job_status, d.name AS department_name, j.location
      FROM job_applications a JOIN internal_jobs j ON j.id = a.job_id JOIN departments d ON d.id = j.department_id WHERE a.employee_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC`, [user.employee_id, orgOf(user)]);
  } },
  { method: "POST", pattern: "/ijp/applications/:id/withdraw", handler: async ({ db, user, params }) => {
    const a = await one(db, `SELECT * FROM job_applications WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!a || a.employee_id !== user.employee_id) throw notFound("Application");
    if (FINAL.has(a.status)) throw unprocessable("final", `The application is already ${a.status.toLowerCase()}`);
    const after = await one(db, `UPDATE job_applications SET status = 'Withdrawn', updated_at = now(), history = history || $2::jsonb WHERE id = $1 AND status NOT IN ('Hired','Not selected','Withdrawn') RETURNING id, status`,
      [a.id, JSON.stringify([{ status: "Withdrawn", at: new Date().toISOString(), by: user.name }])]);
    if (!after) throw conflict("changed", "The application was updated a moment ago");
    await audit(db, user, { entity_type: "job_application", entity_id: a.id, action: "withdrawn" });
    return after;
  } },

  /* ---------- reviewing applicants (HR, or the department head of the job's department) ---------- */
  { method: "GET", pattern: "/ijp/jobs/:id/applications", handler: async ({ db, user, params, meta }) => {
    const j = await jobInOrg(db, user, params.id);
    if (!canManage(user, j)) throw forbidden();
    for (const a of await q(db, `SELECT employee_id FROM job_applications WHERE job_id = $1`, [j.id])) await logAccess(db, user, a.employee_id, "job application", `${j.id} · ${j.title}`, meta.ip);
    const apps = await q(db, `SELECT a.id, a.status, a.match_pct, a.snapshot, a.note, a.history, a.created_at, a.updated_at, e.id AS employee_id, e.name, e.email,
        r.title AS current_role, d.name AS current_department
      FROM job_applications a JOIN employees e ON e.id = a.employee_id JOIN job_roles r ON r.id = e.role_id JOIN departments d ON d.id = e.department_id
      WHERE a.job_id = $1 ORDER BY (a.status = 'Withdrawn'), a.match_pct DESC, a.created_at`, [j.id]);
    const out = [];
    for (const a of apps) { const now = (await matchMany(db, { id: a.employee_id, org_id: j.org_id }, [j.role_id])).get(j.role_id); out.push({ ...a, match_now: now.match_pct, band_now: now.band }); }
    return out;
  } },
  { method: "POST", pattern: "/ijp/applications/:id/status", handler: async ({ user, params, body }) => tx(async c => {
    const b = z.object({ status: z.enum(["Screening", "Interview", "Offered", "Hired", "Not selected"]), note: z.string().trim().max(1000).default("") }).parse(body);
    const a = await one(c, `SELECT a.*, j.department_id, j.openings, j.id AS jid FROM job_applications a JOIN internal_jobs j ON j.id = a.job_id WHERE a.id = $1 AND a.org_id = $2 FOR UPDATE OF a`, [params.id, orgOf(user)]);
    if (!a || !canManage(user, a)) throw notFound("Application");
    if (!(NEXT[a.status] || []).includes(b.status)) throw unprocessable("bad_transition", `An application that is ${a.status} cannot move to ${b.status}`);
    const after = await one(c, `UPDATE job_applications SET status = $2, updated_at = now(), history = history || $3::jsonb WHERE id = $1 RETURNING id, status`,
      [a.id, b.status, JSON.stringify([{ status: b.status, at: new Date().toISOString(), by: user.name, note: b.note || undefined }])]);
    let closed = false;
    if (b.status === "Hired") {
      const hired = await one(c, `SELECT count(*)::int AS n FROM job_applications WHERE job_id = $1 AND status = 'Hired'`, [a.jid]);
      if (hired!.n >= a.openings) { await q(c, `UPDATE internal_jobs SET status = 'Closed', updated_at = now() WHERE id = $1`, [a.jid]); closed = true; }
    }
    await audit(c, user, { entity_type: "job_application", entity_id: a.id, action: "status_changed", before: { status: a.status }, after: { status: b.status } });
    return { ...after, job_closed: closed };
  }) },
];
