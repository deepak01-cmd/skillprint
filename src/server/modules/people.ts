/* Modules 7-11: employees, skill profiles, assessments, gap analysis, development planning. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, MIN_GROUP, scopeOf, User } from "../permissions";
import { employeeInScope, employeeScopeSql, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { effectiveLevel, gapFor, LevelRecord, weightedMatch } from "../calc";
import { listActive } from "./mapping";
import { enqueue, resolveRoleTitle } from "./roleFallback";
import { hashPassword, passwordProblem } from "../auth";
import { logAccess } from "../access";
import { currentAssumptions } from "./structure";

/* ---------- shared readers ---------- */
export async function levelsFor(db: Db, employeeIds: string[]): Promise<Map<string, Map<string, LevelRecord[]>>> {
  const rows = employeeIds.length ? await q(db, `SELECT employee_id, skill_id, source, level, assessed_by, to_char(assessed_on, 'YYYY-MM-DD') AS assessed_on FROM employee_skills WHERE employee_id = ANY($1)`, [employeeIds]) : [];
  const out = new Map<string, Map<string, LevelRecord[]>>();
  for (const r of rows) {
    if (!out.has(r.employee_id)) out.set(r.employee_id, new Map());
    const m = out.get(r.employee_id)!;
    m.set(r.skill_id, [...(m.get(r.skill_id) || []), { level: r.level, source: r.source, assessed_on: r.assessed_on, assessed_by: r.assessed_by }]);
  }
  return out;
}

/** Gap analysis for many employees at once: one query each for assumptions, requirements and levels,
    whatever the number of people (Module 10; AR-03). Same rules as for a single employee. */
export async function employeesGaps(db: Db, emps: any[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  if (!emps.length) return out;
  const orgId = emps[0].org_id;
  const a = (await currentAssumptions(db, orgId)).data;
  const roleIds = [...new Set(emps.map(e => e.role_id))];
  const reqByRole = new Map<string, any[]>();
  for (const r of await listActive(db, orgId, { roleIds })) (reqByRole.get(r.role_id) || reqByRole.set(r.role_id, []).get(r.role_id)!).push(r);
  const levels = await levelsFor(db, emps.map(e => e.id));
  for (const emp of emps) {
    const lv: Map<string, LevelRecord[]> = levels.get(emp.id) || new Map();
    out.set(emp.id, (reqByRole.get(emp.role_id) || []).map(r => {
      const recs = lv.get(r.skill_id) || [];
      const eff = effectiveLevel(recs, a.count_self_assessed);
      const selfRec = recs.find((x: LevelRecord) => x.source === "self");
      const effRec = recs.find((x: LevelRecord) => x.source === eff.source);
      const g = gapFor(r, eff.level, a.gap_priority);
      return { pixel_id: r.pixel_id, skill_id: r.skill_id, skill_name: r.skill_name, skill_category: r.skill_category, required_level: r.required_level,
        requirement_type: r.requirement_type, importance: r.importance, skill_trend: r.skill_trend, current_level: eff.level, source: eff.source,
        assessed_on: eff.assessed_on, assessed_by: effRec?.assessed_by ?? null, self_level: selfRec?.level ?? null, self_assessed_on: selfRec?.assessed_on ?? null, ...g };
    }));
  }
  return out;
}
/** Gap analysis for one employee against the active framework of their role. */
export async function employeeGaps(db: Db, emp: any) { return (await employeesGaps(db, [emp])).get(emp.id) || []; }

function suppress<T extends { employees: number }>(rows: T[], min: number) {
  return rows.map(r => r.employees < min ? { ...r, suppressed: true, detail: `Fewer than ${min} people` } : r);
}

/* ---------- schemas ---------- */
const empSchema = z.object({
  name: z.string().min(2).max(160), email: z.string().email(), department_id: z.string(), role_id: z.string(),
  manager_id: z.string().nullable().optional(), location: z.string().max(120).nullable().optional(), joining_date: z.string().nullable().optional(),
  employee_code: z.string().trim().max(40).regex(/^[\w./-]*$/, "Use letters, digits and . / - _ only").transform(v => v || null).nullable().optional(),
});
async function codeFree(db: Db, orgId: string, code: string | null | undefined, exceptId?: string) {
  if (!code) return;
  const o = await one(db, `SELECT id, name FROM employees WHERE org_id = $1 AND lower(employee_code) = lower($2) AND id <> coalesce($3, '')`, [orgId, code, exceptId ?? null]);
  if (o) throw conflict("employee_code_taken", `Employee number ${code} already belongs to ${o.name} (${o.id})`);
}
const METHODS = ["Self-assessment", "Manager assessment", "Technical quiz", "Practical assignment", "Project evaluation", "Peer assessment", "Certification evidence", "Structured interview", "Work sample"] as const;
const assignSchema = z.object({
  employee_id: z.string(), method: z.enum(METHODS), skill_ids: z.array(z.string()).min(1).max(40),
  assessor_id: z.string().nullable().optional(), due_date: z.string().nullable().optional(),
});
const ACTIVITY_TYPES = ["Training course", "Practical project", "Workplace assignment", "Mentoring", "Job shadowing", "Certification", "Workshop", "Reading material", "Peer learning"] as const;

async function validateEmployeeRefs(db: Db, orgId: string, b: { department_id?: string; role_id?: string; manager_id?: string | null }) {
  if (b.department_id && !(await one(db, `SELECT 1 FROM departments WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [b.department_id, orgId]))) throw unprocessable("unknown_department", "Unknown department");
  if (b.role_id && !(await one(db, `SELECT 1 FROM job_roles WHERE id = $1 AND org_id = $2 AND status = 'Published'`, [b.role_id, orgId]))) throw unprocessable("unknown_role", "Unknown or unpublished job role");
  if (b.manager_id && !(await one(db, `SELECT 1 FROM employees WHERE id = $1 AND org_id = $2`, [b.manager_id, orgId]))) throw unprocessable("unknown_manager", "Unknown manager");
}

/* Development activity suggestions per gap (15.3 pattern: knowledge, practice, validation). No AI needed. */
function suggestActivities(skill: string, current: number | null, target: number) {
  const from = current ?? 0; const out: { title: string; type: (typeof ACTIVITY_TYPES)[number]; description: string }[] = [];
  if (from < 2) out.push({ title: `Learn the fundamentals of ${skill}`, type: "Training course", description: "Build the knowledge base for routine tasks." });
  if (target >= 3 && from < 3) out.push({ title: `Apply ${skill} in a practical project`, type: "Practical project", description: "Complete a scoped piece of real work independently." });
  if (target >= 4 && from < 4) out.push({ title: `Take on a complex ${skill} assignment with a mentor`, type: "Mentoring", description: "Handle complex cases and improve an existing process." });
  if (target >= 5) out.push({ title: `Lead a ${skill} standard or community of practice`, type: "Workplace assignment", description: "Define standards and guide others." });
  out.push({ title: `Validate ${skill} at level ${target}`, type: "Workplace assignment", description: "Complete a practical assessment reviewed by an assessor." });
  return out;
}

export const routes: Route[] = [
  /* ---------- employees ---------- */
  // Paged when ?page= is given ({items, total, page, size}); filters: q (name, email, role), department_id, role_id, manager_id
  { method: "GET", pattern: "/employees", handler: async ({ db, user, query }) => {
    const [cond, params] = employeeScopeSql(user, "employees:read", 1);
    const p = [...params, query.get("status") || "Active"]; const where = [cond, `e.status = $${p.length}`];
    const text = (query.get("q") || "").trim();
    if (text) { p.push(`%${text.toLowerCase()}%`); where.push(`(lower(e.name) LIKE $${p.length} OR lower(e.email) LIKE $${p.length} OR lower(r.title) LIKE $${p.length} OR lower(e.id) LIKE $${p.length} OR lower(coalesce(e.employee_code, '')) LIKE $${p.length})`); }
    for (const k of ["department_id", "role_id", "manager_id"]) { const v = query.get(k); if (v) { p.push(v); where.push(`e.${k} = $${p.length}`); } }
    const base = `FROM employees e JOIN departments d ON d.id = e.department_id JOIN job_roles r ON r.id = e.role_id LEFT JOIN career_levels l ON l.id = r.career_level_id LEFT JOIN employees m ON m.id = e.manager_id WHERE ${where.join(" AND ")}`;
    const cols = `SELECT e.id, e.employee_code, e.name, e.email, e.status, e.location, e.joining_date, e.synthetic, e.department_id, d.name AS department_name, e.role_id, r.title AS role_title,
        e.manager_id, m.name AS manager_name, l.name AS career_level,
        (SELECT count(*) FROM employee_skills s WHERE s.employee_id = e.id AND s.source IN ('validated','manager'))::int AS assessed_skills`;
    if (!query.get("page")) return q(db, `${cols} ${base} ORDER BY d.name, e.name`, p);
    const size = Math.min(200, Math.max(10, Number(query.get("size")) || 50)); const page = Math.max(1, Number(query.get("page")) || 1);
    const sorts: Record<string, string> = { name: "e.name", department: "d.name, e.name", role: "r.title, e.name", joined: "e.joining_date DESC NULLS LAST, e.name" };
    const sort = sorts[query.get("sort") || "name"] || "e.name";
    const total = Number((await one(db, `SELECT count(*)::int AS n ${base}`, p))!.n);
    const items = await q(db, `${cols} ${base} ORDER BY ${sort} LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
    return { items, total, page, size };
  } },
  { method: "GET", pattern: "/me", handler: async ({ db, user }) => {
    if (!user.employee_id) return { employee: null };
    return { employee: await one(db, `SELECT e.*, r.title AS role_title, d.name AS department_name FROM employees e JOIN job_roles r ON r.id = e.role_id JOIN departments d ON d.id = e.department_id WHERE e.id = $1`, [user.employee_id]) };
  } },
  { method: "POST", pattern: "/employees", handler: async ({ user, body }) => {
    if (!has(user, "employees:manage")) throw forbidden();
    const b = parse(empSchema.extend({ role_id: z.string().optional(), role_title: z.string().min(2).max(200).optional(), login_password: z.string().max(200).optional() }), body);
    if (b.login_password) { const pp = passwordProblem(b.login_password); if (pp) throw unprocessable("weak_password", pp); }
    return tx(async c => {
      let roleId = b.role_id;
      if (!roleId) {
        // Role fallback: an unknown title never blocks or disappears; it is matched or queued with the person
        if (!b.role_title) throw unprocessable("role_required", "Choose a role, or type the role title so it can be matched or queued");
        await validateEmployeeRefs(c, orgOf(user), { department_id: b.department_id, manager_id: b.manager_id });
        const res = await resolveRoleTitle(c, orgOf(user), b.role_title, b.department_id);
        if (res.status === "matched" && res.role!.status === "Published") roleId = res.role!.id;
        else {
          const qid = await enqueue(c, orgOf(user), b.role_title, b.department_id, "employee_form",
            [{ kind: "employee", name: b.name, email: b.email.toLowerCase(), department_id: b.department_id, manager_id: b.manager_id || null }], res);
          await audit(c, user, { entity_type: "role_queue", entity_id: qid, action: "employee_waiting", after: { email: b.email, title: b.role_title } });
          return { status: "queued", queue_id: qid, suggestions: res, note: `"${b.role_title}" is not a published role yet. ${b.name} will be created as soon as the title is resolved.` };
        }
      }
      await validateEmployeeRefs(c, orgOf(user), { ...b, role_id: roleId });
      await codeFree(c, orgOf(user), b.employee_code);
      let userId: string | null = null;
      if (b.login_password) {
        if (await one(c, `SELECT 1 FROM users WHERE lower(email) = lower($1)`, [b.email])) throw unprocessable("email_in_use", "A login with this email already exists");
        userId = (await one(c, `INSERT INTO users (org_id, email, name, password_hash, role, department_id) VALUES ($1,$2,$3,$4,'employee',$5) RETURNING id`,
          [orgOf(user), b.email.toLowerCase(), b.name, await hashPassword(b.login_password), b.department_id]))!.id;
      }
      const e = await one(c, `INSERT INTO employees (org_id, user_id, name, email, department_id, role_id, manager_id, location, joining_date, employee_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [orgOf(user), userId, b.name, b.email.toLowerCase(), b.department_id, roleId, b.manager_id || null, b.location || null, b.joining_date || null, b.employee_code ?? null]);
      const { login_password, ...logged } = b;
      await audit(c, user, { entity_type: "employee", entity_id: e.id, action: "created", after: { ...logged, role_id: roleId, login_created: !!userId } });
      return { ...e, status: "created" };
    });
  } },
  { method: "POST", pattern: "/employees/import", handler: async ({ user, body }) => {
    if (!has(user, "employees:manage")) throw forbidden();
    const lines = String(body.csv || "").split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw unprocessable("empty", "Paste a header row and at least one employee");
    const head = lines[0].toLowerCase().split(",").map(s => s.trim());
    const col = (n: string) => head.findIndex(h => h.replace(/\s+/g, "") === n);
    const ix = { id: col("employeeid"), name: col("name"), email: col("email"), dept: col("department"), role: col("role") };
    const missing = Object.entries(ix).filter(([k, v]) => v < 0 && k !== "id").map(([k]) => k);
    if (missing.length) throw unprocessable("missing_columns", `Missing columns: ${missing.join(", ")}`);
    const orgId = orgOf(user);
    return tx(async c => {
      const depts = await q(c, `SELECT id, lower(name) AS n FROM departments WHERE org_id = $1 AND status = 'Active'`, [orgId]);
      const existing = new Set((await q(c, `SELECT lower(email) AS e FROM employees WHERE org_id = $1`, [orgId])).map(r => r.e));
      const seen = new Set<string>(); const errors: string[] = []; const valid: any[] = [];
      for (const [i, line] of lines.slice(1).entries()) {
        const cols = line.split(",").map(s => s.trim()); const row = i + 2;
        const email = (cols[ix.email] || "").toLowerCase();
        const dept = depts.find(d => d.n === (cols[ix.dept] || "").toLowerCase());
        const title = cols[ix.role] || "";
        if (!cols[ix.name]) { errors.push(`Row ${row}: name is required`); continue; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errors.push(`Row ${row}: invalid email "${cols[ix.email] || ""}"`); continue; }
        if (existing.has(email) || seen.has(email)) { errors.push(`Row ${row}: duplicate email ${email}`); continue; }
        if (!dept) { errors.push(`Row ${row}: unknown department "${cols[ix.dept] || ""}"`); continue; }
        if (!title) { errors.push(`Row ${row}: role is empty`); continue; }
        seen.add(email);
        const res = await resolveRoleTitle(c, orgId, title, dept.id);
        valid.push({ row, name: cols[ix.name], email, department_id: dept.id, title, res, role_id: res.status === "matched" && res.role!.status === "Published" ? res.role!.id : null });
      }
      const matched = valid.filter(v => v.role_id), unresolved = valid.filter(v => !v.role_id);
      const summary = {
        auto_matched: matched.filter(v => v.res.method !== "exact").map(v => ({ row: v.row, title: v.title, role_id: v.role_id, role_title: v.res.role.title, method: v.res.method, note: v.res.note })),
        to_queue: unresolved.map(v => ({ row: v.row, title: v.title, best_candidate: v.res.candidates?.[0]?.title ?? v.res.role?.title ?? null, templates: (v.res.templates || []).length })),
      };
      if (body.dry_run || errors.length) return { imported: 0, queued: 0, valid: valid.length, errors, ...summary,
        note: errors.length ? "Fix the errors and import again. Nothing was imported." : `Validation passed: ${matched.length} will be imported, ${unresolved.length} will wait in the role resolution queue.` };
      for (const v of matched) await q(c, `INSERT INTO employees (org_id, name, email, department_id, role_id) VALUES ($1,$2,$3,$4,$5)`, [orgId, v.name, v.email, v.department_id, v.role_id]);
      const queueIds = new Set<string>();
      for (const v of unresolved) queueIds.add(await enqueue(c, orgId, v.title, v.department_id, "employee_import", [{ kind: "employee", name: v.name, email: v.email, department_id: v.department_id }], v.res));
      await audit(c, user, { entity_type: "employee", entity_id: "import", action: "imported", after: { imported: matched.length, queued: unresolved.length } });
      return { imported: matched.length, queued: unresolved.length, queue_items: [...queueIds], errors: [], ...summary };
    });
  } },
  { method: "PATCH", pattern: "/employees/:id", handler: async ({ db, user, params, body }) => {
    if (!has(user, "employees:manage")) throw forbidden();
    const e = await employeeInScope(db, user, "employees:read", params.id);
    const b = parse(empSchema.partial().extend({ status: z.enum(["Active", "Inactive"]).optional() }), body);
    await validateEmployeeRefs(db, orgOf(user), b);
    if (b.manager_id === e.id) throw unprocessable("invalid_manager", "An employee cannot report to themselves");
    await codeFree(db, orgOf(user), b.employee_code, e.id);
    const keys = Object.keys(b).filter(k => (b as any)[k] !== undefined);
    if (!keys.length) return e;
    const after = await one(db, `UPDATE employees SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [e.id, ...keys.map(k => (b as any)[k])]);
    await audit(db, user, { entity_type: "employee", entity_id: e.id, action: "updated", before: Object.fromEntries(keys.map(k => [k, e[k]])), after: b });
    return after;
  } },
  // Profile (Module 8): role requirements, levels by provenance, retired skills kept as history
  { method: "GET", pattern: "/employees/:id", handler: async ({ db, user, params, meta }) => {
    const e = await employeeInScope(db, user, "employees:read", params.id);
    await logAccess(db, user, e.id, "profile", null, meta.ip);
    const info = await one(db, `SELECT e.*, d.name AS department_name, r.title AS role_title, r.status AS role_status, m.name AS manager_name, l.name AS career_level
      FROM employees e JOIN departments d ON d.id = e.department_id JOIN job_roles r ON r.id = e.role_id LEFT JOIN employees m ON m.id = e.manager_id LEFT JOIN career_levels l ON l.id = r.career_level_id WHERE e.id = $1`, [e.id]);
    const gaps = await employeeGaps(db, e);
    const required = new Set(gaps.map(g => g.skill_id));
    const all = (await levelsFor(db, [e.id])).get(e.id) || new Map();
    const archivedForRole = new Set((await q(db, `SELECT skill_id FROM role_skill_mapping WHERE org_id = $1 AND role_id = $2 AND lifecycle_status = 'Archived'`, [e.org_id, e.role_id])).map(r => r.skill_id));
    const names = Object.fromEntries((await q(db, `SELECT id, name, category FROM skills WHERE id = ANY($1)`, [[...all.keys()]])).map(r => [r.id, r]));
    const additional = [...all.entries()].filter(([sid]) => !required.has(sid)).map(([sid, recs]) => ({
      skill_id: sid, skill_name: names[sid]?.name, skill_category: names[sid]?.category, records: recs,
      label: archivedForRole.has(sid) ? "Retired (kept as history)" : "Additional skill" }));
    const evidence = await q(db, `SELECT v.*, s.name AS skill_name FROM employee_evidence v JOIN skills s ON s.id = v.skill_id WHERE v.employee_id = $1 ORDER BY v.created_at DESC`, [e.id]);
    const assessments = await q(db, `SELECT a.*, u.name AS assessor_name, (SELECT count(*) FROM assessment_items i WHERE i.assessment_id = a.id)::int AS items FROM assessments a LEFT JOIN users u ON u.id = a.assessor_id WHERE a.employee_id = $1 ORDER BY a.created_at DESC`, [e.id]);
    const records = Object.fromEntries([...all.entries()].map(([k, v]) => [k, v]));
    const a = (await currentAssumptions(db, e.org_id)).data;
    return { employee: info, gaps, additional, records, evidence, assessments, count_self_assessed: a.count_self_assessed,
      match: weightedMatch(gaps.map((g: any) => ({ required_level: g.required_level, requirement_type: g.requirement_type, current: g.current_level }))),
      can: { manage: has(user, "employees:manage"), assess: !!scopeOf(user, "assessments:assign") && user.employee_id !== e.id, self: user.employee_id === e.id, plan: !!scopeOf(user, "development:write") } };
  } },
  { method: "POST", pattern: "/employees/:id/self-assess", handler: async ({ user, params, body }) => {
    if (user.employee_id !== params.id) throw forbidden("Only the employee can record a self-assessment");
    const b = z.object({ skill_id: z.string(), level: z.coerce.number().int().min(0).max(5) }).parse(body);
    return tx(async c => {
      await q(c, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by) VALUES ($1,$2,$3,'self',$4,$5)
                  ON CONFLICT (employee_id, skill_id, source) DO UPDATE SET level = EXCLUDED.level, assessed_on = current_date`, [orgOf(user), params.id, b.skill_id, b.level, user.name]);
      await audit(c, user, { entity_type: "employee_skill", entity_id: `${params.id}/${b.skill_id}`, action: "self_assessed", after: b });
      return { ok: true, note: "Self-reported levels are shown as self-reported and are not treated as verified proficiency." };
    });
  } },
  { method: "POST", pattern: "/employees/:id/evidence", handler: async ({ db, user, params, body }) => {
    const e = await employeeInScope(db, user, "employees:read", params.id);
    const b = z.object({ skill_id: z.string(), type: z.enum(["Project", "Repository", "Certification", "Assessment result", "Work sample", "Manager feedback", "Training completion"]),
      title: z.string().min(2).max(300), link: z.string().max(500).optional(), evidence_date: z.string().optional() }).parse(body);
    const v = await one(db, `INSERT INTO employee_evidence (org_id, employee_id, skill_id, type, title, link, evidence_date) VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date, current_date)) RETURNING *`,
      [e.org_id, e.id, b.skill_id, b.type, b.title, b.link || null, b.evidence_date || null]);
    await audit(db, user, { entity_type: "evidence", entity_id: v.id, action: "added", after: b });
    return v;
  } },
  { method: "PATCH", pattern: "/evidence/:id", handler: async ({ db, user, params, body }) => {
    const v = await one(db, `SELECT * FROM employee_evidence WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!v) throw notFound("Evidence");
    if (!scopeOf(user, "assessments:review") || user.employee_id === v.employee_id) throw forbidden("Evidence is validated by a manager, assessor or HR");
    await employeeInScope(db, user, user.role === "expert" ? "employees:read" : "assessments:review", v.employee_id).catch(e => { if (user.role !== "expert") throw e; });
    const status = z.enum(["Validated", "Rejected", "Expired"]).parse(body.validation_status);
    await q(db, `UPDATE employee_evidence SET validation_status = $2 WHERE id = $1`, [v.id, status]);
    await audit(db, user, { entity_type: "evidence", entity_id: v.id, action: "validation", before: { validation_status: v.validation_status }, after: { validation_status: status } });
    return { ok: true };
  } },

  /* ---------- assessments (Module 9) ---------- */
  { method: "GET", pattern: "/assessments", handler: async ({ db, user }) => {
    const orgId = orgOf(user);
    const base = `SELECT a.*, e.name AS employee_name, r.title AS role_title, u.name AS assessor_name,
      (SELECT count(*) FROM assessment_items i WHERE i.assessment_id = a.id)::int AS items
      FROM assessments a JOIN employees e ON e.id = a.employee_id JOIN job_roles r ON r.id = e.role_id LEFT JOIN users u ON u.id = a.assessor_id`;
    if (user.role === "expert") return q(db, `${base} WHERE a.org_id = $1 AND a.assessor_id = $2 ORDER BY a.created_at DESC`, [orgId, user.id]);
    const [cond, params] = employeeScopeSql(user, user.role === "employee" ? "employees:read" : "assessments:review", 2);
    const viaReview = scopeOf(user, "assessments:review");
    if (!viaReview && user.role !== "employee") {
      const [c2, p2] = employeeScopeSql(user, "employees:read", 2);
      return q(db, `${base} WHERE a.org_id = $1 AND ${c2} ORDER BY a.created_at DESC`, [orgId, ...p2]);
    }
    return q(db, `${base} WHERE a.org_id = $1 AND ${cond} ORDER BY a.created_at DESC LIMIT 300`, [orgId, ...params]);
  } },
  { method: "POST", pattern: "/assessments", handler: async ({ user, body }) => {
    const b = parse(assignSchema, body);
    return tx(async c => {
      const e = await employeeInScope(c, user, "assessments:assign", b.employee_id);
      if (b.assessor_id && !(await one(c, `SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role IN ('expert','manager','hr_admin','dept_head')`, [b.assessor_id, e.org_id]))) throw unprocessable("invalid_assessor", "Choose an assessor in your organisation");
      const known = await q(c, `SELECT id FROM skills WHERE id = ANY($1) AND (org_id IS NULL OR org_id = $2)`, [b.skill_ids, e.org_id]);
      if (known.length !== b.skill_ids.length) throw unprocessable("unknown_skill", "One or more skills are unknown");
      const a = await one(c, `INSERT INTO assessments (org_id, employee_id, method, assigned_by, assessor_id, due_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [e.org_id, e.id, b.method, user.name, b.assessor_id || (b.method === "Self-assessment" ? null : user.id), b.due_date || null]);
      for (const s of b.skill_ids) await q(c, `INSERT INTO assessment_items (assessment_id, skill_id) VALUES ($1,$2)`, [a.id, s]);
      await audit(c, user, { entity_type: "assessment", entity_id: a.id, action: "assigned", after: b });
      return a;
    });
  } },
  { method: "GET", pattern: "/assessments/:id", handler: async ({ db, user, params }) => {
    const a = await one(db, `SELECT a.*, e.name AS employee_name, e.role_id, u.name AS assessor_name FROM assessments a JOIN employees e ON e.id = a.employee_id LEFT JOIN users u ON u.id = a.assessor_id WHERE a.id = $1 AND a.org_id = $2`, [params.id, orgOf(user)]);
    if (!a) throw notFound("Assessment");
    const isAssessor = a.assessor_id === user.id;
    if (!isAssessor) await employeeInScope(db, user, user.employee_id === a.employee_id ? "employees:read" : "assessments:review", a.employee_id);
    const reqs = new Map((await listActive(db, a.org_id, { roleId: a.role_id })).map(r => [r.skill_id, r.required_level]));
    const items = await q(db, `SELECT i.*, s.name AS skill_name FROM assessment_items i JOIN skills s ON s.id = i.skill_id WHERE i.assessment_id = $1 ORDER BY s.name`, [a.id]);
    const descriptors = await q(db, `SELECT p.level, p.name, p.descriptor, d.skill_id, d.descriptor AS skill_descriptor FROM proficiency_levels p LEFT JOIN skill_level_descriptors d ON d.org_id = p.org_id AND d.level = p.level AND d.skill_id = ANY($2) WHERE p.org_id = $1 ORDER BY p.level`, [a.org_id, items.map(i => i.skill_id)]);
    return { ...a, items: items.map(i => ({ ...i, required_level: reqs.get(i.skill_id) ?? null })), descriptors,
      can: { submit: user.employee_id === a.employee_id && a.status === "Assigned", review: (isAssessor || (!!scopeOf(user, "assessments:review") && user.employee_id !== a.employee_id)) && ["Assigned", "Submitted"].includes(a.status) && (a.method !== "Self-assessment" || a.status === "Submitted") } };
  } },
  { method: "POST", pattern: "/assessments/:id/submit", handler: async ({ user, params, body }) => tx(async c => {
    const a = await one(c, `SELECT * FROM assessments WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!a) throw notFound("Assessment");
    if (a.employee_id !== user.employee_id) throw forbidden("Only the assessed employee submits responses");
    if (a.status !== "Assigned") throw conflict("not_open", `This assessment is ${a.status}`);
    const items = z.array(z.object({ skill_id: z.string(), self_level: z.coerce.number().int().min(0).max(5), self_evidence: z.string().max(2000).optional() })).parse(body.items);
    for (const i of items) {
      await q(c, `UPDATE assessment_items SET self_level = $3, self_evidence = $4 WHERE assessment_id = $1 AND skill_id = $2`, [a.id, i.skill_id, i.self_level, i.self_evidence || null]);
      await q(c, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by) VALUES ($1,$2,$3,'self',$4,$5)
                  ON CONFLICT (employee_id, skill_id, source) DO UPDATE SET level = EXCLUDED.level, assessed_on = current_date`, [a.org_id, a.employee_id, i.skill_id, i.self_level, user.name]);
    }
    await q(c, `UPDATE assessments SET status = 'Submitted', submitted_at = now() WHERE id = $1`, [a.id]);
    await audit(c, user, { entity_type: "assessment", entity_id: a.id, action: "submitted", after: items });
    return { status: "Submitted" };
  }) },
  { method: "POST", pattern: "/assessments/:id/review", handler: async ({ user, params, body }) => tx(async c => {
    const a = await one(c, `SELECT * FROM assessments WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!a) throw notFound("Assessment");
    if (a.employee_id === user.employee_id) throw forbidden("You cannot review your own assessment");
    if (a.assessor_id !== user.id) await employeeInScope(c, user, "assessments:review", a.employee_id);
    if (!["Assigned", "Submitted"].includes(a.status)) throw conflict("not_open", `This assessment is ${a.status}`);
    if (a.method === "Self-assessment" && a.status !== "Submitted") throw conflict("awaiting_employee", "Wait for the employee to submit the self-assessment");
    const items = z.array(z.object({ skill_id: z.string(), assessed_level: z.coerce.number().int().min(0).max(5), feedback: z.string().max(2000).optional(), score: z.coerce.number().min(0).max(100).optional() })).min(1).parse(body.items);
    // Manager assessment and manager review of a self-assessment record a manager-assessed level; other methods are validated by an assessor.
    const source = ["Manager assessment", "Self-assessment"].includes(a.method) ? "manager" : "validated";
    for (const i of items) {
      const r = await q(c, `UPDATE assessment_items SET assessed_level = $3, feedback = $4, score = $5 WHERE assessment_id = $1 AND skill_id = $2 RETURNING skill_id`, [a.id, i.skill_id, i.assessed_level, i.feedback || null, i.score ?? null]);
      if (!r.length) throw bad(`Skill ${i.skill_id} is not part of this assessment`);
      await q(c, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by) VALUES ($1,$2,$3,$4,$5,$6)
                  ON CONFLICT (employee_id, skill_id, source) DO UPDATE SET level = EXCLUDED.level, assessed_by = EXCLUDED.assessed_by, assessed_on = current_date`,
        [a.org_id, a.employee_id, i.skill_id, source, i.assessed_level, user.name]);
    }
    await q(c, `UPDATE assessments SET status = 'Reviewed', reviewed_at = now(), assessor_id = coalesce(assessor_id, $2) WHERE id = $1`, [a.id, user.id]);
    await audit(c, user, { entity_type: "assessment", entity_id: a.id, action: "reviewed", after: { source, items } });
    return { status: "Reviewed", recorded_as: source };
  }) },

  /* ---------- gap analysis (Module 10) ---------- */
  { method: "GET", pattern: "/employees/:id/gaps", handler: async ({ db, user, params, meta }) => {
    const e = await employeeInScope(db, user, "gaps:read", params.id);
    await logAccess(db, user, e.id, "skill gaps", null, meta.ip);
    return employeeGaps(db, e);
  } },
  { method: "GET", pattern: "/gaps", handler: async ({ db, user, query }) => {
    if (!scopeOf(user, "gaps:read") || user.role === "employee") throw forbidden();
    const a = (await currentAssumptions(db, orgOf(user))).data;
    const [cond, params] = employeeScopeSql(user, "gaps:read", 1);
    const dept = query.get("department_id");
    const emps = await q(db, `SELECT e.* FROM employees e WHERE ${cond} AND e.status = 'Active' ${dept ? `AND e.department_id = $${params.length + 1}` : ""}`, dept ? [...params, dept] : params);
    const gm = await employeesGaps(db, emps); const all = emps.map(e => ({ e, gaps: gm.get(e.id) || [] }));
    const bySkill = new Map<string, any>();
    for (const { gaps } of all) for (const g of gaps) {
      const s = bySkill.get(g.skill_id) || { skill_id: g.skill_id, skill_name: g.skill_name, skill_category: g.skill_category, employees: 0, with_gap: 0, no_data: 0, total_gap: 0, high_priority: 0, critical: 0 };
      s.employees++; if (g.status === "Gap") { s.with_gap++; s.total_gap += g.gap!; } if (g.status === "No assessment data") s.no_data++;
      if (g.priority === "High") s.high_priority++; if (g.importance === "Critical") s.critical++;
      bySkill.set(g.skill_id, s);
    }
    const skills = [...bySkill.values()].map(s => ({ ...s, avg_gap: s.with_gap ? Math.round(s.total_gap / s.with_gap * 10) / 10 : 0 })).sort((x, y) => y.high_priority - x.high_priority || y.with_gap - x.with_gap);
    const byDept = new Map<string, any>();
    for (const { e, gaps } of all) {
      const d = byDept.get(e.department_id) || { department_id: e.department_id, employees: 0, gaps: 0, high: 0, no_data: 0 };
      d.employees++; d.gaps += gaps.filter(g => g.status === "Gap").length; d.high += gaps.filter(g => g.priority === "High").length; d.no_data += gaps.filter(g => g.status === "No assessment data").length;
      byDept.set(e.department_id, d);
    }
    const names = Object.fromEntries((await q(db, `SELECT id, name FROM departments WHERE org_id = $1`, [orgOf(user)])).map(r => [r.id, r.name]));
    const individual = scopeOf(user, "gaps:read") === "team"
      ? all.map(({ e, gaps }) => ({ employee_id: e.id, name: e.name, gaps: gaps.filter(g => g.status === "Gap").length, high: gaps.filter(g => g.priority === "High").length, no_data: gaps.filter(g => g.status === "No assessment data").length }))
      : null;
    const min = scopeOf(user, "gaps:read") === "team" ? 1 : a.min_group_size ?? MIN_GROUP;
    return { scope: scopeOf(user, "gaps:read"), employees: emps.length, min_group_size: min,
      skills: suppress(skills, min), departments: suppress([...byDept.values()].map(d => ({ ...d, department_name: names[d.department_id] })), min), individual };
  } },
  { method: "GET", pattern: "/team/matrix", handler: async ({ db, user }) => {
    if (!["manager", "hr_admin", "dept_head"].includes(user.role)) throw forbidden();
    const [cond, params] = employeeScopeSql(user, user.role === "manager" ? "gaps:read" : "employees:read", 1);
    const emps = await q(db, `SELECT e.*, r.title AS role_title FROM employees e JOIN job_roles r ON r.id = e.role_id WHERE ${cond} AND e.status = 'Active' AND e.id <> coalesce($${params.length + 1}, '') ORDER BY e.name LIMIT 60`, [...params, user.employee_id]);
    const gm = await employeesGaps(db, emps); const rows = emps.map(e => ({ employee_id: e.id, name: e.name, role_title: e.role_title, gaps: gm.get(e.id) || [] }));
    const skills = new Map<string, string>();
    rows.forEach(r => r.gaps.forEach(g => skills.set(g.skill_id, g.skill_name)));
    return { skills: [...skills.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), rows };
  } },

  /* ---------- development planning (Module 11) ---------- */
  { method: "GET", pattern: "/employees/:id/plans", handler: async ({ db, user, params }) => {
    const e = await employeeInScope(db, user, "employees:read", params.id);
    const plans = await q(db, `SELECT * FROM development_plans WHERE employee_id = $1 ORDER BY created_at DESC`, [e.id]);
    const acts = await q(db, `SELECT d.*, s.name AS skill_name FROM development_activities d JOIN skills s ON s.id = d.skill_id WHERE d.plan_id = ANY($1) ORDER BY d.created_at`, [plans.map(p => p.id)]);
    const gaps = await employeeGaps(db, e);
    const now = new Map(gaps.map(g => [g.skill_id, g.current_level]));
    return plans.map(p => ({ ...p, activities: acts.filter(a => a.plan_id === p.id).map(a => ({ ...a, level_now: now.get(a.skill_id) ?? null })) }));
  } },
  { method: "POST", pattern: "/employees/:id/plans/generate", handler: async ({ user, params, body }) => tx(async c => {
    const e = await employeeInScope(c, user, "development:write", params.id);
    const fromSkills: { skill_id: string; target: number; source: string }[] | undefined = Array.isArray(body.skills) ? body.skills : undefined;
    let targets: { skill_id: string; skill_name: string; current: number | null; target: number; source: string }[];
    if (fromSkills) {
      const names = Object.fromEntries((await q(c, `SELECT id, name FROM skills WHERE id = ANY($1)`, [fromSkills.map(s => s.skill_id)])).map(r => [r.id, r.name]));
      const lv = (await levelsFor(c, [e.id])).get(e.id) || new Map();
      const a = (await currentAssumptions(c, e.org_id)).data;
      targets = fromSkills.filter(s => names[s.skill_id]).map(s => ({ skill_id: s.skill_id, skill_name: names[s.skill_id], current: effectiveLevel(lv.get(s.skill_id) || [], a.count_self_assessed).level, target: Number(s.target), source: s.source || "readiness" }));
    } else {
      targets = (await employeeGaps(c, e)).filter(g => g.status === "Gap").map(g => ({ skill_id: g.skill_id, skill_name: g.skill_name, current: g.current_level, target: g.required_level, source: "gap" }));
    }
    if (!targets.length) throw unprocessable("no_gaps", "There are no gaps to plan for. Record assessments first, or add activities manually");
    const plan = await one(c, `INSERT INTO development_plans (org_id, employee_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [e.org_id, e.id, String(body.title || `Development plan ${new Date().toISOString().slice(0, 10)}`), user.name]);
    let n = 0;
    for (const t of targets) for (const s of suggestActivities(t.skill_name, t.current, t.target)) {
      await q(c, `INSERT INTO development_activities (plan_id, skill_id, title, type, current_level, target_level, description, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [plan.id, t.skill_id, s.title, s.type, t.current, t.target, s.description, t.source]); n++;
    }
    await audit(c, user, { entity_type: "development_plan", entity_id: plan.id, action: "generated", after: { employee: e.id, skills: targets.length, activities: n } });
    return { plan, activities: n };
  }) },
  { method: "POST", pattern: "/plans/:id/activities", handler: async ({ db, user, params, body }) => {
    const p = await one(db, `SELECT * FROM development_plans WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Plan");
    await employeeInScope(db, user, "development:write", p.employee_id);
    const b = z.object({ skill_id: z.string(), title: z.string().min(2), type: z.enum(ACTIVITY_TYPES), target_level: z.coerce.number().int().min(1).max(5).optional(),
      description: z.string().default(""), resource: z.string().optional(), mentor: z.string().optional(), due_date: z.string().optional() }).parse(body);
    const a = await one(db, `INSERT INTO development_activities (plan_id, skill_id, title, type, target_level, description, resource, mentor, due_date, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual') RETURNING *`,
      [p.id, b.skill_id, b.title, b.type, b.target_level ?? null, b.description, b.resource || null, b.mentor || null, b.due_date || null]);
    await audit(db, user, { entity_type: "development_activity", entity_id: a.id, action: "created", after: b });
    return a;
  } },
  { method: "PATCH", pattern: "/activities/:id", handler: async ({ db, user, params, body }) => {
    const a = await one(db, `SELECT d.*, p.employee_id, p.org_id FROM development_activities d JOIN development_plans p ON p.id = d.plan_id WHERE d.id = $1 AND p.org_id = $2`, [params.id, orgOf(user)]);
    if (!a) throw notFound("Activity");
    await employeeInScope(db, user, "development:write", a.employee_id);
    const b = z.object({ status: z.enum(["Not started", "In progress", "Submitted", "Done"]).optional(), evidence: z.string().max(2000).optional(),
      feedback: z.string().max(2000).optional(), mentor: z.string().max(160).optional(), due_date: z.string().nullable().optional(), clear_flag: z.boolean().optional() }).parse(body);
    if (b.feedback !== undefined && user.employee_id === a.employee_id) throw forbidden("Reviewer feedback comes from a manager or HR");
    if (b.status === "Done" && user.employee_id === a.employee_id) throw forbidden("A reviewer marks the activity done after checking the evidence");
    const after = await one(db, `UPDATE development_activities SET status = coalesce($2, status), evidence = coalesce($3, evidence), feedback = coalesce($4, feedback), mentor = coalesce($5, mentor),
        due_date = CASE WHEN $6 THEN $7::date ELSE due_date END, flag = CASE WHEN $8 THEN NULL ELSE flag END WHERE id = $1 RETURNING *`,
      [a.id, b.status ?? null, b.evidence ?? null, b.feedback ?? null, b.mentor ?? null, b.due_date !== undefined, b.due_date ?? null, !!b.clear_flag]);
    await audit(db, user, { entity_type: "development_activity", entity_id: a.id, action: "updated", before: { status: a.status }, after: b });
    return after;
  } },
];
