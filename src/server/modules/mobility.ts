/* Module 12: career mobility (paths, comparison, aspirations, readiness). Module 17: workforce planning.
   Indicators, not decisions (Principle 8): nothing here changes a person's role. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, MIN_GROUP, scopeOf, User } from "../permissions";
import { assertDeptScope, employeeInScope, employeeScopeSql, orgOf, roleInOrg } from "../scope";
import { parse, Route } from "../http/router";
import { logAccess } from "../access";
import { compareRoles, effectiveLevel, readiness, Requirement, rolePlan, skillOutlook } from "../calc";
import { canReadArchived, listActive } from "./mapping";
import { levelsFor } from "./people";
import { currentAssumptions, DEFAULT_ASSUMPTIONS } from "./structure";

const MOVEMENT = ["Vertical", "Vertical (track change)", "Vertical (skip-level)", "Lateral", "Cross-functional"] as const;

export async function requirements(db: Db, orgId: string, roleId: string): Promise<Requirement[]> {
  return (await listActive(db, orgId, { roleId })).map(m => ({ skill_id: m.skill_id, skill_name: m.skill_name, required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, pixel_id: m.pixel_id }));
}
async function publishedRole(db: Db, u: User, id: string) {
  const r = await one(db, `SELECT r.*, l.rank AS level_rank, l.name AS level_name, d.name AS department_name, f.name AS family_name FROM job_roles r LEFT JOIN career_levels l ON l.id = r.career_level_id
      JOIN departments d ON d.id = r.department_id LEFT JOIN job_families f ON f.id = r.job_family_id WHERE r.id = $1 AND r.org_id = $2`, [id, orgOf(u)]);
  if (!r) throw notFound("Role");
  if (r.status !== "Published") throw unprocessable("role_not_published", `${r.title} is not published`);
  return r;
}
function movementWarning(type: string, levelChange: number | null, sameTrack: boolean) {
  if (levelChange === null) return "One of the roles has no career level, so the level change cannot be checked";
  if (type === "Lateral" && levelChange !== 0) return `Marked Lateral but the level change is ${levelChange}`;
  if (type === "Vertical" && levelChange !== 1) return `Marked Vertical but the level change is ${levelChange}`;
  if (type === "Vertical (skip-level)" && levelChange !== 2) return `Marked skip-level but the level change is ${levelChange}`;
  if (type === "Vertical (track change)" && (levelChange !== 1 || sameTrack)) return "A track change is one level up into a different career track (for example into management)";
  if (type === "Cross-functional" && Math.abs(levelChange) > 1) return `Cross-functional moves are at the same or an adjacent level; this one changes by ${levelChange}`;
  return null;
}

/** Readiness of one employee for one target role (16.6). Stored as an append-only snapshot. */
export async function readinessFor(db: Db, emp: any, targetRoleId: string, store = false) {
  const as = await currentAssumptions(db, emp.org_id);
  const reqs = await requirements(db, emp.org_id, targetRoleId);
  const lv = (await levelsFor(db, [emp.id])).get(emp.id) || new Map();
  const eff = new Map(reqs.map(r => [r.skill_id, effectiveLevel(lv.get(r.skill_id) || [], as.data.count_self_assessed)]));
  const self = new Map(reqs.map(r => [r.skill_id, (lv.get(r.skill_id) || []).find((x: any) => x.source === "self")?.level ?? null]));
  const res = readiness(reqs, eff, as.data.readiness);
  const out = { ...res, lines: res.lines.map(l => ({ ...l, self_level: self.get(l.skill_id) })), assumption_set: { id: as.id, version: as.version }, count_self_assessed: as.data.count_self_assessed };
  if (store) await q(db, `INSERT INTO readiness_snapshots (org_id, employee_id, target_role_id, result, assumption_set_id) VALUES ($1,$2,$3,$4,$5)`, [emp.org_id, emp.id, targetRoleId, JSON.stringify(out), as.id]);
  return out;
}

async function planResults(db: Db, orgId: string, planId: string) {
  const plan = await one(db, `SELECT p.*, a.data AS assumptions, a.version AS assumption_version FROM workforce_plans p JOIN assumption_sets a ON a.id = p.assumption_set_id WHERE p.id = $1 AND p.org_id = $2`, [planId, orgId]);
  if (!plan) throw notFound("Plan");
  if (plan.status === "Approved" && plan.snapshot) return { ...plan, ...plan.snapshot, from_snapshot: true };
  const A = { ...DEFAULT_ASSUMPTIONS, ...plan.assumptions };
  const roleRows = await q(db, `SELECT pr.*, r.title, r.department_id, d.name AS department_name, (SELECT count(*) FROM employees e WHERE e.role_id = r.id AND e.status = 'Active')::int AS current
      FROM workforce_plan_roles pr JOIN job_roles r ON r.id = pr.role_id JOIN departments d ON d.id = r.department_id WHERE pr.plan_id = $1 ORDER BY d.name, r.title`, [planId]);
  const emps = await q(db, `SELECT * FROM employees WHERE org_id = $1 AND status = 'Active'`, [orgId]);
  const lv = await levelsFor(db, emps.map(e => e.id));
  // internal pipeline per target role
  const roles = [];
  for (const r of roleRows) {
    const reqs = await requirements(db, orgId, r.role_id);
    let readyNow = 0, ready612 = 0;
    for (const e of emps) {
      if (e.role_id === r.role_id) continue;
      const eff = new Map(reqs.map(x => [x.skill_id, effectiveLevel(lv.get(e.id)?.get(x.skill_id) || [], A.count_self_assessed)]));
      const band = readiness(reqs, eff, A.readiness).band;
      if (band === A.readiness[0].band) readyNow++; else if (band === A.readiness[1].band) ready612++;
    }
    roles.push({ role_id: r.role_id, title: r.title, department_id: r.department_id, department_name: r.department_name, attrition_rate: Number(r.attrition_rate),
      ...rolePlan({ current: r.current, attrition: Number(r.attrition_rate), planned: r.planned_headcount, horizonMonths: plan.horizon_months, readyNow, ready6to12: ready612 }) });
  }
  // skill demand outlook
  const plannedBy = new Map(roleRows.map(r => [r.role_id, r.planned_headcount]));
  const currentBy = new Map<string, number>(); emps.forEach(e => currentBy.set(e.role_id, (currentBy.get(e.role_id) || 0) + 1));
  const fw = await listActive(db, orgId);
  const growth = new Map((await q(db, `SELECT skill_id, growth_adjustment FROM workforce_plan_skills WHERE plan_id = $1`, [planId])).map(g => [g.skill_id, Number(g.growth_adjustment)]));
  const skillIds = [...new Set(fw.filter(m => m.required_level >= A.competent_level).map(m => m.skill_id)), ...growth.keys()];
  const skills = [...new Set(skillIds)].map(sid => {
    const reqRoles = fw.filter(m => m.skill_id === sid && m.required_level >= A.competent_level).map(m => m.role_id);
    const demandToday = reqRoles.reduce((a, rid) => a + (currentBy.get(rid) || 0), 0);
    const demandPlanned = reqRoles.reduce((a, rid) => a + (plannedBy.has(rid) ? plannedBy.get(rid)! : (currentBy.get(rid) || 0)), 0);
    let supply = 0, assessed = 0;
    for (const e of emps) {
      const recs = lv.get(e.id)?.get(sid) || [];
      const eff = effectiveLevel(recs, A.count_self_assessed);
      if (recs.some((r: any) => r.source !== "self")) assessed++;
      if (eff.level !== null && eff.level >= A.competent_level) supply++;
    }
    const anyAssessment = emps.some(e => (lv.get(e.id)?.get(sid) || []).length > 0);
    const name = fw.find(m => m.skill_id === sid)?.skill_name;
    return { skill_id: sid, skill_name: name, ...skillOutlook({ demandToday, demandPlanned, growth: growth.get(sid) ?? 0, supply, assessedShare: emps.length ? assessed / emps.length : 0, anyAssessment }, A.risk),
      validated_share: emps.length ? Math.round(assessed / emps.length * 100) / 100 : 0 };
  }).filter(s => s.skill_name).sort((a, b) => (b.shortfall ?? -1) - (a.shortfall ?? -1));
  return { ...plan, roles, skills, totals: { net_positions: roles.reduce((a, r) => a + r.net_positions, 0), external_hires: roles.reduce((a, r) => a + r.external_hires, 0), high_risk_skills: skills.filter(s => s.risk === "High").length },
    note: "Internal moves leave a vacancy in the person's previous role. Version 1 does not model backfill chains. Supply counts people at the competent level regardless of current role." };
}

/** Steps, time and skill changes for a path. For a skip-level move the role in between is found from the published paths
    (from -> X -> to) or, failing that, the closest role one level above in the same department. */
export async function careerTrack(db: Db, user: User, p: any) {
  const from = await publishedRole(db, user, p.from_role_id), to = await publishedRole(db, user, p.to_role_id);
  const steps: any[] = [from];
  const legs: { from: string; to: string; months: number | null; movement_type: string }[] = [];
  if (from.level_rank != null && to.level_rank != null && to.level_rank - from.level_rank === 2) {
    const mid = await one(db, `SELECT r.id, a.typical_months AS m1, b.typical_months AS m2, a.movement_type AS t1, b.movement_type AS t2 FROM career_paths a JOIN career_paths b ON b.from_role_id = a.to_role_id AND b.to_role_id = $2
        JOIN job_roles r ON r.id = a.to_role_id WHERE a.from_role_id = $1 AND a.status = 'Published' AND b.status = 'Published' AND a.org_id = $3 LIMIT 1`, [from.id, to.id, orgOf(user)])
      ?? await one(db, `SELECT r.id, NULL::int AS m1, NULL::int AS m2, 'Vertical' AS t1, 'Vertical' AS t2 FROM job_roles r JOIN career_levels l ON l.id = r.career_level_id
        WHERE r.org_id = $1 AND r.status = 'Published' AND r.department_id = $2 AND l.rank = $3 ORDER BY (r.job_family_id = $4) DESC NULLS LAST, r.id LIMIT 1`, [orgOf(user), from.department_id, from.level_rank + 1, from.job_family_id]);
    if (mid) {
      const m = await publishedRole(db, user, mid.id); steps.push(m);
      legs.push({ from: from.title, to: m.title, months: mid.m1, movement_type: mid.t1 }, { from: m.title, to: to.title, months: mid.m2, movement_type: mid.t2 });
    }
  }
  steps.push(to);
  const reqs = await Promise.all(steps.map(st => requirements(db, orgOf(user), st.id)));
  const byStep = reqs.map(r => new Map(r.map(x => [x.skill_id, x])));
  const ids = [...new Set(reqs.flat().map(x => x.skill_id))];
  const last = steps.length - 1;
  const skills = ids.map(id => {
    const cells = byStep.map(m => m.get(id) ? { level: m.get(id)!.required_level, requirement_type: m.get(id)!.requirement_type } : null);
    const name = reqs.flat().find(x => x.skill_id === id)!.skill_name;
    const first = cells.findIndex(c => c), start = cells[0], end = cells[last];
    let change: string, kind: "raise" | "same" | "new" | "less" | "dropped";
    if (!end) { kind = "dropped"; change = `Not needed as ${to.title}`; }
    else if (!start) { kind = "new"; change = `New skill${first > 0 && first < last ? ` (from ${steps[first].title})` : ""}`; }
    else if (end.level > start.level) { kind = "raise"; change = `Raise from ${start.level} to ${end.level}`; }
    else if (end.requirement_type !== "Mandatory" && start.requirement_type === "Mandatory") { kind = "less"; change = `Less central (${end.requirement_type.toLowerCase()})`; }
    else { kind = "same"; change = "Already at this level"; }
    return { skill_id: id, name, cells, first_step: first, kind, change, points: end ? Math.max(0, end.level - (start?.level ?? 0)) : 0 };
  }).sort((a, b) => ["new", "raise", "less", "same", "dropped"].indexOf(a.kind) - ["new", "raise", "less", "same", "dropped"].indexOf(b.kind) || a.first_step - b.first_step || b.points - a.points);
  const stepByStep = legs.length && legs.every(l => l.months != null) ? legs.reduce((a, l) => a + (l.months || 0), 0) : null;
  return {
    path: { id: p.id, movement_type: p.movement_type, typical_months: p.typical_months, level_change: from.level_rank != null && to.level_rank != null ? to.level_rank - from.level_rank : null, extra_requirements: p.extra_requirements },
    steps: steps.map(st => ({ role_id: st.id, title: st.title, level: st.level_name, rank: st.level_rank, track: st.career_track })),
    legs, step_by_step_months: stepByStep,
    summary: { keep: skills.filter(x => x.kind === "same").length, raise: skills.filter(x => x.kind === "raise").length, new: skills.filter(x => x.kind === "new").length,
      less: skills.filter(x => x.kind === "less" || x.kind === "dropped").length, level_points: skills.reduce((a, x) => a + (x.kind === "raise" || x.kind === "new" ? x.points : 0), 0) },
    skills,
  };
}

export const routes: Route[] = [
  /* ---------- career paths ---------- */
  { method: "GET", pattern: "/career-paths", handler: async ({ db, user, query }) => {
    if (!has(user, "paths:read")) throw forbidden();
    const all = has(user, "paths:write");
    return q(db, `SELECT p.*, f.title AS from_title, t.title AS to_title, fl.rank AS from_rank, tl.rank AS to_rank, f.department_id AS from_department_id
      FROM career_paths p JOIN job_roles f ON f.id = p.from_role_id JOIN job_roles t ON t.id = p.to_role_id LEFT JOIN career_levels fl ON fl.id = f.career_level_id LEFT JOIN career_levels tl ON tl.id = t.career_level_id
      WHERE p.org_id = $1 AND ($2 OR p.status = 'Published') AND ($3::text IS NULL OR p.from_role_id = $3) ORDER BY f.title, t.title`, [orgOf(user), all, query.get("from")])
      .then(rows => rows.map(r => ({ ...r, level_change: r.from_rank != null && r.to_rank != null ? r.to_rank - r.from_rank : null })));
  } },
  { method: "POST", pattern: "/career-paths", handler: async ({ user, body }) => {
    const b = z.object({ from_role_id: z.string(), to_role_id: z.string(), movement_type: z.enum(MOVEMENT), typical_months: z.coerce.number().int().min(0).max(240).optional(),
      extra_requirements: z.string().max(1000).optional(), approval_required: z.boolean().default(true) }).parse(body);
    return tx(async c => {
      const from = await publishedRole(c, user, b.from_role_id); const to = await publishedRole(c, user, b.to_role_id);
      assertDeptScope(user, "paths:write", from.department_id, "You can define paths from roles in your department");
      const lc = from.level_rank != null && to.level_rank != null ? to.level_rank - from.level_rank : null;
      // one level up, or two as a skip-level move; never more
      if (lc != null && lc > 2) throw unprocessable("too_many_levels", `A career path goes up at most two levels (a skip-level move); ${to.title} is ${lc} levels above ${from.title}. Add a role in between as a step.`);
      if (lc === 2 && b.movement_type !== "Vertical (skip-level)") throw unprocessable("skip_level_type", `${to.title} is two levels above ${from.title}: mark the path as a skip-level move`);
      const p = await one(c, `INSERT INTO career_paths (org_id, from_role_id, to_role_id, movement_type, typical_months, extra_requirements, approval_required) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [from.org_id, from.id, to.id, b.movement_type, b.typical_months ?? null, b.extra_requirements || null, b.approval_required]);
      await audit(c, user, { entity_type: "career_path", entity_id: p.id, action: "created", after: b });
      return { ...p, level_change: lc, warning: movementWarning(b.movement_type, lc, from.career_track === to.career_track) };
    });
  } },
  { method: "POST", pattern: "/career-paths/:id/submit", handler: async ({ user, params }) => tx(async c => {
    const p = await one(c, `SELECT p.*, f.department_id FROM career_paths p JOIN job_roles f ON f.id = p.from_role_id WHERE p.id = $1 AND p.org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Career path");
    assertDeptScope(user, "paths:write", p.department_id);
    if (p.status !== "Draft") throw conflict("not_draft", `The path is ${p.status}`);
    await q(c, `UPDATE career_paths SET status = 'In Review' WHERE id = $1`, [p.id]);
    return one(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, requested_by, requested_by_name) VALUES ($1,'career_path',$2,'publish',$3,$4,$5) RETURNING *`,
      [p.org_id, p.id, JSON.stringify({ from: p.from_role_id, to: p.to_role_id, movement_type: p.movement_type }), user.id, user.name]);
  }) },
  { method: "POST", pattern: "/career-paths/:id/archive", handler: async ({ db, user, params }) => {
    if (!has(user, "approve")) throw forbidden();
    const r = await one(db, `UPDATE career_paths SET status = 'Archived' WHERE id = $1 AND org_id = $2 RETURNING id`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Career path");
    await audit(db, user, { entity_type: "career_path", entity_id: params.id, action: "archived" });
    return { ok: true };
  } },
  // CM-04: candidate paths from skill overlap and level change. Suggestions only.
  // A career track: the steps of a path (for a skip-level move, the role in between too), the time, and what happens to every skill
  { method: "GET", pattern: "/career-paths/:id/track", handler: async ({ db, user, params, query }) => {
    if (!has(user, "paths:read")) throw forbidden();
    const p = await one(db, `SELECT * FROM career_paths WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Career path");
    const t: any = await careerTrack(db, user, p);
    // ?me=1: the signed-in employee's own confirmed levels next to each requirement
    if (query.get("me") && user.employee_id) {
      const mine = new Map((await q(db, `SELECT skill_id, max(level)::int AS level FROM employee_skills WHERE employee_id = $1 AND source IN ('manager','validated') GROUP BY skill_id`, [user.employee_id])).map(r => [r.skill_id, r.level]));
      t.skills = t.skills.map((k: any) => ({ ...k, your_level: mine.get(k.skill_id) ?? null }));
      t.you = { ready: t.skills.filter((k: any) => k.cells[k.cells.length - 1] && (mine.get(k.skill_id) ?? 0) >= k.cells[k.cells.length - 1].level).length, needed: t.skills.filter((k: any) => k.cells[k.cells.length - 1]).length };
    }
    return t;
  } },
  { method: "GET", pattern: "/career-paths/suggestions", handler: async ({ db, user, query }) => {
    if (!has(user, "paths:write")) throw forbidden();
    const from = await publishedRole(db, user, String(query.get("from")));
    const A = (await currentAssumptions(db, from.org_id)).data;
    const src = await requirements(db, from.org_id, from.id);
    const others = await q(db, `SELECT r.id, r.title, r.career_track, l.rank FROM job_roles r LEFT JOIN career_levels l ON l.id = r.career_level_id WHERE r.org_id = $1 AND r.status = 'Published' AND r.id <> $2
      AND NOT EXISTS (SELECT 1 FROM career_paths p WHERE p.from_role_id = $2 AND p.to_role_id = r.id)`, [from.org_id, from.id]);
    const out = [];
    for (const o of others) {
      const cmp = compareRoles(src, await requirements(db, from.org_id, o.id), A.difficulty);
      if (cmp.skill_overlap < 0.35) continue;
      const lc = from.level_rank != null && o.rank != null ? o.rank - from.level_rank : null;
      if (lc != null && lc > 2) continue; // at most two levels up (skip-level)
      out.push({ to_role_id: o.id, to_title: o.title, level_change: lc, suggested_movement: lc === 0 ? "Lateral" : lc === 1 ? (o.career_track !== from.career_track ? "Vertical (track change)" : "Vertical") : lc === 2 ? "Vertical (skip-level)" : "Cross-functional",
        skill_overlap: cmp.skill_overlap, new_skills: cmp.new_skills, level_points_to_close: cmp.level_points_to_close, move_difficulty: cmp.move_difficulty });
    }
    return out.sort((a, b) => b.skill_overlap - a.skill_overlap).slice(0, 10);
  } },
  // CM-05: compare any two published roles
  { method: "GET", pattern: "/roles/:from/compare/:to", handler: async ({ db, user, params }) => {
    if (!has(user, "paths:read")) throw forbidden();
    const from = await publishedRole(db, user, params.from), to = await publishedRole(db, user, params.to);
    const A = (await currentAssumptions(db, from.org_id));
    const res = compareRoles(await requirements(db, from.org_id, from.id), await requirements(db, from.org_id, to.id), A.data.difficulty, A.data.count_requirement_types);
    const path = await one(db, `SELECT id, movement_type, status FROM career_paths WHERE from_role_id = $1 AND to_role_id = $2 AND status = 'Published'`, [from.id, to.id]);
    const lc = from.level_rank != null && to.level_rank != null ? to.level_rank - from.level_rank : null;
    return { from: { id: from.id, title: from.title, level: from.level_name }, to: { id: to.id, title: to.title, level: to.level_name }, level_change: lc,
      defined_path: path, path_label: path ? path.movement_type : "No defined path", thresholds: A.data.difficulty, assumption_version: A.version, ...res };
  } },

  /* ---------- move planner: one call with everything a role-to-role move needs ---------- */
  { method: "GET", pattern: "/mobility/move", handler: async ({ db, user, query }) => {
    if (!has(user, "paths:read")) throw forbidden();
    const orgId = orgOf(user);
    const A = (await currentAssumptions(db, orgId)).data;
    const mandatoryOnly = query.get("mandatory_only") === "true";
    const types = mandatoryOnly ? ["Mandatory"] : A.count_requirement_types;
    const roles = await q(db, `SELECT r.id, r.title, r.department_id, d.name AS department_name, f.name AS family_name, l.name AS level_name, l.rank AS level_rank
      FROM job_roles r JOIN departments d ON d.id = r.department_id LEFT JOIN job_families f ON f.id = r.job_family_id LEFT JOIN career_levels l ON l.id = r.career_level_id
      WHERE r.org_id = $1 AND r.status = 'Published' ORDER BY d.name, r.title`, [orgId]);
    if (roles.length < 2) return { roles, empty: true };
    const own = user.employee_id ? await one(db, `SELECT role_id FROM employees WHERE id = $1`, [user.employee_id]) : null;
    const fromId = query.get("from") || own?.role_id || roles[0].id;
    const from = roles.find(r => r.id === fromId); if (!from) throw notFound("Role");
    const fw = await listActive(db, orgId, { roleIds: roles.map(r => r.id) });
    const req = new Map<string, any[]>(); for (const m of fw) (req.get(m.role_id) || req.set(m.role_id, []).get(m.role_id)!).push(m);
    const reqOf = (id: string): Requirement[] => (req.get(id) || []).map(m => ({ skill_id: m.skill_id, skill_name: m.skill_name, required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, pixel_id: m.pixel_id }));
    // future-proof index: weighted share of the counted skills by trend (Emerging 1, Current 0.75, Declining 0.25)
    const W: Record<string, number> = { Emerging: 1, Current: 0.75, Declining: 0.25 };
    const fpi = (id: string) => { const ms = (req.get(id) || []).filter(m => !types || types.includes(m.requirement_type)); return ms.length ? Math.round(100 * ms.reduce((a, m) => a + (W[m.skill_trend] ?? 0.75), 0) / ms.length) : 0; };
    const nearest = roles.filter(r => r.id !== from.id).map(r => { const c = compareRoles(reqOf(from.id), reqOf(r.id), A.difficulty, types);
      return { id: r.id, title: r.title, department_name: r.department_name, overlap: c.skill_overlap, difficulty: c.move_difficulty, new_skills: c.new_skills, level_points: c.level_points_to_close }; })
      .filter(n => n.overlap > 0).sort((a, b) => b.overlap - a.overlap || a.level_points - b.level_points).slice(0, 7);
    const toId = query.get("to") || nearest[0]?.id || roles.find(r => r.id !== from.id)!.id;
    const to = roles.find(r => r.id === toId); if (!to) throw notFound("Role");
    const res = compareRoles(reqOf(from.id), reqOf(to.id), A.difficulty, types);
    const meta = new Map(fw.map(m => [`${m.role_id}|${m.skill_id}`, m]));
    const lines = res.lines.map(l => { const m = meta.get(`${to.id}|${l.skill_id}`); return { ...l, pixel_id: m?.pixel_id, trend: m?.skill_trend, category: m?.skill_category, requirement_type: m?.requirement_type }; })
      .sort((a, b) => b.points - a.points || (a.skill_name || "").localeCompare(b.skill_name || ""));
    const toSkills = new Set(res.lines.map(l => l.skill_id));
    const shed = (req.get(from.id) || []).filter(m => (!types || types.includes(m.requirement_type)) && !toSkills.has(m.skill_id)).map(m => ({ skill_id: m.skill_id, skill_name: m.skill_name, level: m.required_level, trend: m.skill_trend }));
    // fingerprint: highest required level per skill category, for both roles
    const cats = [...new Set(fw.map(m => m.skill_category))].sort();
    const shape = (id: string) => cats.map(c => Math.max(0, ...(req.get(id) || []).filter(m => m.skill_category === c && (!types || types.includes(m.requirement_type))).map(m => m.required_level)));
    let archived: any[] | null = null;
    if (canReadArchived(user, from.department_id) || canReadArchived(user, to.department_id))
      archived = await q(db, `SELECT m.pixel_id, m.role_id, s.name AS skill_name, m.archive_reason_category, m.archive_reason, to_char(m.archived_on, 'YYYY-MM-DD') AS archived_on FROM role_skill_mapping m JOIN skills s ON s.id = m.skill_id
        WHERE m.org_id = $1 AND m.role_id = ANY($2) AND m.lifecycle_status = 'Archived' ORDER BY m.pixel_id`, [orgId, [from, to].filter(r => canReadArchived(user, r.department_id)).map(r => r.id)]);
    const hidden = archived ? 0 : Number((await one(db, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE org_id = $1 AND role_id = ANY($2) AND lifecycle_status = 'Archived'`, [orgId, [from.id, to.id]]))!.n);
    const path = await one(db, `SELECT id, movement_type FROM career_paths WHERE from_role_id = $1 AND to_role_id = $2 AND status = 'Published'`, [from.id, to.id]);
    return { roles, from, to, mandatory_only: mandatoryOnly, thresholds: A.difficulty, ...res, lines, shed,
      fpi: { from: fpi(from.id), to: fpi(to.id) }, emerging_gained: lines.filter(l => l.kind === "new" && l.trend === "Emerging").length, declining_shed: shed.filter(x => x.trend === "Declining").length,
      fingerprint: { categories: cats, from: shape(from.id), to: shape(to.id) }, nearest, archived, archived_hidden: hidden, defined_path: path,
      level_change: from.level_rank != null && to.level_rank != null ? to.level_rank - from.level_rank : null, own_role_id: own?.role_id ?? null };
  } },

  /* ---------- aspirations and readiness ---------- */
  { method: "GET", pattern: "/employees/:id/aspirations", handler: async ({ db, user, params }) => {
    const e = await employeeInScope(db, user, "mobility:read", params.id);
    const own = user.employee_id === e.id;
    const rows = await q(db, `SELECT a.*, r.title AS target_title, (SELECT p.movement_type FROM career_paths p WHERE p.from_role_id = $2 AND p.to_role_id = a.target_role_id AND p.status = 'Published') AS movement_type
      FROM aspirations a JOIN job_roles r ON r.id = a.target_role_id WHERE a.employee_id = $1 ORDER BY a.priority`, [e.id, e.role_id]);
    // CM-10: managers see aspirations only after the employee shares them; HR access is logged with a reason
    let visible = rows;
    if (!own) {
      if (user.role === "manager") visible = rows.filter(r => r.shared_with_manager);
      else if (user.role === "hr_admin") {
        const reason = "HR review"; await audit(db, user, { entity_type: "employee", entity_id: e.id, action: "readiness_viewed", reason });
      } else visible = [];
    }
    const out = [];
    for (const a of visible) out.push({ ...a, path_label: a.movement_type || "No defined path", readiness: await readinessFor(db, e, a.target_role_id, false) });
    return { own, aspirations: out, hidden: rows.length - visible.length };
  } },
  { method: "POST", pattern: "/employees/:id/aspirations", handler: async ({ user, params, body }) => {
    if (user.employee_id !== params.id) throw forbidden("Employees record their own aspirations");
    const b = z.object({ target_role_id: z.string(), priority: z.enum(["Primary", "Secondary"]), shared_with_manager: z.boolean().default(false) }).parse(body);
    return tx(async c => {
      const e = await one(c, `SELECT * FROM employees WHERE id = $1`, [params.id]);
      const target = await publishedRole(c, user, b.target_role_id);
      if (target.id === e.role_id) throw unprocessable("same_role", "Choose a role other than your current one");
      const a = await one(c, `INSERT INTO aspirations (org_id, employee_id, target_role_id, priority, shared_with_manager) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (employee_id, priority) DO UPDATE SET target_role_id = EXCLUDED.target_role_id, shared_with_manager = EXCLUDED.shared_with_manager, created_at = now() RETURNING *`,
        [e.org_id, e.id, target.id, b.priority, b.shared_with_manager]);
      await readinessFor(c, e, target.id, true);
      await audit(c, user, { entity_type: "aspiration", entity_id: a.id, action: "saved", after: b });
      return a;
    });
  } },
  { method: "PATCH", pattern: "/aspirations/:id", handler: async ({ db, user, params, body }) => {
    const a = await one(db, `SELECT * FROM aspirations WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!a || a.employee_id !== user.employee_id) throw notFound("Aspiration");
    const shared = z.boolean().parse(body.shared_with_manager);
    await q(db, `UPDATE aspirations SET shared_with_manager = $2 WHERE id = $1`, [a.id, shared]);
    await audit(db, user, { entity_type: "aspiration", entity_id: a.id, action: shared ? "shared" : "unshared" });
    return { ok: true };
  } },
  { method: "DELETE", pattern: "/aspirations/:id", handler: async ({ db, user, params }) => {
    const a = await one(db, `SELECT * FROM aspirations WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!a || a.employee_id !== user.employee_id) throw notFound("Aspiration");
    await q(db, `DELETE FROM aspirations WHERE id = $1`, [a.id]);
    await audit(db, user, { entity_type: "aspiration", entity_id: a.id, action: "removed" });
    return { ok: true };
  } },
  { method: "GET", pattern: "/employees/:id/readiness/:roleId", handler: async ({ db, user, params, meta }) => {
    const e = await employeeInScope(db, user, "mobility:read", params.id);
    await logAccess(db, user, e.id, "readiness", params.roleId, meta.ip);
    if (user.employee_id !== e.id && user.role === "manager") {
      const shared = await one(db, `SELECT 1 FROM aspirations WHERE employee_id = $1 AND target_role_id = $2 AND shared_with_manager`, [e.id, params.roleId]);
      if (!shared) throw forbidden("The employee has not shared this aspiration with you");
    }
    if (user.employee_id !== e.id && user.role === "dept_head") throw forbidden("Department heads see readiness in aggregate only");
    await publishedRole(db, user, params.roleId);
    return readinessFor(db, e, params.roleId, false);
  } },
  { method: "GET", pattern: "/mobility/team", handler: async ({ db, user }) => {
    if (user.role !== "manager") throw forbidden();
    const rows = await q(db, `SELECT a.*, e.name AS employee_name, e.role_id, r.title AS target_title, cr.title AS current_title FROM aspirations a JOIN employees e ON e.id = a.employee_id
      JOIN job_roles r ON r.id = a.target_role_id JOIN job_roles cr ON cr.id = e.role_id WHERE e.manager_id = $1 AND a.shared_with_manager ORDER BY e.name`, [user.employee_id]);
    const out = [];
    for (const a of rows) { const e = await one(db, `SELECT * FROM employees WHERE id = $1`, [a.employee_id]); out.push({ ...a, readiness: await readinessFor(db, e, a.target_role_id) }); }
    return out;
  } },
  { method: "GET", pattern: "/mobility/distribution", handler: async ({ db, user }) => {
    if (!["hr_admin", "dept_head"].includes(user.role)) throw forbidden();
    const A = (await currentAssumptions(db, orgOf(user))).data;
    const [cond, params] = employeeScopeSql(user, "mobility:read", 1);
    const rows = await q(db, `SELECT a.*, r.title AS target_title FROM aspirations a JOIN employees e ON e.id = a.employee_id JOIN job_roles r ON r.id = a.target_role_id WHERE ${cond}`, params);
    const by = new Map<string, any>();
    for (const a of rows) {
      const e = await one(db, `SELECT * FROM employees WHERE id = $1`, [a.employee_id]);
      const band = (await readinessFor(db, e, a.target_role_id)).band;
      const x = by.get(a.target_role_id) || { target_role_id: a.target_role_id, target_title: a.target_title, employees: 0, bands: {} as Record<string, number> };
      x.employees++; x.bands[band] = (x.bands[band] || 0) + 1; by.set(a.target_role_id, x);
    }
    const min = A.min_group_size ?? MIN_GROUP;
    const noPipeline = await q(db, `SELECT r.id, r.title FROM job_roles r WHERE r.org_id = $1 AND r.status = 'Published' AND NOT EXISTS (SELECT 1 FROM career_paths p WHERE p.to_role_id = r.id AND p.status = 'Published') ORDER BY r.title`, [orgOf(user)]);
    return { min_group_size: min, roles: [...by.values()].map(x => x.employees < min ? { target_role_id: x.target_role_id, target_title: x.target_title, employees: x.employees, suppressed: true } : x),
      roles_without_incoming_paths: noPipeline };
  } },

  /* ---------- workforce planning (Module 17) ---------- */
  { method: "GET", pattern: "/planning/assumptions", handler: async ({ db, user }) => {
    if (!scopeOf(user, "planning:read")) throw forbidden();
    return q(db, `SELECT * FROM assumption_sets WHERE org_id = $1 ORDER BY version DESC`, [orgOf(user)]);
  } },
  { method: "POST", pattern: "/planning/assumptions", handler: async ({ user, body }) => {
    if (!has(user, "org:manage")) throw forbidden("HR administrators publish assumption sets");
    const data = z.object({}).passthrough().parse(body.data);
    return tx(async c => {
      const cur = await currentAssumptions(c, orgOf(user));
      const merged = { ...cur.data, ...data };
      await q(c, `UPDATE assumption_sets SET status = 'Archived' WHERE org_id = $1 AND status = 'Published'`, [orgOf(user)]);
      const a = await one(c, `INSERT INTO assumption_sets (org_id, version, status, data, created_by) VALUES ($1,$2,'Published',$3,$4) RETURNING *`, [orgOf(user), cur.version + 1, JSON.stringify(merged), user.name]);
      await audit(c, user, { entity_type: "assumption_set", entity_id: a.id, action: "published", before: cur.data, after: merged });
      return a;
    });
  } },
  { method: "GET", pattern: "/planning/plans", handler: async ({ db, user }) => {
    if (!scopeOf(user, "planning:read")) throw forbidden();
    return q(db, `SELECT p.*, a.version AS assumption_version, (SELECT count(*) FROM workforce_plan_roles r WHERE r.plan_id = p.id)::int AS roles FROM workforce_plans p JOIN assumption_sets a ON a.id = p.assumption_set_id WHERE p.org_id = $1 ORDER BY p.created_at DESC`, [orgOf(user)]);
  } },
  { method: "POST", pattern: "/planning/plans", handler: async ({ user, body }) => {
    if (!has(user, "org:manage")) throw forbidden("HR administrators create plans; department heads propose role rows");
    const b = z.object({ name: z.string().min(2), horizon_months: z.coerce.number().int().min(1).max(60).default(12), copy_from: z.string().optional() }).parse(body);
    return tx(async c => {
      const as = await currentAssumptions(c, orgOf(user));
      const p = await one(c, `INSERT INTO workforce_plans (org_id, name, horizon_months, owner_id, assumption_set_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [orgOf(user), b.name, b.horizon_months, user.id, as.id]);
      if (b.copy_from) {
        await q(c, `INSERT INTO workforce_plan_roles (plan_id, role_id, attrition_rate, planned_headcount) SELECT $1, role_id, attrition_rate, planned_headcount FROM workforce_plan_roles r JOIN workforce_plans p ON p.id = r.plan_id WHERE r.plan_id = $2 AND p.org_id = $3`, [p.id, b.copy_from, orgOf(user)]);
        await q(c, `INSERT INTO workforce_plan_skills (plan_id, skill_id, growth_adjustment) SELECT $1, skill_id, growth_adjustment FROM workforce_plan_skills s JOIN workforce_plans p ON p.id = s.plan_id WHERE s.plan_id = $2 AND p.org_id = $3`, [p.id, b.copy_from, orgOf(user)]);
      }
      await audit(c, user, { entity_type: "workforce_plan", entity_id: p.id, action: "created", after: b });
      return p;
    });
  } },
  { method: "GET", pattern: "/planning/plans/:id", handler: async ({ db, user, params }) => {
    if (!scopeOf(user, "planning:read")) throw forbidden();
    const res: any = await planResults(db, orgOf(user), params.id);
    const s = scopeOf(user, "planning:read");
    if (s === "dept") res.roles = res.roles.filter((r: any) => r.department_id === user.department_id);
    if (s === "team") { const mine = new Set((await q(db, `SELECT DISTINCT role_id FROM employees WHERE manager_id = $1`, [user.employee_id])).map(x => x.role_id)); res.roles = res.roles.filter((r: any) => mine.has(r.role_id)); res.skills = []; }
    return res;
  } },
  { method: "PUT", pattern: "/planning/plans/:id/roles/:roleId", handler: async ({ user, params, body }) => tx(async c => {
    const p = await one(c, `SELECT * FROM workforce_plans WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Plan");
    const role = await roleInOrg(c, user, params.roleId);
    assertDeptScope(user, "planning:write", role.department_id, "You can plan headcount for your department only");
    if (p.status !== "Draft") throw conflict("plan_locked", "Approved plans are snapshots. Duplicate the plan to change it");
    if (role.status !== "Published") throw unprocessable("role_not_published", "Planned headcount needs a published role profile (21.5)");
    const b = z.object({ attrition_rate: z.coerce.number().min(0).max(1), planned_headcount: z.coerce.number().int().min(0).max(100000) }).parse(body);
    const before = await one(c, `SELECT * FROM workforce_plan_roles WHERE plan_id = $1 AND role_id = $2`, [p.id, role.id]);
    await q(c, `INSERT INTO workforce_plan_roles (plan_id, role_id, attrition_rate, planned_headcount) VALUES ($1,$2,$3,$4) ON CONFLICT (plan_id, role_id) DO UPDATE SET attrition_rate = EXCLUDED.attrition_rate, planned_headcount = EXCLUDED.planned_headcount`, [p.id, role.id, b.attrition_rate, b.planned_headcount]);
    await audit(c, user, { entity_type: "workforce_plan", entity_id: p.id, action: "role_input", before, after: { role_id: role.id, ...b } });
    return { ok: true };
  }) },
  { method: "DELETE", pattern: "/planning/plans/:id/roles/:roleId", handler: async ({ db, user, params }) => {
    const p = await one(db, `SELECT * FROM workforce_plans WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Plan");
    if (p.status !== "Draft") throw conflict("plan_locked", "Approved plans are snapshots");
    const role = await roleInOrg(db, user, params.roleId);
    assertDeptScope(user, "planning:write", role.department_id);
    await q(db, `DELETE FROM workforce_plan_roles WHERE plan_id = $1 AND role_id = $2`, [p.id, role.id]);
    await audit(db, user, { entity_type: "workforce_plan", entity_id: p.id, action: "role_removed", after: { role_id: role.id } });
    return { ok: true };
  } },
  { method: "PUT", pattern: "/planning/plans/:id/skills/:skillId", handler: async ({ db, user, params, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const p = await one(db, `SELECT * FROM workforce_plans WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!p) throw notFound("Plan");
    if (p.status !== "Draft") throw conflict("plan_locked", "Approved plans are snapshots");
    const g = z.coerce.number().min(-1).max(5).parse(body.growth_adjustment);
    await q(db, `INSERT INTO workforce_plan_skills (plan_id, skill_id, growth_adjustment) VALUES ($1,$2,$3) ON CONFLICT (plan_id, skill_id) DO UPDATE SET growth_adjustment = EXCLUDED.growth_adjustment`, [p.id, params.skillId, g]);
    await audit(db, user, { entity_type: "workforce_plan", entity_id: p.id, action: "growth_adjustment", after: { skill_id: params.skillId, growth_adjustment: g } });
    return { ok: true };
  } },
  { method: "POST", pattern: "/planning/plans/:id/approve", handler: async ({ user, params }) => {
    if (!has(user, "approve")) throw forbidden();
    return tx(async c => {
      const p = await one(c, `SELECT * FROM workforce_plans WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
      if (!p) throw notFound("Plan");
      if (p.status !== "Draft") throw conflict("not_draft", `The plan is ${p.status}`);
      const r: any = await planResults(c, p.org_id, p.id);
      const snapshot = { roles: r.roles, skills: r.skills, totals: r.totals, note: r.note, assumption_version: r.assumption_version, approved_by: user.name };
      await q(c, `UPDATE workforce_plans SET status = 'Approved', snapshot = $2, approved_at = now() WHERE id = $1`, [p.id, JSON.stringify(snapshot)]);
      await audit(c, user, { entity_type: "workforce_plan", entity_id: p.id, action: "approved", after: { totals: r.totals } });
      return { status: "Approved" };
    });
  } },
];
