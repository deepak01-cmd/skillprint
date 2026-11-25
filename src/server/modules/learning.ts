/* Learning suggestions for skill gaps: the company's own courses, the shared catalogue, colleagues who can mentor,
   searches on learning platforms, and the knowledge-practice-validation steps. Suggestions can be added to a development plan. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { employeeInScope } from "../scope";
import { logAccess } from "../access";
import { Route } from "../http/router";
import { effectiveLevel } from "../calc";
import { CATALOGUE, SEARCH_LINKS } from "../learning/catalogue";
import { employeeGaps, levelsFor } from "./people";
import { readinessFor } from "./mobility";
import { currentAssumptions } from "./structure";

const TYPES = ["Course", "Video", "Book", "Article", "Certification", "Project", "Mentoring", "Workshop", "Internal"] as const;
const ACTIVITY: Record<string, string> = { Course: "Training course", Video: "Training course", Book: "Reading material", Article: "Reading material", Certification: "Certification",
  Project: "Practical project", Mentoring: "Mentoring", Workshop: "Workshop", Internal: "Workplace assignment" };

/** Links the starter catalogue to library skills once (by name or alias). Safe to call often. */
let seeded = false;
export async function ensureCatalogue(db: Db) {
  if (seeded) return;
  const have = await one(db, `SELECT count(*)::int AS n FROM learning_resources WHERE org_id IS NULL`);
  if (!have?.n) {
    const skills = await q(db, `SELECT id, lower(name) AS name, (SELECT array_agg(lower(a)) FROM unnest(aliases) a) AS aliases FROM skills WHERE org_id IS NULL`);
    const byName = new Map<string, string>();
    for (const s of skills) { byName.set(s.name, s.id); for (const a of s.aliases || []) if (!byName.has(a)) byName.set(a, s.id); }
    for (const [names, title, provider, type, url, from, to, hours, cost] of CATALOGUE) {
      const ids = [...new Set(names.map(n => byName.get(n.toLowerCase())).filter(Boolean))] as string[];
      for (const id of ids) await q(db, `INSERT INTO learning_resources (org_id, skill_id, title, provider, type, url, level_from, level_to, hours, cost, created_by) VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,'catalogue')`,
        [id, title, provider, type, url, from, to, hours, cost]);
    }
  }
  seeded = true;
}

const STEPS = (skill: string, from: number, to: number) => {
  const out: { title: string; type: string }[] = [];
  if (from < 2) out.push({ title: `Learn the fundamentals of ${skill}`, type: "Course" });
  if (to >= 3 && from < 3) out.push({ title: `Use ${skill} on a scoped piece of real work`, type: "Project" });
  if (to >= 4 && from < 4) out.push({ title: `Take on a complex ${skill} assignment with a mentor`, type: "Mentoring" });
  if (to >= 5) out.push({ title: `Lead a ${skill} standard or community of practice`, type: "Internal" });
  out.push({ title: `Get ${skill} validated at level ${to}`, type: "Internal" });
  return out;
};

/** Suggestions for a list of gaps. Mentors are colleagues whose level was confirmed by a manager or an assessment. */
export async function suggestionsFor(db: Db, orgId: string, employeeId: string, gaps: { skill_id: string; skill_name: string; current: number | null; target: number; priority?: string; importance?: string; requirement_type?: string }[]) {
  await ensureCatalogue(db);
  if (!gaps.length) return [];
  const ids = gaps.map(g => g.skill_id);
  const res = await q(db, `SELECT id, org_id, skill_id, title, provider, type, url, level_from, level_to, hours::float AS hours, cost FROM learning_resources
      WHERE status = 'Active' AND skill_id = ANY($1) AND (org_id IS NULL OR org_id = $2) ORDER BY (org_id IS NULL), level_from`, [ids, orgId]);
  const mentors = await q(db, `SELECT es.skill_id, e.id, e.name, r.title AS role_title, (e.user_id IS NOT NULL) AS has_account, max(es.level)::int AS level FROM employee_skills es
      JOIN employees e ON e.id = es.employee_id AND e.status = 'Active' JOIN job_roles r ON r.id = e.role_id
      WHERE es.org_id = $1 AND es.skill_id = ANY($2) AND es.source IN ('manager','validated') AND es.level >= 3 AND e.id <> $3
      GROUP BY es.skill_id, e.id, e.name, r.title, e.user_id`, [orgId, ids, employeeId]);
  const plan = await q(db, `SELECT d.skill_id, d.resource_id, d.title FROM development_activities d JOIN development_plans p ON p.id = d.plan_id WHERE p.employee_id = $1 AND p.status = 'Active' AND d.status <> 'Done'`, [employeeId]);
  const asks = await q(db, `SELECT mentor_id, skill_id, status FROM mentoring_requests WHERE mentee_id = $1 AND status IN ('Requested','Accepted')`, [employeeId]);
  return gaps.map(g => {
    const from = g.current ?? 0;
    const fits = res.filter(r => r.skill_id === g.skill_id && r.level_to > from && r.level_from <= Math.max(from, g.target - 1));
    const m = mentors.filter(x => x.skill_id === g.skill_id && x.level >= Math.max(g.target, 3)).sort((a, b) => b.level - a.level).slice(0, 3);
    const inPlan = plan.filter(p => p.skill_id === g.skill_id);
    const hours = fits.slice(0, 2).reduce((a, r) => a + (r.hours || 0), 0) || (g.target - from) * 10;
    return { ...g, gap: Math.max(0, g.target - from),
      resources: fits.map(r => ({ ...r, company: !!r.org_id, in_plan: inPlan.some(p => p.resource_id === r.id) })),
      mentors: m.map(x => ({ employee_id: x.id, name: x.name, role_title: x.role_title, level: x.level, can_ask: x.has_account, asked: asks.find(a => a.mentor_id === x.id && a.skill_id === g.skill_id)?.status ?? null })),
      search: SEARCH_LINKS.map(s => ({ provider: s.provider, url: s.url(g.skill_name) })),
      steps: STEPS(g.skill_name, from, g.target), in_plan: inPlan.length, est_hours: Math.round(hours) };
  });
}

const resourceSchema = z.object({
  skill_id: z.string().max(40), title: z.string().trim().min(3).max(200), provider: z.string().trim().max(120).optional().nullable(),
  type: z.enum(TYPES), url: z.string().trim().url().max(1000).refine(u => /^https?:\/\//i.test(u), "Use an http(s) link").optional().nullable().or(z.literal("")),
  level_from: z.coerce.number().int().min(0).max(5).default(0), level_to: z.coerce.number().int().min(1).max(5).default(5),
  hours: z.coerce.number().positive().max(10000).optional().nullable(), cost: z.enum(["Free", "Paid", "Company paid"]).default("Free"),
}).refine(b => b.level_to >= b.level_from, { message: "The upper level must be at or above the lower level", path: ["level_to"] });

async function skillVisible(db: Db, u: User, skillId: string) {
  if (!(await one(db, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [skillId, u.org_id]))) throw unprocessable("unknown_skill", "Unknown skill");
}
async function activePlan(db: Db, emp: any, user: User) {
  const p = await one(db, `SELECT * FROM development_plans WHERE employee_id = $1 AND status = 'Active' ORDER BY created_at DESC LIMIT 1`, [emp.id]);
  return p || one(db, `INSERT INTO development_plans (org_id, employee_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [emp.org_id, emp.id, "Learning plan", user.name]);
}

export const routes: Route[] = [
  /** Suggestions for the gaps in the employee's own role, or (?role=) for a role they are looking at. */
  { method: "GET", pattern: "/employees/:id/learning", handler: async ({ db, user, params, query, meta }) => {
    const e = await employeeInScope(db, user, "gaps:read", params.id);
    await logAccess(db, user, e.id, "learning", null, meta.ip);
    const target = query.get("role");
    let gaps: any[];
    if (target) {
      if (!(await one(db, `SELECT 1 FROM job_roles WHERE id = $1 AND org_id = $2 AND status = 'Published'`, [target, e.org_id]))) throw notFound("Role");
      const r = await readinessFor(db, e, target);
      gaps = r.lines.filter(l => !l.met).map(l => ({ skill_id: l.skill_id, skill_name: l.skill_name || "", current: l.actual_level, target: l.required_level }));
    } else {
      gaps = (await employeeGaps(db, e)).filter(g => g.status === "Gap" || g.status === "No assessment data")
        .map(g => ({ skill_id: g.skill_id, skill_name: g.skill_name, current: g.current_level, target: g.required_level, priority: g.priority, importance: g.importance, requirement_type: g.requirement_type, unassessed: g.status !== "Gap" }));
    }
    const rank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    const items = (await suggestionsFor(db, e.org_id, e.id, gaps)).sort((a: any, b: any) => (a.unassessed ? 1 : 0) - (b.unassessed ? 1 : 0) || (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || b.gap - a.gap);
    return { employee: { id: e.id, name: e.name }, items, total_hours: items.filter((i: any) => !i.unassessed).reduce((a: number, i: any) => a + i.est_hours, 0) };
  } },
  /** Add suggestions to the employee's active development plan (one is created if needed). Duplicates are skipped. */
  { method: "POST", pattern: "/employees/:id/learning/plan", handler: async ({ user, params, body }) => tx(async c => {
    const e = await employeeInScope(c, user, "development:write", params.id);
    const b = z.object({ items: z.array(z.object({ skill_id: z.string().max(40), target_level: z.coerce.number().int().min(1).max(5), resource_id: z.string().max(40).optional(),
      title: z.string().trim().min(3).max(200).optional(), type: z.enum(TYPES).optional(), mentor: z.string().max(160).optional() })).min(1).max(30) }).parse(body);
    const plan = await activePlan(c, e, user);
    const lv = (await levelsFor(c, [e.id])).get(e.id) || new Map();
    const a = (await currentAssumptions(c, e.org_id)).data;
    let added = 0, skipped = 0;
    for (const it of b.items) {
      await skillVisible(c, user, it.skill_id);
      const r = it.resource_id ? await one(c, `SELECT * FROM learning_resources WHERE id = $1 AND (org_id IS NULL OR org_id = $2) AND status = 'Active'`, [it.resource_id, e.org_id]) : null;
      if (it.resource_id && !r) throw unprocessable("unknown_resource", "Unknown learning resource");
      const title = r?.title || it.title; if (!title) throw unprocessable("missing_title", "Each item needs a resource or a title");
      const type = ACTIVITY[r?.type || it.type || "Internal"];
      const dup = await one(c, `SELECT 1 FROM development_activities WHERE plan_id = $1 AND skill_id = $2 AND (resource_id = $3 OR lower(title) = lower($4)) AND status <> 'Done'`, [plan.id, it.skill_id, r?.id ?? null, title]);
      if (dup) { skipped++; continue; }
      const cur = effectiveLevel(lv.get(it.skill_id) || [], a.count_self_assessed).level;
      await q(c, `INSERT INTO development_activities (plan_id, skill_id, title, type, current_level, target_level, description, resource, resource_id, mentor, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'gap')`,
        [plan.id, it.skill_id, title, type, cur, it.target_level, r ? [r.provider, r.hours ? `${r.hours} h` : null].filter(Boolean).join(" · ") : "", r?.url ?? null, r?.id ?? null, it.mentor ?? null]);
      added++;
    }
    await audit(c, user, { entity_type: "development_plan", entity_id: plan.id, action: "learning_added", after: { employee: e.id, added, skipped } });
    return { plan_id: plan.id, added, skipped };
  }) },

  /* ---------- the company's learning catalogue ---------- */
  { method: "GET", pattern: "/learning/resources", handler: async ({ db, user, query }) => {
    await ensureCatalogue(db);
    const skill = query.get("skill_id"); const text = (query.get("q") || "").trim().toLowerCase().slice(0, 100);
    const scope = query.get("scope"); // company | catalogue | (all)
    return q(db, `SELECT l.id, l.org_id, l.skill_id, s.name AS skill_name, l.title, l.provider, l.type, l.url, l.level_from, l.level_to, l.hours::float AS hours, l.cost, l.status, l.created_by, l.created_at
        FROM learning_resources l JOIN skills s ON s.id = l.skill_id
        WHERE (l.org_id IS NULL OR l.org_id = $1) AND ($2::text IS NULL OR l.skill_id = $2) AND ($3 = '' OR lower(l.title) LIKE '%' || $3 || '%' OR lower(s.name) LIKE '%' || $3 || '%' OR lower(coalesce(l.provider,'')) LIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR ($4 = 'company' AND l.org_id IS NOT NULL) OR ($4 = 'catalogue' AND l.org_id IS NULL)) AND (l.status = 'Active' OR l.org_id = $1)
        ORDER BY (l.org_id IS NULL), s.name, l.level_from LIMIT 500`, [user.org_id, skill || null, text, scope === "company" || scope === "catalogue" ? scope : null]);
  } },
  { method: "POST", pattern: "/learning/resources", handler: async ({ db, user, body }) => {
    if (!has(user, "skills:write") && user.role !== "platform_admin") throw forbidden();
    const b = resourceSchema.parse(body);
    await skillVisible(db, user, b.skill_id);
    const r = await one(db, `INSERT INTO learning_resources (org_id, skill_id, title, provider, type, url, level_from, level_to, hours, cost, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [user.org_id, b.skill_id, b.title, b.provider || null, b.type, b.url || null, b.level_from, b.level_to, b.hours ?? null, b.cost, user.name]);
    await audit(db, user, { entity_type: "learning_resource", entity_id: r.id, action: "created", after: b });
    return r;
  } },
  { method: "PATCH", pattern: "/learning/resources/:id", handler: async ({ db, user, params, body }) => {
    const r = await one(db, `SELECT * FROM learning_resources WHERE id = $1`, [params.id]);
    // a company edits only its own entries; the shared catalogue belongs to the platform administrator
    if (!r || (r.org_id ? r.org_id !== user.org_id : user.role !== "platform_admin")) throw notFound("Learning resource");
    if (r.org_id && !has(user, "skills:write")) throw forbidden();
    const b = z.object({ status: z.enum(["Active", "Retired"]).optional(), title: z.string().trim().min(3).max(200).optional(), url: z.string().trim().url().max(1000).nullable().optional(),
      hours: z.coerce.number().positive().max(10000).nullable().optional(), cost: z.enum(["Free", "Paid", "Company paid"]).optional() }).parse(body);
    if (b.url && !/^https?:\/\//i.test(b.url)) throw unprocessable("bad_url", "Use an http(s) link");
    const after = await one(db, `UPDATE learning_resources SET status = coalesce($2, status), title = coalesce($3, title), url = CASE WHEN $4 THEN $5 ELSE url END,
        hours = CASE WHEN $6 THEN $7 ELSE hours END, cost = coalesce($8, cost) WHERE id = $1 RETURNING *`,
      [r.id, b.status ?? null, b.title ?? null, b.url !== undefined, b.url ?? null, b.hours !== undefined, b.hours ?? null, b.cost ?? null]);
    await audit(db, user, { entity_type: "learning_resource", entity_id: r.id, action: "updated", before: { status: r.status, title: r.title }, after: b });
    return after;
  } },
];
