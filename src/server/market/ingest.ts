/* Job-postings ingestion and aggregation. Used by scripts/import-jobs.ts and by tests. */
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { Db, one, q } from "../db";
import { buildSkillMatchers, buildTitleVocab, canonicalTitle, coveredTerms, termKey, discoverTerms, extractCandidates, extractSkills, normalizeJobTitle, TitleVocab } from "./extract";

export interface RawPosting { company: string; job_title: string; location?: string; department?: string; description?: string; additional_details?: string | Record<string, unknown> | null }

function details(raw: RawPosting["additional_details"]): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as any;
  try { return JSON.parse(raw); } catch { return {}; }
}
function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") { const d = new Date(v > 1e11 ? v : v * 1000); return isNaN(+d) ? null : d.toISOString().slice(0, 10); }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
const COUNTRY: Record<string, string> = { "united states of america": "United States", us: "United States", usa: "United States", cn: "China", de: "Germany", in: "India", gb: "United Kingdom", uk: "United Kingdom" };
const country = (c: unknown) => { const s = String(c || "").trim(); return s ? COUNTRY[s.toLowerCase()] ?? s : null; };

export async function createSource(db: Db, name: string, fileName: string | null, licence: string | null, actor: string) {
  return (await one(db, `INSERT INTO job_sources (name, file_name, licence, imported_by) VALUES ($1,$2,$3,$4) RETURNING id`, [name, fileName, licence, actor]))!.id as string;
}

/** Insert a batch of postings with extracted skills and candidate terms. Duplicates (same content) are skipped. */
export async function ingestBatch(c: PoolClient, sourceId: string, rows: RawPosting[], matchers: ReturnType<typeof buildSkillMatchers>) {
  let inserted = 0;
  const values: unknown[] = []; const tuples: string[] = [];
  for (const r of rows) {
    const title = String(r.job_title || "").trim(); const company = String(r.company || "").trim();
    if (!title || !company) continue;
    const d = details(r.additional_details);
    const desc = String(r.description || "") + "\n" + [d.responsibilities, d.qualifications].filter(Boolean).join("\n");
    const n = normalizeJobTitle(title);
    if (!n.title) continue;
    const text = `${title}\n${desc}`;
    const hash = createHash("sha1").update(`${company}|${title}|${r.location || ""}|${desc.slice(0, 2000)}`).digest("hex");
    const posted = toDate(d.start_date) ?? toDate(d.updated) ?? toDate(d.posting_date);
    const row = [sourceId, company, title, n.title, n.seniority, r.location || null, country(d.country), (r.department || d.function || d.job_function || null) || null,
      d.industry ? String(d.industry) : null, d.experience_level ? String(d.experience_level) : null, posted, desc.slice(0, 20000), extractSkills(text, matchers), [...new Set([...extractCandidates(text), ...discoverTerms(desc)])], hash];
    tuples.push(`(${row.map((_, i) => `$${values.length + i + 1}`).join(",")})`);
    values.push(...row);
  }
  if (!tuples.length) return 0;
  const res = await c.query(`INSERT INTO job_postings (source_id, company, raw_title, normalized_title, seniority, location, country, department, industry, experience_level, posted_date, description, skill_ids, candidate_terms, content_hash)
    VALUES ${tuples.join(",")} ON CONFLICT (source_id, content_hash) DO NOTHING`, values);
  inserted += res.rowCount ?? 0;
  return inserted;
}

export async function loadMatchers(db: Db) {
  const skills = await q(db, `SELECT id AS skill_id, name, aliases FROM skills WHERE org_id IS NULL AND status = 'Active'`);
  return buildSkillMatchers(skills);
}

/** Rebuild clusters, skill statistics and candidate terms from all postings. */
/** Group title variants into market titles: normalise every distinct raw title, learn which title words enough
    employers use, keep only those words. Stores the vocabulary so role titles can be matched the same way. */
export async function canonicalizeTitles(c: Db) {
  const rows = await q(c, `SELECT raw_title, array_agg(DISTINCT company) FILTER (WHERE org_id IS NULL) AS companies, bool_or(org_id IS NULL) AS shared FROM job_postings GROUP BY raw_title`);
  const norm = rows.map(r => ({ raw: r.raw_title as string, norm: normalizeJobTitle(r.raw_title).title, companies: (r.companies || []) as string[], shared: r.shared as boolean }));
  // the vocabulary is learnt from shared postings only; a company's private titles never shape the shared figures
  const { vocab, stats } = buildTitleVocab(norm.filter(r => r.shared));
  await q(c, `DELETE FROM job_title_vocab`);
  for (let i = 0; i < stats.length; i += 5000) { const part = stats.slice(i, i + 5000);
    await q(c, `INSERT INTO job_title_vocab (token, companies, titles) SELECT * FROM unnest($1::text[], $2::int[], $3::int[])`, [part.map(x => x.token), part.map(x => x.companies), part.map(x => x.titles)]); }
  const raws: string[] = [], canon: string[] = [];
  // titles that appear only in a company's own postings keep all their words: in its own context every word matters
  for (const r of norm) { const k = r.shared ? canonicalTitle(r.norm, vocab) : r.norm; if (k) { raws.push(r.raw); canon.push(k); } }
  for (let i = 0; i < raws.length; i += 5000)
    await q(c, `UPDATE job_postings p SET normalized_title = x.c FROM unnest($1::text[], $2::text[]) AS x(r, c) WHERE p.raw_title = x.r AND p.normalized_title IS DISTINCT FROM x.c`, [raws.slice(i, i + 5000), canon.slice(i, i + 5000)]);
  titleVocabCache = { at: Date.now(), vocab };
  return { raw_titles: rows.length, market_titles: new Set(canon).size, min_employers: vocab.min };
}

let titleVocabCache: { at: number; vocab: TitleVocab } | null = null;
/** Title vocabulary for matching role titles to market titles (cached for five minutes). */
export async function loadTitleVocab(db: Db): Promise<TitleVocab> {
  if (titleVocabCache && Date.now() - titleVocabCache.at < 300_000) return titleVocabCache.vocab;
  const rows = await q(db, `SELECT token, companies FROM job_title_vocab`);
  const all = Number((await one(db, `SELECT count(DISTINCT company)::int AS n FROM job_postings`))?.n || 0);
  const min = all >= 60 ? 3 : 2;
  const vocab = { words: new Set(rows.filter(r => r.companies >= min).map(r => r.token as string)), min };
  titleVocabCache = { at: Date.now(), vocab };
  return vocab;
}

export async function refreshAggregates(c: Db) {
  await canonicalizeTitles(c);
  const total = Number((await one(c, `SELECT count(*)::int AS n FROM global_postings`))!.n) || 1;
  await q(c, `DELETE FROM job_title_clusters`);
  await q(c, `
    INSERT INTO job_title_clusters (normalized_title, display_title, postings, companies, raw_variants, departments, seniority, skill_profile, top_companies)
    SELECT p.normalized_title,
      (SELECT raw_title FROM global_postings x WHERE x.normalized_title = p.normalized_title GROUP BY raw_title ORDER BY count(*) DESC, raw_title LIMIT 1),
      count(*)::int, count(DISTINCT company)::int,
      (SELECT coalesce(json_agg(v ORDER BY v.n DESC), '[]') FROM (SELECT raw_title AS title, count(*)::int AS n FROM global_postings x WHERE x.normalized_title = p.normalized_title GROUP BY raw_title ORDER BY n DESC LIMIT 12) v),
      (SELECT coalesce(json_agg(v ORDER BY v.n DESC), '[]') FROM (SELECT department AS name, count(*)::int AS n FROM global_postings x WHERE x.normalized_title = p.normalized_title AND coalesce(department, '') <> '' GROUP BY department ORDER BY n DESC LIMIT 5) v),
      (SELECT coalesce(json_agg(v ORDER BY v.n DESC), '[]') FROM (SELECT coalesce(experience_level, seniority, 'Not stated') AS level, count(*)::int AS n FROM global_postings x WHERE x.normalized_title = p.normalized_title GROUP BY 1 ORDER BY n DESC LIMIT 6) v),
      (SELECT coalesce(json_agg(v ORDER BY v.share DESC), '[]') FROM (
         SELECT s.id AS skill_id, s.name, round(count(*)::numeric / max(t.n), 3) AS share
         FROM global_postings x CROSS JOIN LATERAL unnest(x.skill_ids) sid JOIN skills s ON s.id = sid
         CROSS JOIN (SELECT count(*) AS n FROM global_postings y WHERE y.normalized_title = p.normalized_title) t
         WHERE x.normalized_title = p.normalized_title GROUP BY s.id, s.name ORDER BY share DESC LIMIT 25) v),
      (SELECT coalesce(json_agg(v ORDER BY v.n DESC), '[]') FROM (SELECT company AS name, count(*)::int AS n FROM global_postings x WHERE x.normalized_title = p.normalized_title GROUP BY company ORDER BY n DESC LIMIT 8) v)
    FROM global_postings p GROUP BY p.normalized_title HAVING count(*) >= 2`);
  await q(c, `DELETE FROM job_skill_stats`);
  // one pass: per skill counts, top industries and top titles
  await q(c, `
    WITH x AS MATERIALIZED (SELECT sid, company, coalesce(industry, 'Not stated') AS industry, normalized_title FROM global_postings CROSS JOIN LATERAL unnest(skill_ids) sid),
    g AS (SELECT sid, count(*)::int AS n, count(DISTINCT company)::int AS c FROM x GROUP BY sid),
    ind AS (SELECT sid, json_agg(json_build_object('industry', industry, 'n', n) ORDER BY n DESC) AS j FROM (SELECT sid, industry, n, row_number() OVER (PARTITION BY sid ORDER BY n DESC) rn FROM (SELECT sid, industry, count(*)::int n FROM x GROUP BY 1, 2) a) b WHERE rn <= 6 GROUP BY sid),
    tit AS (SELECT sid, json_agg(json_build_object('title', title, 'n', n) ORDER BY n DESC) AS j FROM (SELECT sid, title, n, row_number() OVER (PARTITION BY sid ORDER BY n DESC) rn FROM (SELECT sid, normalized_title AS title, count(*)::int n FROM x GROUP BY 1, 2) a) b WHERE rn <= 8 GROUP BY sid)
    INSERT INTO job_skill_stats (skill_id, postings, share, companies, by_industry, top_titles)
    SELECT g.sid, g.n, round(g.n::numeric / $1, 4), g.c, coalesce(ind.j, '[]'::json), coalesce(tit.j, '[]'::json) FROM g LEFT JOIN ind USING (sid) LEFT JOIN tit USING (sid)`, [total]);
  const kept = await q(c, `SELECT lower(term) AS k, status, skill_id FROM job_candidate_terms WHERE status <> 'Candidate'`);
  const companiesAll = Number((await one(c, `SELECT count(DISTINCT company)::int AS n FROM global_postings`))!.n);
  // a term must appear at several employers: 2 for listed tools, at least 3 (or 0.5% of employers) for discovered terms
  const minListed = companiesAll >= 60 ? 3 : 2, minFound = Math.max(3, Math.ceil(companiesAll * 0.005));
  await q(c, `DELETE FROM job_candidate_terms`);
  // one pass over the postings: counts, the most common spelling and the top titles per term
  await q(c, `
    WITH x AS MATERIALIZED (SELECT regexp_replace(lower(t), '([a-z]{3,})s$', '\\1') AS k, t, company, normalized_title FROM global_postings CROSS JOIN LATERAL unnest(candidate_terms) t),
    g AS (SELECT k, count(*)::int AS n, count(DISTINCT company)::int AS c, bool_or(lower(t) = ANY($4::text[])) AS listed FROM x GROUP BY k),
    keep AS (SELECT * FROM g WHERE c >= CASE WHEN listed THEN $2::int ELSE $3::int END ORDER BY c DESC, n DESC LIMIT 2000),
    disp AS (SELECT DISTINCT ON (k) k, t FROM (SELECT x.k, x.t, count(*) AS cnt FROM x JOIN keep USING (k) GROUP BY 1, 2) z ORDER BY k, cnt DESC),
    tt AS (SELECT k, json_agg(json_build_object('title', title, 'n', n) ORDER BY n DESC) AS top FROM (
             SELECT k, title, n, row_number() OVER (PARTITION BY k ORDER BY n DESC) AS rn FROM (SELECT x.k, x.normalized_title AS title, count(*)::int AS n FROM x JOIN keep USING (k) GROUP BY 1, 2) a) b WHERE rn <= 6 GROUP BY k)
    INSERT INTO job_candidate_terms (term, postings, companies, share, top_titles, kind)
    SELECT disp.t, keep.n, keep.c, round(keep.n::numeric / $1, 4), coalesce(tt.top, '[]'::json), CASE WHEN keep.listed THEN 'listed' ELSE 'discovered' END
    FROM keep JOIN disp USING (k) LEFT JOIN tt USING (k) ON CONFLICT (term) DO NOTHING`,
    [total, minListed, minFound, (await import("./extract")).CANDIDATE_TERMS.map(t => t.toLowerCase())]);
  for (const k of kept) await q(c, `UPDATE job_candidate_terms SET status = $2, skill_id = $3 WHERE lower(term) = $1`, [k.k, k.status, k.skill_id]);
  await suggestForCandidates(c);
  // period of the middle 90% of dated postings, so a few stray old dates do not stretch it
  const period = await one(c, `SELECT percentile_disc(0.05) WITHIN GROUP (ORDER BY posted_date) AS f, percentile_disc(0.95) WITHIN GROUP (ORDER BY posted_date) AS t FROM global_postings WHERE posted_date IS NOT NULL`);
  return { total, period };
}

/** Close candidates the library already covers; suggest an existing skill (alias) or a category for the rest. */
export async function suggestForCandidates(c: Db) {
  // close every candidate that a library skill already finds (by name, alias, matching phrase or spelling variant)
  const skills = await q(c, `SELECT id AS skill_id, name, aliases FROM skills WHERE org_id IS NULL AND status = 'Active'`);
  const covered = coveredTerms(skills);
  const open = await q(c, `SELECT term FROM job_candidate_terms WHERE status = 'Candidate'`);
  const hit = open.map(o => [o.term, covered.get(termKey(o.term))]).filter(([, id]) => id) as [string, string][];
  if (hit.length) await q(c, `UPDATE job_candidate_terms t SET status = 'Added', skill_id = x.s FROM unnest($1::text[], $2::text[]) AS x(term, s) WHERE t.term = x.term`, [hit.map(h => h[0]), hit.map(h => h[1])]);
  // suggestion for the rest: the term contains a library skill name or alias as whole words ("Azure DevOps" -> Microsoft Azure), or reads almost the same
  const names = [...covered.entries()].filter(([k]) => k.length >= 3);
  const rest = await q(c, `SELECT term FROM job_candidate_terms WHERE status = 'Candidate'`);
  const sug: [string, string][] = [];
  for (const r of rest) {
    const k = ` ${termKey(r.term)} `; let best: string | null = null, len = 0;
    for (const [n, id] of names) if (k.includes(` ${n} `) && n.length > len) { best = id; len = n.length; }
    // a one-word term that starts a library name: "Oracle" -> Oracle Database, "Rust" -> Rust Programming
    if (!best && !k.trim().includes(" ")) { let short = 99; for (const [n, id] of names) if (n.startsWith(`${k.trim()} `) && n.length < short) { best = id; short = n.length; } }
    if (best) sug.push([r.term, best]);
  }
  await q(c, `UPDATE job_candidate_terms SET suggested_skill_id = NULL WHERE status = 'Candidate'`);
  if (sug.length) await q(c, `UPDATE job_candidate_terms t SET suggested_skill_id = x.s FROM unnest($1::text[], $2::text[]) AS x(term, s) WHERE t.term = x.term`, [sug.map(h => h[0]), sug.map(h => h[1])]);
  await q(c, `UPDATE job_candidate_terms t SET suggested_skill_id = (SELECT s.id FROM skills s WHERE s.org_id IS NULL AND similarity(lower(s.name), lower(t.term)) >= 0.7 ORDER BY similarity(lower(s.name), lower(t.term)) DESC LIMIT 1)
    WHERE t.status = 'Candidate' AND t.suggested_skill_id IS NULL`);
  // category: the most common category of library skills mentioned in the same postings
  await q(c, `UPDATE job_candidate_terms t SET suggested_category = x.category FROM (
      SELECT DISTINCT ON (k) k, category FROM (
        SELECT lower(ct) AS k, s.category, count(*) AS n FROM global_postings p CROSS JOIN LATERAL unnest(p.candidate_terms) ct CROSS JOIN LATERAL unnest(p.skill_ids) sid JOIN skills s ON s.id = sid
        WHERE lower(ct) IN (SELECT lower(term) FROM job_candidate_terms WHERE status = 'Candidate') GROUP BY 1, 2) z ORDER BY k, n DESC) x
    WHERE lower(t.term) = x.k AND t.status = 'Candidate'`);
}
