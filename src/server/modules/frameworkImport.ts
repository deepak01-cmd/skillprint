/* Platform administrator: upload an existing role–skill framework (CSV or Excel). The file can be as thin as
   "role, skill"; everything else the framework needs is filled in and shown in the preview before anything is saved:
   - skills are matched to the library through their spelling variants; unknown ones become library additions
     (proposed for approval when two-step approval is on), with a category taken from the most similar library skill;
   - missing levels come from how the same skill is levelled in other frameworks and templates, adjusted for the
     seniority in the title (Junior −1, Senior/Lead +1); then requirement type, importance and trend follow;
   - each role becomes a platform role template that every organisation can draft roles from. */
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { bad, conflict, forbidden, notFound, unprocessable } from "../errors";
import { Route } from "../http/router";
import { readTable, splitList, toCsv } from "../files";
import { canonicalSpelling, spellingsOf } from "../terms";
import { normalizeTitle } from "./roleFallback";
import { applyCandidate, proposeCandidate, twoStep } from "./library";
export { linkPendingTemplateSkills } from "./library";

const FIELDS: Record<string, string[]> = {
  role: ["role title", "job title", "title", "position", "designation", "role name", "job role"],
  skill: ["skill name", "competency", "skill title"],
  skills: ["required skills", "skill requirements", "skill list"],
  required_level: ["level", "required level", "proficiency", "required proficiency", "expected level", "target level"],
  requirement_type: ["requirement", "type", "requirement type", "mandatory"],
  importance: ["priority", "criticality", "weight"],
  trend: ["skill trend", "trend status"],
  category: ["skill category", "skill group", "group", "cluster"],
  definition: ["skill definition", "skill description", "description of skill"],
  industry: ["sector", "domain", "vertical"],
  job_family: ["family", "jobfamily", "job family name", "function"],
  summary: ["role summary", "purpose", "role description", "role purpose"],
  alt_titles: ["alternative titles", "alt titles", "other titles", "aliases"],
};
const EXAMPLE = [["role", "skill", "required_level", "requirement_type", "importance", "trend", "category", "definition", "industry", "job_family", "summary"],
  ["Senior Data Engineer", "Apache Spark", "4", "Mandatory", "High", "Current", "", "", "Cross-industry", "Data Engineering", "Builds and runs data pipelines at scale."],
  ["Senior Data Engineer", "dbt", "", "", "", "Emerging", "", "", "Cross-industry", "", ""],
  ["Senior Data Engineer", "Python", "", "", "", "", "", "", "Cross-industry", "", ""],
  ["Junior QA Engineer", "Selenium", "", "", "", "", "", "", "", "", ""]];

const LEVEL_WORDS: Record<string, number> = { awareness: 1, foundational: 2, basic: 2, beginner: 2, competent: 3, intermediate: 3, proficient: 3, advanced: 4, expert: 5, master: 5 };
const parseLevel = (v: string) => { const s = (v || "").toLowerCase().trim(); const n = s.match(/^l?(\d)/); if (n && +n[1] >= 1 && +n[1] <= 5) return +n[1]; for (const [w, l] of Object.entries(LEVEL_WORDS)) if (s.includes(w)) return l; return null; };
const parseReq = (v: string) => { const s = (v || "").toLowerCase(); if (!s) return null; if (/mand|requir|must|essential|^y/.test(s)) return "Mandatory"; if (/prefer|nice|desir/.test(s)) return "Preferred"; if (/develop|future/.test(s)) return "Developmental"; if (/option|^n/.test(s)) return "Optional"; return undefined; };
const parseImp = (v: string) => { const s = (v || "").toLowerCase(); if (!s) return null; if (/crit/.test(s)) return "Critical"; if (/high/.test(s)) return "High"; if (/med/.test(s)) return "Medium"; if (/low/.test(s)) return "Low"; return undefined; };
const parseTrend = (v: string) => { const s = (v || "").toLowerCase(); if (!s) return null; if (/curr|stable/.test(s)) return "Current"; if (/emerg|grow|new/.test(s)) return "Emerging"; if (/declin|legacy/.test(s)) return "Declining"; return undefined; };
const DOWN = new Set(["junior", "jr", "associate", "trainee", "intern", "entry", "graduate", "apprentice"]);
const UP = new Set(["senior", "sr", "lead", "principal", "staff", "head", "chief", "director", "architect", "manager"]);
const clamp = (n: number) => Math.max(1, Math.min(5, n));
const cap = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b([a-z])/g, (m, c, i, str) => (i === 0 || str[i - 1] === " ") ? c.toUpperCase() : m);

interface Line { row: number; skill: string; skill_id: string | null; status: "library" | "new"; matched_as?: string; level: number; level_from: string; type: string; type_from: string; importance: string; trend: string; category?: string; definition?: string }

async function plan(db: Db, rows: Record<string, string>[]) {
  const skills = await q(db, `SELECT id, name, aliases, category FROM skills WHERE org_id IS NULL AND status = 'Active'`);
  const by = new Map<string, any>();
  for (const s of skills) for (const t of [s.name, ...(s.aliases || [])]) for (const sp of spellingsOf(t)) if (!by.has(sp.toLowerCase())) by.set(sp.toLowerCase(), s);
  for (const s of skills) by.set(s.name.toLowerCase(), s);
  const find = (v: string) => by.get(v.toLowerCase().trim()) || by.get(canonicalSpelling(v).toLowerCase()) || by.get(v.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim());
  // how each skill is usually levelled across tenant frameworks and existing templates
  const usual = new Map<string, number>((await q(db, `SELECT skill_id, round(avg(l))::int AS l FROM (
      SELECT skill_id, required_level AS l FROM role_skill_mapping WHERE lifecycle_status = 'Active'
      UNION ALL SELECT x->>'skill_id', (x->>'required_level')::int FROM role_templates t, jsonb_array_elements(t.skills) x) z GROUP BY skill_id`)).map(r => [r.skill_id, r.l]));
  const trendOf = new Map<string, string>((await q(db, `SELECT DISTINCT ON (skill_id) skill_id, skill_trend FROM role_skill_mapping WHERE lifecycle_status = 'Active' GROUP BY skill_id, skill_trend ORDER BY skill_id, count(*) DESC`)).map(r => [r.skill_id, r.skill_trend]));
  const existing = await q(db, `SELECT id, title, industry FROM role_templates`);

  const groups = new Map<string, any>(); const errors: { row: number; message: string }[] = [];
  const newSkills = new Map<string, any>();
  for (const r of rows) {
    const row = Number(r.__row); const title = (r.role || "").replace(/\s+/g, " ").trim();
    if (!title) { errors.push({ row, message: "No role title" }); continue; }
    if (title.length > 160) { errors.push({ row, message: "Role title longer than 160 characters" }); continue; }
    const industry = (r.industry || "").trim() || "Cross-industry";
    const key = `${title.toLowerCase()}|${industry.toLowerCase()}`;
    const g = groups.get(key) || { title, industry, job_family: "", summary: "", alt_titles: [] as string[], lines: [] as Line[], notes: [] as string[] };
    if (r.job_family && !g.job_family) g.job_family = r.job_family.trim().slice(0, 120);
    if (r.summary && !g.summary) g.summary = r.summary.trim().slice(0, 2000);
    for (const a of splitList(r.alt_titles)) if (!g.alt_titles.includes(a)) g.alt_titles.push(a.slice(0, 160));
    groups.set(key, g);
    // one skill per row, or a list in a "skills" cell: "SQL:4:Mandatory:High; Python:3"
    const items: string[][] = r.skill ? [[r.skill, r.required_level, r.requirement_type, r.importance, r.trend]] : splitList((r.skills || "").replace(/,(?![^()]*\))/g, ";")).map(p => p.split(":").map(x => x.trim()));
    if (!items.length) { errors.push({ row, message: `No skill for "${title}"` }); continue; }
    const words = normalizeTitle(title);
    const shift = words.seniority && DOWN.has(words.seniority) ? -1 : words.seniority && UP.has(words.seniority) ? 1 : 0;
    for (const [rawName, lv, rq, im, tr] of items) {
      const name = (rawName || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      if (name.length > 120) { errors.push({ row, message: `Skill name longer than 120 characters` }); continue; }
      const s = find(name);
      const level = parseLevel(lv || "");
      if (lv && level === null) { errors.push({ row, message: `"${lv}" is not a level (use 1–5 or Awareness … Expert)` }); continue; }
      const req = parseReq(rq || ""), imp = parseImp(im || ""), trd = parseTrend(tr || "");
      if (req === undefined) { errors.push({ row, message: `"${rq}" is not a requirement type` }); continue; }
      if (imp === undefined) { errors.push({ row, message: `"${im}" is not an importance` }); continue; }
      if (trd === undefined) { errors.push({ row, message: `"${tr}" is not a trend` }); continue; }
      const id = s?.id ?? null; const dupKey = (id || name).toLowerCase();
      if (g.lines.some((l: Line) => (l.skill_id || l.skill).toLowerCase() === dupKey)) { g.notes.push(`${name} listed twice; the first is kept`); continue; }
      const base = id && usual.has(id) ? usual.get(id)! : 3;
      const L = level ?? clamp(base + shift);
      const T = req ?? (L >= 3 ? "Mandatory" : "Preferred");
      const I = imp ?? (T === "Mandatory" ? (L >= 4 ? "High" : "Medium") : "Low");
      const line: Line = { row, skill: s?.name ?? cap(name), skill_id: id, status: s ? "library" : "new", matched_as: s && s.name.toLowerCase() !== name.toLowerCase() ? name : undefined,
        level: L, level_from: level !== null ? "file" : id && usual.has(id) ? `usual level ${base}${shift ? (shift > 0 ? " +1 for seniority" : " −1 for seniority") : ""}` : `default 3${shift ? (shift > 0 ? " +1 for seniority" : " −1 for seniority") : ""}`,
        type: T, type_from: req ? "file" : "from level", importance: I, trend: trd ?? (id && trendOf.get(id)) ?? "Current" };
      if (!s) {
        const k = name.toLowerCase();
        const ns = newSkills.get(k) || { name: cap(name), category: (r.category || "").trim(), definition: (r.definition || "").trim(), roles: 0 };
        if (!ns.category && r.category) ns.category = r.category.trim(); if (!ns.definition && r.definition) ns.definition = r.definition.trim();
        ns.roles++; newSkills.set(k, ns);
      }
      g.lines.push(line);
    }
  }
  // new skills: category from the most similar library skill; a definition to review when none was given
  for (const ns of newSkills.values()) {
    if (!ns.category) {
      const near = await one(db, `SELECT category, similarity(lower(name), lower($1)) AS s FROM skills WHERE org_id IS NULL AND status = 'Active' ORDER BY s DESC LIMIT 1`, [ns.name]);
      ns.category = near && Number(near.s) >= 0.3 ? near.category : "Other"; ns.category_from = near && Number(near.s) >= 0.3 ? "similar library skill" : "default";
    } else ns.category_from = "file";
    if (!ns.definition) { ns.definition = `Applies ${ns.name} in day-to-day work at the level the role requires. Review this definition.`; ns.definition_from = "generated"; }
    else ns.definition_from = "file";
    ns.category = ns.category.slice(0, 120); ns.definition = ns.definition.slice(0, 1000);
  }
  const templates = [...groups.values()].filter(g => g.lines.length).map(g => {
    const ex = existing.find(e => e.title.toLowerCase() === g.title.toLowerCase() && (e.industry || "").toLowerCase() === g.industry.toLowerCase());
    const n = normalizeTitle(g.title);
    return { ...g, job_family: g.job_family || cap(n.core || g.title), family_from: g.job_family ? "file" : "title", action: ex ? "update" : "create", template_id: ex?.id ?? null };
  });
  const filled = { levels: 0, types: 0, family: templates.filter(t => t.family_from !== "file").length, categories: [...newSkills.values()].filter(n => n.category_from !== "file").length, definitions: [...newSkills.values()].filter(n => n.definition_from !== "file").length };
  for (const t of templates) for (const l of t.lines) { if (l.level_from !== "file") filled.levels++; if (l.type_from !== "file") filled.types++; }
  return { templates, new_skills: [...newSkills.values()], errors, filled };
}

export const routes: Route[] = [
  { method: "GET", pattern: "/framework-upload/template", handler: async ({ user }) => {
    if (user.role !== "platform_admin") throw forbidden();
    return { file: "role-skill-framework-template.csv", content: toCsv(EXAMPLE[0], EXAMPLE.slice(1)) };
  } },
  { method: "POST", pattern: "/framework-upload/preview", handler: async ({ db, user, body }) => {
    if (user.role !== "platform_admin") throw forbidden("Only the platform administrator loads frameworks into the shared library");
    const filename = String(body.filename || body.file?.name || "framework.csv").slice(0, 200);
    const buf: Buffer | undefined = body.file?.buffer;
    if (!buf && typeof body.text !== "string") throw bad("Attach a CSV or Excel file");
    if (buf && buf.length > 25 * 1024 * 1024) throw unprocessable("file_too_large", "Files up to 25 MB");
    const table = await readTable({ buf, text: body.text, filename }, FIELDS, ["role"]);
    if (!table.columns.includes("skill") && !table.columns.includes("skills")) throw unprocessable("missing_columns", "Add a \"skill\" column (one skill per row) or a \"skills\" column (a list per role)");
    const p = await plan(db, table.rows);
    if (!p.templates.length) throw unprocessable("nothing_to_import", p.errors[0]?.message ? `Nothing to import: ${p.errors[0].message}` : "Nothing to import");
    const summary = { templates: p.templates.length, create: p.templates.filter(t => t.action === "create").length, update: p.templates.filter(t => t.action === "update").length,
      requirements: p.templates.reduce((a, t) => a + t.lines.length, 0), new_skills: p.new_skills.length, errors: p.errors.length, filled: p.filled, two_step: await twoStep(db) };
    const job = await one(db, `INSERT INTO import_jobs (org_id, entity, file_name, mode, total_rows, summary, rows, created_by, created_by_name) VALUES (NULL,'framework',$1,'publish',$2,$3,$4,$5,$6) RETURNING id`,
      [filename, table.rows.length, JSON.stringify({ ...summary, unknown_columns: table.unknown_columns }), JSON.stringify(p), user.id, user.name]);
    return { id: job.id, file_name: filename, summary, unknown_columns: table.unknown_columns, templates: p.templates.slice(0, 300), new_skills: p.new_skills, errors: p.errors.slice(0, 300) };
  } },
  { method: "POST", pattern: "/framework-upload/:id/commit", handler: async ({ user, params }) => tx(async c => {
    if (user.role !== "platform_admin") throw forbidden();
    const job = await one(c, `SELECT * FROM import_jobs WHERE id = $1 AND org_id IS NULL AND entity = 'framework' FOR UPDATE`, [params.id]);
    if (!job) throw notFound("Upload");
    if (job.created_by !== user.id) throw forbidden("Only the person who uploaded the file can apply it");
    if (job.status !== "Previewed") throw conflict("not_previewed", `This upload is ${job.status}`);
    if (Date.now() - new Date(job.created_at).getTime() > 24 * 3600e3) throw conflict("preview_expired", "The preview is older than 24 hours. Upload the file again");
    const p = job.rows as Awaited<ReturnType<typeof plan>>;
    const two = await twoStep(c); const actor = { id: user.id, name: user.name, org_id: null as null };
    // 1. new skills: straight into the library, or proposed for a second person's approval
    const skillResults: any[] = [];
    for (const ns of p.new_skills) {
      const term = ns.name.toLowerCase();
      await q(c, `INSERT INTO job_candidate_terms (term, postings, companies, share, top_titles, kind, suggested_category, example) VALUES ($1,0,0,0,'[]','listed',$2,$3) ON CONFLICT (term) DO NOTHING`, [term, ns.category, `From framework upload ${job.file_name}`]);
      const t = await one(c, `SELECT * FROM job_candidate_terms WHERE term = $1`, [term]);
      if (t.status === "Added" && t.skill_id) { skillResults.push({ term, status: "exists" }); continue; }
      skillResults.push(two ? await proposeCandidate(c, t, "add", { name: ns.name, category: ns.category, definition: ns.definition }, user)
        : await applyCandidate(c, t, "add", { name: ns.name, category: ns.category, definition: ns.definition }, actor));
    }
    const idOf = async (name: string) => (await one(c, `SELECT id FROM skills WHERE org_id IS NULL AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [name]))?.id ?? null;
    // 2. templates
    let created = 0, updated = 0, pending = 0;
    for (const t of p.templates) {
      const skills: any[] = [], waiting: any[] = [];
      for (const l of t.lines) {
        const id = l.skill_id ?? await idOf(l.skill);
        const x = { required_level: l.level, requirement_type: l.type, importance: l.importance, skill_trend: l.trend };
        if (id) { if (!skills.some(s => s.skill_id === id)) skills.push({ skill_id: id, ...x }); } else { waiting.push({ name: l.skill, ...x }); pending++; }
      }
      const r = await one(c, `INSERT INTO role_templates (title, aliases, job_family, industry, summary, skills, pending_skills, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (title, industry) DO UPDATE SET aliases = EXCLUDED.aliases, job_family = EXCLUDED.job_family, summary = CASE WHEN EXCLUDED.summary <> '' THEN EXCLUDED.summary ELSE role_templates.summary END,
            skills = EXCLUDED.skills, pending_skills = EXCLUDED.pending_skills, source = EXCLUDED.source, updated_at = now() RETURNING (xmax = 0) AS inserted`,
        [t.title, t.alt_titles, t.job_family, t.industry, t.summary || "", JSON.stringify(skills), JSON.stringify(waiting), `Framework upload: ${job.file_name}`]);
      r.inserted ? created++ : updated++;
    }
    const applied = { templates_created: created, templates_updated: updated, skills_added: skillResults.filter(s => s.status === "Added").length, skills_proposed: skillResults.filter(s => s.status === "Proposed").length, requirements_waiting_for_approval: pending };
    await q(c, `UPDATE import_jobs SET status = 'Committed', committed_at = now(), summary = summary || $2 WHERE id = $1`, [job.id, JSON.stringify({ applied })]);
    await audit(c, user, { org_id: null, entity_type: "import", entity_id: job.id, action: "framework_committed", after: { file: job.file_name, ...applied } });
    return { id: job.id, status: "Committed", applied };
  }) },
  { method: "POST", pattern: "/framework-upload/:id/discard", handler: async ({ db, user, params }) => {
    const r = await one(db, `UPDATE import_jobs SET status = 'Discarded', rows = '[]' WHERE id = $1 AND created_by = $2 AND status = 'Previewed' AND entity = 'framework' RETURNING id`, [params.id, user.id]);
    if (!r) throw notFound("Upload preview");
    return { status: "Discarded" };
  } },
  { method: "GET", pattern: "/framework-upload", handler: async ({ db, user }) => {
    if (user.role !== "platform_admin") throw forbidden();
    return q(db, `SELECT id, file_name, status, total_rows, summary, created_by_name, created_at, committed_at FROM import_jobs WHERE org_id IS NULL AND entity = 'framework' ORDER BY created_at DESC LIMIT 50`);
  } },
];
