/* Module 13 dashboard, Module 16 search, Module 18 evolution (lean, works without AI), SA-04 reconciliation. */
import { z } from "zod";
import { canonicalSpelling, spellingsOf } from "../terms";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { employeeScopeSql, inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { M18_TO_SAMPLE, Signal, trendScore, weightedMatch } from "../calc";
import { canReadArchived, dto, listActive } from "./mapping";
import { employeeGaps, employeesGaps } from "./people";
import { currentAssumptions } from "./structure";
import { normalizeTitle, resolveRoleTitle, sameRole, titleKey, titleRank } from "./roleFallback";

/* ---------- reconciliation (Developer Guide 9.1, SA-04) ---------- */
export async function reconcile(db: Db, orgId: string | null) {
  const w = orgId ? "WHERE org_id = $1" : ""; const p = orgId ? [orgId] : [];
  const n = async (sql: string) => Number((await one(db, sql, p))!.n);
  const active = await n(`SELECT count(*)::int AS n FROM v_framework ${w}`);
  const archived = await n(`SELECT count(*)::int AS n FROM role_skill_mapping ${w ? w + " AND" : "WHERE"} lifecycle_status = 'Archived'`);
  const drafts = await n(`SELECT count(*)::int AS n FROM role_skill_mapping ${w ? w + " AND" : "WHERE"} approval_status <> 'Published'`);
  const total = await n(`SELECT count(*)::int AS n FROM role_skill_mapping ${w ? w + " AND" : "WHERE"} approval_status = 'Published'`);
  const dup = await n(`SELECT count(*)::int AS n FROM (SELECT org_id, pixel_id FROM role_skill_mapping ${w} GROUP BY 1,2 HAVING count(*) > 1) x`);
  const leak = await n(`SELECT count(*)::int AS n FROM v_framework ${w ? w + " AND" : "WHERE"} (skill_trend = 'Archived' OR lifecycle_status <> 'Active')`);
  const invalid = await n(`SELECT count(*)::int AS n FROM v_framework ${w ? w + " AND" : "WHERE"} skill_trend NOT IN ('Current','Emerging','Declining')`);
  const badPixel = await n(`SELECT count(*)::int AS n FROM role_skill_mapping ${w ? w + " AND" : "WHERE"} pixel_id <> 'PX-' || role_id || '-' || skill_id`);
  const noSkills = await q(db, `SELECT r.id FROM job_roles r WHERE r.status = 'Published' ${orgId ? "AND r.org_id = $1" : ""} AND NOT EXISTS (SELECT 1 FROM v_framework v WHERE v.role_id = r.id)`, p);
  const skillRows = await q(db, `SELECT s.id, (SELECT count(*) FROM v_framework v WHERE v.skill_id = s.id ${orgId ? "AND v.org_id = $1" : ""})::int AS a,
      (SELECT count(*) FROM role_skill_mapping m WHERE m.skill_id = s.id AND m.lifecycle_status = 'Archived' ${orgId ? "AND m.org_id = $1" : ""})::int AS x
      FROM skills s ${orgId ? "WHERE s.org_id IS NULL OR s.org_id = $1" : ""}`, p);
  const crosswalk = await n(`SELECT count(*)::int AS n FROM pixel_id_crosswalk ${w}`);
  const crosswalkUnresolved = await n(`SELECT count(*)::int AS n FROM pixel_id_crosswalk x ${orgId ? "WHERE x.org_id = $1 AND" : "WHERE"} NOT EXISTS (SELECT 1 FROM role_skill_mapping m WHERE m.org_id = x.org_id AND m.pixel_id = x.pixel_id)`);
  const awareness = await q(db, `SELECT pixel_id FROM v_framework ${w ? w + " AND" : "WHERE"} required_level = 1 ORDER BY pixel_id`, p);
  const trends = await q(db, `SELECT skill_trend, count(*)::int AS n FROM v_framework ${w} GROUP BY 1`, p);
  const types = await q(db, `SELECT requirement_type, count(*)::int AS n FROM v_framework ${w} GROUP BY 1`, p);
  return {
    active_mappings: active, archived_mappings: archived, total_stored: total, drafts, duplicate_pixel_ids: dup, archived_in_framework_view: leak,
    invalid_trends_in_view: invalid, pixel_id_mismatches: badPixel, roles_without_active_skills: noSkills.map(r => r.id),
    skills_active: skillRows.filter(s => s.a > 0).length, skills_archived_all_roles: skillRows.filter(s => s.a === 0 && s.x > 0).length,
    skills_not_mapped: skillRows.filter(s => s.a === 0 && s.x === 0).length, crosswalk_rows: crosswalk, crosswalk_unresolved: crosswalkUnresolved,
    awareness_level_in_framework: awareness.map(a => a.pixel_id),
    trends: Object.fromEntries(trends.map(t => [t.skill_trend, t.n])), requirement_types: Object.fromEntries(types.map(t => [t.requirement_type, t.n])),
  };
}

/* ---------- evolution (Module 18, lean) ---------- */
async function skillTrends(db: Db, orgId: string) {
  const A = (await currentAssumptions(db, orgId)).data.evolution;
  const items = await q(db, `SELECT i.*, to_char(i.evidence_date, 'YYYY-MM-DD') AS evidence_date, s.type AS source_type FROM evidence_items i JOIN evidence_sources s ON s.id = i.source_id WHERE i.org_id = $1`, [orgId]);
  const fw = await listActive(db, orgId);
  const skills = await q(db, `SELECT id, name, category FROM skills WHERE (org_id IS NULL OR org_id = $1) AND id = ANY($2)`, [orgId, [...new Set([...fw.map(m => m.skill_id), ...items.map(i => i.skill_id)])]]);
  const emps = await q(db, `SELECT role_id, count(*)::int AS n FROM employees WHERE org_id = $1 AND status = 'Active' GROUP BY 1`, [orgId]);
  const hc = new Map(emps.map(e => [e.role_id, e.n]));
  return skills.map(s => {
    const sig = items.filter(i => i.skill_id === s.id).map(i => ({ signal_type: i.signal_type, value: Number(i.value), source_id: i.source_id, source_type: i.source_type, evidence_date: i.evidence_date })) as Signal[];
    const roles = fw.filter(m => m.skill_id === s.id);
    const t = trendScore(sig, A, { rolesMapped: roles.length, today: new Date() });
    const labels = [...new Set(roles.map(r => r.skill_trend))];
    return { skill_id: s.id, skill_name: s.name, category: s.category, ...t, framework_label: t.trend === "No evidence" ? null : M18_TO_SAMPLE[t.trend],
      current_labels: labels, exposure: { roles: roles.length, employees: roles.reduce((a, r) => a + (hc.get(r.role_id) || 0), 0) }, evidence_items: sig.length };
  }).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
}

/** Run a review: propose Draft-only changes from trends (22.6, 22.9, AR-16). Nothing changes until people decide. */
async function runReview(db: Db, u: User) {
  const orgId = orgOf(u);
  const trends = await skillTrends(db, orgId);
  const fw = await listActive(db, orgId);
  let created = 0, flagged = 0;
  for (const t of trends) {
    if (t.trend === "No evidence" || t.confidence === "Low") continue;
    for (const m of fw.filter(x => x.skill_id === t.skill_id)) {
      let type: string | null = null; let payload: any = {}; let rationale = "";
      if (t.trend === "Declining" && m.skill_trend === "Declining" && m.requirement_type !== "Mandatory") {
        type = "archive"; payload = { reason_category: "No demand", reason: `Evidence score ${t.score} (Declining) at two consecutive reviews; no Mandatory requirement left.` };
        rationale = `Declining in evidence (score ${t.score}, ${t.confidence} confidence) and already Declining in the framework. Proposed default test: expert confirmation required.`;
      } else if (t.trend === "Declining" && m.skill_trend !== "Declining") {
        type = "lower_level"; payload = { required_level: Math.max(1, m.required_level - 1), skill_trend: "Declining" };
        rationale = `Evidence points down (score ${t.score}). Lower the requirement by one level and mark Declining.`;
      } else if ((t.trend === "Growing" || t.trend === "Emerging") && m.required_level < 5 && m.skill_trend !== "Emerging") {
        type = "raise_level"; payload = { required_level: Math.min(5, m.required_level + 1), skill_trend: t.trend === "Emerging" ? "Emerging" : m.skill_trend };
        rationale = `Evidence points up (score ${t.score}, ${t.trend}). Raise the requirement by one level.`;
      }
      if (!type) continue;
      const r = await one(db, `INSERT INTO evolution_suggestions (org_id, subject_type, subject_id, suggestion_type, rationale, payload, confidence)
          VALUES ($1,'mapping',$2,$3,$4,$5,$6)
          ON CONFLICT (org_id, subject_id, suggestion_type) DO UPDATE SET status = CASE WHEN evolution_suggestions.status IN ('Suggested','In expert review','Deferred') AND evolution_suggestions.rationale <> EXCLUDED.rationale THEN 'Needs review' ELSE evolution_suggestions.status END,
            rationale = EXCLUDED.rationale, payload = EXCLUDED.payload, confidence = EXCLUDED.confidence
          RETURNING (xmax = 0) AS inserted, status`, [orgId, m.pixel_id, type, rationale, JSON.stringify(payload), t.confidence]);
      if (r?.inserted) created++; else if (r?.status === "Needs review") flagged++;
    }
  }
  await audit(db, u, { entity_type: "evolution", entity_id: "review", action: "run", after: { created, flagged } });
  return { created, needs_review: flagged, note: "Suggestions are proposals. Accepting one creates a Draft change that goes through approval." };
}

const PAGE_FOR: Record<string, string> = { hr_admin: "HR", dept_head: "Department", manager: "Team", employee: "Me", expert: "Reviewer", platform_admin: "Platform" };

export const routes: Route[] = [
  { method: "GET", pattern: "/dashboard", handler: async ({ db, user }) => {
    if (user.role === "platform_admin") {
      const r = await reconcile(db, null);
      const counts = await one(db, `SELECT (SELECT count(*) FROM organisations)::int AS orgs, (SELECT count(*) FROM departments)::int AS depts, (SELECT count(*) FROM job_roles)::int AS roles,
        (SELECT count(*) FROM skills WHERE org_id IS NULL)::int AS skills, (SELECT count(*) FROM library_requests WHERE status = 'Open')::int AS requests`);
      const byCompany = await q(db, `SELECT o.name, o.industry, (SELECT count(*) FROM v_framework v WHERE v.org_id = o.id)::int AS active,
          (SELECT count(*) FROM role_skill_mapping m WHERE m.org_id = o.id AND m.lifecycle_status = 'Archived')::int AS archived,
          (SELECT json_object_agg(t, n) FROM (SELECT skill_trend AS t, count(*)::int AS n FROM v_framework v WHERE v.org_id = o.id GROUP BY 1) x) AS trends
        FROM organisations o ORDER BY o.name`);
      const byIndustry = await q(db, `SELECT r.industry, count(*) FILTER (WHERE v.skill_trend = 'Current')::int AS current, count(*) FILTER (WHERE v.skill_trend = 'Emerging')::int AS emerging,
          count(*) FILTER (WHERE v.skill_trend = 'Declining')::int AS declining, count(*)::int AS active,
          (SELECT count(*) FROM role_skill_mapping m JOIN job_roles x ON x.id = m.role_id WHERE m.lifecycle_status = 'Archived' AND x.industry = r.industry)::int AS archived
        FROM v_framework v JOIN job_roles r ON r.id = v.role_id GROUP BY r.industry ORDER BY r.industry`);
      return { kind: "Platform", organisations: counts.orgs, departments: counts.depts, roles: counts.roles, skills_global: counts.skills, open_library_requests: counts.requests,
        reconciliation: r, by_company: byCompany.map(c => ({ ...c, trends: c.trends || {} })), trends_by_industry: byIndustry };
    }
    const orgId = orgOf(user);
    const out: any = { kind: PAGE_FOR[user.role], generated_at: new Date().toISOString() };
    if (scopeOf(user, "dashboard:org")) {
      const [cond, params] = employeeScopeSql(user, "gaps:read", 1);
      const emps = await q(db, `SELECT e.* FROM employees e WHERE ${cond} AND e.status = 'Active'`, params);
      let gaps = 0, critical = 0, assessed = 0, noData = 0; const bySkill = new Map<string, { name: string; n: number }>();
      const gm = await employeesGaps(db, emps);
      for (const e of emps) {
        const g = gm.get(e.id) || [];
        if (g.some(x => x.source === "validated" || x.source === "manager")) assessed++;
        for (const x of g) {
          if (x.status === "Gap") { gaps++; if (x.priority === "High") { critical++; const s = bySkill.get(x.skill_id) || { name: x.skill_name, n: 0 }; s.n++; bySkill.set(x.skill_id, s); } }
          if (x.status === "No assessment data") noData++;
        }
      }
      const dept = scopeOf(user, "dashboard:org") === "dept" ? user.department_id : null;   // department heads: their department's framework only
      const roles = await one(db, `SELECT count(*) FILTER (WHERE status = 'Published')::int AS published, count(*) FILTER (WHERE status IN ('Draft','In Review'))::int AS draft,
          count(*) FILTER (WHERE status = 'Published' AND EXISTS (SELECT 1 FROM v_framework v WHERE v.role_id = job_roles.id))::int AS complete FROM job_roles WHERE org_id = $1 AND ($2::text IS NULL OR department_id = $2)`, [orgId, dept]);
      const trends = await q(db, `SELECT r.industry, v.skill_trend, count(*)::int AS n FROM v_framework v JOIN job_roles r ON r.id = v.role_id WHERE v.org_id = $1 ${scopeOf(user, "dashboard:org") === "dept" ? "AND r.department_id = $2" : ""} GROUP BY 1,2`,
        scopeOf(user, "dashboard:org") === "dept" ? [orgId, user.department_id] : [orgId]);
      const plans = await one(db, `SELECT count(DISTINCT p.employee_id)::int AS n FROM development_plans p JOIN employees e ON e.id = p.employee_id WHERE ${cond.replace(/\$(\d+)/g, (_, i) => "$" + i)} AND p.status = 'Active'`, params);
      const pending = scopeOf(user, "audit:read") ? Number((await one(db, `SELECT count(*)::int AS n FROM change_requests WHERE org_id = $1 AND status = 'In Review'`, [orgId]))!.n) : null;
      const archived = scopeOf(user, "archive:read") ? Number((await one(db, `SELECT count(*)::int AS n FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id WHERE m.org_id = $1 AND m.lifecycle_status = 'Archived' AND ($2::text IS NULL OR r.department_id = $2)`, [orgId, dept]))!.n) : null;
      const queue = scopeOf(user, "roles:write") ? Number((await one(db, `SELECT count(*)::int AS n FROM role_resolution_queue WHERE org_id = $1 AND status IN ('Open','Role drafted')`, [orgId]))!.n) : null;
      out.unresolved_roles = queue;
      const mobility = Number((await one(db, `SELECT count(DISTINCT a.employee_id)::int AS n FROM aspirations a JOIN employees e ON e.id = a.employee_id WHERE ${cond}`, params))!.n);
      Object.assign(out, {
        employees: emps.length, employees_assessed: assessed, open_gaps: gaps, high_priority_gaps: critical, missing_assessments: noData,
        roles_published: roles.published, roles_draft: roles.draft, roles_complete: roles.complete, mappings_active: Number((await one(db, `SELECT count(*)::int AS n FROM v_framework v JOIN job_roles r ON r.id = v.role_id WHERE v.org_id = $1 AND ($2::text IS NULL OR r.department_id = $2)`, [orgId, dept]))!.n),
        mappings_archived: archived, approvals_pending: pending, employees_with_plans: plans?.n ?? 0, employees_with_aspirations: mobility,
        shortage_skills: [...bySkill.values()].sort((a, b) => b.n - a.n).slice(0, 8), trends_by_industry: trends,
        suppressed: emps.length > 0 && emps.length < 5 && scopeOf(user, "dashboard:org") !== "team",
      });
    }
    if (user.employee_id) {
      const e = await one(db, `SELECT e.*, r.title AS role_title FROM employees e JOIN job_roles r ON r.id = e.role_id WHERE e.id = $1`, [user.employee_id]);
      const g = await employeeGaps(db, e);
      const open = await q(db, `SELECT id, method, status, due_date FROM assessments WHERE employee_id = $1 AND status IN ('Assigned','Submitted') ORDER BY created_at DESC`, [e.id]);
      const acts = await q(db, `SELECT d.id, d.title, d.status, d.flag, s.name AS skill_name FROM development_activities d JOIN development_plans p ON p.id = d.plan_id JOIN skills s ON s.id = d.skill_id WHERE p.employee_id = $1 AND d.status <> 'Done' ORDER BY d.created_at LIMIT 8`, [e.id]);
      out.me = { employee_id: e.id, name: e.name, role_title: e.role_title, required: g.length,
        match_pct: weightedMatch(g.map((x: any) => ({ required_level: x.required_level, requirement_type: x.requirement_type, current: x.current_level }))).match_pct, met: g.filter(x => x.status === "Met").length, gaps: g.filter(x => x.status === "Gap").length,
        no_data: g.filter(x => x.status === "No assessment data").length, top_gaps: g.filter(x => x.status === "Gap").sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5), open_assessments: open, activities: acts };
    }
    if (user.role === "expert") {
      out.reviews = { assessments: Number((await one(db, `SELECT count(*)::int AS n FROM assessments WHERE assessor_id = $1 AND status IN ('Assigned','Submitted')`, [user.id]))!.n),
        suggestions: Number((await one(db, `SELECT count(*)::int AS n FROM evolution_suggestions WHERE org_id = $1 AND status IN ('Suggested','In expert review','Needs review')`, [orgId]))!.n) };
    }
    return out;
  } },
  { method: "GET", pattern: "/reconciliation", handler: async ({ db, user }) => {
    if (user.role === "platform_admin") return { platform: await reconcile(db, null) };
    if (!has(user, "audit:read")) throw forbidden();
    return { organisation: await reconcile(db, orgOf(user)), platform: user.role === "hr_admin" ? await reconcile(db, null) : null };
  } },

  /* ---------- search (Module 16): active index; archived only on request ---------- */
  { method: "GET", pattern: "/search", handler: async ({ db, user, query }) => {
    const orgId = orgOf(user); const term = (query.get("q") || "").trim(); const ql = term.toLowerCase();
    if (term.length < 2) return { roles: [], skills: [], mappings: [], employees: [], paths: [] };
    const like = `%${ql}%`;
    // spelling variants and title normalisation: "sr dot net developer" finds ".NET Developer"; "dotnet" finds the .NET skill
    const spellings = [...new Set([term, canonicalSpelling(term), ...spellingsOf(term)].map(x => `%${x.toLowerCase()}%`))];
    const want = normalizeTitle(term).core;
    const roles = (await q(db, `SELECT id, title, status, alt_titles FROM job_roles WHERE org_id = $1 AND status <> 'Archived'`, [orgId]))
      .filter(r => r.id === term.toUpperCase() || [r.title, ...(r.alt_titles || [])].some((t: string) => { if (sameRole(t, term)) return true; const lo = t.toLowerCase(); const c = titleKey(normalizeTitle(t).core), wk = titleKey(want); return lo.includes(ql) || (wk.length >= 2 && (c === wk || c.includes(wk) || (wk.includes(c) && c.length >= 4))); }))
      // a full title (or one with a level word) only finds roles at the same level: "Backend Lead" never lists "Backend Developer"
      .filter(r => r.id === term.toUpperCase() || !(normalizeTitle(term).level_rank != null || term.trim().split(/\s+/).length >= 2) || [r.title, ...(r.alt_titles || [])].some((t: string) => titleRank(t) === (normalizeTitle(term).level_rank ?? 3)))
      .slice(0, 10).map(({ alt_titles, ...r }) => r);
    const skills = await q(db, `SELECT s.id, s.name, s.category FROM skills s WHERE (s.org_id IS NULL OR s.org_id = $1) AND s.status = 'Active' AND (lower(s.name) LIKE ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) LIKE ANY($2::text[])) OR s.id = upper($3))
        AND EXISTS (SELECT 1 FROM v_framework v WHERE v.org_id = $1 AND v.skill_id = s.id) LIMIT 10`, [orgId, spellings, term]);
    let mappings: any[] = [];
    if (scopeOf(user, "framework:read") === "org") {
      mappings = (await listActive(db, orgId)).filter(m => m.pixel_id.toLowerCase() === ql || spellings.some(sp => m.skill_name.toLowerCase().includes(sp.slice(1, -1)))).slice(0, 15).map(dto);
    }
    let pixel: any = null;
    if (/^px-r\d{3,}-s\d{3,}$/.test(ql)) {
      const m = await one(db, `SELECT m.pixel_id, m.lifecycle_status, m.approval_status, r.department_id FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id WHERE m.org_id = $1 AND m.pixel_id = upper($2)`, [orgId, term]);
      if (m) pixel = { pixel_id: m.pixel_id, lifecycle_status: m.lifecycle_status, approval_status: m.approval_status, detail_allowed: m.lifecycle_status === "Active" || canReadArchived(user, m.department_id) };
    }
    const [cond, params] = employeeScopeSql(user, "employees:read", 2);
    const employees = await q(db, `SELECT e.id, e.name, r.title AS role_title FROM employees e JOIN job_roles r ON r.id = e.role_id WHERE (lower(e.name) LIKE $1 OR e.id = upper($${params.length + 2})) AND ${cond} AND e.status = 'Active' LIMIT 10`, [like, ...params, term]);
    const paths = await q(db, `SELECT p.id, f.title AS from_title, t.title AS to_title, p.movement_type FROM career_paths p JOIN job_roles f ON f.id = p.from_role_id JOIN job_roles t ON t.id = p.to_role_id WHERE p.org_id = $1 AND p.status = 'Published' AND (lower(f.title) LIKE $2 OR lower(t.title) LIKE $2) LIMIT 10`, [orgId, like]);
    let archived: any[] = [];
    if (query.get("include_archived") === "true") {
      if (!has(user, "archive:read")) throw forbidden("Searching archived skills needs archive:read", "archive_read_required");
      archived = (await q(db, `SELECT m.pixel_id, m.archive_reason_category, m.archived_on, r.title AS role_name, r.department_id, s.name AS skill_name FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id JOIN skills s ON s.id = m.skill_id
          WHERE m.org_id = $1 AND m.lifecycle_status = 'Archived' AND (lower(s.name) LIKE $2 OR lower(m.pixel_id) = $3)`, [orgId, like, ql])).filter(a => inDeptScope(user, "archive:read", a.department_id));
    }
    // Old Role Skill IDs and Framework IDs resolve through the crosswalk during the transition (PX-06)
    let legacy: any = null;
    if (/^(rs\d{3,}|fwr\d{3,})$/.test(ql)) {
      const x = await one(db, `SELECT x.old_role_skill_id, x.old_framework_id, x.pixel_id, m.role_id, m.lifecycle_status FROM pixel_id_crosswalk x JOIN role_skill_mapping m ON m.org_id = x.org_id AND m.pixel_id = x.pixel_id
        WHERE x.org_id = $1 AND (x.old_role_skill_id = upper($2) OR x.old_framework_id = upper($2)) ORDER BY x.pixel_id LIMIT 1`, [orgId, term]);
      if (x) legacy = ql.startsWith("rs") ? { old_id: term.toUpperCase(), pixel_id: x.pixel_id, role_id: x.role_id, lifecycle_status: x.lifecycle_status }
        : { old_id: term.toUpperCase(), role_id: x.role_id, note: "Framework IDs map to a role; its framework is every Pixel ID with this role ID" };
      if (legacy?.pixel_id && x.lifecycle_status === "Active" && scopeOf(user, "framework:read") === "org" && !mappings.length)
        mappings = (await listActive(db, orgId)).filter(m => m.pixel_id === x.pixel_id).map(dto);
    }
    // Unknown role title: say so and offer the fallback instead of an empty result
    const role_fallback = !roles.length && term.length >= 3 && has(user, "roles:read") ? await resolveRoleTitle(db, orgId, term) : null;
    return { roles, skills, mappings, employees, paths, pixel_match: pixel, legacy_match: legacy, archived, role_fallback: role_fallback && role_fallback.status === "unresolved" ? role_fallback : null };
  } },

  /* ---------- evolution ---------- */
  { method: "GET", pattern: "/evolution/skills", handler: async ({ db, user }) => {
    if (!scopeOf(user, "evolution:review") && user.role !== "employee") throw forbidden();
    return skillTrends(db, orgOf(user));
  } },
  { method: "GET", pattern: "/evolution/sources", handler: async ({ db, user }) => {
    if (!scopeOf(user, "evolution:review")) throw forbidden();
    return q(db, `SELECT s.*, (SELECT count(*) FROM evidence_items i WHERE i.source_id = s.id AND i.org_id = $1)::int AS items FROM evidence_sources s WHERE s.org_id IS NULL OR s.org_id = $1 ORDER BY name`, [orgOf(user)]);
  } },
  { method: "POST", pattern: "/evolution/sources", handler: async ({ db, user, body }) => {
    if (!has(user, "evolution:manage")) throw forbidden();
    const b = z.object({ name: z.string().min(2), type: z.enum(["Company data", "Public framework", "Outlook report", "Job-posting dataset", "Technology signal", "Expert review"]),
      licence: z.string().min(3, "A source without a licence note cannot be used"), url: z.string().optional(), reliability: z.enum(["High", "Medium", "Low"]).default("Medium") }).parse(body);
    const s = await one(db, `INSERT INTO evidence_sources (org_id, name, type, licence, url, reliability) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [orgOf(user), b.name, b.type, b.licence, b.url || null, b.reliability]);
    await audit(db, user, { entity_type: "evidence_source", entity_id: s.id, action: "created", after: b });
    return s;
  } },
  { method: "GET", pattern: "/evolution/evidence", handler: async ({ db, user, query }) => {
    if (!scopeOf(user, "evolution:review")) throw forbidden();
    return q(db, `SELECT i.*, to_char(i.evidence_date, 'YYYY-MM-DD') AS evidence_date, s.name AS source_name, s.type AS source_type, k.name AS skill_name FROM evidence_items i JOIN evidence_sources s ON s.id = i.source_id JOIN skills k ON k.id = i.skill_id
      WHERE i.org_id = $1 AND ($2::text IS NULL OR i.skill_id = $2) ORDER BY i.evidence_date DESC LIMIT 300`, [orgOf(user), query.get("skill_id")]);
  } },
  { method: "POST", pattern: "/evolution/evidence", handler: async ({ db, user, body }) => {
    if (!has(user, "evidence:write")) throw forbidden();
    const b = z.object({ source_id: z.string(), skill_id: z.string(), signal_type: z.enum(["external_demand", "expert_rating", "internal_demand", "automation_exposure"]),
      value: z.coerce.number().min(-1).max(1), summary: z.string().min(10).max(1000), evidence_date: z.string(), link: z.string().optional(), industry: z.string().optional() }).parse(body);
    const src = await one(db, `SELECT * FROM evidence_sources WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [b.source_id, orgOf(user)]);
    if (!src) throw notFound("Evidence source");
    const i = await one(db, `INSERT INTO evidence_items (org_id, source_id, skill_id, industry, signal_type, value, summary, evidence_date, link, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [orgOf(user), b.source_id, b.skill_id, b.industry || null, b.signal_type, b.value, b.summary, b.evidence_date, b.link || null, user.name]);
    await audit(db, user, { entity_type: "evidence_item", entity_id: i.id, action: "created", after: b });
    return i;
  } },
  { method: "POST", pattern: "/evolution/review", handler: async ({ db, user }) => { if (!has(user, "evolution:manage")) throw forbidden(); return runReview(db, user); } },
  { method: "GET", pattern: "/evolution/suggestions", handler: async ({ db, user }) => {
    if (!scopeOf(user, "evolution:review")) throw forbidden();
    const rows = await q(db, `SELECT g.*, m.role_id, r.title AS role_name, r.department_id, r.job_family_id, s.name AS skill_name, m.required_level, m.requirement_type, m.skill_trend,
        (SELECT json_agg(json_build_object('reviewer', u.name, 'verdict', x.verdict, 'comment', x.comment)) FROM expert_reviews x JOIN users u ON u.id = x.reviewer_id WHERE x.suggestion_id = g.id) AS reviews
      FROM evolution_suggestions g LEFT JOIN role_skill_mapping m ON g.subject_type = 'mapping' AND m.org_id = g.org_id AND m.pixel_id = g.subject_id
      LEFT JOIN job_roles r ON r.id = m.role_id LEFT JOIN skills s ON s.id = m.skill_id WHERE g.org_id = $1 ORDER BY g.created_at DESC`, [orgOf(user)]);
    const s = scopeOf(user, "evolution:review");
    return rows.filter(r => s === "org" || (s === "dept" && r.department_id === user.department_id) || (s === "assigned" && user.job_family_scope.includes(r.job_family_id)));
  } },
  { method: "POST", pattern: "/evolution/suggestions/:id/review", handler: async ({ db, user, params, body }) => {
    if (!scopeOf(user, "evolution:review")) throw forbidden();
    const b = z.object({ verdict: z.enum(["Agree", "Change", "Disagree"]), comment: z.string().max(1000).default("") }).parse(body);
    const g = await one(db, `SELECT * FROM evolution_suggestions WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!g) throw notFound("Suggestion");
    await q(db, `INSERT INTO expert_reviews (suggestion_id, reviewer_id, verdict, comment) VALUES ($1,$2,$3,$4) ON CONFLICT (suggestion_id, reviewer_id) DO UPDATE SET verdict = EXCLUDED.verdict, comment = EXCLUDED.comment, at = now()`, [g.id, user.id, b.verdict, b.comment]);
    if (g.status === "Suggested") await q(db, `UPDATE evolution_suggestions SET status = 'In expert review' WHERE id = $1`, [g.id]);
    await audit(db, user, { entity_type: "evolution_suggestion", entity_id: g.id, action: "expert_review", after: b });
    return { ok: true };
  } },
  { method: "POST", pattern: "/evolution/suggestions/:id/decide", handler: async ({ user, params, body }) => {
    if (!has(user, "evolution:manage")) throw forbidden();
    const b = z.object({ decision: z.enum(["Accept", "Defer", "Reject"]), reason: z.string().max(1000).default("") }).parse(body);
    if (b.decision === "Reject" && !b.reason.trim()) throw unprocessable("reason_required", "A rejection needs a reason");
    return tx(async c => {
      const g = await one(c, `SELECT * FROM evolution_suggestions WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
      if (!g) throw notFound("Suggestion");
      if (["Accepted", "Edited and accepted", "Rejected"].includes(g.status)) throw conflict("decided", `The suggestion is ${g.status}`);
      let changeId: string | null = null;
      if (b.decision === "Accept") {
        // RE-14 / AR-16: accepting creates a Draft change only; it then goes through approval
        const m = await one(c, `SELECT * FROM role_skill_mapping WHERE org_id = $1 AND pixel_id = $2`, [g.org_id, g.subject_id]);
        if (!m || m.lifecycle_status !== "Active" || m.approval_status !== "Published") throw conflict("subject_changed", "The mapping is no longer an active published mapping");
        const pending = await one(c, `SELECT id FROM change_requests WHERE org_id = $1 AND entity_type = 'mapping' AND entity_id = $2 AND status = 'In Review'`, [g.org_id, g.subject_id]);
        if (pending) throw conflict("pending_change", `${g.subject_id} already has a change in review`);
        const isArchive = g.suggestion_type === "archive";
        const cr = await one(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, origin, requested_by, requested_by_name) VALUES ($1,'mapping',$2,$3,$4,'evolution',$5,$6) RETURNING id`,
          [g.org_id, g.subject_id, isArchive ? "archive" : "update", JSON.stringify(isArchive ? { ...g.payload, confirm: false } : { fields: g.payload, reason: g.rationale }), user.id, `${user.name} (from ${g.id})`]);
        changeId = cr.id;
      }
      const status = b.decision === "Accept" ? "Accepted" : b.decision === "Defer" ? "Deferred" : "Rejected";
      await q(c, `UPDATE evolution_suggestions SET status = $2, decided_by = $3, decision_reason = $4, draft_change_id = $5 WHERE id = $1`, [g.id, status, user.name, b.reason, changeId]);
      await audit(c, user, { entity_type: "evolution_suggestion", entity_id: g.id, action: status.toLowerCase(), reason: b.reason || null, after: { change: changeId } });
      return { status, change_id: changeId };
    });
  } },
  // RE-18 / UC-40: future-ready skills for an employee's role, opportunity wording
  { method: "GET", pattern: "/me/future", handler: async ({ db, user }) => {
    if (!user.employee_id) return { skills: [] };
    const e = await one(db, `SELECT * FROM employees WHERE id = $1`, [user.employee_id]);
    const trends = new Map((await skillTrends(db, e.org_id)).map(t => [t.skill_id, t]));
    const gaps = await employeeGaps(db, e);
    const accepted = await q(db, `SELECT g.subject_id, g.payload FROM evolution_suggestions g JOIN change_requests c ON c.id = g.draft_change_id WHERE g.org_id = $1 AND c.status = 'Published'`, [e.org_id]);
    return { note: "Skills expected to grow or emerge for your role, based on approved framework data. These are opportunities for development, not assessments of you.",
      skills: gaps.filter(g => g.skill_trend === "Emerging" || ["Growing", "Emerging"].includes(trends.get(g.skill_id)?.trend || ""))
        .map(g => ({ ...g, evidence_trend: trends.get(g.skill_id)?.trend ?? null, confidence: trends.get(g.skill_id)?.confidence ?? null })),
      approved_changes: accepted.length };
  } },
];
