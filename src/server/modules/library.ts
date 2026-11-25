/* Governance of the shared (global) skill library:
   - two-step approval: additions from job postings are proposed, then approved by a different person
     (another platform administrator or a nominated library reviewer, such as an expert or a pilot company's HR);
   - retire (history kept, no longer detected or offered) and merge (a duplicate folded into another skill);
   - automatic-growth runs: what each run added, with one-click retire. */
import { z } from "zod";
import { Db, one, q, tx } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { parse, Route } from "../http/router";

export async function twoStep(db: Db): Promise<boolean> {
  const r = await one(db, `SELECT value FROM platform_settings WHERE key = 'library_approval'`);
  return r ? !!r.value.two_step : true;
}
const isReviewer = (u: User) => u.role === "platform_admin" || !!u.library_reviewer;

/** Apply a decision on a candidate term: create a new global skill, or add the term as another name of an existing one. */
export async function applyCandidate(c: Db, t: any, action: "add" | "alias", item: { name?: string; category?: string; definition?: string; skill_id?: string },
  actor: { id: string | null; name: string; org_id: null }, runId?: string | null) {
  if (action === "alias") {
    const sid = item.skill_id || t.suggested_skill_id;
    const sk = sid ? await one(c, `SELECT id, name, aliases FROM skills WHERE id = $1 AND org_id IS NULL AND status = 'Active' FOR UPDATE`, [sid]) : null;
    if (!sk) return { term: t.term, status: "skipped", reason: "choose an existing global skill" };
    if (!(sk.aliases || []).some((a: string) => a.toLowerCase() === t.term.toLowerCase()) && sk.name.toLowerCase() !== t.term.toLowerCase())
      await q(c, `UPDATE skills SET aliases = aliases || $2::text, version = version + 1 WHERE id = $1`, [sk.id, t.term]);
    await q(c, `UPDATE job_candidate_terms SET status = 'Added', skill_id = $2, decided_by_name = $3 WHERE term = $1`, [t.term, sk.id, actor.name]);
    await audit(c, actor as any, { org_id: null, entity_type: "skill", entity_id: sk.id, action: "alias_from_market", after: { alias: t.term, employers: t.companies, proposed_by: t.proposed_by_name || null } });
    return { term: t.term, status: "Alias", skill_id: sk.id, skill_name: sk.name };
  }
  if (!item.category || !item.definition) return { term: t.term, status: "skipped", reason: "category and definition are needed" };
  const name = (item.name || t.term).trim();
  const dup = await one(c, `SELECT id, name FROM skills WHERE org_id IS NULL AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [name]);
  if (dup) { await q(c, `UPDATE job_candidate_terms SET status = 'Added', skill_id = $2 WHERE term = $1`, [t.term, dup.id]); return { term: t.term, status: "skipped", reason: `${dup.name} (${dup.id}) already covers it` }; }
  const sk = await one(c, `INSERT INTO skills (org_id, name, definition, category, aliases, review_date, source_run) VALUES (NULL,$1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, item.definition, item.category, name.toLowerCase() === t.term.toLowerCase() ? [] : [t.term], /review this definition/i.test(item.definition) ? new Date().toISOString().slice(0, 10) : null, runId ?? null]);
  await q(c, `UPDATE job_candidate_terms SET status = 'Added', skill_id = $2, decided_by_name = $3 WHERE term = $1`, [t.term, sk!.id, actor.name]);
  await audit(c, actor as any, { org_id: null, entity_type: "skill", entity_id: sk!.id, action: runId ? "auto_added_from_market" : "created_from_market", after: { term: t.term, employers: t.companies, proposed_by: t.proposed_by_name || null, run: runId ?? null } });
  return { term: t.term, status: "Added", skill_id: sk!.id };
}


/** Link template skills that were waiting for library approval (called after approvals). */
export async function linkPendingTemplateSkills(db: Db) {
  const ts = await q(db, `SELECT id, skills, pending_skills FROM role_templates WHERE jsonb_array_length(pending_skills) > 0`);
  for (const t of ts) {
    const still: any[] = []; const skills = [...t.skills];
    for (const p of t.pending_skills) {
      const s = await one(db, `SELECT id FROM skills WHERE org_id IS NULL AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [p.name]);
      if (s) { if (!skills.some((x: any) => x.skill_id === s.id)) skills.push({ skill_id: s.id, required_level: p.required_level, requirement_type: p.requirement_type, importance: p.importance, skill_trend: p.skill_trend }); }
      else still.push(p);
    }
    if (still.length !== t.pending_skills.length) await q(db, `UPDATE role_templates SET skills = $2, pending_skills = $3, updated_at = now() WHERE id = $1`, [t.id, JSON.stringify(skills), JSON.stringify(still)]);
  }
}

/** Record a proposal instead of applying it (two-step approval). */
export async function proposeCandidate(c: Db, t: any, action: "add" | "alias", item: any, by: { id: string | null; name: string }) {
  await q(c, `UPDATE job_candidate_terms SET status = 'Proposed', proposal = $2, proposed_by = $3, proposed_by_name = $4, proposed_at = now() WHERE term = $1`,
    [t.term, JSON.stringify({ action, ...item }), by.id, by.name]);
  return { term: t.term, status: "Proposed" };
}

/** Retire a skill: kept with its history, no longer detected in postings, offered in pickers or matched in uploads. */
async function retireSkill(c: Db, u: User, id: string, reason: string, mergedInto: string | null = null) {
  const s = await one(c, `SELECT * FROM skills WHERE id = $1 FOR UPDATE`, [id]);
  if (!s) throw notFound("Skill");
  if (s.org_id === null ? u.role !== "platform_admin" : !(has(u, "skills:write") && s.org_id === u.org_id)) throw forbidden(s.org_id === null ? "The platform administrator manages global skills" : "You cannot change this skill");
  if (s.status === "Retired") throw conflict("already_retired", `${s.name} is already retired`);
  const used = await one(c, `SELECT count(*) FILTER (WHERE lifecycle_status = 'Active')::int AS active, count(DISTINCT org_id)::int AS orgs FROM role_skill_mapping WHERE skill_id = $1`, [id]);
  if (used.active > 0) throw unprocessable("skill_in_use", `${s.name} is required by ${used.active} role skill mapping(s) in ${used.orgs} organisation(s). Archive those mappings first, or merge into another skill instead of retiring.`);
  await q(c, `UPDATE skills SET status = 'Retired', retired_reason = $2, retired_at = now(), retired_by = $3, merged_into = $4, version = version + 1 WHERE id = $1`, [id, reason, u.name, mergedInto]);
  // its candidate terms are ignored, so automatic growth does not add the same term again
  await q(c, `UPDATE job_candidate_terms SET status = 'Ignored' WHERE skill_id = $1`, [id]);
  await audit(c, u, { org_id: s.org_id, entity_type: "skill", entity_id: id, action: mergedInto ? "merged" : "retired", before: { status: s.status }, after: { status: "Retired", reason, merged_into: mergedInto } });
  return s;
}

export const routes: Route[] = [
  { method: "GET", pattern: "/library/settings", handler: async ({ db, user }) => {
    if (!isReviewer(user)) throw forbidden();
    const reviewers = await q(db, `SELECT u.id, u.name, u.email, u.role, o.name AS organisation FROM users u LEFT JOIN organisations o ON o.id = u.org_id WHERE u.library_reviewer AND u.active ORDER BY u.name`);
    return { two_step: await twoStep(db), reviewers };
  } },
  { method: "PUT", pattern: "/library/settings", handler: async ({ db, user, body }) => {
    if (user.role !== "platform_admin") throw forbidden();
    const b = parse(z.object({ two_step: z.boolean() }), body);
    await q(db, `INSERT INTO platform_settings (key, value, updated_by) VALUES ('library_approval', $1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(b), user.name]);
    await audit(db, user, { entity_type: "platform_setting", entity_id: "library_approval", action: "updated", after: b });
    return b;
  } },
  // library reviewers: people outside the platform team who may approve proposals (second person)
  { method: "POST", pattern: "/library/reviewers", handler: async ({ db, user, body }) => {
    if (user.role !== "platform_admin") throw forbidden();
    const b = parse(z.object({ email: z.string().email(), reviewer: z.boolean().default(true) }), body);
    const u = await one(db, `UPDATE users SET library_reviewer = $2 WHERE lower(email) = lower($1) AND role IN ('expert','hr_admin','platform_admin') RETURNING id, name, email, role`, [b.email, b.reviewer]);
    if (!u) throw unprocessable("not_eligible", "Only expert reviewers and HR administrators can be library reviewers");
    await audit(db, user, { entity_type: "user", entity_id: u.id, action: b.reviewer ? "library_reviewer_added" : "library_reviewer_removed" });
    return u;
  } },
  { method: "GET", pattern: "/library/proposals", handler: async ({ db, user }) => {
    if (!isReviewer(user)) throw forbidden("Only library reviewers and platform administrators see proposals");
    const rows = await q(db, `SELECT c.term, c.companies, c.postings, c.kind, c.top_titles, c.proposal, c.proposed_by, c.proposed_by_name, c.proposed_at, s.name AS target_skill_name, s.definition AS target_skill_definition
      FROM job_candidate_terms c LEFT JOIN skills s ON s.id = coalesce(c.proposal->>'skill_id', c.suggested_skill_id) WHERE c.status = 'Proposed' ORDER BY c.proposed_at, c.companies DESC`);
    return rows.map(r => ({ ...r, can_decide: r.proposed_by !== user.id }));
  } },
  { method: "POST", pattern: "/library/proposals/decide", handler: async ({ user, body }) => {
    if (!isReviewer(user)) throw forbidden("Only library reviewers and platform administrators approve proposals");
    const b = parse(z.object({ terms: z.array(z.string()).min(1).max(500), decision: z.enum(["approve", "reject"]), comment: z.string().max(500).optional() }), body);
    return tx(async c => {
      const out: any[] = [];
      for (const term of b.terms) {
        const t = await one(c, `SELECT * FROM job_candidate_terms WHERE term = $1 AND status = 'Proposed' FOR UPDATE`, [term]);
        if (!t) { out.push({ term, status: "skipped", reason: "not waiting for approval" }); continue; }
        if (t.proposed_by && t.proposed_by === user.id) { out.push({ term, status: "skipped", reason: "a second person must approve your own proposal" }); continue; }
        if (b.decision === "reject") {
          await q(c, `UPDATE job_candidate_terms SET status = 'Candidate', proposal = proposal || $2, decided_by_name = $3 WHERE term = $1`, [term, JSON.stringify({ rejected_by: user.name, rejection: b.comment || "" }), user.name]);
          await audit(c, user, { org_id: null, entity_type: "market_candidate", entity_id: term, action: "proposal_rejected", reason: b.comment || null });
          out.push({ term, status: "Rejected" }); continue;
        }
        const p = t.proposal || {};
        out.push(await applyCandidate(c, t, p.action, p, { id: user.id, name: `${user.name} (approved proposal by ${t.proposed_by_name})`, org_id: null }, p.run || null));
      }
      if (b.decision === "approve") await linkPendingTemplateSkills(c);
      if (b.decision === "approve") { const n = out.filter(o => o.status === "Added").length; if (n) await q(c, `INSERT INTO skill_growth_runs (mode, added, note) VALUES ('approved proposals', $1, $2)`, [n, `approved by ${user.name}`]); }
      return { results: out, done: out.filter(o => o.status !== "skipped").length };
    });
  } },

  /* ---------- retire, restore, merge ---------- */
  { method: "POST", pattern: "/skills/:id/retire", handler: async ({ user, params, body }) => {
    const b = parse(z.object({ reason: z.string().min(3).max(500) }), body);
    return tx(async c => { const s = await retireSkill(c, user, params.id, b.reason); return { id: s.id, status: "Retired" }; });
  } },
  { method: "POST", pattern: "/skills/:id/reinstate", handler: async ({ user, params }) => tx(async c => {
    const s = await one(c, `SELECT * FROM skills WHERE id = $1 FOR UPDATE`, [params.id]);
    if (!s) throw notFound("Skill");
    if (s.org_id === null ? user.role !== "platform_admin" : !(has(user, "skills:write") && s.org_id === user.org_id)) throw forbidden();
    if (s.status !== "Retired") throw conflict("not_retired", `${s.name} is not retired`);
    if (s.merged_into) throw conflict("merged", `${s.name} was merged into ${s.merged_into}; its names now belong to that skill`);
    await q(c, `UPDATE skills SET status = 'Active', retired_reason = NULL, retired_at = NULL, retired_by = NULL, version = version + 1 WHERE id = $1`, [s.id]);
    await audit(c, user, { org_id: s.org_id, entity_type: "skill", entity_id: s.id, action: "reinstated" });
    return { id: s.id, status: "Active" };
  }) },
  // Merge a duplicate into another skill: its name and aliases move over, people's recorded levels move over, the duplicate is retired.
  { method: "POST", pattern: "/skills/:id/merge", handler: async ({ user, params, body }) => {
    const b = parse(z.object({ into: z.string() }), body);
    return tx(async c => {
      const [src, dst] = [await one(c, `SELECT * FROM skills WHERE id = $1`, [params.id]), await one(c, `SELECT * FROM skills WHERE id = $1 FOR UPDATE`, [b.into])];
      if (!src || !dst) throw notFound("Skill");
      if (src.id === dst.id) throw unprocessable("same_skill", "Choose a different skill to merge into");
      if (dst.status !== "Active") throw unprocessable("target_retired", `${dst.name} is retired`);
      if (src.org_id === null && dst.org_id !== null) throw unprocessable("scope", "A global skill can only be merged into another global skill");
      if (src.org_id !== null && dst.org_id !== null && dst.org_id !== src.org_id) throw forbidden();
      const mapped = await one(c, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE skill_id = $1`, [src.id]);
      if (mapped.n > 0) throw unprocessable("skill_in_use", `${src.name} has ${mapped.n} role skill mapping(s). Pixel IDs never change, so map those roles to ${dst.name} and archive the old mappings first.`);
      const names = [src.name, ...(src.aliases || [])].filter((n: string) => n.toLowerCase() !== dst.name.toLowerCase() && !(dst.aliases || []).some((a: string) => a.toLowerCase() === n.toLowerCase()));
      await q(c, `UPDATE skills SET aliases = aliases || $2::text[], version = version + 1 WHERE id = $1`, [dst.id, names]);
      // recorded levels move to the kept skill (an existing record for the same person and source wins)
      await q(c, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) SELECT org_id, employee_id, $2, source, level, assessed_by, assessed_on FROM employee_skills WHERE skill_id = $1 ON CONFLICT DO NOTHING`, [src.id, dst.id]);
      await q(c, `DELETE FROM employee_skills WHERE skill_id = $1`, [src.id]);
      await q(c, `UPDATE job_postings SET skill_ids = array_remove(skill_ids, $1) || CASE WHEN $2 = ANY(skill_ids) THEN '{}'::text[] ELSE ARRAY[$2] END WHERE $1 = ANY(skill_ids)`, [src.id, dst.id]);
      await q(c, `UPDATE job_candidate_terms SET skill_id = $2 WHERE skill_id = $1`, [src.id, dst.id]);
      await retireSkill(c, user, src.id, `Merged into ${dst.name} (${dst.id})`, dst.id);
      await q(c, `UPDATE job_candidate_terms SET status = 'Added' WHERE skill_id = $1`, [dst.id]);
      return { merged: src.id, into: dst.id, names_moved: names };
    });
  } },

  /* ---------- automatic-growth runs: what each run added, with one-click retire ---------- */
  { method: "GET", pattern: "/library/runs", handler: async ({ db, user }) => {
    if (user.role !== "platform_admin") throw forbidden();
    const runs = await q(db, `SELECT r.*, (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'status', s.status, 'category', s.category,
        'in_use', (SELECT count(*) FROM role_skill_mapping m WHERE m.skill_id = s.id)) ORDER BY s.name), '[]') FROM skills s WHERE s.source_run = r.id) AS skills
      FROM skill_growth_runs r ORDER BY r.at DESC LIMIT 30`);
    return runs;
  } },
  { method: "POST", pattern: "/library/runs/:id/retire", handler: async ({ user, params, body }) => {
    if (user.role !== "platform_admin") throw forbidden();
    const reason = String(body?.reason || "Undo of an automatic addition run");
    return tx(async c => {
      const skills = await q(c, `SELECT id, name FROM skills WHERE source_run = $1 AND status = 'Active'`, [params.id]);
      if (!skills.length) throw notFound("Active skills from this run");
      const out: any[] = [];
      for (const s of skills) {
        const used = await one(c, `SELECT count(*)::int AS n FROM role_skill_mapping WHERE skill_id = $1 AND lifecycle_status = 'Active'`, [s.id]);
        if (used.n) { out.push({ id: s.id, name: s.name, status: "kept", reason: "already required by roles" }); continue; }
        await retireSkill(c, user, s.id, reason); out.push({ id: s.id, name: s.name, status: "Retired" });
      }
      return { retired: out.filter(o => o.status === "Retired").length, kept: out.filter(o => o.status === "kept").length, results: out };
    });
  } },
];
