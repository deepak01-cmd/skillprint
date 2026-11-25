/* Reference data (O*NET and other publishers): releases loaded as delivered, linked to the company's data, never merged into it.
   - Platform administrator: create a release, upload its files (any order; .xlsx, .csv, .txt or a .zip of them), check, publish.
     Publishing needs a licence and an attribution line; it retires the previous release of the same dataset (which can be put back).
   - Everyone with access to roles: each job role is linked to the closest reference occupation (found automatically,
     confirmed or changed by HR). The occupation adds work styles, work context, rated skills and labour-market outlook flags.
   - The outlook engine reads two signals from here: Bright Outlook flags for roles, and Hot / In Demand technologies for skills. */
import { z } from "zod";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { Db, one, pool, q, tx } from "../db";
import { audit } from "../audit";
import { bad, forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { canonicalSpelling, spellingsOf } from "../terms";
import { normalizeTitle } from "./roleFallback";
import { keyWords } from "./market";
import { listActive } from "./mapping";
import { FileResult, loadFile } from "../reference/load";

const platformOnly = (u: User) => { if (u.role !== "platform_admin") throw forbidden("Only the platform administrator manages reference data"); };
const canRead = (u: User) => { if (!has(u, "roles:read") && u.role !== "platform_admin") throw forbidden(); };
const FILE_RE = /\.(xlsx|csv|txt|tsv)$/i;

export const ONET_ATTRIBUTION = (version: string) => `This page includes information from the O*NET ${version ? version + " " : ""}Database and O*NET OnLine by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. Skillprint has modified all or some of this information (matched to its skill library and proficiency levels). USDOL/ETA has not approved, endorsed, or tested these modifications.`;

/* ---------------- loading ---------------- */

let loading: { source: string; progress: string } | null = null;

/** Turns uploaded files (and the files inside uploaded .zip archives) into paths on disk. */
async function stage(files: { name: string; buffer: Buffer }[]) {
  const dir = mkdtempSync(join(tmpdir(), "rsip-ref-")); const out: { name: string; path: string }[] = []; const skipped: string[] = [];
  let i = 0;
  const put = (name: string, buf: Buffer) => { const p = join(dir, `${i++}_${name.replace(/[^\w.-]+/g, "_").slice(-120)}`); writeFileSync(p, buf); out.push({ name, path: p }); };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f.buffer);
      const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
      if (entries.length > 200) throw unprocessable("zip_too_big", "A .zip may hold at most 200 files");
      for (const e of entries) {
        const name = e.name.split("/").pop()!;
        if (!FILE_RE.test(name)) { skipped.push(name); continue; }
        const buf = await e.async("nodebuffer");
        if (buf.length > 300 * 1048576) throw unprocessable("file_too_big", `${name} is larger than 300 MB`);
        put(name, buf);
      }
    } else if (FILE_RE.test(f.name)) put(f.name, f.buffer);
    else skipped.push(f.name);
  }
  return { dir, files: out, skipped };
}

/** Loads files into a release; runs in the background unless wait is set. */
export async function loadIntoSource(db: Db, sourceId: string, files: { name: string; path: string }[], progress: (s: string) => void = () => {}) {
  const results: FileResult[] = [];
  for (const f of files) { progress(`Reading ${f.name}`); results.push(await loadFile(db, sourceId, f.path, f.name, progress)); }
  progress("Matching descriptors and technologies to the skill library");
  const linked = await linkSkills(db, sourceId);
  const counts = await sourceCounts(db, sourceId);
  await q(db, `UPDATE reference_sources SET files = files || $2::jsonb, counts = $3, status = CASE WHEN status = 'Loading' THEN 'Draft' ELSE status END WHERE id = $1`,
    [sourceId, JSON.stringify(results.map(r => ({ ...r, loaded_at: new Date().toISOString() }))), JSON.stringify({ ...counts, skills_linked: linked })]);
  return { results, counts: { ...counts, skills_linked: linked } };
}

async function sourceCounts(db: Db, id: string) {
  const r = await one(db, `SELECT (SELECT count(*)::int FROM ref_occupations WHERE source_id = $1) AS occupations, (SELECT count(*)::int FROM ref_titles WHERE source_id = $1) AS titles,
    (SELECT count(*)::int FROM ref_elements WHERE source_id = $1) AS descriptors, (SELECT count(*)::int FROM ref_ratings WHERE source_id = $1) AS ratings,
    (SELECT count(*)::int FROM ref_outlook_flags WHERE source_id = $1) AS outlook_flags, (SELECT count(*)::int FROM ref_technologies WHERE source_id = $1) AS technologies,
    (SELECT count(*)::int FROM ref_element_links WHERE source_id = $1) AS links, (SELECT count(*)::int FROM ref_categories WHERE source_id = $1) AS categories,
    (SELECT count(*)::int FROM ref_tasks WHERE source_id = $1) AS emerging_tasks, (SELECT count(*)::int FROM ref_related WHERE source_id = $1) AS related`, [id]);
  return r!;
}

/** Matches descriptor names and technology examples to skills in the shared library, by name, alias and spelling. */
export async function linkSkills(db: Db, sourceId: string) {
  const skills = await q(db, `SELECT id, name, aliases FROM skills WHERE org_id IS NULL AND status = 'Active'`);
  const by = new Map<string, string>();
  for (const s of skills) for (const t of [s.name, s.name.replace(/\s*\(.*?\)\s*/g, " ").trim(), ...(s.aliases || [])]) for (const sp of spellingsOf(t)) if (!by.has(sp.toLowerCase())) by.set(sp.toLowerCase(), s.id);
  const find = (n: string) => by.get(n) || by.get(canonicalSpelling(n).toLowerCase()) || by.get(n.replace(/\s*\(.*?\)\s*/g, " ").trim());
  const names = (await q(db, `SELECT DISTINCT lower(name) AS n FROM ref_elements WHERE source_id = $1 AND kind IN ('skill','knowledge','ability','work_style','technology')
    UNION SELECT DISTINCT lower(example) FROM ref_technologies WHERE source_id = $1`, [sourceId])).map(r => r.n as string);
  const pairs = names.map(n => [n, find(n)]).filter(p => p[1]) as [string, string][];
  await q(db, `DELETE FROM ref_skill_links WHERE source_id = $1`, [sourceId]);
  for (let i = 0; i < pairs.length; i += 1000) {
    const b = pairs.slice(i, i + 1000);
    await q(db, `INSERT INTO ref_skill_links (source_id, name, skill_id) SELECT $1, * FROM unnest($2::text[], $3::text[]) ON CONFLICT DO NOTHING`, [sourceId, b.map(p => p[0]), b.map(p => p[1])]);
  }
  return pairs.length;
}

/* ---------------- occupations and roles ---------------- */

const ACTIVE = `SELECT id FROM reference_sources WHERE status = 'Active'`;

/** Closest occupations for a job title, using every title an occupation is known by. Ties (one job title listed under several
    occupations) are broken by how close the occupation's own title is, whether the title is a commonly reported one, and how
    many of its titles match strongly. */
export async function matchOccupations(db: Db, title: string, limit = 6, skillIds: string[] = []) {
  const raw = title.toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();
  const core = normalizeTitle(title).core || raw;
  if (raw.length < 2) return [];
  let rows: any[] = await q(db, `WITH m AS (
      SELECT t.code, t.title, t.kind, greatest(similarity(lower(t.title), $1), 0.9 * similarity(lower(t.title), $2)) AS s
      FROM ref_titles t WHERE t.source_id IN (${ACTIVE}) AND (lower(t.title) % $1 OR lower(t.title) % $2))
    SELECT code, max(s)::float AS score, count(*) FILTER (WHERE s >= 0.6)::int AS strong, coalesce(max(s) FILTER (WHERE kind = 'title'), 0)::float AS own,
      coalesce(max(s) FILTER (WHERE kind = 'reported'), 0)::float AS rep, (array_agg(title ORDER BY s DESC))[1] AS matched_title
    FROM m GROUP BY code ORDER BY max(s) DESC LIMIT 40`, [raw, core]);
  rows = rows.map(r => ({ ...r, rank: r.score + 0.1 * r.own + (r.rep >= r.score - 0.01 ? 0.05 : 0) + 0.015 * Math.min(r.strong, 6) }));
  rows = rows.sort((a, b) => b.rank - a.rank).slice(0, Math.max(limit, 12));
  if (!rows.length || rows[0].score < 0.35) {
    // keyword fallback: every distinctive word of the title appears in one of the occupation's titles
    const words = keyWords(title).filter(w => w.length >= 2).map(w => w === "dotnet" ? "(\\.net|dotnet)" : w === "csharp" ? "(c#|c sharp)" : w === "cpp" ? "c\\+\\+" : `\\m${w.replace(/[^a-z0-9]/g, "")}`);
    if (words.length) {
      const cond = words.map((_, i) => "lower(title) ~ $" + (i + 1)).join(" AND ");
      const kw = await q(db, `SELECT code, 0.35::float AS score, min(title) AS matched_title FROM ref_titles WHERE source_id IN (${ACTIVE}) AND ${cond}
        GROUP BY code ORDER BY count(*) DESC LIMIT ${Math.max(1, Math.min(10, limit))}`, words);
      const seen = new Set(rows.map(r => r.code)); rows = [...kw.filter(k => !seen.has(k.code)).map(k => ({ ...k, rank: k.score })), ...rows];
    }
  }
  // the role's skills tell occupations with the same job title apart (a "Full Stack Developer" is not a film developer)
  const ids = [...new Set(skillIds)];
  if (ids.length >= 2 && rows.length > 1) {
    const top = rows.filter(r => r.score >= Math.max(...rows.map(x => x.score)) - 0.2).map(r => r.code);
    const ov = new Map((await q(db, `SELECT code, count(DISTINCT skill_id)::int AS n FROM (
        SELECT t.code, l.skill_id FROM ref_technologies t JOIN ref_skill_links l ON l.source_id = t.source_id AND l.name = lower(t.example) WHERE t.source_id IN (${ACTIVE}) AND t.code = ANY($1)
        UNION SELECT r.code, l.skill_id FROM ref_ratings r JOIN ref_elements e ON e.source_id = r.source_id AND e.element_id = r.element_id
          JOIN ref_skill_links l ON l.source_id = r.source_id AND l.name = lower(e.name) WHERE r.source_id IN (${ACTIVE}) AND r.code = ANY($1) AND r.scale = 'IM' AND r.value >= 3) x
      WHERE skill_id = ANY($2) GROUP BY code`, [top, ids])).map(r => [r.code, r.n]));
    rows = rows.map(r => ({ ...r, overlap: ov.get(r.code) || 0, rank: r.rank + 0.35 * Math.min(1, (ov.get(r.code) || 0) / Math.min(ids.length, 8)) }));
  }
  rows = rows.sort((a, b) => b.rank - a.rank).slice(0, limit);
  if (!rows.length) return [];
  const occ = new Map((await q(db, `SELECT DISTINCT ON (code) code, title FROM ref_occupations WHERE source_id IN (${ACTIVE}) AND code = ANY($1) ORDER BY code, (description IS NULL)`, [rows.map(r => r.code)])).map(o => [o.code, o.title]));
  return rows.map(r => ({ code: r.code, title: occ.get(r.code) || r.matched_title, matched_title: r.matched_title, score: Math.round(r.score * 100) / 100, skills_in_common: r.overlap ?? null }));
}
export const AUTO_LINK = 0.5;
/** Close enough to link without asking: a close title, or a looser title that shares at least 3 skills with the role. */
const accept = (m: { score: number; skills_in_common?: number | null } | undefined) => !!m && (m.score >= AUTO_LINK || (m.score >= 0.35 && (m.skills_in_common ?? 0) >= 3));

/** The occupation linked to a role: HR's choice, or found automatically (and remembered) when the match is close enough. */
export async function roleLink(db: Db, orgId: string, role: { id: string; title: string; alt_titles?: string[] }) {
  const cur = await one(db, `SELECT code, score::float, method, confirmed_by, updated_at FROM ref_role_links WHERE role_id = $1`, [role.id]);
  if (cur && cur.method !== "auto") return cur;
  if (!(await one(db, ACTIVE + " LIMIT 1"))) return null;
  const skillIds = (await listActive(db, orgId, { roleId: role.id })).map((m: any) => m.skill_id);
  const cands = (await Promise.all([role.title, ...(role.alt_titles || []).slice(0, 3)].map((t, i) => matchOccupations(db, t, 3, skillIds).then(l => l.map((c, k) => ({ ...c, order: i * 10 + k })))))).flat()
    .sort((a, b) => a.order - b.order);
  const best = cands[0];
  if (!accept(best)) { if (cur) await q(db, `DELETE FROM ref_role_links WHERE role_id = $1 AND method = 'auto'`, [role.id]); return null; }
  if (!cur || cur.code !== best.code) await q(db, `INSERT INTO ref_role_links (role_id, org_id, code, score, method) VALUES ($1, $2, $3, $4, 'auto')
    ON CONFLICT (role_id) DO UPDATE SET code = EXCLUDED.code, score = EXCLUDED.score, updated_at = now() WHERE ref_role_links.method = 'auto'`, [role.id, orgId, best.code, best.score]);
  return { code: best.code, score: best.score, method: "auto", confirmed_by: null };
}

/** Links for many roles at once (organisation outlook). */
export async function roleLinks(db: Db, orgId: string, roles: { id: string; title: string }[]) {
  const out = new Map<string, string>();
  if (!roles.length || !(await one(db, ACTIVE + " LIMIT 1"))) return out;
  const stored = new Map((await q(db, `SELECT role_id, code, method FROM ref_role_links WHERE role_id = ANY($1)`, [roles.map(r => r.id)])).map(r => [r.role_id, r]));
  for (const r of roles) {
    const s = stored.get(r.id);
    if (s && s.method !== "auto") { if (s.code) out.set(r.id, s.code); continue; }
    if (s?.code) { out.set(r.id, s.code); continue; }
    const l = await roleLink(db, orgId, r); if (l?.code) out.set(r.id, l.code);
  }
  return out;
}

const FLAG_WEIGHT: Record<string, number> = { "rapid growth": 0.12, "new & emerging": 0.12, "new and emerging": 0.12, "numerous job openings": 0.05 };
/** Labour-market outlook flags of occupations, and what they add to a role's outlook score. */
export async function outlookFlags(db: Db, codes: string[]) {
  const m = new Map<string, string[]>();
  if (!codes.length) return m;
  for (const r of await q(db, `SELECT code, array_agg(DISTINCT flag ORDER BY flag) AS flags FROM ref_outlook_flags WHERE source_id IN (${ACTIVE}) AND code = ANY($1) GROUP BY code`, [codes])) m.set(r.code, r.flags);
  return m;
}
/** New tasks reported for occupations (O*NET Emerging Tasks), counted per occupation. */
export async function newTaskCounts(db: Db, codes: string[]) {
  const m = new Map<string, number>();
  if (!codes.length) return m;
  for (const r of await q(db, `SELECT code, count(*)::int AS n FROM ref_tasks WHERE source_id IN (${ACTIVE}) AND code = ANY($1) AND coalesce(category, 'New') ILIKE 'new%' GROUP BY code`, [codes])) m.set(r.code, r.n);
  return m;
}
/** What an occupation's outlook flags (and newly emerging tasks) add to a role's outlook score, with the reasons shown to people. */
export function flagBonus(flags: string[] | undefined, newTasks = 0) {
  const reasons: string[] = [];
  let bonus = Math.min(0.18, (flags || []).reduce((a, f) => a + (FLAG_WEIGHT[f.toLowerCase()] ?? 0), 0));
  if (bonus) reasons.push(`Labour-market outlook (O*NET Bright Outlook, U.S. projections): ${flags!.join(", ")}`);
  if (newTasks >= 2) { bonus = Math.min(0.2, bonus + 0.04); reasons.push(`${newTasks} new tasks recently reported for this occupation (O*NET Emerging Tasks): the work is evolving`); }
  return { bonus, reason: reasons.join(". ") || null, reasons };
}

/** Hot / In Demand technology flags for library skills (a skill-level outlook signal). */
export async function technologySignals(db: Db, skillIds: string[]) {
  const m = new Map<string, { hot: number; in_demand: number }>();
  if (!skillIds.length) return m;
  for (const r of await q(db, `SELECT l.skill_id, count(DISTINCT t.code) FILTER (WHERE t.hot)::int AS hot, count(DISTINCT t.code) FILTER (WHERE t.in_demand)::int AS in_demand
      FROM ref_skill_links l JOIN ref_technologies t ON t.source_id = l.source_id AND lower(t.example) = l.name
      WHERE l.source_id IN (${ACTIVE}) AND l.skill_id = ANY($1) GROUP BY l.skill_id HAVING count(*) FILTER (WHERE t.hot OR t.in_demand) > 0`, [skillIds])) m.set(r.skill_id, { hot: r.hot, in_demand: r.in_demand });
  return m;
}

const lvToLevel = (lv: number) => lv < 1.5 ? 1 : lv < 3 ? 2 : lv < 4.5 ? 3 : lv < 6 ? 4 : 5;
const imToReq = (im: number) => im >= 4 ? "Mandatory" : im >= 3.5 ? "Preferred" : "Optional";

/** Everything the reference data says about an occupation, matched to the library where possible. */
export async function occupationProfile(db: Db, code: string) {
  const o = await one(db, `SELECT DISTINCT ON (o.code) o.code, o.title, o.description, s.id AS source_id FROM ref_occupations o JOIN reference_sources s ON s.id = o.source_id AND s.status = 'Active'
    WHERE o.code = $1 ORDER BY o.code, (o.description IS NULL), s.published_at DESC`, [code]);
  if (!o) return null;
  const flags = (await outlookFlags(db, [code])).get(code) || [];
  const ratings = await q(db, `SELECT r.element_id, r.scale, r.value::float, e.kind, e.name, e.description, e.category, l.skill_id, sk.name AS skill_name
    FROM ref_ratings r JOIN ref_elements e ON e.source_id = r.source_id AND e.element_id = r.element_id
    LEFT JOIN ref_skill_links l ON l.source_id = r.source_id AND l.name = lower(e.name) LEFT JOIN skills sk ON sk.id = l.skill_id
    WHERE r.source_id IN (${ACTIVE}) AND r.code = $1`, [code]);
  const by = new Map<string, any>();
  for (const r of ratings) { const k = r.element_id; const x = by.get(k) || { element_id: k, kind: r.kind, name: r.name, description: r.description, category: r.category, skill_id: r.skill_id, skill_name: r.skill_name, scales: {} as Record<string, number> }; x.scales[r.scale] = r.value; by.set(k, x); }
  const all = [...by.values()];
  const cats = new Map<string, string>();
  for (const c of await q(db, `SELECT element_id, category, label FROM ref_categories WHERE source_id IN (${ACTIVE}) AND scale IN ('CXP','CTP')`)) cats.set(`${c.element_id}:${c.category}`, c.label);
  const styles = all.filter(x => x.kind === "work_style").map(x => ({ ...x, impact: x.scales.WI ?? x.scales.IM ?? null, rank: x.scales.DR ?? null })).filter(x => x.impact != null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.impact - a.impact).slice(0, 8)
    .map(x => ({ element_id: x.element_id, name: x.name, description: x.description, impact: Math.round(x.impact * 100) / 100, rank: x.rank, skill_id: x.skill_id }));
  const context = all.filter(x => x.kind === "work_context" && (x.scales.CX ?? x.scales.CT) != null).map(x => { const v = x.scales.CX ?? x.scales.CT; return { element_id: x.element_id, name: x.name, value: Math.round(v * 100) / 100, label: cats.get(`${x.element_id}:${Math.round(v)}`) || null }; })
    .sort((a, b) => b.value - a.value).slice(0, 10);
  const rated = (kind: string) => all.filter(x => x.kind === kind && x.scales.IM != null && x.scales.IM >= 3).sort((a, b) => b.scales.IM - a.scales.IM).slice(0, 12)
    .map(x => ({ element_id: x.element_id, name: x.name, importance: Math.round(x.scales.IM * 100) / 100, level: x.scales.LV != null ? lvToLevel(x.scales.LV) : null, requirement_type: imToReq(x.scales.IM), skill_id: x.skill_id, skill_name: x.skill_name }));
  const tech = await q(db, `SELECT t.example, t.commodity, t.hot, t.in_demand, l.skill_id, sk.name AS skill_name FROM ref_technologies t
    LEFT JOIN ref_skill_links l ON l.source_id = t.source_id AND l.name = lower(t.example) LEFT JOIN skills sk ON sk.id = l.skill_id
    WHERE t.source_id IN (${ACTIVE}) AND t.code = $1 ORDER BY t.in_demand DESC, t.hot DESC, t.example LIMIT 25`, [code]);
  const jz = await one(db, `SELECT value::float AS v FROM ref_ratings WHERE source_id IN (${ACTIVE}) AND code = $1 AND scale = 'JZ' LIMIT 1`, [code]);
  const tasks = await q(db, `SELECT task, category, reported FROM ref_tasks WHERE source_id IN (${ACTIVE}) AND code = $1 ORDER BY reported DESC NULLS LAST, task LIMIT 10`, [code]);
  const related = await q(db, `SELECT DISTINCT ON (r.related_code) r.related_code AS code, coalesce(o.title, r.related_code) AS title, r.tier, r.rank FROM ref_related r
    LEFT JOIN ref_occupations o ON o.source_id = r.source_id AND o.code = r.related_code WHERE r.source_id IN (${ACTIVE}) AND r.code = $1 ORDER BY r.related_code, r.rank`, [code]);
  return { code: o.code, title: o.title, description: o.description, flags, job_zone: jz ? Math.round(jz.v) : null, emerging_tasks: tasks,
    related: related.sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 8), work_styles: styles, work_context: context,
    skills: rated("skill"), knowledge: rated("knowledge"), abilities: rated("ability"), technologies: tech, attribution: await attributions(db) };
}

export async function attributions(db: Db) {
  return (await q(db, `SELECT publisher, name, version, attribution, url FROM reference_sources WHERE status = 'Active' AND attribution IS NOT NULL ORDER BY publisher, name`));
}

/** For drafts: the best occupation for a title (only a close match), with a short profile. */
export async function referenceForTitle(db: Db, title: string, skillIds: string[] = []) {
  const m = (await matchOccupations(db, title, 1, skillIds))[0];
  if (!accept(m)) return null;
  const p = await occupationProfile(db, m.code);
  return p ? { ...p, match_score: m.score } : null;
}

/* ---------------- routes ---------------- */

const SourceMeta = z.object({
  publisher: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(160), version: z.string().trim().max(60).optional().nullable(),
  released: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")), licence: z.string().trim().max(400).optional().nullable(),
  attribution: z.string().trim().max(2000).optional().nullable(), url: z.string().trim().url().regex(/^https?:\/\//).optional().nullable().or(z.literal("")),
});
const norm = (b: any) => ({ ...b, released: b.released || null, url: b.url || null, version: b.version || null, licence: b.licence || null, attribution: b.attribution || null });

export const routes: Route[] = [
  { method: "GET", pattern: "/reference/sources", handler: async ({ db, user }) => {
    platformOnly(user);
    if (!loading) await q(db, `UPDATE reference_sources SET status = 'Draft' WHERE status = 'Loading'`); // a load cut short by a restart
    return { sources: await q(db, `SELECT id, publisher, name, version, released, licence, attribution, url, status, counts, jsonb_array_length(files) AS files, created_at, published_at, published_by FROM reference_sources ORDER BY status = 'Active' DESC, created_at DESC`),
      loading, onet_attribution: ONET_ATTRIBUTION("") };
  } },
  { method: "GET", pattern: "/reference/sources/:id", handler: async ({ db, user, params }) => {
    platformOnly(user);
    const s = await one(db, `SELECT * FROM reference_sources WHERE id = $1`, [params.id]);
    if (!s) throw notFound("Reference source");
    const unmatched = await q(db, `SELECT e.kind, e.name FROM ref_elements e WHERE e.source_id = $1 AND e.kind IN ('skill','knowledge','work_style','ability')
      AND NOT EXISTS (SELECT 1 FROM ref_skill_links l WHERE l.source_id = e.source_id AND l.name = lower(e.name)) ORDER BY e.kind, e.name LIMIT 500`, [params.id]);
    const byKind = await q(db, `SELECT kind, count(*)::int AS n, count(l.skill_id)::int AS linked FROM ref_elements e LEFT JOIN ref_skill_links l ON l.source_id = e.source_id AND l.name = lower(e.name) WHERE e.source_id = $1 GROUP BY kind ORDER BY kind`, [params.id]);
    const flags = await q(db, `SELECT flag, count(*)::int AS n FROM ref_outlook_flags WHERE source_id = $1 GROUP BY flag ORDER BY n DESC`, [params.id]);
    const prev = await one(db, `SELECT id, version, counts FROM reference_sources WHERE id <> $1 AND lower(publisher) = lower($2) AND lower(name) = lower($3) AND status IN ('Active','Retired') ORDER BY published_at DESC NULLS LAST LIMIT 1`, [s.id, s.publisher, s.name]);
    return { ...s, descriptors_by_kind: byKind, unmatched, flags, previous: prev, loading: loading?.source === s.id ? loading : null };
  } },
  { method: "POST", pattern: "/reference/sources", handler: async ({ db, user, body }) => {
    platformOnly(user);
    const b = norm(parse(SourceMeta, body));
    const r = await one(db, `INSERT INTO reference_sources (publisher, name, version, released, licence, attribution, url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.publisher, b.name, b.version, b.released, b.licence, b.attribution, b.url, user.name]);
    await audit(db, user, { entity_type: "reference_source", entity_id: r!.id, action: "created", after: b });
    return { id: r!.id };
  } },
  { method: "PATCH", pattern: "/reference/sources/:id", handler: async ({ db, user, params, body }) => {
    platformOnly(user);
    const b = norm(parse(SourceMeta, body));
    const r = await one(db, `UPDATE reference_sources SET publisher=$2, name=$3, version=$4, released=$5, licence=$6, attribution=$7, url=$8 WHERE id = $1 RETURNING id, status`,
      [params.id, b.publisher, b.name, b.version, b.released, b.licence, b.attribution, b.url]);
    if (!r) throw notFound("Reference source");
    if (r.status === "Active" && (!b.licence || !b.attribution)) throw unprocessable("licence_required", "A published source must keep its licence and attribution");
    await audit(db, user, { entity_type: "reference_source", entity_id: params.id, action: "updated", after: b });
    return { ok: true };
  } },
  // files: one or several (.xlsx, .csv, .txt, .tsv, or .zip archives of them); loading runs in the background unless wait is set
  { method: "POST", pattern: "/reference/sources/:id/files", handler: async ({ db, user, params, body }) => {
    platformOnly(user);
    const s = await one(db, `SELECT id, status FROM reference_sources WHERE id = $1`, [params.id]);
    if (!s) throw notFound("Reference source");
    if (s.status !== "Draft") throw unprocessable("not_draft", s.status === "Loading" ? "Files are still loading into this source" : "Files can be added only to a draft. Create a new release for new files.");
    const files = [body.files, body.file].flat().filter((f: any) => f?.buffer);
    if (!files.length) throw bad("Attach one or more files");
    if (loading) throw unprocessable("busy", `Another reference load is running (${loading.progress}). Try again when it finishes.`);
    const st = await stage(files);
    if (!st.files.length) { rmSync(st.dir, { recursive: true, force: true }); throw unprocessable("file_type", `No usable files. Use .xlsx, .csv, .txt (tab-separated) or a .zip of them.${st.skipped.length ? ` Skipped: ${st.skipped.slice(0, 5).join(", ")}` : ""}`); }
    await q(db, `UPDATE reference_sources SET status = 'Loading' WHERE id = $1`, [s.id]);
    loading = { source: s.id, progress: "Starting" };
    const run = async () => {
      try {
        const r = await loadIntoSource(pool(), s.id, st.files, p => { if (loading) loading.progress = p; });
        await audit(pool(), user, { entity_type: "reference_source", entity_id: s.id, action: "files_loaded", after: { files: r.results.map(x => ({ file: x.file, format: x.format, rows: x.rows })), counts: r.counts } });
        return { ...r, skipped: st.skipped };
      } catch (e) { await q(pool(), `UPDATE reference_sources SET status = 'Draft' WHERE id = $1 AND status = 'Loading'`, [s.id]); throw e; }
      finally { loading = null; rmSync(st.dir, { recursive: true, force: true }); }
    };
    if (body.wait) return run();
    run().catch(e => console.error(`reference load failed: ${e.message}`));
    return { started: true, files: st.files.map(f => f.name), skipped: st.skipped };
  } },
  { method: "POST", pattern: "/reference/sources/:id/publish", handler: async ({ user, params }) => {
    platformOnly(user);
    return tx(async c => {
      const s = await one(c, `SELECT * FROM reference_sources WHERE id = $1 FOR UPDATE`, [params.id]);
      if (!s) throw notFound("Reference source");
      if (!["Draft", "Retired"].includes(s.status)) throw unprocessable("bad_status", s.status === "Active" ? "Already published" : "Wait for the files to finish loading");
      if (!s.licence?.trim() || !s.attribution?.trim()) throw unprocessable("licence_required", "Record the licence and the attribution line before publishing. Data without a licence that allows this use is never published.");
      const n = await one(c, `SELECT (SELECT count(*) FROM ref_occupations WHERE source_id = $1) + (SELECT count(*) FROM ref_elements WHERE source_id = $1) AS n`, [s.id]);
      if (!Number(n!.n)) throw unprocessable("empty", "Load at least one file first");
      const old = await q(c, `UPDATE reference_sources SET status = 'Retired' WHERE status = 'Active' AND lower(publisher) = lower($1) AND lower(name) = lower($2) AND id <> $3 RETURNING id`, [s.publisher, s.name, s.id]);
      await q(c, `UPDATE reference_sources SET status = 'Active', published_by = $2, published_at = now() WHERE id = $1`, [s.id, user.name]);
      await q(c, `DELETE FROM ref_role_links WHERE method = 'auto'`); // automatic links are found again against the new data
      await audit(c, user, { entity_type: "reference_source", entity_id: s.id, action: "published", after: { retired: old.map(o => o.id) } });
      return { status: "Active", retired: old.map(o => o.id) };
    });
  } },
  { method: "POST", pattern: "/reference/sources/:id/retire", handler: async ({ db, user, params }) => {
    platformOnly(user);
    const r = await one(db, `UPDATE reference_sources SET status = 'Retired' WHERE id = $1 AND status = 'Active' RETURNING id`, [params.id]);
    if (!r) throw unprocessable("bad_status", "Only a published source can be retired");
    await q(db, `DELETE FROM ref_role_links WHERE method = 'auto'`);
    await audit(db, user, { entity_type: "reference_source", entity_id: params.id, action: "retired" });
    return { status: "Retired" };
  } },
  { method: "DELETE", pattern: "/reference/sources/:id", handler: async ({ db, user, params }) => {
    platformOnly(user);
    const r = await one(db, `DELETE FROM reference_sources WHERE id = $1 AND status = 'Draft' RETURNING id`, [params.id]);
    if (!r) throw unprocessable("bad_status", "Only a draft that is not loading can be deleted; retire a published source instead");
    await audit(db, user, { entity_type: "reference_source", entity_id: params.id, action: "deleted" });
    return { deleted: true };
  } },
  { method: "GET", pattern: "/reference/sources/:id/unmatched.csv", handler: async ({ db, user, params }) => {
    platformOnly(user);
    const rows = await q(db, `SELECT e.kind, e.element_id, e.name, coalesce(e.description, '') AS description FROM ref_elements e WHERE e.source_id = $1 AND e.kind IN ('skill','knowledge','work_style','ability')
      AND NOT EXISTS (SELECT 1 FROM ref_skill_links l WHERE l.source_id = e.source_id AND l.name = lower(e.name)) ORDER BY e.kind, e.name`, [params.id]);
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = ["kind,element_id,name,description", ...rows.map(r => [r.kind, r.element_id, r.name, r.description].map(x => esc(String(x))).join(","))].join("\n");
    return { __file: { name: `unmatched-${params.id}.csv`, mime: "text/csv", data: Buffer.from(csv) } };
  } },

  // occupations, for everyone who can read roles
  { method: "GET", pattern: "/reference/occupations", handler: async ({ db, user, query }) => {
    canRead(user);
    const t = (query.get("q") || "").trim();
    if (t.length < 2) throw unprocessable("q_required", "Type at least 2 characters");
    return matchOccupations(db, t.slice(0, 120), 10);
  } },
  { method: "GET", pattern: "/reference/occupations/:code", handler: async ({ db, user, params }) => {
    canRead(user);
    const p = await occupationProfile(db, params.code);
    if (!p) throw notFound("Occupation");
    return p;
  } },
  { method: "GET", pattern: "/reference/roles/:id", handler: async ({ db, user, params }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const r = await one(db, `SELECT id, title, alt_titles, department_id FROM job_roles WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Role");
    const available = !!(await one(db, ACTIVE + " LIMIT 1"));
    if (!available) return { available: false };
    const link = await roleLink(db, orgOf(user), r);
    const cur = await one(db, `SELECT method, code, confirmed_by FROM ref_role_links WHERE role_id = $1`, [r.id]);
    const candidates = await matchOccupations(db, r.title, 6, (await listActive(db, orgOf(user), { roleId: r.id })).map((m: any) => m.skill_id));
    const framework = new Set((await listActive(db, orgOf(user), { roleId: r.id })).map((m: any) => m.skill_id));
    const profile = link?.code ? await occupationProfile(db, link.code) : null;
    return { available: true, link: link ? { ...link, method: cur?.method ?? link.method } : cur?.method === "none" ? { code: null, method: "none", confirmed_by: cur.confirmed_by } : null,
      candidates, profile, in_framework: [...framework], can_edit: has(user, "roles:write") && inDeptScope(user, "roles:write", r.department_id) };
  } },
  { method: "PUT", pattern: "/reference/roles/:id", handler: async ({ db, user, params, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const b = parse(z.object({ code: z.string().trim().max(40).nullable() }), body);
    const r = await one(db, `SELECT id, department_id FROM job_roles WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Role");
    if (!inDeptScope(user, "roles:write", r.department_id)) throw forbidden("You can change roles only in your department");
    if (b.code && !(await one(db, `SELECT 1 FROM ref_occupations WHERE code = $1 AND source_id IN (${ACTIVE})`, [b.code]))) throw notFound("Occupation");
    await q(db, `INSERT INTO ref_role_links (role_id, org_id, code, score, method, confirmed_by) VALUES ($1, $2, $3, NULL, $4, $5)
      ON CONFLICT (role_id) DO UPDATE SET code = EXCLUDED.code, score = NULL, method = EXCLUDED.method, confirmed_by = EXCLUDED.confirmed_by, updated_at = now()`,
      [r.id, orgOf(user), b.code, b.code ? "confirmed" : "none", user.name]);
    await audit(db, user, { entity_type: "role", entity_id: r.id, action: "occupation_linked", after: { code: b.code } });
    return { code: b.code, method: b.code ? "confirmed" : "none" };
  } },
];
