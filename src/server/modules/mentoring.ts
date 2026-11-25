/* Mentoring requests: an employee asks a colleague with a confirmed level in a skill to mentor them.
   The mentor accepts or declines; accepted pairings log sessions and appear in the mentee's development plan. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { User } from "../permissions";
import { orgOf } from "../scope";
import { Route } from "../http/router";

const MAX_OPEN_ASKS = 5, MAX_MENTEES = 4;
const me = (u: User) => { if (!u.employee_id) throw forbidden("Mentoring is for employees"); return u.employee_id; };
async function load(db: Db, u: User, id: string) {
  const r = await one(db, `SELECT m.*, s.name AS skill_name, a.name AS mentee_name, b.name AS mentor_name FROM mentoring_requests m JOIN skills s ON s.id = m.skill_id
      JOIN employees a ON a.id = m.mentee_id JOIN employees b ON b.id = m.mentor_id WHERE m.id = $1 AND m.org_id = $2`, [id, orgOf(u)]);
  // only the two people involved (and HR) see a pairing
  if (!r || (u.employee_id !== r.mentee_id && u.employee_id !== r.mentor_id && u.role !== "hr_admin")) throw notFound("Mentoring request");
  return r;
}

export const routes: Route[] = [
  { method: "POST", pattern: "/mentoring", handler: async ({ user, body }) => tx(async c => {
    const mentee = me(user);
    const b = z.object({ mentor_id: z.string().max(40), skill_id: z.string().max(40), message: z.string().trim().max(1000).default("") }).parse(body);
    if (b.mentor_id === mentee) throw unprocessable("self", "You cannot mentor yourself");
    const mentor = await one(c, `SELECT e.id, e.name, e.user_id, u.active FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND e.org_id = $2 AND e.status = 'Active'`, [b.mentor_id, orgOf(user)]);
    if (!mentor) throw notFound("Colleague");
    if (!mentor.user_id || !mentor.active) throw unprocessable("mentor_no_account", `${mentor.name} has no sign-in yet, so they cannot answer. Add them to your plan as a mentor instead`);
    const lv = await one(c, `SELECT max(level)::int AS l FROM employee_skills WHERE employee_id = $1 AND skill_id = $2 AND source IN ('manager','validated')`, [mentor.id, b.skill_id]);
    if (!lv?.l || lv.l < 3) throw unprocessable("not_qualified", `${mentor.name} has no confirmed level of 3 or more in this skill`);
    if (await one(c, `SELECT 1 FROM mentoring_requests WHERE mentee_id = $1 AND mentor_id = $2 AND skill_id = $3 AND status IN ('Requested','Accepted')`, [mentee, mentor.id, b.skill_id])) throw conflict("already_asked", "You already asked this person for this skill");
    const open = await one(c, `SELECT count(*)::int AS n FROM mentoring_requests WHERE mentee_id = $1 AND status = 'Requested'`, [mentee]);
    if (open!.n >= MAX_OPEN_ASKS) throw unprocessable("too_many", `You have ${MAX_OPEN_ASKS} requests waiting. Wait for answers or cancel one`);
    const r = await one(c, `INSERT INTO mentoring_requests (org_id, mentee_id, mentor_id, skill_id, message) VALUES ($1,$2,$3,$4,$5) RETURNING id, status`, [orgOf(user), mentee, mentor.id, b.skill_id, b.message]);
    await audit(c, user, { entity_type: "mentoring", entity_id: r.id, action: "requested", after: { mentor: mentor.id, skill: b.skill_id } });
    return r;
  }) },
  { method: "GET", pattern: "/mentoring", handler: async ({ db, user }) => {
    const id = me(user);
    const rows = await q(db, `SELECT m.*, s.name AS skill_name, a.name AS mentee_name, ar.title AS mentee_role, b.name AS mentor_name, br.title AS mentor_role,
        (SELECT count(*)::int FROM mentoring_sessions x WHERE x.request_id = m.id) AS sessions, (SELECT coalesce(sum(minutes),0)::int FROM mentoring_sessions x WHERE x.request_id = m.id) AS minutes
      FROM mentoring_requests m JOIN skills s ON s.id = m.skill_id JOIN employees a ON a.id = m.mentee_id JOIN job_roles ar ON ar.id = a.role_id
      JOIN employees b ON b.id = m.mentor_id JOIN job_roles br ON br.id = b.role_id WHERE (m.mentee_id = $1 OR m.mentor_id = $1) AND m.org_id = $2 ORDER BY m.created_at DESC`, [id, orgOf(user)]);
    return { as_mentee: rows.filter(r => r.mentee_id === id), as_mentor: rows.filter(r => r.mentor_id === id) };
  } },
  { method: "POST", pattern: "/mentoring/:id/respond", handler: async ({ user, params, body }) => tx(async c => {
    const r = await load(c, user, params.id);
    if (r.mentor_id !== user.employee_id) throw forbidden("Only the colleague who was asked can answer");
    if (r.status !== "Requested") throw unprocessable("answered", `This request is ${r.status.toLowerCase()}`);
    const b = z.object({ accept: z.boolean(), note: z.string().trim().max(1000).default("") }).parse(body);
    if (b.accept) {
      const n = await one(c, `SELECT count(*)::int AS n FROM mentoring_requests WHERE mentor_id = $1 AND status = 'Accepted'`, [r.mentor_id]);
      if (n!.n >= MAX_MENTEES) throw unprocessable("full", `You already mentor ${MAX_MENTEES} people. Complete one first`);
    }
    const upd = await one(c, `UPDATE mentoring_requests SET status = $2, response_note = $3, responded_at = now() WHERE id = $1 AND status = 'Requested' RETURNING id`, [r.id, b.accept ? "Accepted" : "Declined", b.note || null]);
    if (!upd) throw conflict("changed", "This request was answered or cancelled a moment ago");
    if (b.accept) {
      // the pairing becomes a mentoring activity in the mentee's active plan
      let plan = await one(c, `SELECT id FROM development_plans WHERE employee_id = $1 AND status = 'Active' ORDER BY created_at DESC LIMIT 1`, [r.mentee_id]);
      if (!plan) plan = await one(c, `INSERT INTO development_plans (org_id, employee_id, title, created_by) VALUES ($1,$2,'Learning plan',$3) RETURNING id`, [r.org_id, r.mentee_id, user.name]);
      const req = await one(c, `SELECT v.required_level FROM employees e JOIN v_framework v ON v.role_id = e.role_id AND v.skill_id = $2 WHERE e.id = $1`, [r.mentee_id, r.skill_id]);
      await q(c, `INSERT INTO development_activities (plan_id, skill_id, title, type, target_level, mentor, status, source) VALUES ($1,$2,$3,'Mentoring',$4,$5,'In progress','manual')`,
        [plan.id, r.skill_id, `Mentoring in ${r.skill_name} with ${r.mentor_name}`, req?.required_level ?? null, r.mentor_name]);
    }
    await audit(c, user, { entity_type: "mentoring", entity_id: r.id, action: b.accept ? "accepted" : "declined", reason: b.note || null });
    return { status: b.accept ? "Accepted" : "Declined" };
  }) },
  { method: "POST", pattern: "/mentoring/:id/close", handler: async ({ db, user, params, body }) => {
    const r = await load(db, user, params.id);
    const b = z.object({ outcome: z.enum(["Cancelled", "Completed"]) }).parse(body);
    if (b.outcome === "Cancelled" && !(r.status === "Requested" && user.employee_id === r.mentee_id) && !(r.status === "Accepted" && [r.mentee_id, r.mentor_id].includes(user.employee_id)))
      throw unprocessable("cannot_cancel", "This request cannot be cancelled now");
    if (b.outcome === "Completed" && (r.status !== "Accepted" || ![r.mentee_id, r.mentor_id].includes(user.employee_id))) throw unprocessable("cannot_complete", "Only an accepted pairing can be completed, by the mentor or mentee");
    const upd = await one(db, `UPDATE mentoring_requests SET status = $2, completed_at = now() WHERE id = $1 AND status = $3 RETURNING id`, [r.id, b.outcome, r.status]);
    if (!upd) throw conflict("changed", "This pairing changed a moment ago. Reload the page");
    await audit(db, user, { entity_type: "mentoring", entity_id: r.id, action: b.outcome.toLowerCase() });
    return { status: b.outcome };
  } },
  { method: "GET", pattern: "/mentoring/:id/sessions", handler: async ({ db, user, params }) => {
    const r = await load(db, user, params.id);
    return q(db, `SELECT id, held_on, minutes, notes, created_by, created_at FROM mentoring_sessions WHERE request_id = $1 ORDER BY held_on DESC, id DESC`, [r.id]);
  } },
  { method: "POST", pattern: "/mentoring/:id/sessions", handler: async ({ db, user, params, body }) => {
    const r = await load(db, user, params.id);
    if (r.status !== "Accepted" || ![r.mentee_id, r.mentor_id].includes(user.employee_id)) throw unprocessable("not_active", "Sessions are logged on an accepted pairing by the mentor or mentee");
    const b = z.object({ held_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.coerce.number().int().min(5).max(600).optional(), notes: z.string().trim().max(2000).default("") }).parse(body);
    if (isNaN(Date.parse(b.held_on)) || b.held_on > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) throw unprocessable("bad_date", "Use the date the session took place");
    const s = await one(db, `INSERT INTO mentoring_sessions (request_id, held_on, minutes, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [r.id, b.held_on, b.minutes ?? null, b.notes, user.name]);
    return s;
  } },
];
