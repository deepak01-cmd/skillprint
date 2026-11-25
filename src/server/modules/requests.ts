/* Level-change requests: an employee asks for a new proficiency level in one skill and attaches evidence (files or links).
   Their manager (or HR) reviews the evidence and approves (possibly at a different level), rejects, or asks for more.
   Only an approval changes the trusted level; the employee's own rating is kept separately as self-reported. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { logAccess } from "../access";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { User } from "../permissions";
import { employeeInScope, orgOf } from "../scope";
import { Route } from "../http/router";
import { effectiveLevel } from "../calc";
import { levelsFor } from "./people";
import { currentAssumptions } from "./structure";

const TYPES = ["Project", "Repository", "Certification", "Assessment result", "Work sample", "Manager feedback", "Training completion"] as const;
const MAX_FILES = 5, MAX_FILE = 5 * 1024 * 1024, MAX_TOTAL = 15 * 1024 * 1024;
const EXT: Record<string, { mime: string; ok: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", ok: b => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { mime: "image/png", ok: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: "image/jpeg", ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg", ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ok: b => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ok: b => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ok: b => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  txt: { mime: "text/plain", ok: b => !b.subarray(0, 4096).includes(0) },
};
export const ALLOWED_FILES = Object.keys(EXT).map(e => "." + e).join(",");

const linkSchema = z.object({ title: z.string().trim().min(2).max(300), url: z.string().trim().url().max(1000).refine(u => /^https?:\/\//i.test(u), "Links must start with http:// or https://"), type: z.enum(TYPES).default("Work sample") });
const asList = (v: unknown) => v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v];
const parseJson = (v: unknown, fallback: any) => { if (typeof v !== "string") return v ?? fallback; try { return JSON.parse(v); } catch { throw unprocessable("bad_field", "A form field was not readable"); } };

/** Checks uploaded files (count, size, real content matching the extension) and links. */
function readEvidence(body: any) {
  const links = z.array(linkSchema).max(10).parse(parseJson(body.links, []));
  const files = asList(body.file).filter((f: any) => f && typeof f === "object" && f.buffer);
  const titles: string[] = parseJson(body.file_titles, []); const types: string[] = parseJson(body.file_types, []);
  if (files.length > MAX_FILES) throw unprocessable("too_many_files", `Attach up to ${MAX_FILES} files`);
  let total = 0;
  const out = files.map((f: any, i: number) => {
    const ext = String(f.name).toLowerCase().split(".").pop() || "";
    const spec = EXT[ext];
    if (!spec) throw unprocessable("file_type", `${f.name}: use PDF, Word, Excel, PowerPoint, PNG, JPG or text files`);
    if (f.buffer.length === 0) throw unprocessable("empty_file", `${f.name} is empty`);
    if (f.buffer.length > MAX_FILE) throw unprocessable("file_too_large", `${f.name} is larger than 5 MB`);
    if (!spec.ok(f.buffer)) throw unprocessable("file_content", `${f.name} does not look like a real .${ext} file`);
    total += f.buffer.length;
    const type = (TYPES as readonly string[]).includes(types[i]) ? types[i] : "Work sample";
    const title = String(titles[i] || f.name).trim().slice(0, 300);
    return { name: String(f.name).slice(0, 200), mime: spec.mime, data: f.buffer as Buffer, type, title: title.length >= 2 ? title : f.name };
  });
  if (total > MAX_TOTAL) throw unprocessable("files_too_large", "Files together are larger than 15 MB");
  return { links, files: out };
}
async function saveEvidence(c: Db, requestId: string, ev: ReturnType<typeof readEvidence>) {
  for (const l of ev.links) await q(c, `INSERT INTO level_request_evidence (request_id, kind, type, title, url) VALUES ($1,'link',$2,$3,$4)`, [requestId, l.type, l.title, l.url]);
  for (const f of ev.files) await q(c, `INSERT INTO level_request_evidence (request_id, kind, type, title, file_name, mime, size_bytes, data) VALUES ($1,'file',$2,$3,$4,$5,$6,$7)`, [requestId, f.type, f.title, f.name, f.mime, f.data.length, f.data]);
}

/** May this user review (decide) requests for this employee? The current manager, or HR. Never the employee. */
async function canDecide(db: Db, u: User, employeeId: string) {
  if (u.employee_id === employeeId) return false;
  if (u.role === "hr_admin") return true;
  if (u.role !== "manager" || !u.employee_id) return false;
  return !!(await one(db, `SELECT 1 FROM employees WHERE id = $1 AND manager_id = $2`, [employeeId, u.employee_id]));
}
async function load(db: Db, u: User, id: string) {
  const r = await one(db, `SELECT r.*, s.name AS skill_name, e.name AS employee_name, e.manager_id, jr.title AS role_title FROM level_requests r JOIN skills s ON s.id = r.skill_id
      JOIN employees e ON e.id = r.employee_id JOIN job_roles jr ON jr.id = e.role_id WHERE r.id = $1 AND r.org_id = $2`, [id, orgOf(u)]);
  if (!r) throw notFound("Request");
  if (r.employee_id !== u.employee_id) await employeeInScope(db, u, "employees:read", r.employee_id);
  return r;
}
const hist = (status: string, by: string, note?: string, extra?: any) => JSON.stringify([{ status, at: new Date().toISOString(), by, note: note || undefined, ...extra }]);

export const routes: Route[] = [
  /** Create: multipart (skill_id, requested_level, note, links JSON, file × n, file_titles JSON, file_types JSON) or JSON with links only. */
  { method: "POST", pattern: "/level-requests", handler: async ({ user, body }) => tx(async c => {
    if (!user.employee_id) throw forbidden("Only employees can request a level change");
    const b = z.object({ skill_id: z.string().max(40), requested_level: z.coerce.number().int().min(0).max(5), note: z.string().trim().max(2000).default("") }).parse(body);
    const ev = readEvidence(body);
    if (!ev.links.length && !ev.files.length) throw unprocessable("evidence_required", "Attach at least one piece of evidence: a file or a link");
    const emp = await one(c, `SELECT * FROM employees WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [user.employee_id, orgOf(user)]);
    if (!emp) throw notFound("Employee");
    if (!(await one(c, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2) AND status = 'Active'`, [b.skill_id, emp.org_id]))) throw unprocessable("unknown_skill", "Unknown skill");
    if (await one(c, `SELECT 1 FROM level_requests WHERE employee_id = $1 AND skill_id = $2 AND status IN ('Pending','More info needed')`, [emp.id, b.skill_id])) throw conflict("already_requested", "You already have an open request for this skill");
    const A = (await currentAssumptions(c, emp.org_id)).data;
    const cur = effectiveLevel((await levelsFor(c, [emp.id])).get(emp.id)?.get(b.skill_id) || [], false).level;
    if (cur !== null && cur === b.requested_level) throw unprocessable("same_level", `Your confirmed level is already ${cur}`);
    const r = await one(c, `INSERT INTO level_requests (org_id, employee_id, skill_id, current_level, requested_level, note, reviewer_id, history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status`,
      [emp.org_id, emp.id, b.skill_id, cur, b.requested_level, b.note, emp.manager_id, hist("Pending", user.name, b.note || undefined)]);
    await saveEvidence(c, r.id, ev);
    await audit(c, user, { entity_type: "level_request", entity_id: r.id, action: "requested", after: { skill: b.skill_id, from: cur, to: b.requested_level, links: ev.links.length, files: ev.files.length, counted_self: A.count_self_assessed } });
    return { ...r, reviewer: emp.manager_id ? "manager" : "hr" };
  }) },
  /** mine: my own; review: waiting for me (managers: direct reports; HR: everyone); all: HR and department heads (history). */
  { method: "GET", pattern: "/level-requests", handler: async ({ db, user, query }) => {
    const view = query.get("view") || "mine";
    const cols = `SELECT r.id, r.employee_id, e.name AS employee_name, jr.title AS role_title, r.skill_id, s.name AS skill_name, r.current_level, r.requested_level, r.decided_level, r.note, r.status,
        r.decision_note, r.decided_by_name, r.created_at, r.updated_at, r.decided_at, r.history,
        (SELECT count(*)::int FROM level_request_evidence x WHERE x.request_id = r.id) AS evidence_count
      FROM level_requests r JOIN employees e ON e.id = r.employee_id JOIN job_roles jr ON jr.id = e.role_id JOIN skills s ON s.id = r.skill_id`;
    if (view === "mine") return user.employee_id ? q(db, `${cols} WHERE r.employee_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [user.employee_id]) : [];
    const status = query.get("status") === "all" ? null : "open";
    if (user.role === "manager" && user.employee_id)
      return q(db, `${cols} WHERE e.manager_id = $1 AND r.org_id = $2 ${status ? "AND r.status IN ('Pending','More info needed')" : ""} ORDER BY r.created_at LIMIT 300`, [user.employee_id, orgOf(user)]);
    if (user.role === "hr_admin") return q(db, `${cols} WHERE r.org_id = $1 ${status ? "AND r.status IN ('Pending','More info needed')" : ""} ORDER BY r.created_at LIMIT 500`, [orgOf(user)]);
    if (user.role === "dept_head") return q(db, `${cols} WHERE r.org_id = $1 AND e.department_id = $2 ${status ? "AND r.status IN ('Pending','More info needed')" : ""} ORDER BY r.created_at LIMIT 300`, [orgOf(user), user.department_id]);
    throw forbidden();
  } },
  { method: "GET", pattern: "/level-requests/:id", handler: async ({ db, user, params, meta }) => {
    const r = await load(db, user, params.id);
    const ev = await q(db, `SELECT id, kind, type, title, url, file_name, mime, size_bytes, created_at FROM level_request_evidence WHERE request_id = $1 ORDER BY created_at`, [r.id]);
    await logAccess(db, user, r.employee_id, "level request", `${r.id} · ${r.skill_name}`, meta.ip);
    return { ...r, evidence: ev, can_decide: ["Pending"].includes(r.status) && await canDecide(db, user, r.employee_id), can_edit: r.employee_id === user.employee_id && ["Pending", "More info needed"].includes(r.status) };
  } },
  { method: "GET", pattern: "/level-requests/files/:id", handler: async ({ db, user, params, meta }) => {
    const f = await one(db, `SELECT x.*, r.employee_id, r.org_id FROM level_request_evidence x JOIN level_requests r ON r.id = x.request_id WHERE x.id = $1 AND x.kind = 'file'`, [params.id]);
    if (!f || f.org_id !== user.org_id) throw notFound("File");
    if (f.employee_id !== user.employee_id) await employeeInScope(db, user, "employees:read", f.employee_id);
    await logAccess(db, user, f.employee_id, "evidence file", f.file_name, meta.ip);
    return { __file: { name: f.file_name, mime: f.mime, data: f.data } };
  } },
  /** The employee adds evidence (while open) and, when more information was asked for, sends it back for review. */
  { method: "POST", pattern: "/level-requests/:id/evidence", handler: async ({ user, params, body }) => tx(async c => {
    const r = await load(c, user, params.id);
    await c.query(`SELECT 1 FROM level_requests WHERE id = $1 FOR UPDATE`, [r.id]);
    if (r.employee_id !== user.employee_id) throw forbidden("Only the employee adds evidence to their request");
    if (!["Pending", "More info needed"].includes(r.status)) throw unprocessable("closed", `The request is ${r.status.toLowerCase()}`);
    const ev = readEvidence(body);
    const have = await one(c, `SELECT count(*) FILTER (WHERE kind = 'file')::int AS files, count(*)::int AS n FROM level_request_evidence WHERE request_id = $1`, [r.id]);
    if (have.files + ev.files.length > MAX_FILES) throw unprocessable("too_many_files", `Up to ${MAX_FILES} files per request`);
    if (!ev.links.length && !ev.files.length && r.status !== "More info needed") throw unprocessable("evidence_required", "Add a file or a link");
    await saveEvidence(c, r.id, ev);
    const note = z.string().trim().max(1000).default("").parse(body.note ?? "");
    if (r.status === "More info needed") await q(c, `UPDATE level_requests SET status = 'Pending', updated_at = now(), history = history || $2::jsonb WHERE id = $1`, [r.id, hist("Pending", user.name, note || "More evidence added")]);
    else await q(c, `UPDATE level_requests SET updated_at = now() WHERE id = $1`, [r.id]);
    await audit(c, user, { entity_type: "level_request", entity_id: r.id, action: "evidence_added", after: { links: ev.links.length, files: ev.files.length } });
    return { ok: true, status: "Pending" };
  }) },
  { method: "POST", pattern: "/level-requests/:id/withdraw", handler: async ({ db, user, params }) => {
    const r = await load(db, user, params.id);
    if (r.employee_id !== user.employee_id) throw forbidden();
    if (!["Pending", "More info needed"].includes(r.status)) throw unprocessable("closed", `The request is ${r.status.toLowerCase()}`);
    const upd = await one(db, `UPDATE level_requests SET status = 'Withdrawn', updated_at = now(), history = history || $2::jsonb WHERE id = $1 AND status IN ('Pending','More info needed') RETURNING id`, [r.id, hist("Withdrawn", user.name)]);
    if (!upd) throw conflict("changed", "The request was decided a moment ago");
    await audit(db, user, { entity_type: "level_request", entity_id: r.id, action: "withdrawn" });
    return { ok: true };
  } },
  { method: "POST", pattern: "/level-requests/:id/decide", handler: async ({ user, params, body }) => tx(async c => {
    const b = z.object({ decision: z.enum(["approve", "reject", "more_info"]), level: z.coerce.number().int().min(0).max(5).optional(), note: z.string().trim().max(2000).default("") }).parse(body);
    const r = await one(c, `SELECT * FROM level_requests WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Request");
    if (!(await canDecide(c, user, r.employee_id))) throw r.employee_id === user.employee_id ? forbidden("You cannot decide your own request") : forbidden("Only the person's manager or HR decides");
    if (r.status !== "Pending") throw unprocessable("not_pending", `The request is ${r.status.toLowerCase()}`);
    if (b.decision !== "approve" && b.note.length < 3) throw unprocessable("note_required", b.decision === "reject" ? "Say why the request is rejected" : "Say what else is needed");
    if (b.decision === "more_info") {
      await q(c, `UPDATE level_requests SET status = 'More info needed', updated_at = now(), history = history || $2::jsonb WHERE id = $1`, [r.id, hist("More info needed", user.name, b.note)]);
      await audit(c, user, { entity_type: "level_request", entity_id: r.id, action: "more_info_requested", reason: b.note });
      return { status: "More info needed" };
    }
    const level = b.decision === "approve" ? (b.level ?? r.requested_level) : null;
    await q(c, `UPDATE level_requests SET status = $2, decided_level = $3, decision_note = $4, decided_by = $5, decided_by_name = $6, decided_at = now(), updated_at = now(), history = history || $7::jsonb WHERE id = $1`,
      [r.id, b.decision === "approve" ? "Approved" : "Rejected", level, b.note || null, user.id, user.name, hist(b.decision === "approve" ? "Approved" : "Rejected", user.name, b.note, level !== null ? { level } : undefined)]);
    if (level !== null) {
      // approval sets the trusted (manager-assessed) level and keeps the evidence in the person's portfolio as validated
      await q(c, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by) VALUES ($1,$2,$3,'manager',$4,$5)
        ON CONFLICT (employee_id, skill_id, source) DO UPDATE SET level = EXCLUDED.level, assessed_on = current_date, assessed_by = EXCLUDED.assessed_by`, [r.org_id, r.employee_id, r.skill_id, level, user.name]);
      for (const x of await q(c, `SELECT id, kind, type, title, url FROM level_request_evidence WHERE request_id = $1`, [r.id]))
        await q(c, `INSERT INTO employee_evidence (org_id, employee_id, skill_id, type, title, link, validation_status) VALUES ($1,$2,$3,$4,$5,$6,'Validated')`,
          [r.org_id, r.employee_id, r.skill_id, x.type, x.title, x.kind === "link" ? x.url : `/api/v1/level-requests/files/${x.id}`]);
    }
    await audit(c, user, { entity_type: "level_request", entity_id: r.id, action: b.decision === "approve" ? "approved" : "rejected", before: { level: r.current_level, requested: r.requested_level }, after: { level }, reason: b.note || null });
    return { status: b.decision === "approve" ? "Approved" : "Rejected", level };
  }) },
];
