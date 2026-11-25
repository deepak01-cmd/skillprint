/* Succession planning: HR (whole organisation) and department heads (their department) mark critical roles, see who
   holds them, get internal candidates ranked by skill match, and name successors with a readiness horizon. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { logAccess } from "../access";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { User } from "../permissions";
import { orgOf } from "../scope";
import { Route } from "../http/router";
import { effectiveLevel, weightedMatch } from "../calc";
import { listActive } from "./mapping";
import { levelsFor } from "./people";
import { currentAssumptions } from "./structure";

const READINESS = ["Ready now", "Ready in 1-2 years", "Ready in 3+ years"] as const;
const canPlan = (u: User) => u.role === "hr_admin" || u.role === "dept_head";
const inScope = (u: User, deptId: string) => u.role === "hr_admin" || (u.role === "dept_head" && u.department_id === deptId);

/** Match of every active employee (outside the role) to one role, in a fixed number of queries. */
export async function rankFor(db: Db, orgId: string, roleId: string, opts: { employeeIds?: string[]; limit?: number } = {}) {
  const A = (await currentAssumptions(db, orgId)).data;
  const reqs = await listActive(db, orgId, { roleId });
  const emps = await q(db, `SELECT e.id, e.name, e.role_id, e.department_id, r.title AS role_title, d.name AS department_name, l.rank AS level_rank, e.joining_date
    FROM employees e JOIN job_roles r ON r.id = e.role_id JOIN departments d ON d.id = e.department_id LEFT JOIN career_levels l ON l.id = r.career_level_id
    WHERE e.org_id = $1 AND e.status = 'Active' AND ($2::text[] IS NULL OR e.id = ANY($2))`, [orgId, opts.employeeIds ?? null]);
  const lv = await levelsFor(db, emps.map(e => e.id));
  const asp = new Set((await q(db, `SELECT employee_id FROM aspirations WHERE target_role_id = $1`, [roleId])).map(r => r.employee_id));
  const applied = new Set((await q(db, `SELECT a.employee_id FROM job_applications a JOIN internal_jobs j ON j.id = a.job_id WHERE j.role_id = $1 AND a.status NOT IN ('Withdrawn','Not selected')`, [roleId])).map(r => r.employee_id));
  const out = emps.map(e => {
    const gaps: string[] = [];
    const lines = reqs.map(r => { const cur = effectiveLevel(lv.get(e.id)?.get(r.skill_id) || [], A.count_self_assessed).level; if (cur === null || cur < r.required_level) gaps.push(r.skill_name); return { required_level: r.required_level, requirement_type: r.requirement_type, current: cur }; });
    const wm = weightedMatch(lines); const match = wm.match_pct, mustGaps = wm.mandatory_gaps;
    return { employee_id: e.id, name: e.name, role_title: e.role_title, department_name: e.department_name, in_role: e.role_id === roleId, match, skills_met: wm.skills_met, skills_required: wm.skills_required,
      mandatory_gaps: mustGaps, top_gaps: gaps.slice(0, 3), aspires: asp.has(e.id), applied: applied.has(e.id),
      suggested: match >= 85 && mustGaps === 0 ? "Ready now" : match >= 60 ? "Ready in 1-2 years" : "Ready in 3+ years" };
  });
  return out.sort((a, b) => b.match - a.match || Number(b.aspires) - Number(a.aspires)).slice(0, opts.limit ?? out.length);
}

async function planFor(db: Db, u: User, id: string) {
  const p = await one(db, `SELECT p.*, r.title AS role_title, r.department_id, d.name AS department_name, l.name AS career_level FROM succession_plans p JOIN job_roles r ON r.id = p.role_id
    JOIN departments d ON d.id = r.department_id LEFT JOIN career_levels l ON l.id = r.career_level_id WHERE p.id = $1 AND p.org_id = $2`, [id, orgOf(u)]);
  if (!p || !inScope(u, p.department_id)) throw notFound("Succession plan");
  return p;
}
const benchOf = (succ: any[], incumbents: number) => {
  const now = succ.filter(s => s.readiness === "Ready now").length;
  return { ready_now: now, ready_1_2: succ.filter(s => s.readiness === "Ready in 1-2 years").length, ready_3: succ.filter(s => s.readiness === "Ready in 3+ years").length,
    risk: !succ.length ? "No successor" : now === 0 ? "No one ready now" : now < Math.max(1, incumbents) ? "Thin bench" : "Covered" };
};

export const routes: Route[] = [
  { method: "GET", pattern: "/succession", handler: async ({ db, user }) => {
    if (!canPlan(user)) throw forbidden();
    const plans = await q(db, `SELECT p.id, p.role_id, p.criticality, p.reason, p.updated_at, r.title AS role_title, r.department_id, d.name AS department_name,
        (SELECT count(*)::int FROM employees e WHERE e.role_id = p.role_id AND e.status = 'Active') AS incumbents
      FROM succession_plans p JOIN job_roles r ON r.id = p.role_id JOIN departments d ON d.id = r.department_id
      WHERE p.org_id = $1 AND p.status = 'Active' AND ($2::text IS NULL OR r.department_id = $2) ORDER BY array_position(ARRAY['Critical','High','Medium'], p.criticality), r.title`,
      [orgOf(user), user.role === "dept_head" ? user.department_id : null]);
    const succ = plans.length ? await q(db, `SELECT s.plan_id, s.readiness FROM successors s JOIN employees e ON e.id = s.employee_id AND e.status = 'Active' WHERE s.plan_id = ANY($1)`, [plans.map(p => p.id)]) : [];
    return plans.map(p => { const s = succ.filter(x => x.plan_id === p.id); return { ...p, successors: s.length, ...benchOf(s, p.incumbents) }; });
  } },
  { method: "POST", pattern: "/succession", handler: async ({ db, user, body }) => {
    if (!canPlan(user)) throw forbidden();
    const b = z.object({ role_id: z.string().max(40), criticality: z.enum(["Critical", "High", "Medium"]).default("High"), reason: z.string().trim().max(1000).default("") }).parse(body);
    const role = await one(db, `SELECT id, department_id, status, title FROM job_roles WHERE id = $1 AND org_id = $2`, [b.role_id, orgOf(user)]);
    if (!role) throw notFound("Role");
    if (role.status !== "Published") throw unprocessable("role_not_published", "Plan succession for published roles");
    if (!inScope(user, role.department_id)) throw forbidden("Department heads plan for their own department");
    if (await one(db, `SELECT 1 FROM succession_plans WHERE role_id = $1 AND status = 'Active'`, [role.id])) throw conflict("exists", `${role.title} already has a succession plan`);
    const p = await one(db, `INSERT INTO succession_plans (org_id, role_id, criticality, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [orgOf(user), role.id, b.criticality, b.reason, user.name]);
    await audit(db, user, { entity_type: "succession_plan", entity_id: p.id, action: "created", after: b });
    return p;
  } },
  { method: "PATCH", pattern: "/succession/:id", handler: async ({ db, user, params, body }) => {
    const p = await planFor(db, user, params.id);
    const b = z.object({ criticality: z.enum(["Critical", "High", "Medium"]).optional(), reason: z.string().trim().max(1000).optional(), status: z.enum(["Active", "Archived"]).optional() }).parse(body);
    const after = await one(db, `UPDATE succession_plans SET criticality = coalesce($2, criticality), reason = coalesce($3, reason), status = coalesce($4, status), updated_at = now() WHERE id = $1 RETURNING *`, [p.id, b.criticality ?? null, b.reason ?? null, b.status ?? null]);
    await audit(db, user, { entity_type: "succession_plan", entity_id: p.id, action: "updated", before: { criticality: p.criticality, status: p.status }, after: b });
    return after;
  } },
  { method: "GET", pattern: "/succession/:id", handler: async ({ db, user, params, meta }) => {
    const p = await planFor(db, user, params.id);
    const ranked = await rankFor(db, p.org_id, p.role_id);
    const named = await q(db, `SELECT s.employee_id, s.readiness, s.notes, s.added_by, s.added_at FROM successors s JOIN employees e ON e.id = s.employee_id AND e.status = 'Active' WHERE s.plan_id = $1`, [p.id]);
    const byId = new Map(ranked.map(r => [r.employee_id, r]));
    const successors = named.map(n => ({ ...byId.get(n.employee_id), ...n })).sort((a, b) => READINESS.indexOf(a.readiness) - READINESS.indexOf(b.readiness) || (b.match ?? 0) - (a.match ?? 0));
    const incumbents = ranked.filter(r => r.in_role);
    const candidates = ranked.filter(r => !r.in_role && !named.some(n => n.employee_id === r.employee_id)).slice(0, 25);
    await logAccess(db, user, null, "succession plan", `${p.id} · ${p.role_title}`, meta.ip);
    return { ...p, incumbents, successors, candidates, bench: benchOf(successors, incumbents.length) };
  } },
  { method: "POST", pattern: "/succession/:id/successors", handler: async ({ user, params, body }) => tx(async c => {
    const p = await planFor(c, user, params.id);
    const b = z.object({ employee_id: z.string().max(40), readiness: z.enum(READINESS), notes: z.string().trim().max(1000).default("") }).parse(body);
    const e = await one(c, `SELECT id, role_id FROM employees WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [b.employee_id, p.org_id]);
    if (!e) throw notFound("Employee");
    if (e.role_id === p.role_id) throw unprocessable("incumbent", "This person already holds the role");
    await q(c, `INSERT INTO successors (plan_id, employee_id, readiness, notes, added_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (plan_id, employee_id) DO UPDATE SET readiness = EXCLUDED.readiness, notes = EXCLUDED.notes, added_by = EXCLUDED.added_by, added_at = now()`, [p.id, e.id, b.readiness, b.notes, user.name]);
    await q(c, `UPDATE succession_plans SET updated_at = now() WHERE id = $1`, [p.id]);
    await audit(c, user, { entity_type: "succession_plan", entity_id: p.id, action: "successor_set", after: b });
    return { ok: true };
  }) },
  { method: "DELETE", pattern: "/succession/:id/successors/:employeeId", handler: async ({ db, user, params }) => {
    const p = await planFor(db, user, params.id);
    const r = await one(db, `DELETE FROM successors WHERE plan_id = $1 AND employee_id = $2 RETURNING employee_id`, [p.id, params.employeeId]);
    if (!r) throw notFound("Successor");
    await audit(db, user, { entity_type: "succession_plan", entity_id: p.id, action: "successor_removed", after: { employee: params.employeeId } });
    return { ok: true };
  } },
];
