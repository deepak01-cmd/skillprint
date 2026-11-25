/* A company's own job postings, kept private to that company: title groups with their skill profile, and skill terms
   its postings ask for that neither the global library nor the company's own skills cover yet. */
import { Db, one, q } from "../db";
import { coveredTerms, termKey } from "./extract";

export async function refreshOrgAggregates(db: Db, orgId: string) {
  const total = Number((await one(db, `SELECT count(*)::int AS n FROM job_postings WHERE org_id = $1`, [orgId]))!.n);
  await q(db, `DELETE FROM org_title_clusters WHERE org_id = $1`, [orgId]);
  if (total) await q(db, `
    WITH p AS MATERIALIZED (SELECT id, raw_title, normalized_title, skill_ids FROM job_postings WHERE org_id = $1),
    g AS (SELECT normalized_title, count(*)::int AS n FROM p GROUP BY 1),
    disp AS (SELECT DISTINCT ON (normalized_title) normalized_title, raw_title FROM (SELECT normalized_title, raw_title, count(*) c FROM p GROUP BY 1, 2) z ORDER BY normalized_title, c DESC),
    vars AS (SELECT normalized_title, json_agg(json_build_object('title', raw_title, 'n', c) ORDER BY c DESC) AS j FROM (SELECT normalized_title, raw_title, count(*)::int c FROM p GROUP BY 1, 2) z GROUP BY 1),
    sk AS (SELECT x.normalized_title, json_agg(json_build_object('skill_id', s.id, 'name', s.name, 'share', round(x.k::numeric / g.n, 3)) ORDER BY x.k DESC) AS j
           FROM (SELECT normalized_title, sid, count(*)::int AS k FROM p CROSS JOIN LATERAL unnest(skill_ids) sid GROUP BY 1, 2) x
           JOIN g USING (normalized_title) JOIN skills s ON s.id = x.sid GROUP BY x.normalized_title)
    INSERT INTO org_title_clusters (org_id, normalized_title, display_title, postings, raw_variants, skill_profile)
    SELECT $1, g.normalized_title, disp.raw_title, g.n, coalesce(vars.j, '[]'), coalesce(sk.j, '[]') FROM g JOIN disp USING (normalized_title) LEFT JOIN vars USING (normalized_title) LEFT JOIN sk USING (normalized_title)
    WHERE g.normalized_title <> ''`, [orgId]);

  // candidate terms: grouped by spelling-insensitive key, in at least 2 postings (3 for bigger uploads)
  const kept = await q(db, `SELECT lower(term) AS k, status, skill_id FROM org_candidate_terms WHERE org_id = $1 AND status <> 'Candidate'`, [orgId]);
  await q(db, `DELETE FROM org_candidate_terms WHERE org_id = $1`, [orgId]);
  if (total) await q(db, `
    WITH x AS MATERIALIZED (SELECT regexp_replace(lower(t), '([a-z]{3,})s$', '\\1') AS k, t, normalized_title FROM job_postings CROSS JOIN LATERAL unnest(candidate_terms) t WHERE org_id = $1),
    g AS (SELECT k, count(*)::int AS n FROM x GROUP BY k HAVING count(*) >= $3 ORDER BY 2 DESC LIMIT 1000),
    disp AS (SELECT DISTINCT ON (k) k, t FROM (SELECT x.k, x.t, count(*) c FROM x JOIN g USING (k) GROUP BY 1, 2) z ORDER BY k, c DESC),
    tt AS (SELECT k, json_agg(json_build_object('title', title, 'n', n) ORDER BY n DESC) AS j FROM (SELECT k, title, n, row_number() OVER (PARTITION BY k ORDER BY n DESC) rn FROM (SELECT x.k, x.normalized_title AS title, count(*)::int n FROM x JOIN g USING (k) GROUP BY 1, 2) a) b WHERE rn <= 5 GROUP BY k)
    INSERT INTO org_candidate_terms (org_id, term, postings, share, top_titles)
    SELECT $1, disp.t, g.n, round(g.n::numeric / $2, 4), coalesce(tt.j, '[]') FROM g JOIN disp USING (k) LEFT JOIN tt USING (k) ON CONFLICT DO NOTHING`, [orgId, total, total >= 200 ? 3 : 2]);
  for (const k of kept) await q(db, `UPDATE org_candidate_terms SET status = $3, skill_id = $4 WHERE org_id = $1 AND lower(term) = $2`, [orgId, k.k, k.status, k.skill_id]);

  // close terms covered by global or company skills; suggest a look-alike for the rest
  const skills = await q(db, `SELECT id AS skill_id, name, aliases FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const covered = coveredTerms(skills);
  const open = await q(db, `SELECT term FROM org_candidate_terms WHERE org_id = $1 AND status = 'Candidate'`, [orgId]);
  const names = [...covered.entries()].filter(([k]) => k.length >= 3);
  for (const o of open) {
    const key = termKey(o.term); const hit = covered.get(key);
    if (hit) { await q(db, `UPDATE org_candidate_terms SET status = 'Added', skill_id = $3 WHERE org_id = $1 AND term = $2`, [orgId, o.term, hit]); continue; }
    const k = ` ${key} `; let best: string | null = null, len = 0;
    for (const [n, id] of names) if (k.includes(` ${n} `) && n.length > len) { best = id; len = n.length; }
    if (!best && !key.includes(" ")) { let short = 99; for (const [n, id] of names) if (n.startsWith(`${key} `) && n.length < short) { best = id; short = n.length; } }
    if (best) await q(db, `UPDATE org_candidate_terms SET suggested_skill_id = $3 WHERE org_id = $1 AND term = $2`, [orgId, o.term, best]);
  }
  await q(db, `UPDATE org_candidate_terms t SET suggested_category = x.category FROM (
      SELECT DISTINCT ON (k) k, category FROM (SELECT lower(ct) AS k, s.category, count(*) AS n FROM job_postings p CROSS JOIN LATERAL unnest(p.candidate_terms) ct CROSS JOIN LATERAL unnest(p.skill_ids) sid JOIN skills s ON s.id = sid
        WHERE p.org_id = $1 GROUP BY 1, 2) z ORDER BY k, n DESC) x WHERE t.org_id = $1 AND lower(t.term) = x.k AND t.status = 'Candidate'`, [orgId]);
  return { postings: total };
}
