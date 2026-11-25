/* Sign-in, sessions, passwords and user accounts. Every account belongs to one organisation (platform admins to none);
   a session only works while the account is active and its organisation is not suspended. */
import { z } from "zod";
import { Db, one, q } from "../db";
import { audit } from "../audit";
import { ApiError, forbidden, notFound, unprocessable } from "../errors";
import { permissionsOf, ROLE_LABEL } from "../permissions";
import { orgOf } from "../scope";
import { Route } from "../http/router";
import { burnPasswordCheck, checkPassword, createSession, hashPassword, loadUser, passwordProblem, revokeSessions, temporaryPassword } from "../auth";

const MAX_FAILED = 5, LOCK_MINUTES = 15;
// per-address limit on failed sign-ins, on top of the per-account lock
const byIp = new Map<string, { n: number; until: number }>();
function ipBlocked(ip = "local") { const r = byIp.get(ip); return !!r && r.until > Date.now() && r.n >= 30; }
function ipFailed(ip = "local") {
  const r = byIp.get(ip); const now = Date.now();
  if (!r || r.until < now) byIp.set(ip, { n: 1, until: now + 10 * 60_000 }); else r.n++;
  if (byIp.size > 10_000) for (const [k, v] of byIp) if (v.until < now) byIp.delete(k);
}

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
const ROLES = ["hr_admin", "dept_head", "manager", "employee", "expert"] as const;

async function userInOrg(db: Db, orgId: string, id: string) {
  const u = await one(db, `SELECT id, org_id, email, name, role, active FROM users WHERE id = $1 AND org_id = $2`, [id, orgId]);
  if (!u) throw notFound("User");
  return u;
}

export const routes: Route[] = [
  { method: "POST", pattern: "/auth/login", public: true, handler: async ({ body, db, meta }) => {
    const b = loginSchema.parse(body);
    if (ipBlocked(meta.ip)) throw new ApiError(429, "too_many_attempts", "Too many attempts from this network. Try again in a few minutes");
    const u = await one(db, `SELECT u.*, o.status AS org_status FROM users u LEFT JOIN organisations o ON o.id = u.org_id WHERE lower(u.email) = lower($1)`, [b.email]);
    if (!u) { await burnPasswordCheck(b.password); ipFailed(meta.ip); throw new ApiError(401, "invalid_credentials", "Email or password is incorrect"); }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
      throw new ApiError(429, "account_locked", `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}`);
    }
    if (!u.active || !(await checkPassword(b.password, u.password_hash))) {
      ipFailed(meta.ip);
      const n = u.failed_logins + 1;
      await q(db, `UPDATE users SET failed_logins = $2::int, locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) END WHERE id = $1`, [u.id, n >= MAX_FAILED ? 0 : n, n >= MAX_FAILED, LOCK_MINUTES]);
      if (n >= MAX_FAILED) await audit(db, { id: u.id, name: u.name, org_id: u.org_id }, { entity_type: "user", entity_id: u.id, action: "locked" });
      throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
    }
    if (u.org_status === "Suspended") throw new ApiError(403, "organisation_suspended", "Your organisation's access is suspended");
    await q(db, `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
    await audit(db, { id: u.id, name: u.name, org_id: u.org_id }, { entity_type: "user", entity_id: u.id, action: "login" });
    return { token: await createSession(u.id, db, meta), user: await loadUser(db, u.id), must_change_password: u.must_change_password };
  } },
  { method: "POST", pattern: "/auth/logout", public: true, handler: async ({ user, db }) => {
    if (user?.session_id) await q(db, `UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, [user.session_id]);
    return { ok: true };
  } },
  { method: "GET", pattern: "/auth/me", handler: async ({ user, db }) => {
    const org = user.org_id ? await one(db, `SELECT id, name, industry, domain FROM organisations WHERE id = $1`, [user.org_id]) : null;
    return { user, role_label: ROLE_LABEL[user.role], organisation: org, permissions: permissionsOf(user) };
  } },
  { method: "POST", pattern: "/auth/password", handler: async ({ user, db, body }) => {
    const b = z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }).parse(body);
    const row = await one(db, `SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!row || !(await checkPassword(b.current, row.password_hash))) throw unprocessable("wrong_password", "Your current password is not correct");
    const problem = passwordProblem(b.next); if (problem) throw unprocessable("weak_password", problem);
    if (b.next === b.current) throw unprocessable("same_password", "Choose a password different from the current one");
    await q(db, `UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE id = $1`, [user.id, await hashPassword(b.next)]);
    await revokeSessions(db, user.id, user.session_id);
    await audit(db, user, { entity_type: "user", entity_id: user.id, action: "password_changed" });
    return { ok: true };
  } },
  { method: "GET", pattern: "/auth/sessions", handler: async ({ user, db }) =>
    (await q(db, `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 20`, [user.id]))
      .map(s => ({ ...s, current: s.id === user.session_id })) },
  { method: "POST", pattern: "/auth/sessions/revoke-others", handler: async ({ user, db }) => {
    await revokeSessions(db, user.id, user.session_id);
    await audit(db, user, { entity_type: "user", entity_id: user.id, action: "signed_out_other_sessions" });
    return { ok: true };
  } },
  { method: "GET", pattern: "/health", public: true, handler: async ({ db }) => {
    const r = await one(db, `SELECT (SELECT count(*) FROM organisations)::int AS organisations, (SELECT count(*) FROM job_postings)::int AS job_postings`);
    return { status: "ok", ...r };
  } },
  { method: "GET", pattern: "/auth/demo-accounts", public: true, handler: async ({ db }) => {
    // the list of demo accounts on the sign-in page; hidden on a public server (SHOW_DEMO_LOGINS=false) even when demo data is kept
    if (process.env.DEMO_MODE === "false" || process.env.SHOW_DEMO_LOGINS === "false") return [];
    return q(db, `SELECT u.email, u.name, u.role, o.name AS organisation, d.name AS department FROM users u LEFT JOIN organisations o ON o.id = u.org_id LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.email LIKE '%.demo' AND u.active ORDER BY o.name NULLS FIRST, array_position(ARRAY['hr_admin','dept_head','manager','employee','expert'], u.role), u.email`);
  } },

  /* ---------- user accounts (HR administrators, own organisation only) ---------- */
  { method: "GET", pattern: "/users", handler: async ({ user, db, query }) => {
    if (user.role !== "hr_admin") throw forbidden();
    const text = (query.get("q") || "").trim().toLowerCase().slice(0, 100);
    return q(db, `SELECT u.id, u.email, u.name, u.role, u.active, u.department_id, d.name AS department_name, u.last_login_at, u.must_change_password,
        (u.locked_until > now()) AS locked, e.id AS employee_id
      FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.org_id = $1 AND ($2 = '' OR lower(u.name) LIKE '%' || $2 || '%' OR lower(u.email) LIKE '%' || $2 || '%') ORDER BY u.active DESC, u.name LIMIT 500`, [orgOf(user), text]);
  } },
  { method: "PATCH", pattern: "/users/:id", handler: async ({ user, db, params, body }) => {
    if (user.role !== "hr_admin") throw forbidden();
    const b = z.object({ active: z.boolean().optional(), role: z.enum(ROLES).optional(), department_id: z.string().max(40).nullable().optional() }).parse(body);
    const t = await userInOrg(db, orgOf(user), params.id);
    if (t.id === user.id && (b.active === false || (b.role && b.role !== "hr_admin"))) throw unprocessable("own_account", "You cannot deactivate or demote your own account");
    if (b.department_id && !(await one(db, `SELECT 1 FROM departments WHERE id = $1 AND org_id = $2`, [b.department_id, orgOf(user)]))) throw unprocessable("unknown_department", "Unknown department");
    if ((b.active === false || (b.role && b.role !== "hr_admin")) && t.role === "hr_admin") {
      const others = await one(db, `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'hr_admin' AND active AND id <> $2`, [orgOf(user), t.id]);
      if (!others?.n) throw unprocessable("last_admin", "The organisation needs at least one active HR administrator");
    }
    const after = await one(db, `UPDATE users SET active = coalesce($2, active), role = coalesce($3, role), department_id = CASE WHEN $4 THEN $5 ELSE department_id END WHERE id = $1 RETURNING id, email, name, role, active, department_id`,
      [t.id, b.active ?? null, b.role ?? null, b.department_id !== undefined, b.department_id ?? null]);
    if (b.active === false || b.role) await revokeSessions(db, t.id);
    await audit(db, user, { entity_type: "user", entity_id: t.id, action: "updated", before: { active: t.active, role: t.role }, after: b });
    return after;
  } },
  { method: "POST", pattern: "/users/:id/reset-password", handler: async ({ user, db, params }) => {
    if (user.role !== "hr_admin") throw forbidden();
    const t = await userInOrg(db, orgOf(user), params.id);
    if (t.id === user.id) throw unprocessable("own_account", "Change your own password from your account page");
    const temp = temporaryPassword();
    await q(db, `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [t.id, await hashPassword(temp)]);
    await revokeSessions(db, t.id);
    await audit(db, user, { entity_type: "user", entity_id: t.id, action: "password_reset" });
    return { temporary_password: temp, email: t.email };
  } },
  { method: "POST", pattern: "/users/:id/unlock", handler: async ({ user, db, params }) => {
    if (user.role !== "hr_admin") throw forbidden();
    const t = await userInOrg(db, orgOf(user), params.id);
    await q(db, `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [t.id]);
    await audit(db, user, { entity_type: "user", entity_id: t.id, action: "unlocked" });
    return { ok: true };
  } },
];
