/* Module 3: master skill library (global + organisation skills, duplicate detection, derived status 7.8)
   Module 5: proficiency framework (levels and skill-specific descriptors). */
import { z } from "zod";
import { canonicalSpelling, spellingsOf } from "../terms";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound } from "../errors";
import { has, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { dto, listActive } from "./mapping";

const skillSchema = z.object({
  name: z.string().min(2).max(160),
  definition: z.string().min(5).max(2000),
  category: z.string().min(2).max(120),
  type: z.string().max(120).default("Technical / functional / industry"),
  aliases: z.array(z.string().min(1).max(160)).default([]),
  parent_id: z.string().nullable().optional(),
  force: z.boolean().default(false),   // create even though similar skills exist
});

/** Possible duplicates: same name or alias, or trigram similarity >= 0.45 (7.5). */
export async function findDuplicates(db: Db, orgId: string | null, name: string, aliases: string[] = []) {
  const terms = [...new Set([name, ...aliases].flatMap(t => [t, canonicalSpelling(t), ...spellingsOf(t)]).map(t => t.toLowerCase().trim()))];
  name = canonicalSpelling(name);
  return q(db, `
    SELECT id, name, category, org_id IS NULL AS global, greatest(similarity(lower(name), $2), 0) AS score,
      (lower(name) = ANY($3) OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) = ANY($3))) AS exact
    FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'
      AND (lower(name) = ANY($3) OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) = ANY($3)) OR similarity(lower(name), $2) >= 0.45
           OR (length(name) >= 3 AND position(' ' || lower(name) || ' ' IN ' ' || $2 || ' ') > 0)
           OR (length($2) >= 3 AND position(' ' || $2 || ' ' IN ' ' || lower(name) || ' ') > 0))
    ORDER BY exact DESC, score DESC LIMIT 6`, [orgId, name.toLowerCase().trim(), terms]);
}

/** Library with status derived from this organisation's mappings (7.8, AR-11). */
async function library(db: Db, u: User, opts: { includeArchived: boolean; q: string; category: string | null; includeRetired?: boolean }) {
  const orgId = u.org_id;
  const rows = await q(db, `
    SELECT s.*, s.org_id IS NULL AS global, p.name AS parent_name,
      (SELECT count(*) FROM v_framework v WHERE v.org_id = $1 AND v.skill_id = s.id)::int AS roles_mapped,
      (SELECT count(*) FROM role_skill_mapping m WHERE m.org_id = $1 AND m.skill_id = s.id AND m.lifecycle_status = 'Archived')::int AS archived_mappings,
      (SELECT array_agg(DISTINCT r.industry) FROM v_framework v JOIN job_roles r ON r.id = v.role_id WHERE v.org_id = $1 AND v.skill_id = s.id) AS industries,
      (SELECT count(*) FROM v_framework v WHERE v.skill_id = s.id)::int AS platform_active,
      (SELECT count(*) FROM role_skill_mapping m WHERE m.skill_id = s.id AND m.lifecycle_status = 'Archived')::int AS platform_archived
    FROM skills s LEFT JOIN skills p ON p.id = s.parent_id
    WHERE (s.org_id IS NULL OR s.org_id = $1)
      AND ($2 = '' OR lower(s.name) LIKE '%' || $2 || '%' OR lower(s.definition) LIKE '%' || $2 || '%' OR s.id = upper($2)
           OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) LIKE '%' || $2 || '%'))
      AND ($3::text IS NULL OR s.category = $3)
    ORDER BY s.id`, [orgId, opts.q.toLowerCase().trim(), opts.category]);
  return rows.map(s => {
    const platform_status = s.platform_active > 0 ? "Active" : s.platform_archived > 0 ? "Archived (all roles)" : "Not mapped";
    // A global skill retired in every role on the platform is retired for everyone, even organisations that never mapped it
    const status = s.status === "Retired" ? "Retired" : s.roles_mapped > 0 ? "Active" : (s.archived_mappings > 0 || (s.global && platform_status === "Archived (all roles)")) ? "Archived (all roles)" : "Not mapped";
    return { ...s, lifecycle: s.status, status, platform_status };
  }).filter(s => (opts.includeArchived || s.status !== "Archived (all roles)") && (opts.includeRetired || s.status !== "Retired"));
}

export const routes: Route[] = [
  { method: "GET", pattern: "/skills", handler: async ({ db, user, query }) => {
    if (user.role === "platform_admin") {
      return q(db, `SELECT s.*, true AS global, (SELECT count(*) FROM v_framework v WHERE v.skill_id = s.id)::int AS roles_mapped,
        (SELECT count(*) FROM role_skill_mapping m WHERE m.skill_id = s.id AND m.lifecycle_status = 'Archived')::int AS archived_mappings
        FROM skills s WHERE s.org_id IS NULL ORDER BY s.id`).then(r => r.map(s => ({ ...s, lifecycle: s.status, status: s.status === "Retired" ? "Retired" : s.roles_mapped ? "Active" : s.archived_mappings ? "Archived (all roles)" : "Not mapped" }))
          .filter(s => query.get("include_retired") === "true" || s.status !== "Retired"));
    }
    orgOf(user);
    return library(db, user, { includeArchived: query.get("include_archived") === "true", q: query.get("q") || "", category: query.get("category"), includeRetired: query.get("include_retired") === "true" });
  } },
  { method: "GET", pattern: "/skills/categories", handler: async ({ db, user }) =>
    (await q(db, `SELECT DISTINCT category FROM skills WHERE org_id IS NULL OR org_id = $1 ORDER BY category`, [user.org_id])).map(r => r.category) },
  { method: "GET", pattern: "/skills/duplicates", handler: async ({ db, user, query }) => findDuplicates(db, user.org_id, query.get("name") || "") },
  { method: "GET", pattern: "/skills/:id", handler: async ({ db, user, params }) => {
    const s = await one(db, `SELECT s.*, s.org_id IS NULL AS global, p.name AS parent_name FROM skills s LEFT JOIN skills p ON p.id = s.parent_id WHERE s.id = $1 AND (s.org_id IS NULL OR s.org_id = $2)`, [params.id, user.org_id]);
    if (!s) throw notFound("Skill");
    const children = await q(db, `SELECT id, name FROM skills WHERE parent_id = $1 AND (org_id IS NULL OR org_id = $2)`, [s.id, user.org_id]);
    const related = await q(db, `SELECT s.id, s.name FROM skill_relationships r JOIN skills s ON s.id = r.related_id WHERE r.skill_id = $1`, [s.id]);
    const plat = await one(db, `SELECT (SELECT count(*) FROM v_framework WHERE skill_id = $1)::int AS a, (SELECT count(*) FROM role_skill_mapping WHERE skill_id = $1 AND lifecycle_status = 'Archived')::int AS x`, [s.id]);
    const platform_status = plat.a > 0 ? "Active" : plat.x > 0 ? "Archived (all roles)" : "Not mapped";
    if (!user.org_id) {
      // Platform view across tenants: roles and trends only, no people data (used to compare a skill across industries)
      const across = await q(db, `SELECT m.pixel_id, m.role_id, r.title AS role_name, o.name AS company, r.industry, m.required_level, m.requirement_type, m.skill_trend, m.lifecycle_status, m.trend_rationale
        FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id JOIN organisations o ON o.id = m.org_id WHERE m.skill_id = $1 AND m.approval_status = 'Published' ORDER BY o.name, m.pixel_id`, [s.id]);
      return { ...s, children, related, platform_status, lifecycle: s.status, status: s.status === "Retired" ? "Retired" : platform_status, roles_mapped: plat.a, mappings: across.filter(a => a.lifecycle_status === "Active"), archived: across.filter(a => a.lifecycle_status === "Archived"), can_edit: s.global };
    }
    const descriptors = await q(db, `SELECT level, descriptor FROM skill_level_descriptors WHERE org_id = $1 AND skill_id = $2 ORDER BY level`, [user.org_id, s.id]);
    const mappings = has(user, "roles:read") && ["hr_admin", "dept_head"].includes(user.role) ? (await listActive(db, user.org_id, { skillId: s.id })).map(dto) : [];
    const archived = (await q(db, `SELECT m.pixel_id, m.role_id, r.title AS role_name, r.department_id, m.archive_reason_category, m.archived_on FROM role_skill_mapping m JOIN job_roles r ON r.id = m.role_id
      WHERE m.org_id = $1 AND m.skill_id = $2 AND m.lifecycle_status = 'Archived'`, [user.org_id, s.id])).filter(a => inDeptScope(user, "archive:read", a.department_id));
    const roles_mapped = Number((await one(db, `SELECT count(*)::int AS n FROM v_framework WHERE org_id = $1 AND skill_id = $2`, [user.org_id, s.id]))!.n);
    const total_archived = Number((await one(db, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE org_id = $1 AND skill_id = $2 AND lifecycle_status = 'Archived'`, [user.org_id, s.id]))!.n);
    return { ...s, children, related, descriptors, mappings, archived, roles_mapped, platform_status,
      lifecycle: s.status, status: s.status === "Retired" ? "Retired" : roles_mapped ? "Active" : (total_archived || (s.global && platform_status === "Archived (all roles)")) ? "Archived (all roles)" : "Not mapped", can_edit: !s.global && has(user, "skills:write") };
  } },
  { method: "POST", pattern: "/skills", handler: async ({ user, body }) => {
    const b = parse(skillSchema, body);
    const global = user.role === "platform_admin";
    if (!global && !has(user, "skills:write")) throw forbidden();
    return tx(async c => {
      const dups = await findDuplicates(c, global ? null : orgOf(user), b.name, b.aliases);
      const options = ["use_existing", "add_as_alias", "create_different", "request_library_update"];
      const sameName = dups.find(d => d.name.toLowerCase() === b.name.toLowerCase().trim());
      if (sameName) throw conflict("duplicate_skill", `"${sameName.name}" already exists (${sameName.id}). Use it, or request a library update`, { candidates: dups, options: ["use_existing", "request_library_update"] });
      if (dups.some(d => d.exact) && !b.force) throw conflict("duplicate_skill", `"${b.name}" is already a name for ${dups.find(d => d.exact)!.name}. Use the existing skill, add it as an alias, create a genuinely different skill, or request a library update`, { candidates: dups, options });
      if (dups.length && !b.force) throw conflict("possible_duplicate", "Similar skills exist. Use one of them, add your name as an alias, or confirm this is a genuinely different skill", { candidates: dups, options });
      const s = await one(c, `INSERT INTO skills (org_id, name, definition, category, type, aliases, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [global ? null : orgOf(user), b.name, b.definition, b.category, b.type, b.aliases, b.parent_id || null]);
      await audit(c, user, { org_id: global ? null : orgOf(user), entity_type: "skill", entity_id: s.id, action: "created", after: b });
      return s;
    });
  } },
  { method: "PATCH", pattern: "/skills/:id", handler: async ({ user, params, body }) => {
    const b = parse(skillSchema.partial().omit({ force: true }), body);
    return tx(async c => {
      const s = await one(c, `SELECT * FROM skills WHERE id = $1 FOR UPDATE`, [params.id]);
      if (!s || (s.org_id && s.org_id !== user.org_id)) throw notFound("Skill");
      if (s.org_id === null && user.role !== "platform_admin") throw forbidden("Global skills are managed by the platform. Create an organisation skill or request a library update", "global_skill_read_only");
      if (s.org_id !== null && !has(user, "skills:write")) throw forbidden();
      const keys = Object.keys(b).filter(k => (b as any)[k] !== undefined);
      if (!keys.length) return s;
      const after = await one(c, `UPDATE skills SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, version = version + 1 WHERE id = $1 RETURNING *`, [s.id, ...keys.map(k => (b as any)[k])]);
      await audit(c, user, { org_id: s.org_id, entity_type: "skill", entity_id: s.id, action: "updated", before: Object.fromEntries(keys.map(k => [k, s[k]])), after: b });
      return after;
    });
  } },
  { method: "POST", pattern: "/skills/:id/related", handler: async ({ db, user, params, body }) => {
    if (!has(user, "skills:write") && user.role !== "platform_admin") throw forbidden();
    const rid = String(body.related_id || "");
    for (const id of [params.id, rid]) if (!(await one(db, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [id, user.org_id]))) throw notFound("Skill");
    await q(db, `INSERT INTO skill_relationships VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING`, [params.id, rid]);
    await audit(db, user, { entity_type: "skill", entity_id: params.id, action: "related_added", after: { related_id: rid } });
    return { ok: true };
  } },

  /* ---------- proficiency framework ---------- */
  { method: "GET", pattern: "/proficiency", handler: async ({ db, user }) => {
    const orgId = orgOf(user);
    const levels = await q(db, `SELECT l.*, (SELECT count(*) FROM v_framework v WHERE v.org_id = l.org_id AND v.required_level = l.level)::int AS used_in_framework,
      (SELECT count(*) FROM role_skill_mapping m WHERE m.org_id = l.org_id AND m.lifecycle_status = 'Archived' AND coalesce(m.last_required_level, m.required_level) = l.level)::int AS used_in_archived
      FROM proficiency_levels l WHERE l.org_id = $1 ORDER BY level`, [orgId]);
    const descriptors = await q(db, `SELECT d.skill_id, s.name AS skill_name, d.level, d.descriptor FROM skill_level_descriptors d JOIN skills s ON s.id = d.skill_id WHERE d.org_id = $1 ORDER BY s.name, d.level`, [orgId]);
    return { levels, descriptors };
  } },
  { method: "PATCH", pattern: "/proficiency/:level", handler: async ({ db, user, params, body }) => {
    if (!has(user, "proficiency:write")) throw forbidden();
    const b = z.object({ name: z.string().min(2).max(60), descriptor: z.string().min(5).max(1000) }).parse(body);
    const before = await one(db, `SELECT * FROM proficiency_levels WHERE org_id = $1 AND level = $2`, [orgOf(user), Number(params.level)]);
    if (!before) throw notFound("Level");
    await q(db, `UPDATE proficiency_levels SET name = $3, descriptor = $4 WHERE org_id = $1 AND level = $2`, [orgOf(user), Number(params.level), b.name, b.descriptor]);
    await audit(db, user, { entity_type: "proficiency_level", entity_id: params.level, action: "updated", before, after: b });
    return { ok: true };
  } },
  { method: "PUT", pattern: "/skills/:id/descriptors", handler: async ({ user, params, body }) => {
    if (!has(user, "proficiency:write")) throw forbidden();
    const b = z.object({ descriptors: z.array(z.object({ level: z.number().int().min(1).max(5), descriptor: z.string().max(1000) })) }).parse(body);
    return tx(async c => {
      if (!(await one(c, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [params.id, orgOf(user)]))) throw notFound("Skill");
      for (const d of b.descriptors) {
        if (d.descriptor.trim()) await q(c, `INSERT INTO skill_level_descriptors (org_id, skill_id, level, descriptor) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id, skill_id, level) DO UPDATE SET descriptor = EXCLUDED.descriptor`, [orgOf(user), params.id, d.level, d.descriptor.trim()]);
        else await q(c, `DELETE FROM skill_level_descriptors WHERE org_id = $1 AND skill_id = $2 AND level = $3`, [orgOf(user), params.id, d.level]);
      }
      await audit(c, user, { entity_type: "skill", entity_id: params.id, action: "descriptors_updated", after: b.descriptors });
      return { ok: true };
    });
  } },
  /* ---------- master library update requests (7.5) ---------- */
  { method: "POST", pattern: "/library-requests", handler: async ({ db, user, body }) => {
    if (!has(user, "skills:write")) throw forbidden();
    const b = z.object({ skill_id: z.string().nullable().optional(), type: z.enum(["alias", "update", "new_skill"]), text: z.string().min(2).max(2000) }).parse(body);
    if (b.skill_id && !(await one(db, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [b.skill_id, orgOf(user)]))) throw notFound("Skill");
    const sk = b.skill_id ? await one(db, `SELECT org_id FROM skills WHERE id = $1`, [b.skill_id]) : null;
    if (b.type === "alias" && sk && sk.org_id === orgOf(user)) {
      // company skill: the company adds its own alias directly
      await q(db, `UPDATE skills SET aliases = array_append(aliases, $2) WHERE id = $1 AND NOT ($2 = ANY(aliases))`, [b.skill_id, b.text.trim()]);
      await audit(db, user, { entity_type: "skill", entity_id: b.skill_id!, action: "alias_added", after: { alias: b.text } });
      return { id: null, status: "Approved", note: "Alias added to your company skill" };
    }
    const r = await one(db, `INSERT INTO library_requests (org_id, skill_id, type, text, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [orgOf(user), b.skill_id || null, b.type, b.text.trim(), user.name]);
    await audit(db, user, { entity_type: "library_request", entity_id: r.id, action: "requested", after: b });
    return r;
  } },
  { method: "GET", pattern: "/library-requests", handler: async ({ db, user }) => {
    if (user.role === "platform_admin") return q(db, `SELECT l.*, s.name AS skill_name, o.name AS organisation FROM library_requests l LEFT JOIN skills s ON s.id = l.skill_id JOIN organisations o ON o.id = l.org_id ORDER BY (l.status = 'Open') DESC, l.created_at DESC`);
    if (!has(user, "skills:write")) throw forbidden();
    return q(db, `SELECT l.*, s.name AS skill_name FROM library_requests l LEFT JOIN skills s ON s.id = l.skill_id WHERE l.org_id = $1 ORDER BY l.created_at DESC`, [orgOf(user)]);
  } },
  { method: "POST", pattern: "/library-requests/:id/decide", handler: async ({ user, params, body }) => {
    if (user.role !== "platform_admin") throw forbidden("The platform administrator manages the global library");
    const b = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().default("") }).parse(body);
    return tx(async c => {
      const r = await one(c, `SELECT * FROM library_requests WHERE id = $1 FOR UPDATE`, [params.id]);
      if (!r) throw notFound("Request");
      if (r.status !== "Open") throw conflict("decided", `The request is ${r.status}`);
      if (b.decision === "approve" && r.type === "alias" && r.skill_id) {
        const clash = await findDuplicates(c, null, r.text);
        if (clash.some(d => d.exact && d.id !== r.skill_id)) throw conflict("alias_clash", `"${r.text}" is already a name for another skill`);
        await q(c, `UPDATE skills SET aliases = array_append(aliases, $2), version = version + 1 WHERE id = $1 AND NOT ($2 = ANY(aliases))`, [r.skill_id, r.text]);
      }
      await q(c, `UPDATE library_requests SET status = $2, decided_by = $3, comment = $4, decided_at = now() WHERE id = $1`, [r.id, b.decision === "approve" ? "Approved" : "Rejected", user.name, b.comment]);
      await audit(c, user, { org_id: r.org_id, entity_type: "library_request", entity_id: r.id, action: b.decision, reason: b.comment || null });
      return { status: b.decision === "approve" ? "Approved" : "Rejected", note: r.type === "alias" ? "Alias added to the global skill" : "Recorded. Apply the content change on the skill page." };
    });
  } },
];

