/* Modules 1, 2, 2a: organisations, departments, job architecture, role profiles, job description import. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { assertDeptScope, canReadFramework, inDeptScope, orgOf, roleInOrg } from "../scope";
import { parse, Route } from "../http/router";
import { hashPassword, passwordProblem } from "../auth";
import { listActive } from "./mapping";
import { resolveRoleTitle } from "./roleFallback";

export const DEFAULT_LEVELS = [
  [1, "Awareness", "Understands basic concepts and purpose; applies them only with step-by-step guidance."],
  [2, "Foundational", "Performs simple, routine tasks with guidance and established procedures."],
  [3, "Competent", "Works independently on regular tasks and selects suitable methods."],
  [4, "Advanced", "Handles complex tasks, optimises methods and improves processes."],
  [5, "Expert", "Establishes standards and guides others."],
] as const;
export const DEFAULT_CAREER_LEVELS = [["L1", "Junior", 1], ["L2", "Associate", 2], ["L3", "Mid-Level", 3], ["L4", "Senior", 4], ["L5", "Lead", 5], ["L6", "Head / Director", 6]] as const;
export const DEFAULT_ASSUMPTIONS = {
  difficulty: { low: { new_skills: 2, level_points: 14 }, medium: { new_skills: 5, level_points: 22 } },
  readiness: [{ band: "Ready now", min: 0.9 }, { band: "Ready in 6-12 months", min: 0.7 }, { band: "Ready in 12-24 months", min: 0.5 }, { band: "Long-term / stretch", min: 0 }],
  risk: { high_below: 0.6, medium_below: 0.85 },
  competent_level: 3,
  count_self_assessed: false,
  count_requirement_types: ["Mandatory", "Preferred", "Optional", "Developmental"],
  min_group_size: 5,
  gap_priority: { importance: { Critical: 3, High: 2, Medium: 1, Low: 0 }, mandatory_bonus: 1, high_at: 4, medium_at: 2 },
  evolution: { weights: { external_demand: 0.4, expert_rating: 0.3, internal_demand: 0.2, automation_exposure: 0.1 }, emerging_at: 0.5, growing_at: 0.25, declining_at: -0.25, freshness_months: 12 },
};

/** Create defaults for a new organisation: levels, career levels, assumption set. */
export async function provisionOrg(db: Db, orgId: string, actor: string) {
  for (const [level, name, d] of DEFAULT_LEVELS) await q(db, `INSERT INTO proficiency_levels (org_id, level, name, descriptor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [orgId, level, name, d]);
  for (const [code, name, rank] of DEFAULT_CAREER_LEVELS) await q(db, `INSERT INTO career_levels (org_id, code, name, rank) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [orgId, code, name, rank]);
  await q(db, `INSERT INTO assumption_sets (org_id, version, status, data, created_by) VALUES ($1,1,'Published',$2,$3) ON CONFLICT DO NOTHING`, [orgId, JSON.stringify(DEFAULT_ASSUMPTIONS), actor]);
}

export async function currentAssumptions(db: Db, orgId: string) {
  const a = await one(db, `SELECT id, version, data FROM assumption_sets WHERE org_id = $1 AND status = 'Published' ORDER BY version DESC LIMIT 1`, [orgId]);
  return { id: a?.id ?? null, version: a?.version ?? 0, data: { ...DEFAULT_ASSUMPTIONS, ...(a?.data || {}) } as typeof DEFAULT_ASSUMPTIONS };
}

const orgSchema = z.object({
  name: z.string().min(2).max(120), industry: z.string().min(2).max(120), domain: z.string().max(120).optional(),
  hr_admin_name: z.string().min(2), hr_admin_email: z.string().email(), hr_admin_password: z.string().max(200).refine(v => !passwordProblem(v), v => ({ message: passwordProblem(v) || "" })),
});
const deptSchema = z.object({ name: z.string().min(2).max(120), parent_id: z.string().nullable().optional(), location: z.string().max(120).optional() });
const roleSchema = z.object({
  title: z.string().min(2).max(160),
  department_id: z.string(),
  job_family_id: z.string().nullable().optional(),
  career_level_id: z.string().nullable().optional(),
  career_track: z.enum(["Individual Contributor", "Management", "Technical Leadership"]).default("Individual Contributor"),
  alt_titles: z.array(z.string().max(160)).default([]),
  summary: z.string().max(4000).default(""),
  responsibilities: z.array(z.string().max(1000)).default([]),
  outcomes: z.array(z.string().max(1000)).default([]),
  experience: z.string().max(500).nullable().optional(),
  education: z.string().max(500).nullable().optional(),
  review_date: z.string().nullable().optional(),
});

async function roleDetail(db: Db, u: User, id: string) {
  const r = await one(db, `
    SELECT r.*, d.name AS department_name, f.name AS job_family_name, l.name AS career_level_name, l.code AS career_level_code, l.rank AS career_level_rank,
      (SELECT count(*) FROM v_framework v WHERE v.org_id = r.org_id AND v.role_id = r.id)::int AS active_skills,
      (SELECT count(*) FROM employees e WHERE e.role_id = r.id AND e.status = 'Active')::int AS headcount
    FROM job_roles r JOIN departments d ON d.id = r.department_id LEFT JOIN job_families f ON f.id = r.job_family_id LEFT JOIN career_levels l ON l.id = r.career_level_id
    WHERE r.id = $1 AND r.org_id = $2`, [id, orgOf(u)]);
  if (!r) throw notFound("Role");
  const versions = await q(db, `SELECT version, changed_by, note, at FROM role_versions WHERE role_id = $1 ORDER BY version DESC`, [id]);
  const pending = await one(db, `SELECT id, change_type, status FROM change_requests WHERE org_id = $1 AND entity_type = 'role' AND entity_id = $2 AND status = 'In Review'`, [r.org_id, id]);
  return { ...r, versions, pending_change: pending, can_edit: inDeptScope(u, "roles:write", r.department_id), can_read_framework: await canReadFramework(db, u, r) };
}

/* Rule-based job description extraction (Method B). Works without AI: matches library names and aliases. */
export async function parseJobDescription(db: Db, orgId: string, text: string) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const title = (lines.find(l => /^(job )?title\s*:/i.test(l)) || lines[0] || "").replace(/^(job )?title\s*:\s*/i, "").slice(0, 160);
  const bullets = lines.filter(l => /^[-•*·]|^\d+[.)]/.test(l)).map(l => l.replace(/^[-•*·]\s*|^\d+[.)]\s*/, ""));
  const section = (re: RegExp) => {
    const i = lines.findIndex(l => re.test(l)); if (i < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(i + 1)) { if (/^[A-Z][A-Za-z ]{2,40}:?$/.test(l) && !/^[-•*]/.test(l)) break; out.push(l.replace(/^[-•*·]\s*|^\d+[.)]\s*/, "")); }
    return out;
  };
  const responsibilities = section(/responsibilit|duties|what you will do/i);
  const outcomes = section(/outcome|deliverable|success/i);
  const experience = (text.match(/(\d+\+?\s*(?:-|to)?\s*\d*\s*years?[^.\n]*)/i) || [])[1] || null;
  const education = (text.match(/((?:bachelor|master|degree|phd|diploma)[^.\n]*)/i) || [])[1] || null;
  const skills = await q(db, `SELECT id, name, aliases, category FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const lower = " " + text.toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ") + " ";
  const found = skills.map(s => {
    const terms = [s.name, ...(s.aliases || [])].map((t: string) => t.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim()).filter((t: string) => t.length >= 2);
    const hit = terms.find((t: string) => lower.includes(" " + t.replace(/[^a-z0-9+#./ ]/g, " ") + " "));
    return hit ? { skill_id: s.id, name: s.name, category: s.category, matched_term: hit, basis: "Extracted: term appears in the text" } : null;
  }).filter(Boolean);
  return { title, responsibilities: responsibilities.length ? responsibilities : bullets.slice(0, 12), outcomes, experience, education, suggested_skills: found,
    note: "Rule-based extraction. Review every field before saving; nothing is published automatically." };
}

export const routes: Route[] = [
  /* ---------- platform administration ---------- */
  { method: "GET", pattern: "/platform/organisations", handler: async ({ db, user }) => {
    if (!has(user, "platform:manage")) throw forbidden();
    return q(db, `SELECT o.*, (SELECT count(*) FROM users u WHERE u.org_id = o.id)::int AS users,
      (SELECT count(*) FROM job_roles r WHERE r.org_id = o.id)::int AS roles, (SELECT count(*) FROM employees e WHERE e.org_id = o.id)::int AS employees,
      (SELECT count(*) FROM v_framework v WHERE v.org_id = o.id)::int AS active_mappings FROM organisations o ORDER BY o.name`);
  } },
  { method: "POST", pattern: "/platform/organisations", handler: async ({ user, body }) => {
    if (!has(user, "platform:manage")) throw forbidden();
    const b = parse(orgSchema, body);
    return tx(async c => {
      const o = await one(c, `INSERT INTO organisations (name, industry, domain) VALUES ($1,$2,$3) RETURNING *`, [b.name, b.industry, b.domain || null]);
      await provisionOrg(c, o.id, user.name);
      const d = await one(c, `INSERT INTO departments (org_id, name) VALUES ($1,'Human Resources') RETURNING id`, [o.id]);
      await q(c, `INSERT INTO users (org_id, email, name, password_hash, role, department_id) VALUES ($1,$2,$3,$4,'hr_admin',$5)`, [o.id, b.hr_admin_email.toLowerCase(), b.hr_admin_name, await hashPassword(b.hr_admin_password), d.id]);
      await audit(c, user, { org_id: o.id, entity_type: "organisation", entity_id: o.id, action: "created", after: { name: o.name } });
      return o;
    });
  } },
  { method: "PATCH", pattern: "/platform/organisations/:id", handler: async ({ db, user, params, body }) => {
    if (!has(user, "platform:manage")) throw forbidden();
    const status = z.enum(["Active", "Suspended"]).parse(body.status);
    await q(db, `UPDATE organisations SET status = $2 WHERE id = $1`, [params.id, status]);
    await audit(db, user, { org_id: params.id, entity_type: "organisation", entity_id: params.id, action: "status", after: { status } });
    return { ok: true };
  } },

  /* ---------- organisation ---------- */
  { method: "GET", pattern: "/org", handler: async ({ db, user }) => {
    const orgId = orgOf(user);
    const org = await one(db, `SELECT * FROM organisations WHERE id = $1`, [orgId]);
    const departments = await q(db, `SELECT d.*, p.name AS parent_name,
        (SELECT count(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'Active')::int AS employees,
        (SELECT count(*) FROM job_roles r WHERE r.department_id = d.id AND r.status <> 'Archived')::int AS roles,
        (SELECT string_agg(u.name, ', ') FROM users u WHERE u.department_id = d.id AND u.role = 'dept_head') AS heads
      FROM departments d LEFT JOIN departments p ON p.id = d.parent_id WHERE d.org_id = $1 ORDER BY d.status, d.name`, [orgId]);
    const families = await q(db, `SELECT f.*, (SELECT count(*) FROM job_roles r WHERE r.job_family_id = f.id)::int AS roles FROM job_families f WHERE f.org_id = $1 ORDER BY name`, [orgId]);
    const levels = await q(db, `SELECT * FROM career_levels WHERE org_id = $1 ORDER BY rank`, [orgId]);
    const policy = { mandatory: true, openAssessments: true, all: false, ...(org.settings?.archive_policy || {}) };
    return { org, departments, families, levels, archive_policy: policy };
  } },
  { method: "PATCH", pattern: "/org/settings", handler: async ({ db, user, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const p = z.object({ mandatory: z.boolean(), openAssessments: z.boolean(), all: z.boolean() }).parse(body.archive_policy);
    const before = await one(db, `SELECT settings FROM organisations WHERE id = $1`, [orgOf(user)]);
    await q(db, `UPDATE organisations SET settings = jsonb_set(settings, '{archive_policy}', $2::jsonb) WHERE id = $1`, [orgOf(user), JSON.stringify(p)]);
    await audit(db, user, { entity_type: "organisation", entity_id: orgOf(user), action: "archive_policy", before: before?.settings?.archive_policy ?? null, after: p });
    return { archive_policy: p };
  } },
  { method: "POST", pattern: "/departments", handler: async ({ db, user, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const b = parse(deptSchema, body);
    if (b.parent_id && !(await one(db, `SELECT 1 FROM departments WHERE id = $1 AND org_id = $2`, [b.parent_id, orgOf(user)]))) throw notFound("Parent department");
    const d = await one(db, `INSERT INTO departments (org_id, name, parent_id, location) VALUES ($1,$2,$3,$4) RETURNING *`, [orgOf(user), b.name, b.parent_id || null, b.location || null]);
    await audit(db, user, { entity_type: "department", entity_id: d.id, action: "created", after: b });
    return d;
  } },
  { method: "POST", pattern: "/departments/import", handler: async ({ user, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const rows: string[] = String(body.csv || "").split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    const header = (rows.shift() || "").toLowerCase().split(",").map(s => s.trim());
    const ni = header.indexOf("name"), pi = header.indexOf("parent");
    if (ni < 0) throw unprocessable("missing_column", "The first row must include a 'name' column (optional 'parent')");
    return tx(async c => {
      const created: string[] = [], errors: string[] = [];
      for (const [i, line] of rows.entries()) {
        const cols = line.split(",").map(s => s.trim());
        if (!cols[ni]) { errors.push(`Row ${i + 2}: name is empty`); continue; }
        const parent = pi >= 0 && cols[pi] ? await one(c, `SELECT id FROM departments WHERE org_id = $1 AND lower(name) = lower($2)`, [orgOf(user), cols[pi]]) : null;
        if (pi >= 0 && cols[pi] && !parent) { errors.push(`Row ${i + 2}: unknown parent ${cols[pi]}`); continue; }
        const r = await one(c, `INSERT INTO departments (org_id, name, parent_id) VALUES ($1,$2,$3) ON CONFLICT (org_id, name) DO NOTHING RETURNING id`, [orgOf(user), cols[ni], parent?.id || null]);
        r ? created.push(cols[ni]) : errors.push(`Row ${i + 2}: ${cols[ni]} already exists`);
      }
      await audit(c, user, { entity_type: "department", entity_id: "import", action: "imported", after: { created: created.length, errors: errors.length } });
      return { created, errors };
    });
  } },
  { method: "PATCH", pattern: "/departments/:id", handler: async ({ db, user, params, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const d = await one(db, `SELECT * FROM departments WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!d) throw notFound("Department");
    const b = z.object({ name: z.string().min(2).optional(), parent_id: z.string().nullable().optional(), status: z.enum(["Active", "Archived"]).optional() }).parse(body);
    if (b.parent_id === d.id) throw unprocessable("invalid_parent", "A department cannot be its own parent");
    if (b.status === "Archived" && (await one(db, `SELECT 1 FROM employees WHERE department_id = $1 AND status = 'Active' LIMIT 1`, [d.id])))
      throw conflict("department_in_use", "Move active employees before archiving this department");
    const after = await one(db, `UPDATE departments SET name = coalesce($2, name), parent_id = CASE WHEN $4 THEN $3 ELSE parent_id END, status = coalesce($5, status) WHERE id = $1 RETURNING *`,
      [d.id, b.name ?? null, b.parent_id ?? null, b.parent_id !== undefined, b.status ?? null]);
    await audit(db, user, { entity_type: "department", entity_id: d.id, action: "updated", before: d, after });
    return after;
  } },
  { method: "POST", pattern: "/job-families", handler: async ({ db, user, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const b = z.object({ name: z.string().min(2), description: z.string().optional() }).parse(body);
    const f = await one(db, `INSERT INTO job_families (org_id, name, description) VALUES ($1,$2,$3) RETURNING *`, [orgOf(user), b.name, b.description || null]);
    await audit(db, user, { entity_type: "job_family", entity_id: f.id, action: "created", after: b });
    return f;
  } },
  { method: "PATCH", pattern: "/career-levels/:id", handler: async ({ db, user, params, body }) => {
    if (!has(user, "org:manage")) throw forbidden();
    const b = z.object({ name: z.string().min(2) }).parse(body);
    const r = await one(db, `UPDATE career_levels SET name = $3 WHERE id = $1 AND org_id = $2 RETURNING *`, [params.id, orgOf(user), b.name]);
    if (!r) throw notFound("Career level");
    await audit(db, user, { entity_type: "career_level", entity_id: r.id, action: "renamed", after: b });
    return r;
  } },

  /* ---------- job roles ---------- */
  { method: "GET", pattern: "/roles", handler: async ({ db, user, query }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const status = query.get("status");
    return q(db, `SELECT r.id, r.title, r.alt_titles, r.status, r.version, r.industry, r.career_track, r.department_id, d.name AS department_name,
        r.job_family_id, f.name AS job_family_name, l.name AS career_level_name, l.rank AS career_level_rank, r.review_date,
        (SELECT count(*) FROM v_framework v WHERE v.org_id = r.org_id AND v.role_id = r.id)::int AS active_skills,
        (SELECT count(*) FROM role_skill_mapping m WHERE m.org_id = r.org_id AND m.role_id = r.id AND m.lifecycle_status = 'Archived')::int AS archived_skills,
        (SELECT count(*) FROM employees e WHERE e.role_id = r.id AND e.status = 'Active')::int AS headcount
      FROM job_roles r JOIN departments d ON d.id = r.department_id LEFT JOIN job_families f ON f.id = r.job_family_id LEFT JOIN career_levels l ON l.id = r.career_level_id
      WHERE r.org_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY d.name, r.title`, [orgOf(user), status]).then(rows =>
        rows.map(r => ({ ...r, archived_skills: inDeptScope(user, "archive:read", r.department_id) ? r.archived_skills : undefined })));
  } },
  { method: "GET", pattern: "/roles/:id", handler: ({ db, user, params }) => roleDetail(db, user, params.id) },
  { method: "POST", pattern: "/roles", handler: async ({ user, body }) => {
    const b = parse(roleSchema, body);
    assertDeptScope(user, "roles:write", b.department_id, "You can create roles only in your department");
    return tx(async c => {
      const dept = await one(c, `SELECT id FROM departments WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [b.department_id, orgOf(user)]);
      if (!dept) throw notFound("Department");
      const org = await one(c, `SELECT industry FROM organisations WHERE id = $1`, [orgOf(user)]);
      const r = await one(c, `INSERT INTO job_roles (org_id, department_id, job_family_id, career_level_id, title, alt_titles, career_track, summary, responsibilities, outcomes, experience, education, industry, review_date, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Draft') RETURNING *`,
        [orgOf(user), b.department_id, b.job_family_id || null, b.career_level_id || null, b.title, b.alt_titles, b.career_track, b.summary, b.responsibilities, b.outcomes, b.experience || null, b.education || null, org.industry, b.review_date || null]);
      await audit(c, user, { entity_type: "role", entity_id: r.id, action: "created", after: b });
      return r;
    });
  } },
  { method: "PATCH", pattern: "/roles/:id", handler: async ({ user, params, body }) => {
    const b = parse(roleSchema.partial(), body);
    return tx(async c => {
      const r = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
      if (!r) throw notFound("Role");
      assertDeptScope(user, "roles:write", r.department_id, "You can edit roles only in your department");
      if (r.status === "Archived") throw unprocessable("role_archived", "Archived roles are read-only");
      if (r.status === "In Review") throw conflict("pending_change", "This role is in review. Withdraw the change to edit it");
      const fields: Record<string, unknown> = {};
      for (const k of ["title", "department_id", "job_family_id", "career_level_id", "career_track", "alt_titles", "summary", "responsibilities", "outcomes", "experience", "education", "review_date"] as const)
        if ((b as any)[k] !== undefined) fields[k] = (b as any)[k];
      if (fields.department_id) assertDeptScope(user, "roles:write", String(fields.department_id));
      const keys = Object.keys(fields);
      if (!keys.length) return r;
      // Editing a published role starts a new draft version; the published framework stays in force.
      const bump = r.status === "Published";
      const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const after = await one(c, `UPDATE job_roles SET ${set}, updated_at = now()${bump ? ", version = version + 1, status = 'Draft'" : ""} WHERE id = $1 RETURNING *`, [r.id, ...keys.map(k => fields[k])]);
      await audit(c, user, { entity_type: "role", entity_id: r.id, action: bump ? "new_version" : "updated", before: Object.fromEntries(keys.map(k => [k, r[k]])), after: fields });
      return after;
    });
  } },
  { method: "POST", pattern: "/roles/:id/submit", handler: async ({ user, params }) => tx(async c => {
    const r = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Role");
    assertDeptScope(user, "roles:write", r.department_id);
    if (r.status !== "Draft") throw conflict("not_draft", `The role is ${r.status}`);
    const drafts = await q(c, `SELECT pixel_id FROM role_skill_mapping WHERE org_id = $1 AND role_id = $2 AND approval_status IN ('Draft','Changes Requested')`, [r.org_id, r.id]);
    const pids = drafts.map(d => d.pixel_id);
    if (r.version === 1 && !pids.length && !(await one(c, `SELECT 1 FROM v_framework WHERE org_id = $1 AND role_id = $2`, [r.org_id, r.id])))
      throw unprocessable("no_skills", "Add at least one skill before submitting a new role");
    await q(c, `UPDATE job_roles SET status = 'In Review' WHERE id = $1`, [r.id]);
    if (pids.length) await q(c, `UPDATE role_skill_mapping SET approval_status = 'In Review' WHERE org_id = $1 AND pixel_id = ANY($2)`, [r.org_id, pids]);
    const cr = await one(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, requested_by, requested_by_name) VALUES ($1,'role',$2,'publish',$3,$4,$5) RETURNING *`,
      [r.org_id, r.id, JSON.stringify({ pixel_ids: pids, version: r.version, title: r.title }), user.id, user.name]);
    await audit(c, user, { entity_type: "role", entity_id: r.id, action: "submitted", after: { change: cr.id, mappings: pids.length } });
    return cr;
  }) },
  { method: "POST", pattern: "/roles/:id/duplicate", handler: async ({ user, params, body }) => tx(async c => {
    const r = await roleInOrg(c, user, params.id);
    const full = await one(c, `SELECT * FROM job_roles WHERE id = $1`, [r.id]);
    assertDeptScope(user, "roles:write", full.department_id);
    const title = (typeof body.title === "string" && body.title.trim()) || `${full.title} (copy)`;
    const n = await one(c, `INSERT INTO job_roles (org_id, department_id, job_family_id, career_level_id, title, alt_titles, career_track, summary, responsibilities, outcomes, experience, education, industry, status)
        SELECT org_id, department_id, job_family_id, career_level_id, $2, '{}', career_track, summary, responsibilities, outcomes, experience, education, industry, 'Draft' FROM job_roles WHERE id = $1 RETURNING *`, [r.id, title]);
    const act = await listActive(c, r.org_id, { roleId: r.id });
    for (const m of act) await q(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, observation_period, trend_rationale, confidence_score, explanation, approval_status, created_by)
        VALUES ($1,'PX-'||$2||'-'||$3,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Draft',$13)`,
      [r.org_id, n.id, m.skill_id, m.required_level, m.requirement_type, m.importance, m.skill_trend, m.demand_direction, m.observation_period, m.trend_rationale, m.confidence_score, `Copied from ${m.pixel_id}`, user.name]);
    await audit(c, user, { entity_type: "role", entity_id: n.id, action: "duplicated", after: { from: r.id, mappings: act.length } });
    return n;
  }) },
  { method: "POST", pattern: "/roles/:id/archive", handler: async ({ user, params, body }) => tx(async c => {
    const r = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Role");
    if (!has(user, "org:manage")) throw forbidden("Only HR administrators archive roles");
    const holders = await one(c, `SELECT count(*)::int AS n FROM employees WHERE role_id = $1 AND status = 'Active'`, [r.id]);
    if (holders.n > 0) throw conflict("role_in_use", `${holders.n} active employee(s) hold this role. Reassign them first; history is kept either way`);
    await q(c, `UPDATE job_roles SET status = 'Archived', updated_at = now() WHERE id = $1`, [r.id]);
    const flagged = await q(c, `UPDATE career_paths SET review_flag = true WHERE org_id = $1 AND (from_role_id = $2 OR to_role_id = $2) AND status <> 'Archived' RETURNING id`, [r.org_id, r.id]);
    await audit(c, user, { entity_type: "role", entity_id: r.id, action: "archived", reason: body?.reason || null, after: { paths_flagged: flagged.length } });
    return { status: "archived", paths_flagged: flagged.length };
  }) },
  { method: "POST", pattern: "/roles/parse-description", handler: async ({ db, user, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const text = String(body.text || "");
    if (text.trim().length < 20) throw unprocessable("too_short", "Paste the job description text (at least a few lines)");
    const out = await parseJobDescription(db, orgOf(user), text.slice(0, 50000));
    return { ...out, role_match: out.title ? await resolveRoleTitle(db, orgOf(user), out.title) : null };
  } },
  // Role consolidation (2.6): suggest similar roles, never merge automatically
  { method: "GET", pattern: "/roles/:id/similar", handler: async ({ db, user, params }) => {
    const r = await roleInOrg(db, user, params.id);
    const mine = new Set((await listActive(db, r.org_id, { roleId: r.id })).map(m => m.skill_id));
    const others = await q(db, `SELECT r.id, r.title, d.name AS department_name, similarity(lower(r.title), lower($2)) AS title_sim FROM job_roles r JOIN departments d ON d.id = r.department_id WHERE r.org_id = $1 AND r.id <> $3 AND r.status <> 'Archived'`, [r.org_id, r.title, r.id]);
    const all = await listActive(db, r.org_id, { roleIds: others.map(o => o.id) });
    return others.map(o => {
      const s = new Set(all.filter(m => m.role_id === o.id).map(m => m.skill_id));
      const shared = [...s].filter(x => mine.has(x)).length;
      const overlap = mine.size + s.size - shared ? shared / (mine.size + s.size - shared) : 0;
      return { ...o, title_sim: Number(o.title_sim), shared_skills: shared, overlap: Math.round(overlap * 100) / 100 };
    }).filter(o => o.overlap >= 0.5 || o.title_sim >= 0.5).sort((a, b) => b.overlap - a.overlap).slice(0, 8);
  } },
];
