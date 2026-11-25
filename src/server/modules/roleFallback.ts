/* Role fallback: no role title is ever dropped.
   1. Exact title or alternative title  -> matched automatically
   2. Same title written differently    -> matched automatically (abbreviations, spelling, punctuation), only at the same level
   3. Similar existing roles            -> suggested; a person confirms
   4. Role templates (platform library) -> suggested starting profile
   5. Skills named in the title         -> inferred for a new draft
   Anything not matched automatically goes to the role resolution queue with its pending records
   (for example employees from an import), and is created once a person resolves it. */
import { z } from "zod";
import { tokenizeVariants } from "../terms";
import { PoolClient } from "pg";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, scopeOf, User } from "../permissions";
import { assertDeptScope, inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { marketMatch } from "./market";

const ABBREV: Record<string, string> = {
  sr: "senior", snr: "senior", jr: "junior", jnr: "junior", eng: "engineer", engr: "engineer", engg: "engineer", dev: "developer", devs: "developer",
  mgr: "manager", mngr: "manager", mgmt: "management", assoc: "associate", asst: "assistant", admin: "administrator", spec: "specialist",
  analyt: "analyst", ops: "operations", qa: "qa", ml: "machine learning", ai: "ai", bi: "business intelligence", sw: "software", "s/w": "software", hr: "hr", it: "it",
  fullstack: "full stack", "full-stack": "full stack", frontend: "frontend", "front-end": "frontend", "front end": "frontend", backend: "backend", "back-end": "backend", "back end": "backend",
  // common job-title abbreviations, all industries
  sde: "software development engineer", swe: "software engineer", sre: "site reliability engineer", sdet: "software development engineer in test", mle: "machine learning engineer",
  dba: "database administrator", sysadmin: "system administrator", "sys admin": "system administrator", netops: "network operations", secops: "security operations",
  rn: "registered nurse", lpn: "licensed practical nurse", lvn: "licensed vocational nurse", cna: "certified nursing assistant", np: "nurse practitioner",
  csr: "customer service representative", rep: "representative", reps: "representative", cust: "customer", svc: "service", sdr: "sales development representative",
  bdr: "business development representative", bde: "business development executive", bdm: "business development manager", ae: "account executive",
  hrbp: "hr business partner", "human resources": "hr", acct: "accountant", accts: "accountant", cpa: "certified public accountant", fp: "financial planning",
  vp: "vice president", svp: "senior vice president", avp: "assistant vice president", evp: "executive vice president", gm: "general manager", agm: "assistant general manager", dgm: "deputy general manager",
  dir: "director", exec: "executive", execs: "executive", coord: "coordinator", mktg: "marketing", mkt: "marketing", ba: "business analyst", "sales dev": "sales development",
  tpm: "technical program manager", pmo: "project management office", ux: "ux", ui: "ui", "qa/qc": "quality", qc: "quality control", ehs: "environment health safety", hse: "health safety environment",
};
const SENIORITY = new Set(["junior", "senior", "lead", "principal", "staff", "associate", "trainee", "intern", "graduate", "entry", "level", "mid", "i", "ii", "iii", "iv", "v", "1", "2", "3", "4"]);
const SENIORITY_RANK: Record<string, number> = { intern: 1, trainee: 1, graduate: 1, junior: 1, associate: 2, mid: 3, senior: 4, staff: 4, lead: 5, principal: 5 };

/** Comparison key for a normalised title: spaces and hyphens ignored ("e commerce manager" = "ecommerce manager"). */
export const titleKey = (core: string) => core.replace(/[\s-]+/g, "");
/** Looser key for variants of one title: "engineer" and "developer" count as the same word, and a lead title may leave it out
    ("Backend Lead" = "Lead Backend Developer" = "Backend Engineering Lead"). The level must still match (sameLevel). */
export const variantKey = (core: string) => core.split(" ").map(t => t === "engineer" || t === "engineering" || t === "development" ? "developer" : t).filter(t => t !== "developer").join("");
/** Level of a title from its words: junior 1, associate 2, none = mid-level 3, senior 4, lead / principal 5. */
export const titleRank = (title: string) => normalizeTitle(title).level_rank ?? 3;
/** Two titles are the same role only at the same level: a senior or lead role is never matched to a mid-level one, or the reverse. */
export const sameRole = (a: string, b: string) => {
  const x = normalizeTitle(a), y = normalizeTitle(b);
  if (!x.core || !y.core || (x.level_rank ?? 3) !== (y.level_rank ?? 3)) return false;
  return titleKey(x.core) === titleKey(y.core) || (variantKey(x.core).length > 2 && variantKey(x.core) === variantKey(y.core));
};
export function normalizeTitle(raw: string): { core: string; seniority: string | null; level_rank: number | null } {
  // spelling variants first: "Dot Net", "dotnet" and ".NET" all become one word, so they compare equal
  let s = tokenizeVariants(raw.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[–—]/g, "-").split(/\s-\s|\s\|\s/)[0].replace(/,/g, " "));
  for (const [k, v] of Object.entries(ABBREV)) if (k.includes(" ") || k.includes("-")) s = s.replace(new RegExp(`(?<![a-z0-9])${k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![a-z0-9])`, "g"), v);
  const tokens = s.replace(/[^a-z0-9/+# ]+/g, " ").split(/\s+/).filter(Boolean).map(t => ABBREV[t] ?? t).join(" ").split(" ");
  const found = tokens.find(t => SENIORITY_RANK[t]);
  const core = tokens.filter(t => !SENIORITY.has(t)).join(" ").trim();
  return { core, seniority: found ?? null, level_rank: found ? SENIORITY_RANK[found] : null };
}

export async function resolveRoleTitle(db: Db, orgId: string, title: string, departmentId?: string | null) {
  const raw = title.trim();
  const n = normalizeTitle(raw);
  const roles = await q(db, `SELECT r.id, r.title, r.alt_titles, r.status, r.department_id, d.name AS department_name FROM job_roles r JOIN departments d ON d.id = r.department_id
    WHERE r.org_id = $1 AND r.status <> 'Archived'`, [orgId]);
  const prefer = (list: any[]) => list.sort((a, b) => (b.status === "Published" ? 1 : 0) - (a.status === "Published" ? 1 : 0) || (departmentId && a.department_id === departmentId ? -1 : 0));
  const exact = prefer(roles.filter(r => [r.title, ...(r.alt_titles || [])].some((t: string) => t.toLowerCase() === raw.toLowerCase())));
  const pick = (r: any) => ({ id: r.id, title: r.title, status: r.status, department_name: r.department_name });
  if (exact.length && (exact.length === 1 || departmentId)) return { status: "matched" as const, method: "exact", role: pick(exact[0]), normalized: n.core, seniority: n.seniority, candidates: [], templates: [], inferred_skills: [] };
  // same title written differently, at the same level (".net dev" = ".NET Developer"; "Backend Lead" is not "Backend Developer")
  const norm = prefer(roles.filter(r => [r.title, ...(r.alt_titles || [])].some((t: string) => sameRole(t, raw))));
  const qRank = n.level_rank ?? 3;
  const sameDept = departmentId ? norm.filter(r => r.department_id === departmentId) : norm;
  if (sameDept.length === 1 || (norm.length === 1 && !departmentId)) {
    const r = sameDept[0] ?? norm[0];
    return { status: "matched" as const, method: "normalized", role: pick(r), normalized: n.core, seniority: n.seniority, candidates: [], templates: [], inferred_skills: [],
      note: raw.toLowerCase() !== r.title.toLowerCase() ? `"${raw}" is another way of writing ${r.title}.` : undefined };
  }
  const sim = await q(db, `SELECT r.id, r.title, r.status, d.name AS department_name,
      greatest(similarity(lower(r.title), $2), coalesce((SELECT max(similarity(lower(a), $2)) FROM unnest(r.alt_titles) a), 0)) AS score
    FROM job_roles r JOIN departments d ON d.id = r.department_id WHERE r.org_id = $1 AND r.status <> 'Archived' ORDER BY score DESC LIMIT 15`, [orgId, raw.toLowerCase()]);
  const candidates = [...exact, ...norm].map(r => ({ ...pick(r), score: 1, why: "Same title after normalisation; more than one role matches" }))
    // close matches stay at the same level: no lower-level role for a senior title, or the reverse
    .concat(sim.filter(s => Number(s.score) >= 0.3 && titleRank(s.title) === qRank && !exact.concat(norm).some(e => e.id === s.id)).map(s => ({ id: s.id, title: s.title, status: s.status, department_name: s.department_name, score: Math.round(Number(s.score) * 100) / 100, why: "Similar title at the same level" })));
  const templates = (await q(db, `SELECT id, title, industry, job_family, jsonb_array_length(skills) AS skills, source,
      greatest(similarity(lower(title), $1), coalesce((SELECT max(similarity(lower(a), $1)) FROM unnest(aliases) a), 0)) AS score
    FROM role_templates ORDER BY score DESC LIMIT 5`, [n.core || raw.toLowerCase()])).filter(t => Number(t.score) >= 0.3).map(t => ({ ...t, score: Math.round(Number(t.score) * 100) / 100 }));
  const skills = await q(db, `SELECT id, name, aliases FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const lower = ` ${raw.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ")} `;
  const inferred = skills.filter(s => [s.name, ...(s.aliases || [])].some((t: string) => { const x = t.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim(); return x.length >= 2 && lower.includes(` ${x} `); }))
    .map(s => ({ skill_id: s.id, name: s.name }));
  // Market titles from imported job postings: how often the title appears and what skills those postings mention
  const mm = await marketMatch(db, [raw]).catch(() => ({ exact: [], similar: [] }));
  const market = [...mm.exact.map((x: any) => ({ normalized_title: x.normalized_title, display_title: x.display_title, postings: x.postings, companies: x.companies, score: 1,
      top_skills: (x.skill_profile || []).slice(0, 6).map((s: any) => ({ skill_id: s.skill_id, name: s.name, share: Number(s.share) })) })),
    ...mm.similar.slice(0, 3).map((x: any) => ({ normalized_title: x.normalized_title, display_title: x.display_title, postings: x.postings, companies: x.companies, score: Number(x.score), top_skills: [] }))];
  return { status: "unresolved" as const, method: null, role: null, normalized: n.core, seniority: n.seniority, candidates, templates, inferred_skills: inferred, market };
}

/** Put an unknown title in the queue (or add to the open item for the same normalised title). */
export async function enqueue(db: Db, orgId: string, title: string, departmentId: string | null, source: string, pending: any[], suggestions: any) {
  const norm = normalizeTitle(title).core || title.toLowerCase();
  const existing = await one(db, `SELECT id FROM role_resolution_queue WHERE org_id = $1 AND normalized = $2 AND status IN ('Open','Role drafted')`, [orgId, norm]);
  if (existing) {
    await q(db, `UPDATE role_resolution_queue SET occurrences = occurrences + 1, pending_records = pending_records || $2::jsonb, suggestions = $3 WHERE id = $1`, [existing.id, JSON.stringify(pending), JSON.stringify(suggestions)]);
    return existing.id as string;
  }
  return (await one(db, `INSERT INTO role_resolution_queue (org_id, raw_title, normalized, department_id, source, pending_records, suggestions) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orgId, title.trim(), norm, departmentId, source, JSON.stringify(pending), JSON.stringify(suggestions)]))!.id;
}

/** Create the employees that were waiting for a role. */
async function releasePending(c: PoolClient, item: any, roleId: string, actorName: string) {
  let created = 0; const skipped: string[] = [];
  for (const p of item.pending_records || []) {
    if (p.kind !== "employee") continue;
    const dup = await one(c, `SELECT 1 FROM employees WHERE org_id = $1 AND lower(email) = lower($2)`, [item.org_id, p.email]);
    if (dup) { skipped.push(`${p.email} already exists`); continue; }
    await q(c, `INSERT INTO employees (org_id, name, email, department_id, role_id, manager_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [item.org_id, p.name, p.email.toLowerCase(), p.department_id || item.department_id, roleId, p.manager_id || null]);
    created++;
  }
  await audit(c, { id: null, name: actorName, org_id: item.org_id }, { entity_type: "role_queue", entity_id: item.id, action: "pending_released", after: { role_id: roleId, created, skipped } });
  return { created, skipped };
}

/** Called when a role is published: anything waiting for it is released. */
export async function onRolePublished(c: PoolClient, orgId: string, roleId: string, actorName: string) {
  const items = await q(c, `SELECT * FROM role_resolution_queue WHERE org_id = $1 AND resolved_role_id = $2 AND status = 'Role drafted'`, [orgId, roleId]);
  for (const it of items) {
    await releasePending(c, it, roleId, actorName);
    await q(c, `UPDATE role_resolution_queue SET status = 'Resolved', resolved_at = now() WHERE id = $1`, [it.id]);
  }
}

export async function draftRole(c: PoolClient, u: User, title: string, departmentId: string, alt: string[], skills: { skill_id: string; required_level: number; requirement_type: string; importance: string; skill_trend?: string }[], note: string) {
  const org = await one(c, `SELECT industry FROM organisations WHERE id = $1`, [orgOf(u)]);
  const lvl = await one(c, `SELECT id FROM career_levels WHERE org_id = $1 AND rank = 3`, [orgOf(u)]);
  const r = await one(c, `INSERT INTO job_roles (org_id, department_id, career_level_id, title, alt_titles, summary, industry, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'Draft') RETURNING *`,
    [orgOf(u), departmentId, lvl?.id ?? null, title, alt, note, org.industry]);
  for (const s of skills) {
    const ok = await one(c, `SELECT 1 FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2)`, [s.skill_id, orgOf(u)]);
    if (!ok) continue;
    await q(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, explanation, approval_status, created_by)
      VALUES ($1,'PX-'||$2||'-'||$3,$2,$3,$4,$5,$6,$9,$7,'Draft',$8) ON CONFLICT DO NOTHING`,
      [orgOf(u), r.id, s.skill_id, s.required_level, ["Mandatory", "Preferred", "Optional", "Developmental"].includes(s.requirement_type) ? s.requirement_type : "Optional", s.importance, note, u.name,
       ["Current", "Emerging", "Declining"].includes(s.skill_trend || "") ? s.skill_trend : "Current"]);
  }
  await audit(c, u, { entity_type: "role", entity_id: r.id, action: "created_from_fallback", after: { title, skills: skills.length, note } });
  return r;
}

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), role_id: z.string(), add_alias: z.boolean().default(true) }),
  z.object({ action: z.literal("template"), template_id: z.string(), title: z.string().min(2).optional(), department_id: z.string() }),
  z.object({ action: z.literal("new"), title: z.string().min(2), department_id: z.string() }),
  z.object({ action: z.literal("market"), normalized_title: z.string().min(2), title: z.string().min(2).optional(), department_id: z.string(), min_share: z.coerce.number().min(0.05).max(0.9).default(0.2) }),
  z.object({ action: z.literal("dismiss"), reason: z.string().min(3) }),
]);

export const routes: Route[] = [
  { method: "GET", pattern: "/roles/resolve", handler: async ({ db, user, query }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const t = (query.get("title") || "").trim();
    if (t.length < 2) throw unprocessable("title_required", "Give a role title");
    return resolveRoleTitle(db, orgOf(user), t, query.get("department_id"));
  } },
  { method: "GET", pattern: "/role-templates", handler: async ({ db, user, query }) => {
    if (!has(user, "roles:read") && user.role !== "platform_admin") throw forbidden();
    const t = (query.get("q") || "").toLowerCase();
    return q(db, `SELECT t.*, (SELECT json_agg(json_build_object('skill_id', x->>'skill_id', 'name', s.name, 'required_level', (x->>'required_level')::int, 'requirement_type', x->>'requirement_type'))
        FROM jsonb_array_elements(t.skills) x JOIN skills s ON s.id = x->>'skill_id') AS skill_list
      FROM role_templates t WHERE $1 = '' OR lower(t.title) LIKE '%' || $1 || '%' OR similarity(lower(t.title), $1) > 0.3 ORDER BY t.title LIMIT 100`, [t]);
  } },
  { method: "GET", pattern: "/role-queue", handler: async ({ db, user, query }) => {
    const s = scopeOf(user, "roles:write");
    if (!s) throw forbidden();
    const rows = await q(db, `SELECT q.*, d.name AS department_name, r.title AS resolved_role_title, r.status AS resolved_role_status, jsonb_array_length(q.pending_records) AS pending
      FROM role_resolution_queue q LEFT JOIN departments d ON d.id = q.department_id LEFT JOIN job_roles r ON r.id = q.resolved_role_id
      WHERE q.org_id = $1 AND ($2::text IS NULL OR q.status = $2) ORDER BY (q.status = 'Open') DESC, q.occurrences DESC, q.created_at DESC`, [orgOf(user), query.get("status")]);
    return rows.filter(r => s === "org" || !r.department_id || r.department_id === user.department_id);
  } },
  { method: "POST", pattern: "/role-queue", handler: async ({ user, body }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const b = z.object({ title: z.string().min(2).max(200), department_id: z.string().nullable().optional(), source: z.enum(["search", "manual", "job_description"]).default("manual") }).parse(body);
    return tx(async c => {
      const res = await resolveRoleTitle(c, orgOf(user), b.title, b.department_id);
      if (res.status === "matched") return { status: "exists", role: res.role };
      const id = await enqueue(c, orgOf(user), b.title, b.department_id || null, b.source, [], res);
      await audit(c, user, { entity_type: "role_queue", entity_id: id, action: "requested", after: b });
      return { status: "queued", id };
    });
  } },
  { method: "POST", pattern: "/role-queue/:id/refresh", handler: async ({ db, user, params }) => {
    const it = await one(db, `SELECT * FROM role_resolution_queue WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!it) throw notFound("Queue item");
    const res = await resolveRoleTitle(db, it.org_id, it.raw_title, it.department_id);
    await q(db, `UPDATE role_resolution_queue SET suggestions = $2 WHERE id = $1`, [it.id, JSON.stringify(res)]);
    return res;
  } },
  { method: "POST", pattern: "/role-queue/:id/resolve", handler: async ({ user, params, body }) => {
    const b = parse(resolveSchema, body);
    return tx(async c => {
      const it = await one(c, `SELECT * FROM role_resolution_queue WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgOf(user)]);
      if (!it) throw notFound("Queue item");
      if (!["Open", "Role drafted"].includes(it.status)) throw conflict("not_open", `This item is ${it.status}`);
      if (it.department_id) assertDeptScope(user, "roles:write", it.department_id, "This title belongs to another department");
      else if (!has(user, "roles:write")) throw forbidden();
      if (b.action === "dismiss") {
        if (!has(user, "org:manage")) throw forbidden("Only HR can dismiss a title");
        await q(c, `UPDATE role_resolution_queue SET status = 'Dismissed', resolution = 'dismissed', resolved_by = $2, resolved_at = now(), suggestions = suggestions || jsonb_build_object('dismiss_reason', $3::text) WHERE id = $1`, [it.id, user.name, b.reason]);
        await audit(c, user, { entity_type: "role_queue", entity_id: it.id, action: "dismissed", reason: b.reason });
        return { status: "Dismissed", pending_dropped: (it.pending_records || []).length };
      }
      if (b.action === "map") {
        const r = await one(c, `SELECT * FROM job_roles WHERE id = $1 AND org_id = $2 AND status <> 'Archived' FOR UPDATE`, [b.role_id, it.org_id]);
        if (!r) throw notFound("Role");
        assertDeptScope(user, "roles:write", r.department_id, "You can map titles only to roles in your department");
        // learn: the raw title becomes an alternative title, so the next import matches it automatically
        if (b.add_alias && r.title.toLowerCase() !== it.raw_title.toLowerCase() && !(r.alt_titles || []).some((a: string) => a.toLowerCase() === it.raw_title.toLowerCase()))
          await q(c, `UPDATE job_roles SET alt_titles = array_append(alt_titles, $2), updated_at = now() WHERE id = $1`, [r.id, it.raw_title]);
        let released = { created: 0, skipped: [] as string[] }; let status = "Role drafted";
        if (r.status === "Published") { released = await releasePending(c, it, r.id, user.name); status = "Resolved"; }
        await q(c, `UPDATE role_resolution_queue SET status = $2, resolution = 'mapped_existing', resolved_role_id = $3, resolved_by = $4, resolved_at = CASE WHEN $2 = 'Resolved' THEN now() END WHERE id = $1`, [it.id, status, r.id, user.name]);
        await audit(c, user, { entity_type: "role_queue", entity_id: it.id, action: "mapped", after: { role_id: r.id, alias_added: b.add_alias } });
        return { status, role_id: r.id, employees_created: released.created, skipped: released.skipped };
      }
      assertDeptScope(user, "roles:write", b.department_id, "You can create roles only in your department");
      let r;
      if (b.action === "template") {
        const t = await one(c, `SELECT * FROM role_templates WHERE id = $1`, [b.template_id]);
        if (!t) throw notFound("Template");
        r = await draftRole(c, user, b.title || it.raw_title, b.department_id, b.title && b.title !== it.raw_title ? [it.raw_title] : [], t.skills, `Drafted from template ${t.id} (${t.title}, ${t.source}) for "${it.raw_title}". Review every skill and level before submitting.`);
      } else if (b.action === "market") {
        const cl = await one(c, `SELECT normalized_title, display_title, postings, companies FROM job_title_clusters WHERE normalized_title = $1`, [b.normalized_title]);
        if (!cl) throw notFound("Market title");
        const n = Math.max(1, cl.postings); const minShare = b.min_share ?? 0.2;
        const sk = await q(c, `SELECT sid AS skill_id, count(*)::int AS k FROM global_postings p CROSS JOIN LATERAL unnest(p.skill_ids) sid WHERE p.normalized_title = $1 GROUP BY sid`, [cl.normalized_title]);
        const skills = sk.filter(x => x.k / n >= minShare).map(x => ({ skill_id: x.skill_id, required_level: 3, requirement_type: x.k / n >= 0.5 ? "Mandatory" : "Optional", importance: x.k / n >= 0.5 ? "High" : "Medium" }));
        r = await draftRole(c, user, b.title || it.raw_title, b.department_id, (b.title || it.raw_title) !== it.raw_title ? [it.raw_title] : [], skills,
          `Drafted from ${cl.postings} job postings titled "${cl.display_title}" (${cl.companies} employers). Skills mentioned in at least ${Math.round(minShare * 100)}% of them; levels default to 3. Review before submitting.`);
      } else {
        const inferred = (it.suggestions?.inferred_skills || []).map((s: any) => ({ skill_id: s.skill_id, required_level: 3, requirement_type: "Mandatory", importance: "Medium" }));
        r = await draftRole(c, user, b.title, b.department_id, b.title !== it.raw_title ? [it.raw_title] : [], inferred, `Created for unknown title "${it.raw_title}". ${inferred.length} skill(s) inferred from the title; add the rest before submitting.`);
      }
      await q(c, `UPDATE role_resolution_queue SET status = 'Role drafted', resolution = $2, resolved_role_id = $3, resolved_by = $4, department_id = coalesce(department_id, $5) WHERE id = $1`,
        [it.id, b.action === "template" || b.action === "market" ? "from_template" : "new_role", r.id, user.name, b.department_id]);
      return { status: "Role drafted", role_id: r.id, note: "Pending records are released automatically when the role is published." };
    });
  } },
];
