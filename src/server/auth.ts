import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { Db, one, pool, q } from "./db";
import { User } from "./permissions";

export const SESSION_COOKIE = "rsip_session";
export const SESSION_HOURS = 12;
const DEV_SECRET = "dev-only-secret-change-me-dev-only-secret";
let runtimeSecret: string | null = null;
/** A weak or missing secret is never used in production: a random one is made instead (sessions then end on restart). */
function secretValue() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32 && s !== DEV_SECRET) return s;
  if (process.env.NODE_ENV !== "production") return s || DEV_SECRET;
  if (!runtimeSecret) { runtimeSecret = randomBytes(48).toString("hex"); console.warn("SESSION_SECRET is missing or shorter than 32 characters; using a random secret for this run."); }
  return runtimeSecret;
}
const secret = () => new TextEncoder().encode(secretValue());

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);
// compared against when the email is unknown, so a wrong email takes as long as a wrong password
let dummyHash: Promise<string> | null = null;
export const burnPasswordCheck = async (p: string) => bcrypt.compare(p, await (dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), 10))).catch(() => false);

/** Password rule: 10–200 characters with at least one letter and one digit. */
export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters";
  if (p.length > 200) return "Use at most 200 characters";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use at least one letter and one number";
  return null;
}
export function temporaryPassword() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"; const d = "23456789";
  const b = randomBytes(12); let s = "";
  for (let i = 0; i < 10; i++) s += a[b[i] % a.length];
  return s + d[b[10] % d.length] + d[b[11] % d.length];
}

/** Starts a server-side session and returns its signed token. */
export async function createSession(userId: string, db: Db = pool(), meta: { ip?: string; ua?: string } = {}): Promise<string> {
  const sid = randomUUID();
  await q(db, `INSERT INTO user_sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + make_interval(hours => $3), $4, $5)`,
    [sid, userId, SESSION_HOURS, meta.ip?.slice(0, 64) || null, meta.ua?.slice(0, 300) || null]);
  return new SignJWT({ sub: userId, sid }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${SESSION_HOURS}h`).sign(secret());
}

/** The signed-in user, only while the session is live, the account active and the organisation not suspended. */
export async function userFromToken(token: string | undefined, db: Db = pool()): Promise<User | null> {
  if (!token || token.length > 2000) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sid || !payload.sub) return null;
    const u = await one<User & { last_seen_at: string }>(db, `
      SELECT u.id, u.org_id, u.email, u.name, u.role, u.department_id, u.job_family_scope, u.library_reviewer, u.must_change_password, e.id AS employee_id,
             s.id AS session_id, s.last_seen_at
      FROM user_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN organisations o ON o.id = u.org_id LEFT JOIN employees e ON e.user_id = u.id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active AND coalesce(o.status, 'Active') <> 'Suspended'`,
      [String(payload.sid), String(payload.sub)]);
    if (!u) return null;
    if (Date.now() - new Date(u.last_seen_at).getTime() > 5 * 60_000) q(db, `UPDATE user_sessions SET last_seen_at = now() WHERE id = $1`, [u.session_id]).catch(() => {});
    const { last_seen_at, ...user } = u;
    return user;
  } catch { return null; }
}

export async function revokeSessions(db: Db, userId: string, exceptId?: string | null) {
  await q(db, `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> coalesce($2, '')`, [userId, exceptId ?? null]);
}

export async function loadUser(db: Db, id: string): Promise<User | null> {
  return one<User>(db, `
    SELECT u.id, u.org_id, u.email, u.name, u.role, u.department_id, u.job_family_scope, u.library_reviewer, u.must_change_password, e.id AS employee_id
    FROM users u LEFT JOIN employees e ON e.user_id = u.id
    WHERE u.id = $1 AND u.active`, [id]);
}
