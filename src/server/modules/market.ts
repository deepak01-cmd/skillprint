/* Module 14: market intelligence from imported job postings (platform data, shared as aggregates).
   Uses: role fallback (market titles), role profile check against postings, skill demand, candidate new skills, role templates. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { assertReadFramework, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { listActive } from "./mapping";
import { applyCandidate, proposeCandidate, twoStep } from "./library";
import { canonicalTitle, normalizeJobTitle } from "../market/extract";
import { loadTitleVocab } from "../market/ingest";

export const SMALL_SAMPLE = 10;

/** Market title groups for a role title and its alternative titles: exact normalised match first, then similar titles. */
export async function marketMatch(db: Db, titles: string[]) {
  const vocab = await loadTitleVocab(db);
  const norms = [...new Set(titles.map(t => canonicalTitle(normalizeJobTitle(t).title, vocab)).filter(Boolean))];
  const exact = norms.length ? await q(db, `SELECT normalized_title, display_title, postings, companies, skill_profile, seniority, departments FROM job_title_clusters WHERE normalized_title = ANY($1) ORDER BY postings DESC`, [norms]) : [];
  const similar: any[] = norms.length ? await q(db, `SELECT normalized_title, display_title, postings, companies, round(similarity(normalized_title, $1)::numeric, 2) AS score FROM job_title_clusters
    WHERE normalized_title <> ALL($2) AND similarity(normalized_title, $1) >= 0.45 ORDER BY similarity(normalized_title, $1) DESC, postings DESC LIMIT 8`, [norms[0], norms]) : [];
  // Keyword fallback: "Senior .NET Lead" has no title group of its own, but "dotnet developer" postings say what .NET work needs
  if (!exact.length && similar.length < 2) {
    const words = keyWords(titles[0] || "");
    if (words.length) {
      const seen = new Set(similar.map(s => s.normalized_title));
      // read the postings themselves: titles seen only once or twice never form a title group
      const kw = await q(db, `SELECT normalized_title, min(raw_title) AS display_title, count(*)::int AS postings, count(DISTINCT company)::int AS companies, 0.5 AS score FROM global_postings
        WHERE ${words.map((_, i) => `normalized_title ~ ('\\m' || $${i + 1} || '\\M')`).join(" AND ")} GROUP BY normalized_title ORDER BY count(*) DESC LIMIT 8`, words);
      similar.push(...kw.filter(k => !seen.has(k.normalized_title)));
    }
  }
  return { exact, similar };
}

const GENERIC = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "head", "chief", "of", "and", "the", "for", "i", "ii", "iii", "iv",
  "developer", "engineer", "manager", "specialist", "analyst", "consultant", "associate", "executive", "officer", "expert", "architect", "intern", "trainee", "team", "tech", "technical"]);
/** The distinctive words of a title, with ".NET"/"C#"/"C++" spelled as the posting titles spell them. */
export function keyWords(title: string) {
  const t = title.toLowerCase().replace(/\.net\b|dot ?net/g, " dotnet ").replace(/c#|c sharp/g, " csharp ").replace(/c\+\+/g, " cpp ").replace(/[^a-z0-9]+/g, " ");
  return [...new Set(t.split(" ").filter(w => w.length >= 2 && !GENERIC.has(w)))].slice(0, 3);
}

/** Pooled skill profile over a set of title groups, recomputed from the postings. */
export async function pooledProfile(db: Db, normTitles: string[]) {
  if (!normTitles.length) return { postings: 0, companies: 0, skills: [] as any[] };
  const base = await one(db, `SELECT count(*)::int AS n, count(DISTINCT company)::int AS c FROM global_postings WHERE normalized_title = ANY($1)`, [normTitles]);
  const skills = await q(db, `SELECT s.id AS skill_id, s.name, count(*)::int AS postings, round(count(*)::numeric / $2, 3) AS share FROM global_postings p CROSS JOIN LATERAL unnest(p.skill_ids) sid JOIN skills s ON s.id = sid
    WHERE p.normalized_title = ANY($1) GROUP BY s.id, s.name ORDER BY postings DESC`, [normTitles, Math.max(1, base!.n)]);
  return { postings: base!.n, companies: base!.c, skills: skills.map(s => ({ ...s, share: Number(s.share) })) };
}

async function sourceInfo(db: Db) {
  const s = await q(db, `SELECT id, name, licence, rows_read, rows_imported, period_from, period_to, imported_at FROM job_sources ORDER BY imported_at DESC`);
  return { sources: s, licensed: s.some(x => x.licence), single_period: s.every(x => !x.period_from || !x.period_to || (new Date(x.period_to).getTime() - new Date(x.period_from).getTime()) < 120 * 864e5) };
}

const requireMarket = (u: User) => { if (!has(u, "roles:read") && u.role !== "platform_admin") throw forbidden(); };

export const routes: Route[] = [
  { method: "GET", pattern: "/market/summary", handler: async ({ db, user }) => {
    requireMarket(user);
    const info = await sourceInfo(db);
    const t = await one(db, `SELECT count(*)::int AS postings, count(DISTINCT company)::int AS companies, count(DISTINCT normalized_title)::int AS titles,
      count(*) FILTER (WHERE cardinality(skill_ids) > 0)::int AS with_library_skill,
      percentile_disc(0.05) WITHIN GROUP (ORDER BY posted_date) AS period_from, percentile_disc(0.95) WITHIN GROUP (ORDER BY posted_date) AS period_to,
      count(*) FILTER (WHERE posted_date IS NOT NULL)::int AS dated FROM global_postings`);
    const clusters = await q(db, `SELECT normalized_title, display_title, postings, companies FROM job_title_clusters ORDER BY companies DESC, postings DESC LIMIT 25`);
    const skills = await q(db, `SELECT j.skill_id, s.name, j.postings, j.share, j.companies FROM job_skill_stats j JOIN skills s ON s.id = j.skill_id ORDER BY j.postings DESC LIMIT 25`);
    const unseen = await q(db, `SELECT id, name FROM skills WHERE org_id IS NULL AND id NOT IN (SELECT skill_id FROM job_skill_stats) ORDER BY id`);
    const candidates = await one(db, `SELECT count(*) FILTER (WHERE status = 'Candidate')::int AS open FROM job_candidate_terms`);
    const industries = await q(db, `SELECT coalesce(industry, 'Not stated') AS industry, count(*)::int AS n FROM global_postings GROUP BY 1 ORDER BY n DESC LIMIT 10`);
    const countries = await q(db, `SELECT coalesce(country, 'Not stated') AS country, count(*)::int AS n FROM global_postings GROUP BY 1 ORDER BY n DESC LIMIT 8`);
    let roleCoverage = null;
    if (user.org_id) {
      const roles = await q(db, `SELECT id, title, alt_titles FROM job_roles WHERE org_id = $1 AND status = 'Published' ORDER BY title`, [user.org_id]);
      const rows = [];
      for (const r of roles) { const m = await marketMatch(db, [r.title, ...(r.alt_titles || [])]); rows.push({ role_id: r.id, title: r.title, postings: m.exact.reduce((a: number, x: any) => a + x.postings, 0), similar: m.similar.length }); }
      roleCoverage = rows;
    }
    return { ...info, totals: t, top_titles: clusters, top_skills: skills.map(s => ({ ...s, share: Number(s.share) })), library_skills_not_seen: unseen, open_candidates: candidates!.open,
      industries, countries, role_coverage: roleCoverage,
      caveats: [
        info.licensed ? null : "No licence or usage rights are recorded for this data. It is used for title matching, templates and profile checks, not as trend evidence.",
        info.single_period ? "The postings cover one short period, so they show current demand only, not whether demand is rising or falling. A second snapshot is needed for trends." : null,
        "A skill counts as mentioned when its name, alias or a common synonym appears in the posting. Mentions do not show the level required.",
      ].filter(Boolean) };
  } },
  { method: "GET", pattern: "/market/titles", handler: async ({ db, user, query }) => {
    requireMarket(user);
    const t = normalizeJobTitle(query.get("q") || "").title;
    const min = Math.max(1, Number(query.get("min_postings")) || 1);
    const exists = `(SELECT r.id FROM job_roles r WHERE r.org_id = $1 AND r.status <> 'Archived' AND (lower(r.title) = lower(c.display_title) OR c.display_title ILIKE ANY(r.alt_titles)) LIMIT 1) AS existing_role,
      (SELECT count(*) FROM jsonb_array_elements(c.skill_profile) x WHERE (x->>'share')::numeric >= 0.2)::int AS common_skills`;
    if (!t) return q(db, `SELECT c.normalized_title, c.display_title, c.postings, c.companies, ${exists} FROM job_title_clusters c WHERE c.postings >= $2 ORDER BY c.companies DESC, c.postings DESC LIMIT 200`, [user.org_id, min]);
    return q(db, `SELECT c.normalized_title, c.display_title, c.postings, c.companies, round(similarity(c.normalized_title, $2)::numeric, 2) AS score, ${exists} FROM job_title_clusters c
      WHERE c.postings >= $3 AND (c.normalized_title LIKE '%' || $2 || '%' OR similarity(c.normalized_title, $2) >= 0.35) ORDER BY (c.normalized_title = $2) DESC, similarity(c.normalized_title, $2) DESC, c.companies DESC, c.postings DESC LIMIT 200`, [user.org_id, t, min]);
  } },
  { method: "GET", pattern: "/market/titles/:norm", handler: async ({ db, user, params }) => {
    requireMarket(user);
    const c = await one(db, `SELECT * FROM job_title_clusters WHERE normalized_title = $1`, [params.norm]);
    if (!c) throw notFound("Market title");
    const template = await one(db, `SELECT id, title FROM role_templates WHERE cluster_title = $1`, [params.norm]);
    const samples = await q(db, `SELECT company, raw_title, location, posted_date, left(description, 400) AS excerpt FROM global_postings WHERE normalized_title = $1 ORDER BY posted_date DESC NULLS LAST LIMIT 5`, [params.norm]);
    return { ...c, small_sample: c.postings < SMALL_SAMPLE, template, samples };
  } },
  // Role profile check: does the framework match what the market asks for this role?
  { method: "GET", pattern: "/market/roles/:id", handler: async ({ db, user, params }) => {
    const role = await assertReadFramework(db, user, params.id);
    const full = await one(db, `SELECT title, alt_titles FROM job_roles WHERE id = $1`, [role.id]);
    const m = await marketMatch(db, [full.title, ...(full.alt_titles || [])]);
    const used = m.exact.map((x: any) => x.normalized_title);
    const prof = await pooledProfile(db, used);
    const mapped = await listActive(db, role.org_id, { roleId: role.id });
    const share = new Map(prof.skills.map(s => [s.skill_id, s]));
    const mappedSet = new Set(mapped.map(x => x.skill_id));
    const drafts = new Set((await q(db, `SELECT skill_id FROM role_skill_mapping WHERE org_id = $1 AND role_id = $2`, [role.org_id, role.id])).map(x => x.skill_id));
    return {
      role_id: role.id, title: full.title, matched_titles: m.exact.map((x: any) => ({ normalized_title: x.normalized_title, display_title: x.display_title, postings: x.postings, companies: x.companies })),
      similar_titles: m.similar, postings: prof.postings, companies: prof.companies, small_sample: prof.postings < SMALL_SAMPLE,
      mapped: mapped.map(x => ({ pixel_id: x.pixel_id, skill_id: x.skill_id, skill_name: x.skill_name, requirement_type: x.requirement_type, skill_trend: x.skill_trend,
        market_share: share.get(x.skill_id)?.share ?? 0, market_postings: share.get(x.skill_id)?.postings ?? 0 })),
      not_mapped: prof.skills.filter(s => !mappedSet.has(s.skill_id) && s.share >= 0.15 && s.postings >= 3).map(s => ({ ...s, already_in_role: drafts.has(s.skill_id) })),
      note: prof.postings ? `Based on ${prof.postings} postings at ${prof.companies} employers with the same title. Mentions are not proof of required level.` : "No postings with this title. Try a similar market title or add an alternative title to the role.",
    };
  } },
  { method: "GET", pattern: "/market/skills/:id", handler: async ({ db, user, params }) => {
    requireMarket(user);
    const s = await one(db, `SELECT j.*, k.name FROM job_skill_stats j JOIN skills k ON k.id = j.skill_id WHERE j.skill_id = $1`, [params.id]);
    const info = await sourceInfo(db);
    return s ? { ...s, share: Number(s.share), single_period: info.single_period, licensed: info.licensed } : { skill_id: params.id, postings: 0, share: 0, note: "Not mentioned in the imported postings" };
  } },
  { method: "GET", pattern: "/market/candidates", handler: async ({ db, user }) => {
    requireMarket(user);
    return q(db, `SELECT c.*, s.name AS skill_name, g.name AS suggested_skill_name, g.category AS suggested_skill_category FROM job_candidate_terms c LEFT JOIN skills s ON s.id = c.skill_id LEFT JOIN skills g ON g.id = c.suggested_skill_id
      ORDER BY (c.status = 'Candidate') DESC, c.companies DESC, c.postings DESC LIMIT 5000`);
  } },
  // Platform admin turns a candidate term into a global skill, or ignores it (7.7: candidates enter through review, never directly)
  { method: "POST", pattern: "/market/candidates/:term/decide", handler: async ({ user, params, body }) => {
    if (user.role !== "platform_admin") throw forbidden("The platform administrator manages the global library");
    const b = z.object({ action: z.enum(["add", "ignore"]), name: z.string().min(1).optional(), category: z.string().min(2).optional(), definition: z.string().min(5).optional() }).parse(body);
    return tx(async c => {
      const t = await one(c, `SELECT * FROM job_candidate_terms WHERE term = $1 FOR UPDATE`, [params.term]);
      if (!t) throw notFound("Candidate");
      if (t.status !== "Candidate") throw conflict("decided", `Already ${t.status}`);
      if (b.action === "ignore") { await q(c, `UPDATE job_candidate_terms SET status = 'Ignored' WHERE term = $1`, [t.term]); await audit(c, user, { entity_type: "market_candidate", entity_id: t.term, action: "ignored" }); return { status: "Ignored" }; }
      if (!b.category || !b.definition) throw unprocessable("details_required", "Give a category and a definition for the new skill");
      const name = b.name || t.term;
      const dup = await one(c, `SELECT id, name FROM skills WHERE org_id IS NULL AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [name]);
      if (dup) throw conflict("duplicate_skill", `${dup.name} (${dup.id}) already covers this term`);
      const s = await one(c, `INSERT INTO skills (org_id, name, definition, category, aliases) VALUES (NULL,$1,$2,$3,$4) RETURNING id`, [name, b.definition, b.category, name === t.term ? [] : [t.term]]);
      await q(c, `UPDATE job_candidate_terms SET status = 'Added', skill_id = $2 WHERE term = $1`, [t.term, s!.id]);
      await audit(c, user, { entity_type: "skill", entity_id: s!.id, action: "created_from_market", after: { term: t.term, postings: t.postings } });
      return { status: "Added", skill_id: s!.id, note: "Re-run the import to count this skill in postings." };
    });
  } },
  // Bulk review: add terms as new global skills, as alternative names (aliases) of an existing skill, or ignore them
  { method: "POST", pattern: "/market/candidates/bulk", handler: async ({ db, user, body }) => {
    if (user.role !== "platform_admin") throw forbidden("The platform administrator manages the global library");
    const b = z.object({ action: z.enum(["add", "alias", "ignore"]), items: z.array(z.object({ term: z.string(), name: z.string().min(1).max(120).optional(), category: z.string().min(2).optional(), definition: z.string().min(10).optional(), skill_id: z.string().optional() })).min(1).max(500) }).parse(body);
    const second = await twoStep(db);
    return tx(async c => {
      const out: any[] = [];
      for (const it of b.items) {
        const t = await one(c, `SELECT * FROM job_candidate_terms WHERE term = $1 FOR UPDATE`, [it.term]);
        if (!t || t.status !== "Candidate") { out.push({ term: it.term, status: "skipped", reason: t ? `already ${t.status}` : "not found" }); continue; }
        if (b.action === "ignore") { await q(c, `UPDATE job_candidate_terms SET status = 'Ignored', decided_by_name = $2 WHERE term = $1`, [t.term, user.name]); out.push({ term: t.term, status: "Ignored" }); continue; }
        if (b.action === "add" && (!it.category || !it.definition)) { out.push({ term: t.term, status: "skipped", reason: "category and definition are needed" }); continue; }
        if (b.action === "alias" && !(it.skill_id || t.suggested_skill_id)) { out.push({ term: t.term, status: "skipped", reason: "choose an existing global skill" }); continue; }
        // two-step approval: record a proposal for a second person; otherwise apply now
        out.push(second ? await proposeCandidate(c, t, b.action, { ...it, skill_id: it.skill_id || (b.action === "alias" ? t.suggested_skill_id : undefined) }, user)
          : await applyCandidate(c, t, b.action, it, { id: user.id, name: user.name, org_id: null }));
      }
      const proposed = out.filter(o => o.status === "Proposed").length;
      return { results: out, done: out.filter(o => o.status !== "skipped").length, proposed,
        note: proposed ? `${proposed} proposal(s) wait for a second person: a library reviewer or another platform administrator.` : "Re-scan the postings so the new skills and names are counted." };
    });
  } },
  // Platform admin promotes a market title group to a role template (feeds the role fallback)
  { method: "POST", pattern: "/market/titles/:norm/promote", handler: async ({ user, params, body }) => {
    if (user.role !== "platform_admin") throw forbidden("The platform administrator manages role templates");
    const b = z.object({ title: z.string().min(2).optional(), min_share: z.coerce.number().min(0.05).max(0.9).default(0.2) }).parse(body || {});
    return tx(async c => {
      const cl = await one(c, `SELECT * FROM job_title_clusters WHERE normalized_title = $1`, [params.norm]);
      if (!cl) throw notFound("Market title");
      const prof = await pooledProfile(c, [cl.normalized_title]);
      const skills = prof.skills.filter(s => s.share >= b.min_share).map(s => ({ skill_id: s.skill_id, required_level: 3, requirement_type: s.share >= 0.5 ? "Mandatory" : "Optional", importance: s.share >= 0.5 ? "High" : "Medium", market_share: s.share }));
      if (!skills.length) throw unprocessable("no_skills", `No library skill appears in at least ${Math.round(b.min_share * 100)}% of these postings`);
      const title = b.title || cl.display_title;
      const variants = (cl.raw_variants || []).map((v: any) => v.title).filter((t: string) => t.toLowerCase() !== title.toLowerCase()).slice(0, 10);
      const t = await one(c, `INSERT INTO role_templates (title, aliases, job_family, industry, summary, skills, source, cluster_title, postings) VALUES ($1,$2,NULL,'Cross-industry (job postings)',$3,$4,$5,$6,$7)
        ON CONFLICT (title, industry) DO UPDATE SET aliases = EXCLUDED.aliases, skills = EXCLUDED.skills, postings = EXCLUDED.postings, cluster_title = EXCLUDED.cluster_title RETURNING id`,
        [title, variants, `Built from ${prof.postings} job postings at ${prof.companies} employers. Levels default to 3; review them.`, JSON.stringify(skills), "Job-postings analysis", cl.normalized_title, prof.postings]);
      await audit(c, user, { entity_type: "role_template", entity_id: t!.id, action: "promoted_from_market", after: { cluster: cl.normalized_title, skills: skills.length } });
      return { template_id: t!.id, skills: skills.length };
    });
  } },
  { method: "POST", pattern: "/market/sources/:id/licence", handler: async ({ db, user, params, body }) => {
    if (user.role !== "platform_admin") throw forbidden();
    const licence = z.string().min(5).parse(body.licence);
    await q(db, `UPDATE job_sources SET licence = $2 WHERE id = $1`, [params.id, licence]);
    await audit(db, user, { entity_type: "job_source", entity_id: params.id, action: "licence_recorded", after: { licence } });
    return { ok: true };
  } },
];
