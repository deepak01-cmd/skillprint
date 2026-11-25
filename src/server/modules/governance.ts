/* Module 6: framework governance (PRD 10). Change requests for mappings, roles and career paths.
   Archive and restore follow the same approval flow (10.6). */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { activeCount, applyArchive, applyMappingUpdate, applyRestore, mappingOrThrow } from "./mapping";
import { onRolePublished } from "./roleFallback";

const decideSchema = z.object({
  decision: z.enum(["approve", "request_changes", "reject"]),
  comment: z.string().max(2000).default(""),
});

async function listChanges(db: Db, u: User, status: string | null) {
  const orgId = orgOf(u);
  const s = scopeOf(u, "audit:read");
  if (!s) throw forbidden();
  const rows = await q(db, `
    SELECT c.*,
      coalesce(mr.title, rr.title, pf.title) AS role_name,
      coalesce(mr.department_id, rr.department_id, pf.department_id) AS department_id,
      sk.name AS skill_name, m.required_level, m.requirement_type, m.skill_trend, m.approval_status AS mapping_approval,
      pt.title AS to_role_name
    FROM change_requests c
    LEFT JOIN role_skill_mapping m ON c.entity_type = 'mapping' AND m.org_id = c.org_id AND m.pixel_id = c.entity_id
    LEFT JOIN job_roles mr ON mr.id = m.role_id
    LEFT JOIN skills sk ON sk.id = m.skill_id
    LEFT JOIN job_roles rr ON c.entity_type = 'role' AND rr.id = c.entity_id
    LEFT JOIN career_paths cp ON c.entity_type = 'career_path' AND cp.id = c.entity_id
    LEFT JOIN job_roles pf ON pf.id = cp.from_role_id
    LEFT JOIN job_roles pt ON pt.id = cp.to_role_id
    WHERE c.org_id = $1 AND ($2::text IS NULL OR c.status = $2)
    ORDER BY c.requested_at DESC LIMIT 300`, [orgId, status]);
  return rows.filter(r => s === "org" || r.department_id === u.department_id);
}

export async function decide(u: User, id: string, body: unknown) {
  const b = parse(decideSchema, body);
  if (!has(u, "approve")) throw forbidden("Only an HR administrator can approve framework changes", "approve_required");
  if (b.decision !== "approve" && !(b.comment || "").trim()) throw bad("Say what needs to change", "comment_required");
  return tx(async c => {
    const cr = await one(c, `SELECT * FROM change_requests WHERE id = $1 AND org_id = $2 FOR UPDATE`, [id, orgOf(u)]);
    if (!cr) throw notFound("Change request");
    if (cr.status !== "In Review") throw conflict("not_in_review", `${cr.id} is ${cr.status}`);
    const label = `${cr.requested_by_name}, approved by ${u.name}`;
    if (b.decision === "approve") {
      if (cr.entity_type === "mapping") {
        const m = await mappingOrThrow(c, u, cr.entity_id, true);
        if (cr.change_type === "archive") {
          if (m.lifecycle_status === "Archived") throw conflict("already_archived", `${m.pixel_id} is already archived`);
          const remaining = (await activeCount(c, m.org_id, m.role_id)) - 1;
          if (remaining <= 0 && !cr.payload.confirm) throw conflict("confirm_required", "This would leave the role with no active skills");
          await applyArchive(c, m, u, label, cr.payload.reason_category, cr.payload.reason, cr.id);
        } else if (cr.change_type === "restore") {
          if (m.lifecycle_status !== "Archived") throw conflict("not_archived", `${m.pixel_id} is not archived`);
          await applyRestore(c, m, u, label, cr.payload.note, cr.id);
        } else if (cr.change_type === "publish") {
          await q(c, `UPDATE role_skill_mapping SET approval_status = 'Published', lifecycle_status = 'Active', updated_at = now() WHERE org_id = $1 AND pixel_id = $2`, [m.org_id, m.pixel_id]);
          await audit(c, u, { entity_type: "mapping", entity_id: m.pixel_id, action: "published", after: { change: cr.id } });
        } else if (cr.change_type === "update") {
          await applyMappingUpdate(c, m, u, cr.payload.fields || {});
        }
      } else if (cr.entity_type === "role") {
        const role = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 FOR UPDATE`, [cr.entity_id, cr.org_id]);
        if (!role) throw notFound("Role");
        const newVersion = role.version;
        await q(c, `UPDATE job_roles SET status = 'Published', updated_at = now() WHERE id = $1`, [role.id]);
        await q(c, `INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (role_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot, changed_by = EXCLUDED.changed_by, note = EXCLUDED.note`,
          [role.id, newVersion, JSON.stringify({ ...role, status: "Published" }), label, "Published"]);
        const pids: string[] = cr.payload.pixel_ids || [];
        if (pids.length) await q(c, `UPDATE role_skill_mapping SET approval_status = 'Published', lifecycle_status = 'Active', updated_at = now()
                                     WHERE org_id = $1 AND pixel_id = ANY($2) AND approval_status <> 'Published'`, [cr.org_id, pids]);
        await audit(c, u, { entity_type: "role", entity_id: role.id, action: "published", after: { change: cr.id, mappings: pids.length } });
        await onRolePublished(c, cr.org_id, role.id, u.name);
      } else if (cr.entity_type === "career_path") {
        await q(c, `UPDATE career_paths SET status = 'Published', review_flag = false WHERE id = $1 AND org_id = $2`, [cr.entity_id, cr.org_id]);
        await audit(c, u, { entity_type: "career_path", entity_id: cr.entity_id, action: "published", after: { change: cr.id } });
      }
      await q(c, `UPDATE change_requests SET status = 'Published', decided_by = $2, decided_at = now(), comment = $3 WHERE id = $1`, [cr.id, u.name, b.comment]);
    } else {
      const status = b.decision === "reject" ? "Rejected" : "Changes Requested";
      if (cr.entity_type === "mapping" && cr.change_type === "publish")
        await q(c, `UPDATE role_skill_mapping SET approval_status = 'Changes Requested' WHERE org_id = $1 AND pixel_id = $2`, [cr.org_id, cr.entity_id]);
      if (cr.entity_type === "role") {
        await q(c, `UPDATE job_roles SET status = 'Draft' WHERE id = $1 AND status = 'In Review'`, [cr.entity_id]);
        if ((cr.payload.pixel_ids || []).length) await q(c, `UPDATE role_skill_mapping SET approval_status = 'Changes Requested' WHERE org_id = $1 AND pixel_id = ANY($2) AND approval_status = 'In Review'`, [cr.org_id, cr.payload.pixel_ids]);
      }
      if (cr.entity_type === "career_path") await q(c, `UPDATE career_paths SET status = 'Draft' WHERE id = $1 AND status = 'In Review'`, [cr.entity_id]);
      await q(c, `UPDATE change_requests SET status = $2, decided_by = $3, decided_at = now(), comment = $4 WHERE id = $1`, [cr.id, status, u.name, b.comment]);
    }
    await audit(c, u, { entity_type: "change_request", entity_id: cr.id, action: b.decision, reason: b.comment || null, after: { entity: cr.entity_id, type: cr.change_type } });
    return one(c, `SELECT * FROM change_requests WHERE id = $1`, [cr.id]);
  });
}

export const routes: Route[] = [
  { method: "GET", pattern: "/changes", handler: ({ db, user, query }) => listChanges(db, user, query.get("status")) },
  { method: "POST", pattern: "/changes/:id/decide", handler: ({ user, params, body }) => decide(user, params.id, body) },
  { method: "POST", pattern: "/changes/:id/withdraw", handler: async ({ db, user, params }) => {
    const cr = await one(db, `SELECT * FROM change_requests WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!cr) throw notFound("Change request");
    if (cr.requested_by !== user.id && !has(user, "approve")) throw forbidden("Only the requester can withdraw this change");
    if (cr.status !== "In Review") throw conflict("not_in_review", `${cr.id} is ${cr.status}`);
    await q(db, `UPDATE change_requests SET status = 'Withdrawn', decided_by = $2, decided_at = now() WHERE id = $1`, [cr.id, user.name]);
    if (cr.entity_type === "mapping" && cr.change_type === "publish") await q(db, `UPDATE role_skill_mapping SET approval_status = 'Draft' WHERE org_id = $1 AND pixel_id = $2`, [cr.org_id, cr.entity_id]);
    if (cr.entity_type === "role") await q(db, `UPDATE job_roles SET status = 'Draft' WHERE id = $1 AND status = 'In Review'`, [cr.entity_id]);
    if (cr.entity_type === "career_path") await q(db, `UPDATE career_paths SET status = 'Draft' WHERE id = $1 AND status = 'In Review'`, [cr.entity_id]);
    await audit(db, user, { entity_type: "change_request", entity_id: cr.id, action: "withdraw" });
    return { status: "withdrawn" };
  } },
  { method: "GET", pattern: "/audit", handler: async ({ db, user, query }) => {
    const s = scopeOf(user, "audit:read");
    if (!s) throw forbidden();
    const entity = query.get("entity_id");
    const rows = await q(db, `SELECT a.* FROM audit_log a WHERE a.org_id = $1 AND ($2::text IS NULL OR a.entity_id = $2) ORDER BY a.id DESC LIMIT 400`, [orgOf(user), entity]);
    const lifecycle = await q(db, `SELECT l.*, m.role_id, r.department_id, r.title AS role_name, s.name AS skill_name FROM archive_audit_log l
        JOIN role_skill_mapping m ON m.org_id = l.org_id AND m.pixel_id = l.pixel_id JOIN job_roles r ON r.id = m.role_id JOIN skills s ON s.id = m.skill_id
        WHERE l.org_id = $1 ORDER BY l.id DESC LIMIT 400`, [orgOf(user)]);
    return { events: s === "org" ? rows : rows.filter(r => r.actor_id === user.id), lifecycle: s === "org" ? lifecycle : lifecycle.filter(l => l.department_id === user.department_id) };
  } },
];
