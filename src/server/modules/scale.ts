/* Growing the data: skills catalogue, re-scan of postings, bulk role templates, job-postings upload,
   and bulk creation of an organisation's draft roles from market titles. */
import { z } from "zod";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { one, q, tx, pool } from "../db";
import { audit } from "../audit";
import { bad, forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { globalSkillCount, loadCatalogue, readCatalogue, rescanPostings } from "../market/catalogue";
import { createSource, ingestBatch, loadMatchers, RawPosting, refreshAggregates } from "../market/ingest";
import { readRows } from "../market/read";
import { pooledProfile } from "./market";
import { applyCandidate, proposeCandidate, twoStep } from "./library";
import { draftRole } from "./roleFallback";

const platformOnly = (u: User) => { if (u.role !== "platform_admin") throw forbidden("Only the platform administrator manages global data"); };

/** Long jobs (re-scan, uploads) run one at a time; their progress is visible on the status endpoint. */
let running: { kind: string; started: string; progress: string; org: string | null } | null = null;
let lastResult: any = null;
async function exclusive<T>(kind: string, f: (progress: (s: string) => void) => Promise<T>, org: string | null = null): Promise<T> {
  if (running) throw unprocessable("busy", `Another data job is running (${running.org === org ? running.progress : "please wait"}). Try again when it finishes.`);
  running = { kind, started: new Date().toISOString(), progress: "starting", org };
  try { const r = await f(s => { if (running) running.progress = s; }); lastResult = { kind, finished: new Date().toISOString(), result: r, org }; return r; }
  catch (e: any) { lastResult = { kind, finished: new Date().toISOString(), error: e.message, org }; throw e; }
  finally { running = null; }
}
/** Starts a long job in the background and answers at once; the screen follows its progress on /data/scale.
    `wait: true` (scripts, tests) waits for the result instead. */
async function background<T>(wait: boolean, kind: string, f: (progress: (s: string) => void) => Promise<T>, org: string | null = null) {
  if (wait) return exclusive(kind, f, org);
  if (running) throw unprocessable("busy", `Another data job is running (${running.org === org ? running.progress : "please wait"}). Try again when it finishes.`);
  exclusive(kind, f, org).catch(e => console.error(`${kind} failed: ${e.message}`));
  return { started: true, kind, note: "Running in the background. Progress is shown on this page." };
}

/** Runs a long data job (scripts/job.ts) as a separate process with its own database connection, so its heavy text
    processing never blocks the web app. Progress lines are relayed to the status shown on the Data growth page. */
function runChild(spec: any, progress: (s: string) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [cli, join(process.cwd(), "scripts", "job.ts"), JSON.stringify(spec)], { env: { ...process.env, PG_POOL_MAX: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", result: any = undefined, error = "", stderr = "";
    child.stdout.on("data", d => {
      buf += d.toString(); let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.startsWith("PROGRESS ")) progress(line.slice(9));
        else if (line.startsWith("RESULT ")) result = JSON.parse(line.slice(7));
        else if (line.startsWith("ERROR ")) error = line.slice(6); }
    });
    child.stderr.on("data", d => { stderr = (stderr + d.toString()).slice(-2000); });
    child.on("error", reject);
    child.on("exit", code => code === 0 && result !== undefined ? resolve(result) : reject(new Error(error || stderr.trim().split("\n").pop() || `job exited with code ${code}`)));
  });
}

/** Automatic growth of the skill library (off by default): candidates that at least N employers ask for, and that do not
    look like an existing skill, are added as global skills marked for review. Look-alikes always wait for a person. */
export const AUTO_ADD_DEFAULT = { enabled: false, min_employers: 10 };
export async function autoAddSettings(db: any) {
  const r = await one(db, `SELECT value FROM platform_settings WHERE key = 'skill_auto_add'`);
  return { ...AUTO_ADD_DEFAULT, ...(r?.value || {}) } as typeof AUTO_ADD_DEFAULT;
}
export async function autoAddSkills(db: any, force?: { min_employers: number }) {
  const cfg = force ? { enabled: true, ...force } : await autoAddSettings(db);
  if (!cfg.enabled) return { added: 0, proposed: 0, enabled: false };
  const cands = await q(db, `SELECT * FROM job_candidate_terms WHERE status = 'Candidate' AND suggested_skill_id IS NULL AND companies >= $1 ORDER BY companies DESC LIMIT 500`, [cfg.min_employers]);
  if (!cands.length) return { added: 0, proposed: 0, enabled: true, min_employers: cfg.min_employers };
  const second = await twoStep(db);
  const run = await one(db, `INSERT INTO skill_growth_runs (mode, note) VALUES ($1, $2) RETURNING id`, [second ? "automatic proposals" : "automatic", `terms used by at least ${cfg.min_employers} employers`]);
  const actor = { id: null, name: "Automatic skill growth", org_id: null as null };
  let added = 0, proposed = 0;
  for (const c of cands) {
    const title = c.top_titles?.[0]?.title;
    const item = { category: c.suggested_category || "Technical Methods", run: run.id,
      definition: `${c.term}: ${c.kind === "listed" ? "tool, standard or certification" : "skill"} asked for in job postings by ${c.companies} employers${title ? `, most often for ${title} roles` : ""}. Added automatically; review this definition.` };
    if (second) { await proposeCandidate(db, c, "add", item, actor); proposed++; }
    else { const r = await applyCandidate(db, c, "add", item, actor, run.id); if (r.status === "Added") added++; }
  }
  await q(db, `UPDATE skill_growth_runs SET added = $2 WHERE id = $1`, [run.id, added]);
  return { added, proposed, enabled: true, min_employers: cfg.min_employers, run: run.id };
}

/** Build role templates from the biggest market title groups. */
/** Settings for the automatic template rebuild after uploads and re-scans. */
export const AUTO_TEMPLATES = { min_postings: 8, limit: 600, min_share: 0.15 };
export async function bulkTemplates(db: any, opts: { min_postings: number; limit: number; min_share: number }) {
  // templates for market titles that no longer exist (after regrouping) are removed
  const removed = (await q(db, `DELETE FROM role_templates WHERE source = 'Job-postings analysis' AND cluster_title IS NOT NULL AND cluster_title NOT IN (SELECT normalized_title FROM job_title_clusters) RETURNING id`)).length;
  const clusters = await q(db, `SELECT normalized_title, display_title, postings, companies, raw_variants FROM job_title_clusters WHERE postings >= $1 AND companies >= 2 ORDER BY postings DESC LIMIT $2`, [opts.min_postings, opts.limit]);
  let created = 0, updated = 0, skipped = 0;
  for (const cl of clusters) {
    const prof = await pooledProfile(db, [cl.normalized_title]);
    const skills = prof.skills.filter((s: any) => s.share >= opts.min_share).slice(0, 25).map((s: any) => ({ skill_id: s.skill_id, required_level: 3, requirement_type: s.share >= 0.5 ? "Mandatory" : "Optional", importance: s.share >= 0.5 ? "High" : "Medium", market_share: s.share }));
    if (skills.length < 2) { skipped++; continue; }
    const title = cl.display_title.replace(/\s+/g, " ").trim();
    const variants = (cl.raw_variants || []).map((v: any) => v.title).filter((t: string) => t.toLowerCase() !== title.toLowerCase()).slice(0, 10);
    const r = await one(db, `INSERT INTO role_templates (title, aliases, job_family, industry, summary, skills, source, cluster_title, postings) VALUES ($1,$2,NULL,'Cross-industry (job postings)',$3,$4,'Job-postings analysis',$5,$6)
      ON CONFLICT (title, industry) DO UPDATE SET aliases = EXCLUDED.aliases, skills = EXCLUDED.skills, postings = EXCLUDED.postings, summary = EXCLUDED.summary RETURNING (xmax = 0) AS inserted`,
      [title, variants, `Built from ${prof.postings} job postings at ${prof.companies} employers. Levels default to 3; review them.`, JSON.stringify(skills), cl.normalized_title, prof.postings]);
    if (r.inserted) created++; else updated++;
  }
  return { considered: clusters.length, created, updated, removed, skipped_too_few_skills: skipped };
}

export const routes: Route[] = [
  { method: "GET", pattern: "/data/scale", handler: async ({ db, user }) => {
    const r = await one(db, `SELECT (SELECT count(*) FROM skills WHERE org_id IS NULL AND status = 'Active')::int AS global_skills,
      (SELECT count(*) FROM job_candidate_terms WHERE status = 'Proposed')::int AS proposals,
      (SELECT count(*) FROM job_postings WHERE org_id = $1)::int AS company_postings, (SELECT count(*) FROM org_title_clusters WHERE org_id = $1)::int AS company_titles,
      (SELECT count(*) FROM org_candidate_terms WHERE org_id = $1 AND status = 'Candidate')::int AS company_candidates, (SELECT count(*) FROM skills WHERE org_id = $1)::int AS company_skills,
      (SELECT count(*) FROM role_templates)::int AS templates, (SELECT count(*) FROM global_postings)::int AS postings, (SELECT count(*) FROM job_title_clusters)::int AS title_groups,
      (SELECT count(*) FROM job_title_clusters WHERE postings >= 10)::int AS big_title_groups, (SELECT count(*) FROM job_candidate_terms WHERE status = 'Candidate')::int AS open_candidates,
      (SELECT count(*) FROM global_postings WHERE cardinality(skill_ids) > 0)::int AS postings_with_skills,
      (SELECT count(*) FROM job_roles WHERE org_id = $1)::int AS roles, (SELECT count(*) FROM employees WHERE org_id = $1 AND status = 'Active')::int AS employees,
      (SELECT count(*) FROM v_framework WHERE org_id = $1)::int AS requirements,
      (SELECT count(DISTINCT raw_title) FROM global_postings)::int AS raw_titles, (SELECT count(DISTINCT normalized_title) FROM global_postings)::int AS market_titles,
      (SELECT count(DISTINCT company) FROM global_postings)::int AS employers,
      (SELECT count(*) FROM job_candidate_terms WHERE status = 'Added')::int AS candidates_covered,
      (SELECT count(*) FROM job_candidate_terms WHERE status = 'Candidate' AND suggested_skill_id IS NOT NULL)::int AS candidates_with_suggestion,
      (SELECT count(*) FROM job_title_clusters WHERE postings >= 8 AND companies >= 2)::int AS template_ready_titles`, [user.org_id]);
    const names = new Set<string>();
    for (const x of await q(db, `SELECT lower(name) AS n, aliases FROM skills WHERE org_id IS NULL`)) { names.add(x.n); for (const a of x.aliases || []) names.add(String(a).toLowerCase()); }
    const cat = readCatalogue();
    // a company sees only its own jobs; the platform administrator sees platform jobs
    const mine = (x: any) => x && (x.org ?? null) === (user.role === "platform_admin" ? null : user.org_id);
    return { ...r, catalogue_size: cat.length, catalogue_missing: cat.filter(s => !names.has(s.name.toLowerCase())).length, running: mine(running) ? running : null, last: mine(lastResult) ? lastResult : null };
  } },
  { method: "POST", pattern: "/data/catalogue/load", handler: async ({ user, body }) => {
    platformOnly(user);
    return background(!!body?.wait, "catalogue load", p => runChild({ kind: "catalogue", user: { id: user.id, name: user.name } }, p));
  } },
  { method: "POST", pattern: "/data/rescan", handler: async ({ user, body }) => {
    platformOnly(user);
    return background(!!body?.wait, "re-scan", p => runChild({ kind: "rescan", user: { id: user.id, name: user.name } }, p));
  } },
  // HR: re-scan the company's own postings (after adding company skills)
  { method: "POST", pattern: "/company-postings/rescan", handler: async ({ user, body }) => {
    if (!has(user, "skills:write")) throw forbidden();
    const org = user.org_id!;
    return background(!!body?.wait, "re-scan of your postings", p => runChild({ kind: "company-refresh", org_id: org, user: { id: user.id, name: user.name, org_id: org } }, p), org);
  } },
  { method: "GET", pattern: "/data/settings", handler: async ({ db, user }) => { platformOnly(user); return { skill_auto_add: await autoAddSettings(db) }; } },
  { method: "PUT", pattern: "/data/settings", handler: async ({ db, user, body }) => {
    platformOnly(user);
    const v = parse(z.object({ enabled: z.boolean(), min_employers: z.coerce.number().int().min(3).max(100000) }), body?.skill_auto_add || {});
    await q(db, `INSERT INTO platform_settings (key, value, updated_by) VALUES ('skill_auto_add', $1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(v), user.name]);
    await audit(db, user, { entity_type: "platform_setting", entity_id: "skill_auto_add", action: "updated", after: v });
    const now = v.enabled ? await autoAddSkills(db) : null;
    return { skill_auto_add: v, added_now: now?.added ?? 0, proposed_now: (now as any)?.proposed ?? 0 };
  } },
  { method: "POST", pattern: "/data/templates/bulk", handler: async ({ db, user, body }) => {
    platformOnly(user);
    const b = parse(z.object({ min_postings: z.coerce.number().int().min(3).default(10), limit: z.coerce.number().int().min(1).max(2000).default(300), min_share: z.coerce.number().min(0.05).max(0.9).default(0.15) }), body || {});
    const r = await bulkTemplates(db, b as any);
    await audit(db, user, { entity_type: "role_template", entity_id: "bulk", action: "bulk_from_market", after: r });
    return r;
  } },
  // Job-postings upload from the browser (platform administrator). Multipart field "file", optional "name" and "licence".
  { method: "POST", pattern: "/data/job-postings", handler: async ({ user, body }) => {
    // platform administrator: shared postings for every organisation; HR: the company's own postings, private to it
    if (user.role !== "platform_admin" && !has(user, "skills:write")) throw forbidden("Only HR administrators and the platform administrator upload job postings");
    const org = user.role === "platform_admin" ? null : user.org_id;
    const file = body.file;
    if (!file?.buffer) throw bad("Attach a .xlsx or .csv file of job postings");
    if (!/\.(xlsx|csv)$/i.test(file.name)) throw unprocessable("file_type", "Use .xlsx or .csv");
    const dir = mkdtempSync(join(tmpdir(), "rsip-jobs-")); const path = join(dir, file.name.replace(/[^\w.-]+/g, "_"));
    writeFileSync(path, file.buffer);
    // check the columns now, so a wrong file is reported at once; the import itself runs in the background
    for await (const r of readRows(path)) { const miss = ["company", "job_title"].filter(k => !(k in r)); if (miss.length) { rmSync(dir, { recursive: true, force: true }); throw unprocessable("missing_columns", `Missing column(s): ${miss.join(", ")}. Expected company, job_title, location, department, description, additional_details`); } break; }
    return background(!!body.wait, "job-postings import", p => runChild({ kind: "upload", org_id: org, path, dir, name: String(body.name || file.name), file_name: file.name, licence: body.licence ? String(body.licence) : null, user: { id: user.id, name: user.name, org_id: org } }, p), org);
  } },
  // HR: create draft roles in bulk from market title groups (each gets the skills mentioned in enough postings)
  { method: "POST", pattern: "/roles/from-market", handler: async ({ user, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const b = parse(z.object({ department_id: z.string(), titles: z.array(z.object({ normalized_title: z.string(), title: z.string().min(2).optional() })).min(1).max(200), min_share: z.coerce.number().min(0.05).max(0.9).default(0.2) }), body);
    if (!inDeptScope(user, "roles:write", b.department_id)) throw forbidden("You can create roles only in your department");
    return tx(async c => {
      const dept = await one(c, `SELECT id FROM departments WHERE id = $1 AND org_id = $2 AND status = 'Active'`, [b.department_id, orgOf(user)]);
      if (!dept) throw notFound("Department");
      const out: any[] = [];
      for (const t of b.titles) {
        const cl = await one(c, `SELECT normalized_title, display_title, postings, companies FROM job_title_clusters WHERE normalized_title = $1`, [t.normalized_title]);
        if (!cl) { out.push({ normalized_title: t.normalized_title, status: "not_found" }); continue; }
        const title = t.title || cl.display_title;
        const dup = await one(c, `SELECT id FROM job_roles WHERE org_id = $1 AND status <> 'Archived' AND (lower(title) = lower($2) OR lower($2) = ANY(SELECT lower(a) FROM unnest(alt_titles) a))`, [orgOf(user), title]);
        if (dup) { out.push({ normalized_title: cl.normalized_title, title, status: "exists", role_id: dup.id }); continue; }
        const prof = await pooledProfile(c, [cl.normalized_title]);
        const skills = prof.skills.filter((s: any) => s.share >= b.min_share!).slice(0, 25).map((s: any) => ({ skill_id: s.skill_id, required_level: 3, requirement_type: s.share >= 0.5 ? "Mandatory" : "Optional", importance: s.share >= 0.5 ? "High" : "Medium" }));
        const r = await draftRole(c, user, title, b.department_id, [], skills,
          `Drafted from ${cl.postings} job postings titled "${cl.display_title}" (${cl.companies} employers). Skills mentioned in at least ${Math.round(b.min_share! * 100)}% of them; levels default to 3. Review before submitting.`);
        out.push({ normalized_title: cl.normalized_title, title, status: "created", role_id: r.id, skills: skills.length });
      }
      return { created: out.filter(o => o.status === "created").length, results: out };
    });
  } },
];
