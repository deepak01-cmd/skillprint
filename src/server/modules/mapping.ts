/* Module 4: Role-skill mapping. Pixel ID (PRD 8.7), lifecycle (8.8, 8.9), on-request archived view (8.10),
   downstream effects (8.11). Developer Guide sections 2, 4, 6, 7, 8.
   The active filter lives in one place: v_framework, read through listActive(). Only the archive functions
   below read archived rows, and they check archive:read first. */
import { z } from "zod";
import { PoolClient } from "pg";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { assertReadFramework, inDeptScope, orgOf, roleInOrg } from "../scope";
import { parse, Route } from "../http/router";

export const REASON_CATEGORIES = ["End of life", "Replaced by successor", "Regulation change", "No demand"] as const;
export const REQ_TYPES = ["Mandatory", "Preferred", "Optional", "Developmental"] as const;
export const IMPORTANCE = ["Critical", "High", "Medium", "Low"] as const;
export const ACTIVE_TRENDS = ["Current", "Emerging", "Declining"] as const;
export const PIXEL_RE = /^PX-(R\d{3,})-(S\d{3,})$/;

export const buildPixelId = (roleId: string, skillId: string) => `PX-${roleId}-${skillId}`;
export function parsePixelId(pid: string): [string, string] {
  const m = PIXEL_RE.exec(pid);
  if (!m) throw bad(`Invalid Pixel ID: ${pid}`, "invalid_pixel_id");
  return [m[1], m[2]];
}

const SELECT = (source: string) => `
  SELECT m.*, s.name AS skill_name, s.category AS skill_category, s.definition AS skill_definition,
         r.title AS role_name, r.industry, r.department_id,
         coalesce(sd.descriptor, pl.descriptor) AS level_descriptor, pl.name AS level_name, (sd.descriptor IS NOT NULL) AS level_descriptor_skill_specific
  FROM ${source} m JOIN skills s ON s.id = m.skill_id JOIN job_roles r ON r.id = m.role_id
  LEFT JOIN proficiency_levels pl ON pl.org_id = m.org_id AND pl.level = m.required_level
  LEFT JOIN skill_level_descriptors sd ON sd.org_id = m.org_id AND sd.skill_id = m.skill_id AND sd.level = m.required_level`;

export function dto(m: any) {
  const o: any = {
    pixel_id: m.pixel_id, role_id: m.role_id, role_name: m.role_name, skill_id: m.skill_id, skill_name: m.skill_name,
    skill_category: m.skill_category, skill_definition: m.skill_definition, industry: m.industry,
    required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance,
    skill_trend: m.skill_trend, demand_direction: m.demand_direction, observation_period: m.observation_period,
    trend_rationale: m.trend_rationale, confidence_score: m.confidence_score === null ? null : Number(m.confidence_score),
    evidence_status: m.evidence_status, explanation: m.explanation, approval_status: m.approval_status,
    lifecycle_status: m.lifecycle_status, review_flag: m.review_flag, version: m.version,
    level_name: m.level_name, level_descriptor: m.level_descriptor, level_descriptor_skill_specific: m.level_descriptor_skill_specific,
  };
  if (m.lifecycle_status === "Archived") Object.assign(o, {
    last_required_level: m.last_required_level ?? m.required_level, archive_reason_category: m.archive_reason_category,
    archive_reason: m.archive_reason, archived_on: m.archived_on instanceof Date ? m.archived_on.toISOString().slice(0, 10) : m.archived_on,
    archived_by: m.archived_by,
  });
  if (m.pending_change_id) o.pending_change = { id: m.pending_change_id, type: m.pending_change_type };
  return o;
}

const PENDING = `(SELECT c.id FROM change_requests c WHERE c.org_id = m.org_id AND c.entity_type = 'mapping' AND c.entity_id = m.pixel_id AND c.status = 'In Review' LIMIT 1) AS pending_change_id,
                 (SELECT c.change_type FROM change_requests c WHERE c.org_id = m.org_id AND c.entity_type = 'mapping' AND c.entity_id = m.pixel_id AND c.status = 'In Review' LIMIT 1) AS pending_change_type`;

/* ---------- repository: the only default read path ---------- */
export async function listActive(db: Db, orgId: string, filter: { roleId?: string; skillId?: string; roleIds?: string[] } = {}) {
  const where = ["m.org_id = $1"]; const params: unknown[] = [orgId];
  if (filter.roleId) { params.push(filter.roleId); where.push(`m.role_id = $${params.length}`); }
  if (filter.skillId) { params.push(filter.skillId); where.push(`m.skill_id = $${params.length}`); }
  if (filter.roleIds) { params.push(filter.roleIds); where.push(`m.role_id = ANY($${params.length})`); }
  const rows = await q(db, `${SELECT("v_framework").replace("SELECT m.*,", `SELECT m.*, ${PENDING},`)} WHERE ${where.join(" AND ")} ORDER BY m.pixel_id`, params);
  return rows;
}
export async function activeCount(db: Db, orgId: string, roleId: string): Promise<number> {
  return Number((await one(db, `SELECT count(*)::int AS n FROM v_framework WHERE org_id = $1 AND role_id = $2`, [orgId, roleId]))!.n);
}
async function archivedCount(db: Db, orgId: string, roleId: string): Promise<number> {
  return Number((await one(db, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE org_id = $1 AND role_id = $2 AND lifecycle_status = 'Archived'`, [orgId, roleId]))!.n);
}

/* ---------- archive service: the only reader of archived rows ---------- */
export function canReadArchived(u: User, departmentId: string) { return inDeptScope(u, "archive:read", departmentId); }
async function listArchived(db: Db, u: User, orgId: string, role: { id: string; department_id: string }) {
  if (!canReadArchived(u, role.department_id)) throw forbidden("Viewing archived skills needs the archive:read permission", "archive_read_required");
  const rows = await q(db, `${SELECT("role_skill_mapping").replace("SELECT m.*,", `SELECT m.*, ${PENDING},`)} WHERE m.org_id = $1 AND m.role_id = $2 AND m.lifecycle_status = 'Archived' ORDER BY m.pixel_id`, [orgId, role.id]);
  return rows.map(dto);
}

async function getRow(db: Db, orgId: string, pid: string, lock = false) {
  return one(db, `${SELECT("role_skill_mapping").replace("SELECT m.*,", `SELECT m.*, ${PENDING},`)} WHERE m.org_id = $1 AND m.pixel_id = $2${lock ? " FOR UPDATE OF m" : ""}`, [orgId, pid]);
}
export async function mappingOrThrow(db: Db, u: User, pid: string, lock = false) {
  const m = await getRow(db, orgOf(u), pid.toUpperCase(), lock);
  if (!m) throw notFound(`Mapping ${pid}`);
  return m;
}
export async function pendingChange(db: Db, orgId: string, pid: string) {
  return one(db, `SELECT id, change_type FROM change_requests WHERE org_id = $1 AND entity_type = 'mapping' AND entity_id = $2 AND status = 'In Review'`, [orgId, pid]);
}

function policyOf(settings: any) {
  return { mandatory: true, openAssessments: true, all: false, ...(settings?.archive_policy || {}) };
}
async function openAssessmentCount(db: Db, m: any): Promise<number> {
  return Number((await one(db, `
    SELECT count(DISTINCT a.id)::int AS n FROM assessments a JOIN assessment_items i ON i.assessment_id = a.id JOIN employees e ON e.id = a.employee_id
    WHERE a.org_id = $1 AND e.role_id = $2 AND i.skill_id = $3 AND a.status IN ('Assigned','Submitted')`, [m.org_id, m.role_id, m.skill_id]))!.n);
}
export async function archiveNeedsApproval(db: Db, u: User, m: any): Promise<{ needs: boolean; why: string | null }> {
  if (scopeOf(u, "archive:write") !== "org") return { needs: true, why: "Department heads propose; HR approves" };
  const org = await one(db, `SELECT settings FROM organisations WHERE id = $1`, [m.org_id]);
  const p = policyOf(org?.settings);
  if (p.all) return { needs: true, why: "Your policy requires approval for every archive" };
  if (p.mandatory && m.requirement_type === "Mandatory") return { needs: true, why: "The mapping is Mandatory" };
  if (p.openAssessments && (await openAssessmentCount(db, m)) > 0) return { needs: true, why: "The skill has open assessments for this role" };
  return { needs: false, why: null };
}

/* ---------- state changes (each runs inside a transaction with its audit rows) ---------- */
export async function applyArchive(c: PoolClient, m: any, actor: User, actorLabel: string, category: string, reason: string, changeId: string | null) {
  const prior = { skill_trend: m.skill_trend, required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance };
  await q(c, `UPDATE role_skill_mapping SET lifecycle_status = 'Archived', skill_trend = 'Archived', requirement_type = 'Legacy only',
      last_required_level = required_level, last_requirement_type = requirement_type, last_importance = importance,
      archive_reason_category = $3, archive_reason = $4, archived_on = current_date, archived_by = $5, review_flag = false,
      version = version + 1, updated_at = now() WHERE org_id = $1 AND pixel_id = $2`, [m.org_id, m.pixel_id, category, reason, actorLabel]);
  await q(c, `INSERT INTO archive_audit_log (org_id, pixel_id, action, actor, reason_category, reason, prior_trend, prior_values, change_id)
      VALUES ($1,$2,'archive',$3,$4,$5,$6,$7,$8)`, [m.org_id, m.pixel_id, actorLabel, category, reason, m.skill_trend, JSON.stringify(prior), changeId]);
  await audit(c, actor, { org_id: m.org_id, entity_type: "mapping", entity_id: m.pixel_id, action: "archive", before: prior, after: { lifecycle_status: "Archived", category }, reason });
  // 8.11 downstream effects
  const notice = `${m.skill_name} was archived for ${m.role_name} on ${new Date().toISOString().slice(0, 10)}.`;
  const open = await q(c, `SELECT a.id, (SELECT count(*) FROM assessment_items x WHERE x.assessment_id = a.id)::int AS items
      FROM assessments a JOIN assessment_items i ON i.assessment_id = a.id JOIN employees e ON e.id = a.employee_id
      WHERE a.org_id = $1 AND e.role_id = $2 AND i.skill_id = $3 AND a.status IN ('Assigned','Submitted')`, [m.org_id, m.role_id, m.skill_id]);
  for (const a of open) {
    await q(c, `UPDATE assessments SET notice = $2, status = CASE WHEN $3 THEN 'Closed' ELSE status END WHERE id = $1`, [a.id, notice, a.items === 1]);
  }
  await q(c, `UPDATE development_activities d SET flag = 'Review: skill archived for this role'
      FROM development_plans p JOIN employees e ON e.id = p.employee_id
      WHERE d.plan_id = p.id AND p.org_id = $1 AND e.role_id = $2 AND d.skill_id = $3 AND d.status <> 'Done'`, [m.org_id, m.role_id, m.skill_id]);
}

export async function applyRestore(c: PoolClient, m: any, actor: User, actorLabel: string, note: string, changeId: string | null) {
  const prior = { skill_trend: m.skill_trend, requirement_type: m.requirement_type, archive_reason_category: m.archive_reason_category, archived_on: m.archived_on };
  await q(c, `UPDATE role_skill_mapping SET lifecycle_status = 'Active', skill_trend = 'Declining', requirement_type = 'Optional',
      required_level = coalesce(last_required_level, required_level), importance = coalesce(last_importance, importance),
      demand_direction = 'Decreasing', review_flag = true, archive_reason_category = NULL, archive_reason = NULL, archived_on = NULL, archived_by = NULL,
      version = version + 1, updated_at = now() WHERE org_id = $1 AND pixel_id = $2`, [m.org_id, m.pixel_id]);
  await q(c, `INSERT INTO archive_audit_log (org_id, pixel_id, action, actor, reason, prior_trend, prior_values, change_id)
      VALUES ($1,$2,'restore',$3,$4,'Archived',$5,$6)`, [m.org_id, m.pixel_id, actorLabel, note || "Restored", JSON.stringify(prior), changeId]);
  await audit(c, actor, { org_id: m.org_id, entity_type: "mapping", entity_id: m.pixel_id, action: "restore", before: prior, after: { lifecycle_status: "Active", skill_trend: "Declining", requirement_type: "Optional", review_flag: true }, reason: note || null });
}

export async function applyMappingUpdate(c: PoolClient, m: any, actor: User, fields: any) {
  const allowed = ["required_level", "requirement_type", "importance", "skill_trend", "explanation", "demand_direction"];
  const set: string[] = []; const params: unknown[] = [m.org_id, m.pixel_id];
  const before: any = {}, after: any = {};
  for (const k of allowed) if (fields[k] !== undefined && fields[k] !== m[k]) { params.push(fields[k]); set.push(`${k} = $${params.length}`); before[k] = m[k]; after[k] = fields[k]; }
  if (!set.length) return;
  await q(c, `UPDATE role_skill_mapping SET ${set.join(", ")}, review_flag = false, version = version + 1, updated_at = now() WHERE org_id = $1 AND pixel_id = $2`, params);
  await audit(c, actor, { org_id: m.org_id, entity_type: "mapping", entity_id: m.pixel_id, action: "update", before, after });
}

/* ---------- validation ---------- */
const draftSchema = z.object({
  skill_id: z.string().min(1),
  required_level: z.coerce.number().int().min(1).max(5),
  requirement_type: z.enum(REQ_TYPES),
  importance: z.enum(IMPORTANCE),
  skill_trend: z.enum(ACTIVE_TRENDS).default("Current"),
  explanation: z.string().max(2000).default(""),
});
const updateSchema = z.object({
  required_level: z.coerce.number().int().min(1).max(5).optional(),
  requirement_type: z.enum(REQ_TYPES).optional(),
  importance: z.enum(IMPORTANCE).optional(),
  skill_trend: z.enum(ACTIVE_TRENDS).optional(),
  explanation: z.string().max(2000).optional(),
  reason: z.string().max(2000).optional(),
});
const archiveSchema = z.object({
  reason_category: z.string().optional(),
  reason: z.string().optional(),
  confirm: z.boolean().optional(),
});

async function openChange(c: Db, u: User, m: any, change_type: string, payload: any, origin = "user") {
  return one(c, `INSERT INTO change_requests (org_id, entity_type, entity_id, change_type, payload, origin, requested_by, requested_by_name)
     VALUES ($1,'mapping',$2,$3,$4,$5,$6,$7) RETURNING *`, [m.org_id, m.pixel_id, change_type, JSON.stringify(payload), origin, u.id, u.name]);
}

/* ---------- operations ---------- */
export async function archiveMapping(u: User, pid: string, body: unknown) {
  const b = parse(archiveSchema, body);
  return tx(async c => {
    const m = await mappingOrThrow(c, u, pid, true);
    if (!inDeptScope(u, "archive:write", m.department_id)) throw forbidden("You cannot archive mappings for this role", "archive_write_required");
    if (m.lifecycle_status === "Archived") throw conflict("already_archived", `${m.pixel_id} is already archived`);
    if (m.approval_status !== "Published") throw unprocessable("not_published", "Only Published mappings can be archived. Withdraw a Draft instead");
    if (m.pending_change_id) throw conflict("pending_change", `${m.pixel_id} already has a change in review (${m.pending_change_id})`);
    if (!b.reason_category || !(REASON_CATEGORIES as readonly string[]).includes(b.reason_category)) throw unprocessable("reason_category_required", "Choose a reason category");
    if (!b.reason || !b.reason.trim()) throw unprocessable("reason_required", "Write a reason for archiving");
    const remaining = (await activeCount(c, m.org_id, m.role_id)) - 1;
    if (remaining <= 0 && !b.confirm) throw conflict("confirm_required", `${m.role_name} would have no active skills left. Resend with confirm=true to continue`);
    const { needs, why } = await archiveNeedsApproval(c, u, m);
    if (needs) {
      const cr = await openChange(c, u, m, "archive", { reason_category: b.reason_category, reason: b.reason.trim(), confirm: !!b.confirm });
      await audit(c, u, { entity_type: "mapping", entity_id: m.pixel_id, action: "archive_requested", reason: b.reason.trim(), after: { change: cr!.id } });
      return { status: "in_review", reason_for_review: why, change: cr };
    }
    await applyArchive(c, m, u, u.name, b.reason_category, b.reason.trim(), null);
    return { status: "archived", mapping: dto(await getRow(c, m.org_id, m.pixel_id)) };
  });
}

export async function restoreMapping(u: User, pid: string, body: any) {
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  return tx(async c => {
    const m = await mappingOrThrow(c, u, pid, true);
    if (!inDeptScope(u, "archive:write", m.department_id)) throw forbidden("You cannot restore mappings for this role", "archive_write_required");
    if (m.lifecycle_status !== "Archived") throw conflict("not_archived", `${m.pixel_id} is not archived`);
    if (m.pending_change_id) throw conflict("pending_change", `${m.pixel_id} already has a change in review`);
    const org = await one(c, `SELECT settings FROM organisations WHERE id = $1`, [m.org_id]);
    if (scopeOf(u, "archive:write") !== "org" || policyOf(org?.settings).all) {
      const cr = await openChange(c, u, m, "restore", { note });
      return { status: "in_review", change: cr };
    }
    await applyRestore(c, m, u, u.name, note, null);
    return { status: "restored", mapping: dto(await getRow(c, m.org_id, m.pixel_id)) };
  });
}

export async function createDraft(u: User, roleId: string, body: unknown) {
  const b = parse(draftSchema, body);
  return tx(async c => {
    const role = await roleInOrg(c, u, roleId);
    if (!inDeptScope(u, "framework:draft", role.department_id)) throw forbidden("You cannot change this role's framework");
    if (role.status === "Archived") throw unprocessable("role_archived", "This role is archived");
    const skill = await one(c, `SELECT id, name FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [b.skill_id, role.org_id]);
    if (!skill) throw notFound("Skill");
    const pid = buildPixelId(role.id, skill.id);
    const existing = await getRow(c, role.org_id, pid, true);
    if (existing) {
      if (existing.lifecycle_status === "Archived") {
        // 7.8: mapping an archived pair restores it with the same Pixel ID, never a duplicate
        if (existing.pending_change_id) throw conflict("pending_change", `${pid} already has a change in review`);
        const org = await one(c, `SELECT settings FROM organisations WHERE id = $1`, [role.org_id]);
        if (scopeOf(u, "archive:write") !== "org" || policyOf(org?.settings).all) {
          const cr = await openChange(c, u, existing, "restore", { note: "Re-mapped from the skill picker" });
          return { status: "in_review", restored_existing: true, change: cr };
        }
        await applyRestore(c, existing, u, u.name, "Re-mapped from the skill picker", null);
        return { status: "restored", restored_existing: true, mapping: dto(await getRow(c, role.org_id, pid)) };
      }
      throw conflict("duplicate_mapping", `${role.title} already maps ${skill.name} as ${pid}`);
    }
    await q(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend,
        demand_direction, observation_period, trend_rationale, explanation, approval_status, lifecycle_status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$10,'Draft','Active',$11)`,
      [role.org_id, pid, role.id, skill.id, b.required_level, b.requirement_type, b.importance, b.skill_trend,
       b.skill_trend === "Emerging" ? "Increasing" : b.skill_trend === "Declining" ? "Decreasing" : "Stable", b.explanation, u.name]);
    await audit(c, u, { entity_type: "mapping", entity_id: pid, action: "draft_created", after: b });
    return { status: "draft", mapping: dto(await getRow(c, role.org_id, pid)) };
  });
}

export async function updateMapping(u: User, pid: string, body: unknown) {
  const b = parse(updateSchema, body);
  return tx(async c => {
    const m = await mappingOrThrow(c, u, pid, true);
    if (!inDeptScope(u, "framework:draft", m.department_id)) throw forbidden("You cannot change this role's framework");
    if (m.lifecycle_status === "Archived") throw unprocessable("archived_read_only", "Archived mappings are read-only. Restore it first");
    if (m.approval_status !== "Published") {
      await applyMappingUpdate(c, m, u, b);
      return { status: "draft_updated", mapping: dto(await getRow(c, m.org_id, m.pixel_id)) };
    }
    if (m.pending_change_id) throw conflict("pending_change", `${m.pixel_id} already has a change in review`);
    const { reason, ...fields } = b;
    const cr = await openChange(c, u, m, "update", { fields, reason: reason || "", before: { required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, skill_trend: m.skill_trend } });
    return { status: "in_review", change: cr };
  });
}

export async function submitMapping(u: User, pid: string) {
  return tx(async c => {
    const m = await mappingOrThrow(c, u, pid, true);
    if (!inDeptScope(u, "framework:draft", m.department_id)) throw forbidden("You cannot submit this draft");
    if (!["Draft", "Changes Requested"].includes(m.approval_status)) throw conflict("not_draft", `${m.pixel_id} is ${m.approval_status}`);
    await q(c, `UPDATE role_skill_mapping SET approval_status = 'In Review', updated_at = now() WHERE org_id = $1 AND pixel_id = $2`, [m.org_id, m.pixel_id]);
    return openChange(c, u, m, "publish", { reason: m.explanation });
  });
}

export async function withdrawDraft(u: User, pid: string) {
  return tx(async c => {
    const m = await mappingOrThrow(c, u, pid, true);
    if (!inDeptScope(u, "framework:draft", m.department_id)) throw forbidden("You cannot withdraw this draft");
    if (m.approval_status === "Published") throw new (await import("../errors")).ApiError(405, "use_archive", "Published mappings are archived, never deleted");
    await q(c, `UPDATE change_requests SET status = 'Withdrawn' WHERE org_id = $1 AND entity_type = 'mapping' AND entity_id = $2 AND status = 'In Review'`, [m.org_id, m.pixel_id]);
    await q(c, `DELETE FROM role_skill_mapping WHERE org_id = $1 AND pixel_id = $2`, [m.org_id, m.pixel_id]);
    await audit(c, u, { entity_type: "mapping", entity_id: m.pixel_id, action: "draft_withdrawn" });
    return { status: "withdrawn" };
  });
}

/* ---------- exports ---------- */
const EXPORT_HEAD = ["Pixel ID", "Company", "Department", "Role ID", "Role Name", "Skill ID", "Skill Name", "Skill Category", "Industry",
  "Required Level (1-5)", "Requirement Type", "Importance", "Skill Trend", "Demand Direction", "Observation Period", "Trend Rationale",
  "Confidence Score", "Evidence Status", "Lifecycle Status"];
async function exportRows(db: Db, rows: any[]) {
  const names = Object.fromEntries((await q(db, `SELECT d.id, d.name, o.name AS org FROM departments d JOIN organisations o ON o.id = d.org_id`)).map(r => [r.id, r]));
  return rows.map(m => [m.pixel_id, names[m.department_id]?.org, names[m.department_id]?.name, m.role_id, m.role_name, m.skill_id, m.skill_name,
    m.skill_category, m.industry, m.required_level, m.requirement_type, m.importance, m.skill_trend, m.demand_direction, m.observation_period ?? "",
    m.trend_rationale, m.confidence_score ?? "", m.evidence_status, m.lifecycle_status]);
}

/* ---------- routes ---------- */
export const routes: Route[] = [
  // GET /roles/{id}/skills[?include_archived=true]  (Developer Guide 7)
  { method: "GET", pattern: "/roles/:id/skills", handler: async ({ db, user, params, query }) => {
    const role = await assertReadFramework(db, user, params.id);
    const active = (await listActive(db, role.org_id, { roleId: role.id })).map(dto);
    const res: any = { role_id: role.id, role_name: role.title, active_count: active.length, skills: active };
    const permitted = canReadArchived(user, role.department_id);
    if (permitted) res.archived_count = await archivedCount(db, role.org_id, role.id);
    if (query.get("include_archived") === "true") res.archived = await listArchived(db, user, role.org_id, role); // separate array, never inside skills
    if (inDeptScope(user, "framework:draft", role.department_id)) {
      res.drafts = (await q(db, `${SELECT("role_skill_mapping").replace("SELECT m.*,", `SELECT m.*, ${PENDING},`)} WHERE m.org_id = $1 AND m.role_id = $2 AND m.approval_status <> 'Published' ORDER BY m.pixel_id`, [role.org_id, role.id])).map(dto);
    }
    res.permissions = { archive_read: permitted, archive_write: inDeptScope(user, "archive:write", role.department_id),
      archive_write_direct: scopeOf(user, "archive:write") === "org", draft: inDeptScope(user, "framework:draft", role.department_id),
      archive_export: has(user, "archive:export") };
    return res;
  } },
  { method: "POST", pattern: "/roles/:id/skills", handler: ({ user, params, body }) => createDraft(user, params.id, body) },
  { method: "GET", pattern: "/roles/:id/skills/archived/export", handler: async ({ db, user, params }) => {
    const role = await assertReadFramework(db, user, params.id);
    if (!has(user, "archive:export")) throw forbidden("Archive export needs permission", "archive_export_forbidden");
    const rows = await q(db, `${SELECT("role_skill_mapping")} WHERE m.org_id = $1 AND m.role_id = $2 AND m.lifecycle_status = 'Archived' ORDER BY m.pixel_id`, [role.org_id, role.id]);
    await audit(db, user, { entity_type: "role", entity_id: role.id, action: "archive_export", reason: `${rows.length} rows` });
    return { file: `archived-skills-${role.id}.csv`, header: [...EXPORT_HEAD, "Archived On", "Archive Reason Category", "Archive Reason", "Last Required Level"],
      rows: (await exportRows(db, rows)).map((r, i) => [...r, dto(rows[i]).archived_on, rows[i].archive_reason_category, rows[i].archive_reason, rows[i].last_required_level]) };
  } },
  // Standard export: active only, Pixel ID first (PX-05, AR-03)
  { method: "GET", pattern: "/framework/export", handler: async ({ db, user, query }) => {
    const orgId = orgOf(user);
    if (!has(user, "framework:read")) throw forbidden();
    const roleId = query.get("role_id");
    let rows = await listActive(db, orgId, roleId ? { roleId } : {});
    if (scopeOf(user, "framework:read") !== "org") {
      const visible: any[] = [];
      for (const r of rows) { try { await assertReadFramework(db, user, r.role_id); visible.push(r); } catch { /* skip */ } }
      rows = visible;
    }
    return { file: "role-skill-framework.csv", header: EXPORT_HEAD, rows: await exportRows(db, rows) };
  } },
  { method: "GET", pattern: "/pixels/legacy/:oldId", handler: async ({ db, user, params }) => {
    const id = params.oldId.trim().toUpperCase(); const orgId = orgOf(user);
    const rs = await one(db, `SELECT x.*, m.lifecycle_status FROM pixel_id_crosswalk x JOIN role_skill_mapping m ON m.org_id = x.org_id AND m.pixel_id = x.pixel_id WHERE x.old_role_skill_id = $1 AND x.org_id = $2`, [id, orgId]);
    if (rs) return { old_id: id, kind: "Role Skill ID", pixel_id: rs.pixel_id, lifecycle_status: rs.lifecycle_status };
    const fw = await q(db, `SELECT DISTINCT m.role_id FROM pixel_id_crosswalk x JOIN role_skill_mapping m ON m.org_id = x.org_id AND m.pixel_id = x.pixel_id WHERE x.old_framework_id = $1 AND x.org_id = $2`, [id, orgId]);
    if (fw.length) {
      const act = await listActive(db, orgId, { roleId: fw[0].role_id });
      return { old_id: id, kind: "Framework ID", role_id: fw[0].role_id, note: "A role's framework is every Pixel ID with this role_id", active_pixel_ids: act.map(a => a.pixel_id) };
    }
    throw notFound(`${id} as a Role Skill ID or Framework ID in your organisation`);
  } },
  // Direct lookup: any lifecycle, status shown. Not a list, so it is allowed (Developer Guide 8)
  { method: "GET", pattern: "/pixels/:pid", handler: async ({ db, user, params }) => {
    const m = await mappingOrThrow(db, user, params.pid);
    await assertReadFramework(db, user, m.role_id);
    if (m.lifecycle_status === "Archived" && !canReadArchived(user, m.department_id))
      return { pixel_id: m.pixel_id, lifecycle_status: "Archived", detail: "Viewing archived details needs archive:read" };
    const events = canReadArchived(user, m.department_id) ? await q(db, `SELECT action, actor, reason_category, reason, prior_trend, at FROM archive_audit_log WHERE org_id = $1 AND pixel_id = $2 ORDER BY id`, [m.org_id, m.pixel_id]) : [];
    return { ...dto(m), lifecycle_events: events };
  } },
  { method: "PATCH", pattern: "/pixels/:pid", handler: ({ user, params, body }) => updateMapping(user, params.pid, body) },
  { method: "DELETE", pattern: "/pixels/:pid", handler: ({ user, params }) => withdrawDraft(user, params.pid) },
  { method: "POST", pattern: "/pixels/:pid/submit", handler: ({ user, params }) => submitMapping(user, params.pid) },
  { method: "POST", pattern: "/pixels/:pid/archive", handler: ({ user, params, body }) => archiveMapping(user, params.pid, body) },
  { method: "POST", pattern: "/pixels/:pid/restore", handler: ({ user, params, body }) => restoreMapping(user, params.pid, body) },
  { method: "GET", pattern: "/pixels/:pid/archive-check", handler: async ({ db, user, params }) => {
    const m = await mappingOrThrow(db, user, params.pid);
    if (!inDeptScope(user, "archive:write", m.department_id)) throw forbidden();
    const remaining = (await activeCount(db, m.org_id, m.role_id)) - 1;
    const approval = await archiveNeedsApproval(db, user, m);
    const affected = await one(db, `SELECT
        (SELECT count(*) FROM employee_skills es JOIN employees e ON e.id = es.employee_id WHERE e.role_id = $1 AND es.skill_id = $2)::int AS profiles,
        (SELECT count(DISTINCT a.id) FROM assessments a JOIN assessment_items i ON i.assessment_id = a.id JOIN employees e ON e.id = a.employee_id WHERE e.role_id = $1 AND i.skill_id = $2 AND a.status IN ('Assigned','Submitted'))::int AS open_assessments,
        (SELECT count(*) FROM development_activities d JOIN development_plans p ON p.id = d.plan_id JOIN employees e ON e.id = p.employee_id WHERE e.role_id = $1 AND d.skill_id = $2 AND d.status <> 'Done')::int AS open_activities
      `, [m.role_id, m.skill_id]);
    return { pixel_id: m.pixel_id, last_active: remaining <= 0, needs_approval: approval.needs, reason_for_review: approval.why, affected };
  } },
  // Change history for one mapping (Q9): every request with old and new values, requester, approver, times, plus lifecycle events
  { method: "GET", pattern: "/pixels/:pid/history", handler: async ({ db, user, params }) => {
    const m = await mappingOrThrow(db, user, params.pid);
    await assertReadFramework(db, user, m.role_id);
    const crs = await q(db, `SELECT * FROM change_requests WHERE org_id = $1 AND entity_type = 'mapping' AND entity_id = $2 ORDER BY requested_at`, [m.org_id, m.pixel_id]);
    const roleCrs = await q(db, `SELECT * FROM change_requests WHERE org_id = $1 AND entity_type = 'role' AND entity_id = $2 AND payload->'pixel_ids' ? $3 ORDER BY requested_at`, [m.org_id, m.role_id, m.pixel_id]);
    const changes = [...crs, ...roleCrs].map(c => {
      const p = c.payload || {};
      const before = c.change_type === "update" ? p.before : c.change_type === "archive" ? { lifecycle_status: "Active" } : c.change_type === "restore" ? { lifecycle_status: "Archived" } : null;
      const after = c.change_type === "update" ? p.fields : c.change_type === "archive" ? { lifecycle_status: "Archived", reason_category: p.reason_category } : c.change_type === "restore" ? { lifecycle_status: "Active", skill_trend: "Declining", requirement_type: "Optional" } : { approval_status: "Published" };
      return { id: c.id, change_type: c.entity_type === "role" ? "publish (with role)" : c.change_type, origin: c.origin, status: c.status, before, after,
        reason: p.reason || p.note || null, requested_by_name: c.requested_by_name, requested_at: c.requested_at, decided_by: c.decided_by, decided_at: c.decided_at, comment: c.comment };
    });
    const audit = await q(db, `SELECT action, actor_name, before, after, reason, at FROM audit_log WHERE org_id = $1 AND entity_type = 'mapping' AND entity_id = $2 ORDER BY id`, [m.org_id, m.pixel_id]);
    const lifecycle = canReadArchived(user, m.department_id) ? await q(db, `SELECT action, actor, reason_category, reason, prior_trend, prior_values, change_id, at FROM archive_audit_log WHERE org_id = $1 AND pixel_id = $2 ORDER BY id`, [m.org_id, m.pixel_id]) : [];
    return { pixel_id: m.pixel_id, current: { required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, skill_trend: m.skill_trend, lifecycle_status: m.lifecycle_status, version: m.version }, changes, audit, lifecycle };
  } },
  // Framework explorer across all roles in scope, with trend filter; archived only on request and in its own list (Q2-Q4)
  { method: "GET", pattern: "/framework", handler: async ({ db, user, query }) => {
    const orgId = orgOf(user);
    const s = scopeOf(user, "framework:read");
    if (!s) throw forbidden();
    let rows = await listActive(db, orgId);
    if (s !== "org") {
      const keep: any[] = [];
      for (const id of [...new Set(rows.map(r => r.role_id))]) { try { await assertReadFramework(db, user, id); keep.push(...rows.filter(r => r.role_id === id)); } catch { /* not visible */ } }
      rows = keep;
    }
    const trend = query.get("trend"), req = query.get("requirement_type"), dept = query.get("department_id");
    rows = rows.filter(r => (!trend || r.skill_trend === trend) && (!req || r.requirement_type === req) && (!dept || r.department_id === dept));
    const res: any = { count: rows.length, skills: rows.map(dto) };
    if (query.get("include_archived") === "true") {
      if (!has(user, "archive:read")) throw forbidden("Viewing archived skills needs the archive:read permission", "archive_read_required");
      const arch = await q(db, `${SELECT("role_skill_mapping")} WHERE m.org_id = $1 AND m.lifecycle_status = 'Archived' ORDER BY m.pixel_id`, [orgId]);
      res.archived = arch.filter(a => canReadArchived(user, a.department_id) && (!dept || a.department_id === dept)).map(dto);
    }
    return res;
  } },
];

