/* Role drafts for titles that are not in the framework (Module: never-empty search).
   Search for a role that does not exist -> a draft profile is generated (local AI model, or the app's own data) ->
   shown at once, marked as unreviewed -> waits in Role resolution -> HR approves it into a draft role (which then follows
   the normal approval to publish), or rejects it. One draft per organisation and title; later searches reuse it. */
import { z } from "zod";
import { Db, one, q, tx, pool } from "../db";
import { audit } from "../audit";
import { conflict, forbidden, notFound, unprocessable } from "../errors";
import { has, User } from "../permissions";
import { inDeptScope, orgOf } from "../scope";
import { parse, Route } from "../http/router";
import { draftRole, enqueue, normalizeTitle, resolveRoleTitle, titleKey } from "./roleFallback";
import { buildPixelId } from "./mapping";
import { generateRoleDraft } from "../ai/roleDraft";
import { aiConfig, aiStatus } from "../ai/llm";

/* one generation at a time: a local model answers one request well, several slowly */
let active = 0; const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 1) await new Promise<void>(r => waiting.push(r));
  active++;
  try { return await f(); } finally { active--; waiting.shift()?.(); }
}

async function runGeneration(id: string) {
  return slot(async () => {
    const d = await one(pool(), `SELECT * FROM ai_role_drafts WHERE id = $1`, [id]);
    if (!d || d.status !== "Generating") return;
    try {
      let last = 0, lastStage = "";
      const report = (pct: number, stage: string) => {
        // written at most every second (or when the step changes), never backwards
        if (stage === lastStage && Date.now() - last < 1000) return;
        last = Date.now(); lastStage = stage;
        q(pool(), `UPDATE ai_role_drafts SET progress = GREATEST(progress, $2), stage = $3 WHERE id = $1 AND status = 'Generating'`, [id, Math.max(0, Math.min(99, Math.round(pct))), stage]).catch(() => {});
      };
      const g = await generateRoleDraft(pool(), d.org_id, d.query, report);
      await q(pool(), `UPDATE ai_role_drafts SET status = 'Ready', progress = 100, stage = 'Done', method = $2, provider = $3, model = $4, payload = $5, context = $6, generated_at = now(), error = NULL WHERE id = $1 AND status = 'Generating'`,
        [id, g.method, g.provider, g.model, JSON.stringify(g.payload), JSON.stringify(g.context)]);
    } catch (e: any) {
      await q(pool(), `UPDATE ai_role_drafts SET status = 'Failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]);
    }
  });
}

const view = (d: any) => d && ({ id: d.id, query: d.query, status: d.status, progress: d.progress, stage: d.stage, method: d.method, model: d.model, payload: d.payload, error: d.error, role_id: d.role_id, queue_id: d.queue_id,
  created_by_name: d.created_by_name, created_at: d.created_at, generated_at: d.generated_at, decided_by: d.decided_by, decided_at: d.decided_at, decision_note: d.decision_note });

/** Find or start the draft for a title. Returns the existing role instead when the title is already in the framework. */
export async function draftFor(db: Db, user: User, title: string, wait = false) {
  const orgId = orgOf(user);
  const res: any = await resolveRoleTitle(db, orgId, title);
  if (res.status === "matched") return { matched: res.role };
  const key = titleKey(normalizeTitle(title).core) || title.toLowerCase().trim();
  let d = await one(db, `SELECT * FROM ai_role_drafts WHERE org_id = $1 AND normalized = $2 AND status IN ('Generating','Ready','Approved') ORDER BY created_at DESC LIMIT 1`, [orgId, key]);
  const stale = d && d.status === "Generating" && Date.now() - new Date(d.created_at).getTime() > aiConfig().timeoutMs + 120000;
  if (d && !stale) { if (wait && d.status === "Generating") { await runGeneration(d.id); d = await one(db, `SELECT * FROM ai_role_drafts WHERE id = $1`, [d.id]); } return { draft: view(d) }; }
  if (stale) await q(db, `UPDATE ai_role_drafts SET status = 'Failed', error = 'interrupted' WHERE id = $1`, [d.id]);
  // the title also waits in Role resolution, so HR reviews it there with the draft attached
  const qid = await enqueue(db, orgId, title, null, "search", [], { ...res, ai_draft: true });
  d = await one(db, `INSERT INTO ai_role_drafts (org_id, query, normalized, queue_id, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING RETURNING *`, [orgId, title.trim().slice(0, 120), key, qid, user.id, user.name]);
  if (!d) d = await one(db, `SELECT * FROM ai_role_drafts WHERE org_id = $1 AND normalized = $2 AND status IN ('Generating','Ready','Approved') LIMIT 1`, [orgId, key]);
  else await audit(db, user, { entity_type: "ai_role_draft", entity_id: d.id, action: "requested", after: { title } });
  if (wait) { await runGeneration(d.id); d = await one(db, `SELECT * FROM ai_role_drafts WHERE id = $1`, [d.id]); }
  else runGeneration(d.id).catch(() => {});
  return { draft: view(d) };
}

const approveSchema = z.object({
  department_id: z.string(), title: z.string().min(2).max(120).optional(),
  skills: z.array(z.object({ skill_id: z.string(), required_level: z.coerce.number().int().min(1).max(5), requirement_type: z.enum(["Mandatory", "Preferred", "Optional", "Developmental"]), importance: z.enum(["Critical", "High", "Medium", "Low"]) })).optional(),
  new_skills: z.array(z.object({ name: z.string().min(1).max(120), definition: z.string().max(500).optional(), category: z.string().max(80).optional(), as: z.enum(["company", "request", "skip"]) })).default([]),
  note: z.string().max(500).optional(),
});

export const routes: Route[] = [
  { method: "GET", pattern: "/ai/status", handler: async () => {
    const c = aiConfig(); const st = await aiStatus();
    return { ...st, base_url: c.baseUrl, timeout_seconds: Math.round(c.timeoutMs / 1000), fallback: "Without a model, drafts are made from job-market data, role templates and similar roles." };
  } },
  { method: "POST", pattern: "/ai/role-drafts", handler: async ({ db, user, body }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const b = parse(z.object({ title: z.string().trim().min(3).max(120), wait: z.boolean().optional() }), body);
    return draftFor(db, user, b.title, !!b.wait);
  } },
  { method: "GET", pattern: "/ai/role-drafts", handler: async ({ db, user, query }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const st = query.get("status");
    return (await q(db, `SELECT * FROM ai_role_drafts WHERE org_id = $1 ${st ? "AND status = $2" : ""} ORDER BY created_at DESC LIMIT 200`, st ? [orgOf(user), st] : [orgOf(user)])).map(view);
  } },
  { method: "GET", pattern: "/ai/role-drafts/:id", handler: async ({ db, user, params }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const d = await one(db, `SELECT * FROM ai_role_drafts WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!d) throw notFound("Draft");
    return view(d);
  } },
  { method: "POST", pattern: "/ai/role-drafts/:id/regenerate", handler: async ({ db, user, params, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const d = await one(db, `UPDATE ai_role_drafts SET status = 'Generating', payload = NULL, error = NULL, created_at = now() WHERE id = $1 AND org_id = $2 AND status IN ('Ready','Failed') RETURNING *`, [params.id, orgOf(user)]);
    if (!d) throw conflict("not_regenerable", "Only drafts that are ready or failed can be regenerated");
    if (body?.wait) await runGeneration(d.id); else runGeneration(d.id).catch(() => {});
    return view(await one(db, `SELECT * FROM ai_role_drafts WHERE id = $1`, [d.id]));
  } },
  { method: "POST", pattern: "/ai/role-drafts/:id/reject", handler: async ({ user, params, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    return tx(async c => {
      const d = await one(c, `UPDATE ai_role_drafts SET status = 'Rejected', decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1 AND org_id = $2 AND status IN ('Ready','Failed') RETURNING *`, [params.id, orgOf(user), user.name, String(body?.note || "").slice(0, 500)]);
      if (!d) throw conflict("not_open", "This draft is not waiting for review");
      if (d.queue_id) await q(c, `UPDATE role_resolution_queue SET status = 'Dismissed', resolution = 'dismissed', resolved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'Open'`, [d.queue_id, user.name]);
      await audit(c, user, { entity_type: "ai_role_draft", entity_id: d.id, action: "rejected", reason: d.decision_note || null });
      return view(d);
    });
  } },
  // HR approves: a draft role with the chosen skills (then submitted for approval as usual); new skills become company skills or library requests
  { method: "POST", pattern: "/ai/role-drafts/:id/approve", handler: async ({ user, params, body }) => {
    if (!has(user, "roles:write")) throw forbidden();
    const b = parse(approveSchema, body);
    if (!inDeptScope(user, "roles:write", b.department_id)) throw forbidden("You can create roles only in your department");
    const orgId = orgOf(user);
    return tx(async c => {
      const d = await one(c, `SELECT * FROM ai_role_drafts WHERE id = $1 AND org_id = $2 FOR UPDATE`, [params.id, orgId]);
      if (!d) throw notFound("Draft");
      if (d.status !== "Ready") throw conflict("not_ready", `This draft is ${d.status}`);
      const p = d.payload;
      const title = b.title || p.title;
      const dup = await one(c, `SELECT id, title FROM job_roles WHERE org_id = $1 AND status <> 'Archived' AND lower(title) = lower($2)`, [orgId, title]);
      if (dup) throw conflict("role_exists", `${dup.title} (${dup.id}) already exists`);
      const skills = (b.skills || p.skills.filter((s: any) => s.skill_id)).map((s: any) => ({ skill_id: s.skill_id, required_level: s.required_level, requirement_type: s.requirement_type, importance: s.importance,
        skill_trend: s.trend || p.skills.find((x: any) => x.skill_id === s.skill_id)?.trend }));
      const ok = await q(c, `SELECT id FROM skills WHERE id = ANY($1) AND (org_id IS NULL OR org_id = $2) AND status = 'Active'`, [skills.map((s: any) => s.skill_id), orgId]);
      const valid = skills.filter((s: any) => ok.some(o => o.id === s.skill_id));
      const note = `Drafted ${d.method === "ai" ? `by the local AI model ${d.model}` : "from job-market data, templates and similar roles"} for the search "${d.query}"; approved for drafting by ${user.name}. Review levels before submitting.`;
      const role = await draftRole(c as any, user, title, b.department_id, (p.alt_titles || []).filter((t: string) => t.toLowerCase() !== title.toLowerCase()).slice(0, 5), valid, note);
      await q(c, `UPDATE job_roles SET summary = $2, responsibilities = $3, outcomes = $4, experience = $5, education = $6 WHERE id = $1`,
        [role.id, p.summary || note, p.responsibilities || [], p.outcomes || [], p.experience || null, p.education || null]);
      // keep why each skill got its trend
      for (const sk of p.skills || []) if (sk.skill_id && sk.trend_reasons?.length)
        await q(c, `UPDATE role_skill_mapping SET trend_rationale = $3 WHERE role_id = $1 AND skill_id = $2 AND approval_status = 'Draft'`, [role.id, sk.skill_id, sk.trend_reasons.join("; ").slice(0, 900)]);
      // new skills named by the draft
      const created: any[] = [], requested: string[] = [];
      for (const n of b.new_skills || []) {
        if (n.as === "skip") continue;
        const exists = await one(c, `SELECT id FROM skills WHERE (org_id IS NULL OR org_id = $2) AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a))`, [n.name, orgId]);
        if (n.as === "request" || exists) {
          if (!exists) { await q(c, `INSERT INTO library_requests (org_id, type, text, requested_by) VALUES ($1,'new_skill',$2,$3)`, [orgId, `${n.name}: ${n.definition || "named in a drafted role profile for " + title}`, user.name]); requested.push(n.name); }
          if (exists) await q(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, explanation, approval_status, created_by) VALUES ($1,$2,$3,$4,3,'Preferred','Medium','Current',$5,'Draft',$6) ON CONFLICT DO NOTHING`,
            [orgId, buildPixelId(role.id, exists.id), role.id, exists.id, "Named in the drafted profile", user.name]);
          continue;
        }
        const sk = await one(c, `INSERT INTO skills (org_id, name, definition, category, review_date) VALUES ($1,$2,$3,$4,current_date) RETURNING id, name`,
          [orgId, n.name, n.definition && n.definition.length >= 10 ? n.definition : `${n.name}: named in the drafted profile for ${title}. Review this definition.`, n.category || "Technical Methods"]);
        await q(c, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, explanation, approval_status, created_by) VALUES ($1,$2,$3,$4,3,'Preferred','Medium','Current',$5,'Draft',$6) ON CONFLICT DO NOTHING`,
          [orgId, buildPixelId(role.id, sk!.id), role.id, sk!.id, "New skill named in the drafted profile", user.name]);
        created.push(sk);
      }
      await q(c, `UPDATE ai_role_drafts SET status = 'Approved', role_id = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [d.id, role.id, user.name, b.note || null]);
      if (d.queue_id) await q(c, `UPDATE role_resolution_queue SET status = 'Role drafted', resolution = 'from_ai_draft', resolved_role_id = $2, resolved_by = $3, department_id = coalesce(department_id, $4) WHERE id = $1`, [d.queue_id, role.id, user.name, b.department_id]);
      await audit(c, user, { entity_type: "ai_role_draft", entity_id: d.id, action: "approved_into_draft_role", after: { role_id: role.id, method: d.method, model: d.model, skills: valid.length, new_company_skills: created.length, library_requests: requested.length } });
      return { role_id: role.id, title, skills: valid.length, new_company_skills: created.map(x => x.name), library_requests: requested,
        note: "The role is a draft. Check the levels, then submit it for approval to publish it." };
    });
  } },
];
void unprocessable;
