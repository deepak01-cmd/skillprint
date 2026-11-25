/* HR's own job postings: private to the company. They grow the company's skills, roles and frameworks:
   - titles in the postings become draft roles, or add the missing skills to an existing role's framework as drafts;
   - skill terms the postings ask for become company skills, or other names for an existing skill. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { draftRole, normalizeTitle, titleKey } from "./roleFallback";
import { buildPixelId } from "./mapping";

const hrOnly = (u: User) => { if (!has(u, "roles:write") && !has(u, "skills:write")) throw forbidden("HR administrators and department heads work with the company's job postings"); };

/** Existing company roles that a posting title stands for (same title after normalisation, or an alternative title). */
async function roleIndex(db: Db, orgId: string) {
  const roles = await q(db, `SELECT id, title, alt_titles, status, department_id FROM job_roles WHERE org_id = $1 AND status <> 'Archived'`, [orgId]);
  const by = new Map<string, any>();
  for (const r of roles) for (const t of [r.title, ...(r.alt_titles || [])]) { const k = titleKey(normalizeTitle(t).core); if (k && !by.has(k)) by.set(k, r); }
  return (norm: string) => by.get(titleKey(normalizeTitle(norm).core)) || by.get(titleKey(norm));
}

export const routes: Route[] = [
  { method: "GET", pattern: "/company-postings", handler: async ({ db, user }) => {
    hrOnly(user); const orgId = orgOf(user);
    const sources = await q(db, `SELECT s.id, s.name, s.file_name, s.rows_read, s.rows_imported, s.imported_at, s.imported_by, (SELECT count(*) FROM job_postings p WHERE p.source_id = s.id)::int AS postings
      FROM job_sources s WHERE s.org_id = $1 ORDER BY s.imported_at DESC`, [orgId]);
    const t = await one(db, `SELECT (SELECT count(*) FROM job_postings WHERE org_id = $1)::int AS postings, (SELECT count(*) FROM org_title_clusters WHERE org_id = $1)::int AS titles,
      (SELECT count(*) FROM job_postings WHERE org_id = $1 AND cardinality(skill_ids) > 0)::int AS with_skills,
      (SELECT count(*) FROM org_candidate_terms WHERE org_id = $1 AND status = 'Candidate')::int AS candidates`, [orgId]);
    return { ...t, sources };
  } },
  { method: "DELETE", pattern: "/company-postings/sources/:id", handler: async ({ user, params }) => {
    if (!has(user, "skills:write")) throw forbidden();
    return tx(async c => {
      const s = await one(c, `SELECT * FROM job_sources WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
      if (!s) throw notFound("Upload");
      await q(c, `DELETE FROM job_postings WHERE source_id = $1`, [s.id]);
      await q(c, `DELETE FROM job_sources WHERE id = $1`, [s.id]);
      const { refreshOrgAggregates } = await import("../market/company");
      await refreshOrgAggregates(c, s.org_id);
      await audit(c, user, { entity_type: "job_source", entity_id: s.id, action: "deleted", after: { file: s.file_name } });
      return { deleted: s.id };
    });
  } },
  // titles in the company's postings: a new role to draft, or an existing role whose framework misses skills the postings ask for
  { method: "GET", pattern: "/company-postings/titles", handler: async ({ db, user, query }) => {
    hrOnly(user); const orgId = orgOf(user);
    const minShare = Math.min(0.9, Math.max(0.05, Number(query.get("min_share")) || 0.2));
    const find = await roleIndex(db, orgId);
    const fw = await q(db, `SELECT role_id, skill_id FROM role_skill_mapping WHERE org_id = $1 AND lifecycle_status = 'Active'`, [orgId]);
    const has_ = new Set(fw.map(m => `${m.role_id}|${m.skill_id}`));
    const rows = await q(db, `SELECT normalized_title, display_title, postings, raw_variants, skill_profile FROM org_title_clusters WHERE org_id = $1 ORDER BY postings DESC LIMIT 500`, [orgId]);
    return rows.map(r => {
      const role = find(r.normalized_title) || find(r.display_title);
      const common = (r.skill_profile || []).filter((s: any) => Number(s.share) >= minShare);
      const missing = role ? common.filter((s: any) => !has_.has(`${role.id}|${s.skill_id}`)) : [];
      return { normalized_title: r.normalized_title, display_title: r.display_title, postings: r.postings, variants: (r.raw_variants || []).slice(0, 5).map((v: any) => v.title),
        common_skills: common.length, role: role ? { id: role.id, title: role.title, status: role.status } : null, missing_skills: missing.map((s: any) => ({ skill_id: s.skill_id, name: s.name, share: Number(s.share) })) };
    });
  } },
  { method: "POST", pattern: "/company-postings/roles", handler: async ({ user, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const b = parse(z.object({ department_id: z.string().optional(), min_share: z.coerce.number().min(0.05).max(0.9).default(0.2),
      titles: z.array(z.object({ normalized_title: z.string(), title: z.string().min(2).optional() })).min(1).max(200) }), body);
    const orgId = orgOf(user);
    return tx(async c => {
      const find = await roleIndex(c, orgId);
      const out: any[] = [];
      for (const t of b.titles) {
        const cl = await one(c, `SELECT * FROM org_title_clusters WHERE org_id = $1 AND normalized_title = $2`, [orgId, t.normalized_title]);
        if (!cl) { out.push({ normalized_title: t.normalized_title, status: "not_found" }); continue; }
        const skills = (cl.skill_profile || []).filter((s: any) => Number(s.share) >= b.min_share!).slice(0, 25)
          .map((s: any) => ({ skill_id: s.skill_id, required_level: 3, requirement_type: Number(s.share) >= 0.5 ? "Mandatory" : "Optional", importance: Number(s.share) >= 0.5 ? "High" : "Medium", share: Number(s.share) }));
        const role = find(cl.normalized_title) || find(cl.display_title);
        if (role) {
          // existing role: add the skills its own postings ask for and its framework lacks, as draft requirements for approval
          if (!inDeptScope(user, "framework:draft", role.department_id)) { out.push({ normalized_title: cl.normalized_title, title: role.title, status: "not_in_scope" }); continue; }
          let added = 0;
          for (const s of skills) {
            const pid = buildPixelId(role.id, s.skill_id);
            const r = await one(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, explanation, approval_status, created_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,'Current',$8,'Draft',$9) ON CONFLICT (org_id, role_id, skill_id) DO NOTHING RETURNING pixel_id`,
              [orgId, pid, role.id, s.skill_id, s.required_level, s.requirement_type, s.importance, `In ${Math.round(s.share * 100)}% of the company's own postings for "${cl.display_title}". Review the level before submitting.`, user.name]);
            if (r) added++;
          }
          if (added) await audit(c, user, { entity_type: "role", entity_id: role.id, action: "skills_from_company_postings", after: { title: cl.display_title, added } });
          out.push({ normalized_title: cl.normalized_title, title: role.title, role_id: role.id, status: added ? "framework_extended" : "up_to_date", skills: added });
          continue;
        }
        if (!b.department_id) { out.push({ normalized_title: cl.normalized_title, title: cl.display_title, status: "needs_department" }); continue; }
        if (!inDeptScope(user, "roles:write", b.department_id)) throw forbidden("You can create roles only in your department");
        const r = await draftRole(c, user, t.title || cl.display_title, b.department_id, (cl.raw_variants || []).map((v: any) => v.title).filter((x: string) => x !== (t.title || cl.display_title)).slice(0, 5), skills,
          `Drafted from ${cl.postings} of the company's own job postings titled "${cl.display_title}". Skills mentioned in at least ${Math.round(b.min_share! * 100)}% of them; levels default to 3. Review before submitting.`);
        out.push({ normalized_title: cl.normalized_title, title: r.title, role_id: r.id, status: "created", skills: skills.length });
      }
      return { created: out.filter(o => o.status === "created").length, extended: out.filter(o => o.status === "framework_extended").length, results: out };
    });
  } },
  { method: "GET", pattern: "/company-postings/candidates", handler: async ({ db, user }) => {
    hrOnly(user);
    return q(db, `SELECT c.*, s.name AS skill_name, g.name AS suggested_skill_name, g.org_id IS NULL AS suggested_global FROM org_candidate_terms c LEFT JOIN skills s ON s.id = c.skill_id LEFT JOIN skills g ON g.id = c.suggested_skill_id
      WHERE c.org_id = $1 ORDER BY (c.status = 'Candidate') DESC, c.postings DESC LIMIT 2000`, [orgOf(user)]);
  } },
  // HR decides: company skill (single step: the company owns its skills), another name for a company skill,
  // a request to the platform for a global skill's alias, or ignore
  { method: "POST", pattern: "/company-postings/candidates/bulk", handler: async ({ user, body }) => {
    if (!has(user, "skills:write")) throw forbidden("HR administrators decide the company's skills");
    const b = parse(z.object({ action: z.enum(["add", "alias", "ignore"]), items: z.array(z.object({ term: z.string(), name: z.string().optional(), category: z.string().min(2).optional(), definition: z.string().min(10).optional(), skill_id: z.string().optional() })).min(1).max(500) }), body);
    const orgId = orgOf(user);
    return tx(async c => {
      const out: any[] = [];
      for (const it of b.items) {
        const t = await one(c, `SELECT * FROM org_candidate_terms WHERE org_id = $1 AND term = $2 FOR UPDATE`, [orgId, it.term]);
        if (!t || t.status !== "Candidate") { out.push({ term: it.term, status: "skipped", reason: t ? `already ${t.status}` : "not found" }); continue; }
        if (b.action === "ignore") { await q(c, `UPDATE org_candidate_terms SET status = 'Ignored' WHERE org_id = $1 AND term = $2`, [orgId, t.term]); out.push({ term: t.term, status: "Ignored" }); continue; }
        if (b.action === "alias") {
          const sk = await one(c, `SELECT id, name, org_id, aliases FROM skills WHERE id = $1 AND (org_id IS NULL OR org_id = $2) AND status = 'Active'`, [it.skill_id || t.suggested_skill_id, orgId]);
          if (!sk) { out.push({ term: t.term, status: "skipped", reason: "choose an existing skill" }); continue; }
          if (sk.org_id === null) {
            // global skills belong to the platform: send a library request instead of changing it
            await q(c, `INSERT INTO library_requests (org_id, skill_id, type, text, requested_by) VALUES ($1,$2,'alias',$3,$4)`, [orgId, sk.id, t.term, user.name]);
            await q(c, `UPDATE org_candidate_terms SET status = 'Added', skill_id = $3 WHERE org_id = $1 AND term = $2`, [orgId, t.term, sk.id]);
            out.push({ term: t.term, status: "Requested", skill_name: sk.name }); continue;
          }
          await q(c, `UPDATE skills SET aliases = aliases || $2::text, version = version + 1 WHERE id = $1`, [sk.id, t.term]);
          await q(c, `UPDATE org_candidate_terms SET status = 'Added', skill_id = $3 WHERE org_id = $1 AND term = $2`, [orgId, t.term, sk.id]);
          out.push({ term: t.term, status: "Alias", skill_name: sk.name }); continue;
        }
        if (!it.category || !it.definition) { out.push({ term: t.term, status: "skipped", reason: "category and definition are needed" }); continue; }
        const name = (it.name || t.term).trim();
        const dup = await one(c, `SELECT id, name FROM skills WHERE (org_id IS NULL OR org_id = $2) AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [name, orgId]);
        if (dup) { out.push({ term: t.term, status: "skipped", reason: `${dup.name} already covers it` }); continue; }
        const sk = await one(c, `INSERT INTO skills (org_id, name, definition, category, aliases, review_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [orgId, name, it.definition, it.category, name.toLowerCase() === t.term.toLowerCase() ? [] : [t.term], /review this definition/i.test(it.definition) ? new Date().toISOString().slice(0, 10) : null]);
        await q(c, `UPDATE org_candidate_terms SET status = 'Added', skill_id = $3 WHERE org_id = $1 AND term = $2`, [orgId, t.term, sk!.id]);
        await audit(c, user, { entity_type: "skill", entity_id: sk!.id, action: "created_from_company_postings", after: { term: t.term, postings: t.postings } });
        out.push({ term: t.term, status: "Added", skill_id: sk!.id });
      }
      return { results: out, done: out.filter(o => o.status !== "skipped").length, note: "Re-scan your postings so new company skills are counted." };
    });
  } },
];
void unprocessable;
