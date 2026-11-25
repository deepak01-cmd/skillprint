/* Role-based access (PRD Section 3 and 27). Permissions are checked in services, never only in the UI. */
export type RoleName = "platform_admin" | "hr_admin" | "dept_head" | "manager" | "employee" | "expert";

export interface User {
  id: string; org_id: string | null; email: string; name: string; role: RoleName;
  department_id: string | null; job_family_scope: string[]; employee_id: string | null; library_reviewer?: boolean;
  session_id?: string; must_change_password?: boolean;
}

export const ROLE_LABEL: Record<RoleName, string> = {
  platform_admin: "Platform administrator", hr_admin: "HR administrator", dept_head: "Department head",
  manager: "Manager", employee: "Employee", expert: "Expert reviewer",
};

// Scope of a permission: org = whole organisation, dept = own department, team = direct reports, self = own records.
export type Scope = "platform" | "org" | "dept" | "team" | "self" | "assigned";

const P: Record<string, Partial<Record<RoleName, Scope>>> = {
  "platform:manage":        { platform_admin: "platform" },
  "global_skills:write":    { platform_admin: "platform" },
  "org:manage":             { hr_admin: "org" },
  "org:read":               { hr_admin: "org", dept_head: "org", manager: "org", employee: "org", expert: "org" },
  "roles:write":            { hr_admin: "org", dept_head: "dept" },          // dept heads create drafts for their department
  "roles:read":             { hr_admin: "org", dept_head: "org", manager: "org", employee: "org", expert: "org" },
  "framework:read":         { hr_admin: "org", dept_head: "org", manager: "team", employee: "self", expert: "assigned" },
  "framework:draft":        { hr_admin: "org", dept_head: "dept" },
  "archive:read":           { hr_admin: "org", dept_head: "dept" },
  "archive:write":          { hr_admin: "org", dept_head: "dept" },          // dept head: propose only (see governance)
  "archive:export":         { hr_admin: "org" },
  "approve":                { hr_admin: "org" },
  "audit:read":             { hr_admin: "org", dept_head: "dept" },
  "skills:write":           { hr_admin: "org" },
  "proficiency:write":      { hr_admin: "org" },
  "employees:manage":       { hr_admin: "org" },
  "employees:read":         { hr_admin: "org", dept_head: "dept", manager: "team", employee: "self" },
  "assessments:assign":     { hr_admin: "org", manager: "team" },
  "assessments:review":     { hr_admin: "org", manager: "team", expert: "assigned" },
  "gaps:read":              { hr_admin: "org", dept_head: "dept", manager: "team", employee: "self" },
  "development:write":      { hr_admin: "org", manager: "team", employee: "self" },
  "paths:write":            { hr_admin: "org", dept_head: "dept" },
  "paths:read":             { hr_admin: "org", dept_head: "org", manager: "org", employee: "org", expert: "org" },
  "mobility:read":          { hr_admin: "org", dept_head: "dept", manager: "team", employee: "self" },
  "planning:write":         { hr_admin: "org", dept_head: "dept" },
  "planning:read":          { hr_admin: "org", dept_head: "dept", manager: "team" },
  "evolution:manage":       { hr_admin: "org" },
  "evolution:review":       { hr_admin: "org", dept_head: "dept", expert: "assigned" },
  "evidence:write":         { hr_admin: "org", expert: "assigned" },
  "dashboard:org":          { hr_admin: "org", dept_head: "dept", manager: "team" },
};

export function scopeOf(u: User, perm: string): Scope | null {
  return P[perm]?.[u.role] ?? null;
}
export function has(u: User, perm: string): boolean { return scopeOf(u, perm) !== null; }
export function permissionsOf(u: User): Record<string, Scope> {
  const out: Record<string, Scope> = {};
  for (const k of Object.keys(P)) { const s = scopeOf(u, k); if (s) out[k] = s; }
  return out;
}

/** Minimum group size for aggregated people data (PRD 27). */
export const MIN_GROUP = 5;
