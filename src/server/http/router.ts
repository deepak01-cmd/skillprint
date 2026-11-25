import { ZodError, ZodSchema } from "zod";
import { ApiError, bad } from "../errors";
import { User } from "../permissions";
import { pool, Db } from "../db";

export interface Ctx {
  user: User;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  db: Db;
  meta: { ip?: string; ua?: string };
}
export type Handler = (ctx: Ctx) => Promise<unknown>;
export interface Route { method: string; pattern: string; handler: Handler; public?: boolean; }

const compiled: { method: string; re: RegExp; keys: string[]; route: Route }[] = [];
export function register(routes: Route[]) {
  for (const r of routes) {
    const keys: string[] = [];
    const re = new RegExp("^" + r.pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    compiled.push({ method: r.method, re, keys, route: r });
  }
}
export function match(method: string, path: string) {
  for (const c of compiled) {
    if (c.method !== method) continue;
    const m = c.re.exec(path);
    if (m) {
      try { return { route: c.route, params: Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
      catch { return null; } // malformed %-encoding
    }
  }
  return null;
}

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  try { return schema.parse(data); }
  catch (e) {
    if (e instanceof ZodError) throw bad(e.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "validation_failed", e.issues);
    throw e;
  }
}

const ALLOWED_BEFORE_CHANGE = new Set(["GET /auth/me", "POST /auth/password", "POST /auth/logout"]);

/** Call a route in-process: used by the HTTP adapter and by the test suite. */
export async function dispatch(method: string, path: string, user: User | null, opts: { query?: URLSearchParams; body?: any; db?: Db; meta?: Ctx["meta"] } = {}): Promise<{ status: number; body: any }> {
  const m = match(method, path);
  if (!m) return { status: 404, body: { error: "not_found", message: `No route ${method} ${path}` } };
  if (!m.route.public && !user) return { status: 401, body: { error: "unauthenticated", message: "Sign in first" } };
  // a temporary password must be replaced before anything else
  if (user?.must_change_password && !m.route.public && !ALLOWED_BEFORE_CHANGE.has(`${method} ${m.route.pattern}`))
    return { status: 403, body: { error: "password_change_required", message: "Choose a new password first" } };
  const body = opts.body && typeof opts.body === "object" && !Array.isArray(opts.body) ? opts.body : {};
  try {
    const data = await m.route.handler({ user: user as User, params: m.params, query: opts.query ?? new URLSearchParams(), body, db: opts.db ?? pool(), meta: opts.meta ?? {} });
    return { status: 200, body: data ?? { ok: true } };
  } catch (e: any) {
    if (e instanceof ApiError) return { status: e.status, body: { error: e.code, message: e.message, details: e.details } };
    if (e instanceof ZodError) return { status: 400, body: { error: "validation_failed", message: e.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), details: e.issues } };
    if (["22P02", "22007", "22008", "22003", "22001", "22023"].includes(e?.code)) return { status: 400, body: { error: "invalid_value", message: "A value has the wrong format or is too long" } };
    if (e?.code === "23505") return { status: 409, body: { error: "duplicate", message: e.detail || "That record already exists" } };
    if (e?.code === "23514") return { status: 422, body: { error: "constraint_violation", message: `Rule ${e.constraint} rejected the change` } };
    if (e?.code === "23503") return { status: 409, body: { error: "reference_conflict", message: "The record is referenced elsewhere or a reference is missing" } };
    console.error(e);
    return { status: 500, body: { error: "server_error", message: "Something went wrong. The error was logged." } };
  }
}
