import { Db, one, q } from "./db";
import { forbidden, notFound } from "./errors";
import { has, scopeOf, User } from "./permissions";

export function orgOf(u: User): string {
  if (!u.org_id) throw forbidden("This action belongs to an organisation user");
  return u.org_id;
}

export interface RoleRow {
  id: string; org_id: string; department_id: string; job_family_id: string | null; title: string;
  status: string; industry: string; career_level_id: string | null;
}

/** Load a role in the caller's organisation. Another tenant's role reads as not found. */
export async function roleInOrg(db: Db, u: User, roleId: string): Promise<RoleRow> {
  const r = await one<RoleRow>(db,
    `SELECT id, org_id, department_id, job_family_id, title, status, industry, career_level_id FROM job_roles WHERE id = $1 AND org_id = $2`,
    [roleId, orgOf(u)]);
  if (!r) throw notFound("Role");
  return r;
}

/** Roles held by the manager's direct reports, plus the manager's own role. */
export async function teamRoleIds(db: Db, u: User): Promise<string[]> {
  if (!u.employee_id) return [];
  const rows = await q(db, `SELECT DISTINCT role_id FROM employees WHERE (manager_id = $1 OR id = $1) AND status = 'Active'`, [u.employee_id]);
  return rows.map(r => r.role_id);
}
export async function ownRoleId(db: Db, u: User): Promise<string | null> {
  if (!u.employee_id) return null;
  return (await one(db, `SELECT role_id FROM employees WHERE id = $1`, [u.employee_id]))?.role_id ?? null;
}

/** Can the user read this role's framework (PRD 27 table)? */
export async function canReadFramework(db: Db, u: User, role: RoleRow): Promise<boolean> {
  const s = scopeOf(u, "framework:read");
  if (!s || role.org_id !== u.org_id) return false;
  if (s === "org") return true;
  if (s === "team") return (await teamRoleIds(db, u)).includes(role.id);
  if (s === "self") return (await ownRoleId(db, u)) === role.id;
  if (s === "assigned") return !!role.job_family_id && u.job_family_scope.includes(role.job_family_id);
  return false;
}
export async function assertReadFramework(db: Db, u: User, roleId: string) {
  const role = await roleInOrg(db, u, roleId);
  if (!(await canReadFramework(db, u, role))) throw forbidden("You do not have access to this role's framework");
  return role;
}

/** Department-scoped permissions: org scope covers every role, dept scope covers the user's department. */
export function inDeptScope(u: User, perm: string, departmentId: string): boolean {
  const s = scopeOf(u, perm);
  return s === "org" || (s === "dept" && u.department_id === departmentId);
}
export function assertDeptScope(u: User, perm: string, departmentId: string, msg?: string) {
  if (!inDeptScope(u, perm, departmentId)) throw forbidden(msg);
}

/** SQL condition limiting employees (alias e) to the caller's scope for a permission. */
export function employeeScopeSql(u: User, perm: string, startIndex: number): [string, unknown[]] {
  const s = scopeOf(u, perm);
  const i = startIndex;
  switch (s) {
    case "org": return [`e.org_id = $${i}`, [u.org_id]];
    case "dept": return [`e.org_id = $${i} AND e.department_id = $${i + 1}`, [u.org_id, u.department_id]];
    case "team": return [`e.org_id = $${i} AND (e.manager_id = $${i + 1} OR e.id = $${i + 1})`, [u.org_id, u.employee_id]];
    case "self": return [`e.id = $${i}`, [u.employee_id]];
    default: return ["false", []];
  }
}

export async function employeeInScope(db: Db, u: User, perm: string, employeeId: string) {
  const [cond, params] = employeeScopeSql(u, perm, 2);
  const e = await one(db, `SELECT e.* FROM employees e WHERE e.id = $1 AND ${cond}`, [employeeId, ...params]);
  if (!e) {
    const exists = await one(db, `SELECT org_id FROM employees WHERE id = $1`, [employeeId]);
    if (!exists || exists.org_id !== u.org_id) throw notFound("Employee");
    throw forbidden("This employee is outside your scope");
  }
  return e;
}

export { has };
