/* Built-in skills catalogue (db/catalog/skills-catalogue.csv) and re-scanning of stored job postings against the library. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Db, one, q } from "../db";
import { parseCsv, splitList } from "../files";
import { extractSkills, buildSkillMatchers, discoverTerms, extractCandidates } from "./extract";

export const CATALOGUE_FILE = join(process.cwd(), "db", "catalog", "skills-catalogue.csv");

export function readCatalogue(): { name: string; definition: string; category: string; aliases: string[]; type: string }[] {
  if (!existsSync(CATALOGUE_FILE)) return [];
  const [head, ...rows] = parseCsv(readFileSync(CATALOGUE_FILE, "utf8"));
  const ix = (k: string) => head.indexOf(k);
  return rows.map(r => ({ name: r[ix("name")], definition: r[ix("definition")], category: r[ix("category")], aliases: splitList(r[ix("aliases")]), type: r[ix("type")] || "Technical / functional / industry" }));
}

/** Add catalogue skills that the global library does not have yet (by name or alias). Returns the number added. */
export async function loadCatalogue(c: Db): Promise<{ added: number; skipped: number; total: number }> {
  const cat = readCatalogue();
  const existing = await q(c, `SELECT lower(name) AS n, aliases FROM skills WHERE org_id IS NULL`);
  const known = new Set<string>();
  for (const s of existing) { known.add(s.n); for (const a of s.aliases || []) known.add(String(a).toLowerCase()); }
  let added = 0;
  for (const s of cat) {
    if (known.has(s.name.toLowerCase())) continue;
    const aliases = s.aliases.filter(a => !known.has(a.toLowerCase()));
    await q(c, `INSERT INTO skills (org_id, name, definition, category, type, aliases) VALUES (NULL,$1,$2,$3,$4,$5)`, [s.name, s.definition, s.category, s.type, aliases]);
    known.add(s.name.toLowerCase()); aliases.forEach(a => known.add(a.toLowerCase())); added++;
  }
  // candidate terms now covered by a library skill are marked as added
  await q(c, `UPDATE job_candidate_terms t SET status = 'Added', skill_id = s.id FROM skills s
    WHERE t.status = 'Candidate' AND s.org_id IS NULL AND (lower(s.name) = lower(t.term) OR lower(t.term) = ANY(SELECT lower(a) FROM unnest(s.aliases) a))`);
  return { added, skipped: cat.length - added, total: cat.length };
}

/** Split text into sentences for boilerplate detection. */
const sentences = (t: string) => t.split(/(?<=[.!?。])\s+|\n+|•|·/).map(x => x.replace(/\s+/g, " ").trim()).filter(x => x.length >= 40);

/** Remove an employer's repeated text (company description, benefits, equal-opportunity statement): sentences that
    appear in at least 30% of that employer's postings (minimum 3). What remains is the job-specific text. */
export function stripBoilerplate(descs: string[], titles?: string[]): string[] {
  if (descs.length < 3) return descs;
  const freq = new Map<string, number>(), across = new Map<string, Set<string>>();
  descs.forEach((d, i) => { for (const x of new Set(sentences(d))) { freq.set(x, (freq.get(x) || 0) + 1); if (titles) (across.get(x) || across.set(x, new Set()).get(x)!).add(titles[i]); } });
  const min = Math.max(3, Math.ceil(descs.length * 0.3));
  // with titles known, a sentence is boilerplate only if it repeats across different jobs (company blurb, benefits);
  // requirements that one job's postings share are kept
  const distinct = titles ? new Set(titles).size : 0;
  const needTitles = Math.max(2, Math.ceil(distinct * 0.5));
  const boiler = new Set([...freq].filter(([x, n]) => n >= min && (!titles || (across.get(x)?.size || 0) >= needTitles)).map(([x]) => x));
  if (!boiler.size) return descs;
  return descs.map(d => d.split(/(?<=[.!?。])\s+|\n+|•|·/).filter(x => !boiler.has(x.replace(/\s+/g, " ").trim())).join("\n"));
}

/** Re-extract library skills from every stored posting, employer by employer, ignoring each employer's boilerplate.
    Employers are processed in batches of about 5,000 postings, and each query takes its own connection, so other
    requests (the app itself, progress checks) can run between batches, even with the single-connection portable database. */
export async function rescanPostings(db: Db, onProgress?: (done: number, total: number) => void, companies?: string[], orgId: string | null = null) {
  // shared postings are matched against global skills; a company's own postings also against that company's skills
  const skills = await q(db, `SELECT id AS skill_id, name, aliases FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const matchers = buildSkillMatchers(skills);
  const counts = companies
    ? await q(db, `SELECT company, count(*)::int AS n FROM job_postings WHERE company = ANY($1) AND org_id IS NOT DISTINCT FROM $2 GROUP BY company ORDER BY company`, [companies, orgId])
    : await q(db, `SELECT company, count(*)::int AS n FROM job_postings WHERE org_id IS NOT DISTINCT FROM $1 GROUP BY company ORDER BY company`, [orgId]);
  const total = counts.reduce((a, r) => a + r.n, 0);
  let done = 0, changed = 0, lastReport = 0;
  for (let i = 0; i < counts.length;) {
    const chunk: string[] = []; let size = 0;
    while (i < counts.length && (size === 0 || size + counts[i].n <= 5000)) { chunk.push(counts[i].company); size += counts[i].n; i++; }
    const rows = await q(db, `SELECT id, company, raw_title, normalized_title, description, skill_ids, candidate_terms FROM job_postings WHERE company = ANY($1) AND org_id IS NOT DISTINCT FROM $2 ORDER BY company, id`, [chunk, orgId]);
    const byCompany = new Map<string, any[]>(); for (const r of rows) (byCompany.get(r.company) || byCompany.set(r.company, []).get(r.company)!).push(r);
    const upd: [string, string, string][] = [];
    for (const list of byCompany.values()) {
      const clean = stripBoilerplate(list.map(r => r.description || ""), list.map(r => r.normalized_title || r.raw_title));
      list.forEach((r, k) => {
        const text = `${r.raw_title}\n${clean[k]}`;
        const ids = extractSkills(text, matchers);
        const terms = [...new Set([...extractCandidates(text), ...discoverTerms(clean[k])])];
        if (ids.join() !== (r.skill_ids || []).join() || terms.join("\u0001") !== (r.candidate_terms || []).join("\u0001")) upd.push([r.id, ids.join(","), JSON.stringify(terms)]);
      });
    }
    for (let j = 0; j < upd.length; j += 2500) {
      const part = upd.slice(j, j + 2500);
      await q(db, `UPDATE job_postings p SET skill_ids = coalesce(string_to_array(nullif(x.j, ''), ','), '{}'), candidate_terms = ARRAY(SELECT jsonb_array_elements_text(x.t::jsonb))
        FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS j, unnest($3::text[]) AS t) x WHERE p.id = x.id`,
        [part.map(u => u[0]), part.map(u => u[1]), part.map(u => u[2])]);
    }
    changed += upd.length; done += rows.length;
    if (done - lastReport >= 5000 || i >= counts.length) { onProgress?.(done, total); lastReport = done; }
    await new Promise(r => setImmediate(r));   // let waiting requests in
  }
  return { scanned: done, changed };
}

export async function globalSkillCount(db: Db) { return Number((await one(db, `SELECT count(*)::int AS n FROM skills WHERE org_id IS NULL`))!.n); }
