/* Analytics exports and scheduled reports. Each report is a workbook (summary + detail sheets) or a CSV of the detail.
   HR administrators see the whole organisation; department heads their own department. Scheduled reports are kept in
   the report history and, when SMTP is configured, emailed — only to HR administrators or department heads of the same organisation. */
import { z } from "zod";
import ExcelJS from "exceljs";
import { Db, one, q } from "../db";
import { audit } from "../audit";
import { logAccess } from "../access";
import { forbidden, notFound, unprocessable } from "../errors";
import { User } from "../permissions";
import { orgOf } from "../scope";
import { Route } from "../http/router";
import { toCsv } from "../files";
import { employeesGaps } from "./people";
import { rankFor } from "./succession";

type Col = { key: string; header: string; width?: number };
type Sheet = { name: string; columns: Col[]; rows: Record<string, any>[] };
type Scope = { org_id: string; department_id: string | null; role: string };
const KEYS = ["skill_gaps", "skills_inventory", "learning", "mobility", "succession", "access"] as const;
type Key = (typeof KEYS)[number];

export const CATALOGUE: Record<Key, { title: string; about: string; hrOnly?: boolean }> = {
  skill_gaps: { title: "Skill gaps", about: "Every required skill per person: required vs current level, gap and priority, with a summary by skill." },
  skills_inventory: { title: "Skills inventory", about: "All recorded skill levels by person, source and date." },
  learning: { title: "Learning & development", about: "Development activities by person: status, mentor, due date." },
  mobility: { title: "Internal mobility", about: "Internal job postings and every application with its match and status." },
  succession: { title: "Succession bench", about: "Critical roles, incumbents, named successors and readiness." },
  access: { title: "Personal-data access", about: "Who opened whose profile, gaps, applications or evidence (last 90 days).", hrOnly: true },
};

const C = (key: string, header: string, width = 16): Col => ({ key, header, width });
async function build(db: Db, s: Scope, key: Key): Promise<Sheet[]> {
  const dept = s.department_id;
  if (key === "skill_gaps") {
    const emps = await q(db, `SELECT e.*, d.name AS department_name, r.title AS role_title FROM employees e JOIN departments d ON d.id = e.department_id JOIN job_roles r ON r.id = e.role_id
      WHERE e.org_id = $1 AND e.status = 'Active' AND ($2::text IS NULL OR e.department_id = $2) ORDER BY d.name, e.name`, [s.org_id, dept]);
    const gm = await employeesGaps(db, emps); const rows: any[] = []; const by = new Map<string, any>();
    for (const e of emps) for (const g of gm.get(e.id) || []) {
      rows.push({ employee_id: e.id, name: e.name, department: e.department_name, role: e.role_title, skill: g.skill_name, type: g.requirement_type, importance: g.importance,
        required: g.required_level, current: g.current_level ?? "", source: g.source ?? "", gap: g.gap ?? "", priority: g.priority ?? "", status: g.status });
      const x = by.get(g.skill_name) || { skill: g.skill_name, people: 0, with_gap: 0, high: 0, not_assessed: 0, total_gap: 0 };
      x.people++; if (g.status === "Gap") { x.with_gap++; x.total_gap += g.gap || 0; } if (g.priority === "High") x.high++; if (g.status === "No assessment data") x.not_assessed++; by.set(g.skill_name, x);
    }
    const summary = [...by.values()].map(x => ({ ...x, avg_gap: x.with_gap ? Math.round(x.total_gap / x.with_gap * 10) / 10 : 0 })).sort((a, b) => b.high - a.high || b.with_gap - a.with_gap);
    return [{ name: "Summary by skill", columns: [C("skill", "Skill", 34), C("people", "People needing it", 16), C("with_gap", "With a gap", 12), C("high", "High priority", 13), C("not_assessed", "Not assessed", 13), C("avg_gap", "Average gap", 12)], rows: summary },
      { name: "Gaps by person", columns: [C("employee_id", "Employee ID", 12), C("name", "Name", 24), C("department", "Department", 22), C("role", "Role", 26), C("skill", "Skill", 30), C("type", "Requirement", 13), C("importance", "Importance", 12),
        C("required", "Required", 9), C("current", "Current", 9), C("source", "Source", 11), C("gap", "Gap", 6), C("priority", "Priority", 10), C("status", "Status", 18)], rows }];
  }
  if (key === "skills_inventory") {
    const rows = await q(db, `SELECT e.id AS employee_id, e.name, d.name AS department, r.title AS role, s.name AS skill, s.category, es.source, es.level, to_char(es.assessed_on, 'YYYY-MM-DD') AS assessed_on, es.assessed_by
      FROM employee_skills es JOIN employees e ON e.id = es.employee_id AND e.status = 'Active' JOIN departments d ON d.id = e.department_id JOIN job_roles r ON r.id = e.role_id JOIN skills s ON s.id = es.skill_id
      WHERE es.org_id = $1 AND ($2::text IS NULL OR e.department_id = $2) ORDER BY e.name, s.name, es.source`, [s.org_id, dept]);
    return [{ name: "Skills inventory", columns: [C("employee_id", "Employee ID", 12), C("name", "Name", 24), C("department", "Department", 22), C("role", "Role", 26), C("skill", "Skill", 30), C("category", "Category", 22), C("source", "Source", 11), C("level", "Level", 7), C("assessed_on", "Assessed on", 12), C("assessed_by", "Assessed by", 20)], rows }];
  }
  if (key === "learning") {
    const rows = await q(db, `SELECT e.id AS employee_id, e.name, d.name AS department, s.name AS skill, a.title AS activity, a.type, a.status, a.current_level, a.target_level, a.mentor, to_char(a.due_date, 'YYYY-MM-DD') AS due, to_char(a.created_at, 'YYYY-MM-DD') AS added
      FROM development_activities a JOIN development_plans p ON p.id = a.plan_id JOIN employees e ON e.id = p.employee_id JOIN departments d ON d.id = e.department_id JOIN skills s ON s.id = a.skill_id
      WHERE p.org_id = $1 AND ($2::text IS NULL OR e.department_id = $2) ORDER BY e.name, a.created_at`, [s.org_id, dept]);
    const by = new Map<string, any>(); for (const r of rows) { const x = by.get(r.status) || { status: r.status, activities: 0 }; x.activities++; by.set(r.status, x); }
    return [{ name: "By status", columns: [C("status", "Status", 16), C("activities", "Activities", 12)], rows: [...by.values()] },
      { name: "Activities", columns: [C("employee_id", "Employee ID", 12), C("name", "Name", 24), C("department", "Department", 22), C("skill", "Skill", 28), C("activity", "Activity", 44), C("type", "Type", 18), C("status", "Status", 12), C("current_level", "Level then", 10), C("target_level", "Target", 8), C("mentor", "Mentor", 20), C("due", "Due", 12), C("added", "Added", 12)], rows }];
  }
  if (key === "mobility") {
    const jobs = await q(db, `SELECT j.id, j.title, d.name AS department, j.status, j.openings, j.location, j.work_mode, to_char(j.created_at, 'YYYY-MM-DD') AS posted, to_char(j.closes_on, 'YYYY-MM-DD') AS closes,
        (SELECT count(*)::int FROM job_applications a WHERE a.job_id = j.id AND a.status <> 'Withdrawn') AS applicants, (SELECT count(*)::int FROM job_applications a WHERE a.job_id = j.id AND a.status = 'Hired') AS hired
      FROM internal_jobs j JOIN departments d ON d.id = j.department_id WHERE j.org_id = $1 AND ($2::text IS NULL OR j.department_id = $2) ORDER BY j.created_at DESC`, [s.org_id, dept]);
    const apps = await q(db, `SELECT j.id AS job_id, j.title AS posting, e.id AS employee_id, e.name, r.title AS current_role, cd.name AS current_department, a.status, a.match_pct, to_char(a.created_at, 'YYYY-MM-DD') AS applied, to_char(a.updated_at, 'YYYY-MM-DD') AS updated
      FROM job_applications a JOIN internal_jobs j ON j.id = a.job_id JOIN employees e ON e.id = a.employee_id JOIN job_roles r ON r.id = e.role_id JOIN departments cd ON cd.id = e.department_id
      WHERE a.org_id = $1 AND ($2::text IS NULL OR j.department_id = $2) ORDER BY j.title, a.match_pct DESC`, [s.org_id, dept]);
    return [{ name: "Postings", columns: [C("id", "ID", 10), C("title", "Posting", 30), C("department", "Department", 22), C("status", "Status", 10), C("openings", "Openings", 9), C("applicants", "Applicants", 10), C("hired", "Hired", 7), C("location", "Location", 14), C("work_mode", "Mode", 9), C("posted", "Posted", 12), C("closes", "Closes", 12)], rows: jobs },
      { name: "Applications", columns: [C("job_id", "Posting ID", 10), C("posting", "Posting", 30), C("employee_id", "Employee ID", 12), C("name", "Applicant", 24), C("current_role", "Current role", 26), C("current_department", "Current department", 22), C("status", "Status", 13), C("match_pct", "Match %", 9), C("applied", "Applied", 12), C("updated", "Updated", 12)], rows: apps }];
  }
  if (key === "succession") {
    const plans = await q(db, `SELECT p.id, p.role_id, r.title AS role, d.name AS department, p.criticality FROM succession_plans p JOIN job_roles r ON r.id = p.role_id JOIN departments d ON d.id = r.department_id
      WHERE p.org_id = $1 AND p.status = 'Active' AND ($2::text IS NULL OR r.department_id = $2) ORDER BY r.title`, [s.org_id, dept]);
    const pRows: any[] = [], sRows: any[] = [];
    for (const p of plans) {
      const named = await q(db, `SELECT s.employee_id, s.readiness, s.notes FROM successors s JOIN employees e ON e.id = s.employee_id AND e.status = 'Active' WHERE s.plan_id = $1`, [p.id]);
      const ranked = named.length ? await rankFor(db, s.org_id, p.role_id, { employeeIds: named.map(n => n.employee_id) }) : [];
      const inc = await one(db, `SELECT count(*)::int AS n FROM employees WHERE role_id = $1 AND status = 'Active'`, [p.role_id]);
      pRows.push({ role: p.role, department: p.department, criticality: p.criticality, incumbents: inc!.n, successors: named.length, ready_now: named.filter(n => n.readiness === "Ready now").length });
      for (const n of named) { const r = ranked.find(x => x.employee_id === n.employee_id); sRows.push({ role: p.role, employee_id: n.employee_id, name: r?.name, current_role: r?.role_title, readiness: n.readiness, match: r?.match, mandatory_gaps: r?.mandatory_gaps, notes: n.notes }); }
    }
    return [{ name: "Critical roles", columns: [C("role", "Role", 28), C("department", "Department", 22), C("criticality", "Criticality", 11), C("incumbents", "Incumbents", 11), C("successors", "Successors", 11), C("ready_now", "Ready now", 10)], rows: pRows },
      { name: "Successors", columns: [C("role", "Role", 28), C("employee_id", "Employee ID", 12), C("name", "Name", 24), C("current_role", "Current role", 26), C("readiness", "Readiness", 18), C("match", "Match %", 9), C("mandatory_gaps", "Must-have gaps", 14), C("notes", "Notes", 40)], rows: sRows }];
  }
  // access
  const rows = await q(db, `SELECT to_char(a.at, 'YYYY-MM-DD HH24:MI') AS at, a.actor_name, a.actor_role, e.name AS subject, a.resource, a.detail, a.ip FROM access_log a LEFT JOIN employees e ON e.id = a.subject_id
    WHERE a.org_id = $1 AND a.at > now() - interval '90 days' ORDER BY a.at DESC LIMIT 50000`, [s.org_id]);
  return [{ name: "Access log", columns: [C("at", "When", 17), C("actor_name", "Who", 24), C("actor_role", "Their access", 14), C("subject", "Whose data", 24), C("resource", "What", 18), C("detail", "Detail", 36), C("ip", "Address", 16)], rows }];
}

/** The file for a report: an Excel workbook with every sheet, or a CSV of the detail sheet. */
export async function render(db: Db, s: Scope, key: Key, format: "xlsx" | "csv", orgName: string) {
  const sheets = await build(db, s, key);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${CATALOGUE[key].title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`;
  const detail = sheets[sheets.length - 1];
  if (format === "csv") return { name: `${base}.csv`, mime: "text/csv; charset=utf-8", data: Buffer.from("﻿" + toCsv(detail.columns.map(c => c.header), detail.rows.map(r => detail.columns.map(c => r[c.key]))), "utf8"), rows: detail.rows.length };
  const wb = new ExcelJS.Workbook(); wb.creator = "Skillprint"; wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 2 }] });
    ws.mergeCells(1, 1, 1, Math.max(2, sh.columns.length));
    ws.getCell(1, 1).value = `${orgName} · ${CATALOGUE[key].title}${s.department_id ? " (one department)" : ""} · ${stamp}`;
    ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FF4F46E5" } };
    ws.getRow(2).values = sh.columns.map(c => c.header);
    ws.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(2).eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }; });
    sh.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 16; });
    // text that a spreadsheet would treat as a formula is stored as plain text
    for (const r of sh.rows) ws.addRow(sh.columns.map(c => { const v = r[c.key]; return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v ?? ""; }));
    if (sh.rows.length) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sh.columns.length } };
  }
  return { name: `${base}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: Buffer.from(await wb.xlsx.writeBuffer()), rows: detail.rows.length };
}

function scopeFor(u: User, key: string, departmentId?: string | null): Scope {
  if (!(KEYS as readonly string[]).includes(key)) throw notFound("Report");
  if (u.role !== "hr_admin" && u.role !== "dept_head") throw forbidden("Reports are for HR administrators and department heads");
  if (CATALOGUE[key as Key].hrOnly && u.role !== "hr_admin") throw forbidden("Only HR administrators see this report");
  return { org_id: orgOf(u), role: u.role, department_id: u.role === "dept_head" ? u.department_id : departmentId || null };
}
export function nextRun(freq: "weekly" | "monthly", from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 7, 0, 0));
  if (freq === "weekly") { do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1); }
  else { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); }
  return d;
}

/** Email a report when SMTP_URL is set (for example smtp://user:password@mail.company.com:587). */
async function deliver(to: string[], subject: string, file: { name: string; mime: string; data: Buffer }) {
  if (!process.env.SMTP_URL || !to.length) return "saved (email not configured)";
  try {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    await t.sendMail({ from: process.env.REPORT_FROM || "Skillprint <no-reply@localhost>", to, subject, text: `${subject}\n\nThe report is attached.`, attachments: [{ filename: file.name, content: file.data, contentType: file.mime }] });
    return `emailed to ${to.length}`;
  } catch (e: any) { return `email failed: ${String(e.message).slice(0, 120)}`; }
}
/** Runs one schedule: makes the file, keeps it in the history, emails it. Recipients are re-checked at send time. */
export async function runSchedule(db: Db, sc: any, by: string) {
  const org = await one(db, `SELECT name, status FROM organisations WHERE id = $1`, [sc.org_id]);
  if (!org || org.status === "Suspended") return null;
  const f = await render(db, { org_id: sc.org_id, department_id: sc.department_id, role: "hr_admin" }, sc.report, sc.format, org.name);
  const allowed = (await q(db, `SELECT email FROM users WHERE org_id = $1 AND active AND (role = 'hr_admin' OR (role = 'dept_head' AND department_id = $2)) AND lower(email) = ANY($3)`,
    [sc.org_id, sc.department_id, sc.recipients.map((x: string) => x.toLowerCase())])).map(r => r.email);
  const delivered = await deliver(allowed, `${org.name}: ${CATALOGUE[sc.report as Key].title}`, f);
  const run = await one(db, `INSERT INTO report_runs (org_id, schedule_id, report, format, file_name, rows, data, delivered, run_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, file_name, rows, delivered, created_at`,
    [sc.org_id, sc.id, sc.report, sc.format, f.name, f.rows, f.data, delivered, by]);
  await q(db, `UPDATE report_schedules SET last_run_at = now(), next_run_at = $2 WHERE id = $1`, [sc.id, nextRun(sc.frequency)]);
  await q(db, `DELETE FROM report_runs WHERE org_id = $1 AND created_at < now() - interval '180 days'`, [sc.org_id]);
  return run;
}
export async function runDueSchedules(db: Db) {
  const due = await q(db, `SELECT * FROM report_schedules WHERE active AND next_run_at <= now() ORDER BY next_run_at LIMIT 20`);
  for (const sc of due) { try { await runSchedule(db, sc, "schedule"); } catch (e: any) { console.error(`Report ${sc.id} failed: ${e.message}`); await q(db, `UPDATE report_schedules SET next_run_at = $2 WHERE id = $1`, [sc.id, nextRun(sc.frequency)]); } }
  return due.length;
}

const scheduleSchema = z.object({ report: z.enum(KEYS), format: z.enum(["xlsx", "csv"]).default("xlsx"), frequency: z.enum(["weekly", "monthly"]), department_id: z.string().max(40).nullable().optional(),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(10).default([]) });
async function checkRecipients(db: Db, u: User, emails: string[], dept: string | null) {
  if (!emails.length) return;
  const ok = (await q(db, `SELECT lower(email) AS e FROM users WHERE org_id = $1 AND active AND (role = 'hr_admin' OR (role = 'dept_head' AND department_id = $2)) AND lower(email) = ANY($3)`, [orgOf(u), dept, emails])).map(r => r.e);
  const bad = emails.filter(e => !ok.includes(e));
  if (bad.length) throw unprocessable("recipient_not_allowed", `Reports contain personal data, so they go only to HR administrators${dept ? " or this department's head" : ""} in your organisation. Not allowed: ${bad.join(", ")}`);
}
async function scheduleFor(db: Db, u: User, id: string) {
  const s = await one(db, `SELECT * FROM report_schedules WHERE id = $1 AND org_id = $2`, [id, orgOf(u)]);
  if (!s || (u.role !== "hr_admin" && s.owner_id !== u.id)) throw notFound("Schedule");
  return s;
}

export const routes: Route[] = [
  { method: "GET", pattern: "/reports", handler: async ({ user }) => {
    if (user.role !== "hr_admin" && user.role !== "dept_head") throw forbidden();
    return KEYS.filter(k => !CATALOGUE[k].hrOnly || user.role === "hr_admin").map(k => ({ key: k, ...CATALOGUE[k] }));
  } },
  { method: "GET", pattern: "/reports/:key/download", handler: async ({ db, user, params, query, meta }) => {
    const s = scopeFor(user, params.key, query.get("department_id"));
    if (s.department_id && !(await one(db, `SELECT 1 FROM departments WHERE id = $1 AND org_id = $2`, [s.department_id, s.org_id]))) throw notFound("Department");
    const fmt = query.get("format") === "csv" ? "csv" : "xlsx";
    const org = await one(db, `SELECT name FROM organisations WHERE id = $1`, [s.org_id]);
    const f = await render(db, s, params.key as Key, fmt, org!.name);
    await logAccess(db, user, null, "report export", `${CATALOGUE[params.key as Key].title} · ${f.rows} rows${s.department_id ? ` · ${s.department_id}` : ""}`, meta.ip);
    await audit(db, user, { entity_type: "report", entity_id: params.key, action: "exported", after: { format: fmt, rows: f.rows, department: s.department_id } });
    return { __file: f };
  } },
  { method: "GET", pattern: "/reports/schedules", handler: async ({ db, user }) => {
    if (user.role !== "hr_admin" && user.role !== "dept_head") throw forbidden();
    return q(db, `SELECT s.id, s.report, s.format, s.frequency, s.department_id, d.name AS department_name, s.recipients, s.active, s.next_run_at, s.last_run_at, s.owner_name FROM report_schedules s LEFT JOIN departments d ON d.id = s.department_id
      WHERE s.org_id = $1 AND ($2 OR s.owner_id = $3) ORDER BY s.created_at`, [orgOf(user), user.role === "hr_admin", user.id]);
  } },
  { method: "POST", pattern: "/reports/schedules", handler: async ({ db, user, body }) => {
    const b = scheduleSchema.parse(body);
    const s = scopeFor(user, b.report, b.department_id);
    if (s.department_id && !(await one(db, `SELECT 1 FROM departments WHERE id = $1 AND org_id = $2`, [s.department_id, s.org_id]))) throw notFound("Department");
    const recipients = [...new Set(b.recipients)];
    await checkRecipients(db, user, recipients, s.department_id);
    const n = await one(db, `SELECT count(*)::int AS n FROM report_schedules WHERE org_id = $1`, [s.org_id]);
    if (n!.n >= 50) throw unprocessable("too_many", "Up to 50 schedules per organisation");
    const r = await one(db, `INSERT INTO report_schedules (org_id, report, format, frequency, department_id, recipients, next_run_at, owner_id, owner_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [s.org_id, b.report, b.format, b.frequency, s.department_id, recipients, nextRun(b.frequency), user.id, user.name]);
    await audit(db, user, { entity_type: "report_schedule", entity_id: r.id, action: "created", after: { ...b, recipients } });
    return r;
  } },
  { method: "PATCH", pattern: "/reports/schedules/:id", handler: async ({ db, user, params, body }) => {
    const s = await scheduleFor(db, user, params.id);
    const b = z.object({ active: z.boolean().optional(), recipients: scheduleSchema.shape.recipients.optional(), frequency: z.enum(["weekly", "monthly"]).optional(), format: z.enum(["xlsx", "csv"]).optional() }).parse(body);
    if (b.recipients) await checkRecipients(db, user, [...new Set(b.recipients)], s.department_id);
    const after = await one(db, `UPDATE report_schedules SET active = coalesce($2, active), recipients = coalesce($3, recipients), frequency = coalesce($4, frequency), format = coalesce($5, format),
        next_run_at = CASE WHEN $4::text IS NOT NULL THEN $6 ELSE next_run_at END WHERE id = $1 RETURNING *`,
      [s.id, b.active ?? null, b.recipients ? [...new Set(b.recipients)] : null, b.frequency ?? null, b.format ?? null, b.frequency ? nextRun(b.frequency) : null]);
    await audit(db, user, { entity_type: "report_schedule", entity_id: s.id, action: "updated", after: b });
    return after;
  } },
  { method: "DELETE", pattern: "/reports/schedules/:id", handler: async ({ db, user, params }) => {
    const s = await scheduleFor(db, user, params.id);
    await q(db, `UPDATE report_runs SET schedule_id = NULL WHERE schedule_id = $1`, [s.id]);
    await q(db, `DELETE FROM report_schedules WHERE id = $1`, [s.id]);
    await audit(db, user, { entity_type: "report_schedule", entity_id: s.id, action: "deleted" });
    return { ok: true };
  } },
  { method: "POST", pattern: "/reports/schedules/:id/run", handler: async ({ db, user, params }) => {
    const s = await scheduleFor(db, user, params.id);
    const run = await runSchedule(db, s, user.name);
    if (!run) throw unprocessable("not_run", "The report could not run");
    return run;
  } },
  { method: "GET", pattern: "/reports/runs", handler: async ({ db, user }) => {
    if (user.role !== "hr_admin" && user.role !== "dept_head") throw forbidden();
    return q(db, `SELECT r.id, r.report, r.format, r.file_name, r.rows, r.delivered, r.run_by, r.created_at FROM report_runs r LEFT JOIN report_schedules s ON s.id = r.schedule_id
      WHERE r.org_id = $1 AND ($2 OR s.owner_id = $3) ORDER BY r.created_at DESC LIMIT 100`, [orgOf(user), user.role === "hr_admin", user.id]);
  } },
  { method: "GET", pattern: "/reports/runs/:id/download", handler: async ({ db, user, params, meta }) => {
    const r = await one(db, `SELECT r.*, s.owner_id FROM report_runs r LEFT JOIN report_schedules s ON s.id = r.schedule_id WHERE r.id = $1 AND r.org_id = $2`, [Number(params.id) || 0, orgOf(user)]);
    if (!r || (user.role !== "hr_admin" && r.owner_id !== user.id)) throw notFound("Report");
    await logAccess(db, user, null, "report export", `${r.file_name} (history)`, meta.ip);
    return { __file: { name: r.file_name, mime: r.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: r.data } };
  } },

  /* ---------- who saw whom ---------- */
  { method: "GET", pattern: "/access-log", handler: async ({ db, user, query }) => {
    if (user.role !== "hr_admin") throw forbidden("Only HR administrators see the access log");
    const p: unknown[] = [orgOf(user)]; const w = ["a.org_id = $1"];
    const add = (v: string | null, sql: (i: number) => string) => { if (v) { p.push(v); w.push(sql(p.length)); } };
    add(query.get("employee_id"), i => `a.subject_id = $${i}`);
    add(query.get("actor"), i => `lower(a.actor_name) LIKE '%' || lower($${i}) || '%'`);
    add(query.get("resource"), i => `a.resource = $${i}`);
    add(query.get("from"), i => `a.at >= $${i}::date`);
    add(query.get("to"), i => `a.at < $${i}::date + 1`);
    const rows = await q(db, `SELECT a.id, a.at, a.actor_id, a.actor_name, a.actor_role, a.subject_id, e.name AS subject_name, a.resource, a.detail, a.ip FROM access_log a LEFT JOIN employees e ON e.id = a.subject_id
      WHERE ${w.join(" AND ")} ORDER BY a.at DESC LIMIT 1000`, p);
    const resources = (await q(db, `SELECT DISTINCT resource FROM access_log WHERE org_id = $1 ORDER BY 1`, [orgOf(user)])).map(r => r.resource);
    return { rows, resources };
  } },
  /** Transparency: anyone can see who opened their own data. */
  { method: "GET", pattern: "/me/access-log", handler: async ({ db, user }) => {
    if (!user.employee_id) return [];
    return q(db, `SELECT at, actor_name, actor_role, resource FROM access_log WHERE subject_id = $1 AND org_id = $2 ORDER BY at DESC LIMIT 200`, [user.employee_id, orgOf(user)]);
  } },
];
