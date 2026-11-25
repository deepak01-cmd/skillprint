/* Drafts a role profile for a title that is not in the framework.
   1. Context from the app's own data: similar roles, role templates, market postings for the title (skill shares and sample
      descriptions), the company's own postings, skills implied by the title, the organisation's departments and levels.
   2. With a local model: the model writes the profile from that context. Its answer is validated; skills are mapped to the
      library under any spelling; unknown skills are kept apart as "new skills" for review.
   3. Without a model, or if it fails: a rule-based draft from the same context. A draft is always produced. */
import { z } from "zod";
import { Db, one, q } from "../db";
import { listActive } from "../modules/mapping";
import { normalizeTitle, resolveRoleTitle } from "../modules/roleFallback";
import { marketMatch, pooledProfile } from "../modules/market";
import { parseJobDescription } from "../modules/structure";
import { canonicalSpelling, spellingsOf } from "../terms";
import { aiStatus, chatJson } from "./llm";
import { roleOutlook, Trend } from "../modules/outlook";
import { referenceForTitle } from "../modules/reference";

const REQ = ["Mandatory", "Preferred", "Optional", "Developmental"] as const;
const IMP = ["Critical", "High", "Medium", "Low"] as const;

export async function draftContext(db: Db, orgId: string, title: string) {
  const org = await one(db, `SELECT name, industry FROM organisations WHERE id = $1`, [orgId]);
  const depts = await q(db, `SELECT id, name FROM departments WHERE org_id = $1 AND status = 'Active' ORDER BY name`, [orgId]);
  const levels = await q(db, `SELECT code, name, rank FROM career_levels WHERE org_id = $1 ORDER BY rank`, [orgId]);
  const res: any = await resolveRoleTitle(db, orgId, title);
  // similar roles in the organisation, with their active skills
  const simIds = (res.candidates || []).slice(0, 3).map((c: any) => c.id);
  const fw = simIds.length ? await listActive(db, orgId, { roleIds: simIds }) : [];
  const similar: any[] = (res.candidates || []).slice(0, 3).map((c: any) => ({ id: c.id, title: c.title, department: c.department_name, score: c.score,
    skills: fw.filter(m => m.role_id === c.id).map(m => ({ skill_id: m.skill_id, name: m.skill_name, level: m.required_level, type: m.requirement_type })) }));
  const roleDetail: any[] = simIds.length ? await q(db, `SELECT id, department_id, responsibilities FROM job_roles WHERE id = ANY($1)`, [simIds]) : [];
  // role templates
  const tIds = (res.templates || []).slice(0, 2).map((t: any) => t.id);
  const templates: any[] = tIds.length ? (await q(db, `SELECT id, title, source, skills FROM role_templates WHERE id = ANY($1)`, [tIds])) : [];
  // market postings for the title
  const mm = (res.market && res.market.length) ? null : await marketMatch(db, [title]).catch(() => ({ exact: [], similar: [] }));
  const marketTitles = mm ? [...mm.exact.map((x: any) => x.normalized_title), ...mm.similar.slice(0, 1).map((x: any) => x.normalized_title)] : (res.market || []).slice(0, 2).map((x: any) => x.normalized_title);
  const market = marketTitles.length ? await pooledProfile(db, marketTitles) : { postings: 0, companies: 0, skills: [] as any[] };
  const samples = marketTitles.length ? (await q(db, `SELECT description FROM global_postings WHERE normalized_title = ANY($1) AND length(description) > 300 ORDER BY length(description) DESC LIMIT 3`, [marketTitles])).map(r => String(r.description).slice(0, 2500)) : [];
  // the company's own postings for the title
  const own = await q(db, `SELECT display_title, postings, skill_profile FROM org_title_clusters WHERE org_id = $1 AND (normalized_title = $2 OR similarity(normalized_title, $2) >= 0.6) ORDER BY postings DESC LIMIT 1`, [orgId, res.normalized || title.toLowerCase()]).catch(() => []);
  // library skills the model may choose from: everything from the sources above, plus skills sharing a word with the title
  const words = (res.normalized || title.toLowerCase()).split(/\s+/).filter((w: string) => w.length >= 4);
  const wordSkills = words.length ? await q(db, `SELECT id, name FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active' AND (${words.map((_: string, i: number) => `lower(name) LIKE $${i + 2}`).join(" OR ")}) LIMIT 15`, [orgId, ...words.map((w: string) => `%${w}%`)]) : [];
  return { title, org, depts, levels, res, similar, roleDetail, templates, market: { titles: marketTitles, ...market }, samples, own: own[0] || null, inferred: res.inferred_skills || [], wordSkills };
}
type Ctx = Awaited<ReturnType<typeof draftContext>>;

/** Library lookup by name or alias, under every spelling. */
async function skillLookup(db: Db, orgId: string) {
  const skills = await q(db, `SELECT id, name, aliases, category, org_id FROM skills WHERE (org_id IS NULL OR org_id = $1) AND status = 'Active'`, [orgId]);
  const by = new Map<string, any>();
  for (const s of skills) for (const t of [s.name, s.name.replace(/\s*\(.*?\)\s*/g, " ").trim(), ...(s.aliases || [])]) for (const sp of spellingsOf(t)) if (!by.has(sp.toLowerCase())) by.set(sp.toLowerCase(), s);
  return (name: string) => by.get(name.toLowerCase().trim()) || by.get(canonicalSpelling(name).toLowerCase()) || by.get(name.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim());
}

/* ---------- rule-based draft: always available ---------- */
export function rulesDraft(ctx: Ctx) {
  const score = new Map<string, { skill_id: string; name: string; s: number; level: number[]; why: string[] }>();
  const add = (id: string, name: string, s: number, why: string, level?: number) => {
    const e = score.get(id) || { skill_id: id, name, s: 0, level: [], why: [] }; e.s += s; if (level) e.level.push(level); if (!e.why.includes(why)) e.why.push(why); score.set(id, e);
  };
  for (const m of ctx.market.skills.slice(0, 30)) add(m.skill_id, m.name, Number(m.share) * 3, `in ${Math.round(Number(m.share) * 100)}% of ${ctx.market.postings} market postings`);
  for (const r of ctx.similar) for (const k of r.skills) add(k.skill_id, k.name, 0.8 * Number(r.score || 0.5), `required by similar role ${r.title}`, k.level);
  for (const t of ctx.templates) for (const k of (t.skills || [])) add(k.skill_id, k.name || k.skill_id, 0.7, `in role template ${t.title}`, k.required_level);
  for (const k of ctx.inferred) add(k.skill_id, k.name, 1.2, "named in the title");
  for (const k of (ctx.own?.skill_profile || [])) add(k.skill_id, k.name, Number(k.share) * 3, `in ${Math.round(Number(k.share) * 100)}% of your own postings`);
  const ranked = [...score.values()].filter(x => x.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, 12);
  // With no level evidence, the seniority word sets the level: senior/staff 4 on core skills, lead/principal 4 (5 on the top skills), junior 2
  const rank = normalizeTitle(ctx.title).level_rank;
  const base = (i: number) => rank == null ? 3 : rank <= 2 ? 2 : rank === 3 ? 3 : rank === 4 ? (i < 5 ? 4 : 3) : (i < 3 ? 5 : i < 8 ? 4 : 3);
  const skills = ranked.map((x, i) => ({
    skill_id: x.skill_id, name: x.name, source: "library" as const,
    required_level: x.level.length ? Math.round(x.level.reduce((a, b) => a + b, 0) / x.level.length) : base(i),
    requirement_type: i < 5 && x.s >= 1.2 ? "Mandatory" : i < 9 || x.s >= 1.5 ? "Preferred" : "Optional",
    importance: x.s >= 2 ? "High" : x.s >= 1 ? "Medium" : "Low",
    why: x.why.slice(0, 2).join("; "),
  }));
  const sources = [ctx.market.postings && `${ctx.market.postings} job postings from ${ctx.market.companies} employers`, ctx.similar.length && `similar roles: ${ctx.similar.map(s => s.title).join(", ")}`,
    ctx.templates.length && `role templates: ${ctx.templates.map(t => t.title).join(", ")}`, ctx.own && `${ctx.own.postings} of your own postings`].filter(Boolean) as string[];
  const confidence = skills.length >= 6 && (ctx.market.postings >= 10 || ctx.similar.some(s => Number(s.score) >= 0.6)) ? "medium" : skills.length >= 3 ? "low" : "very low";
  return { skills, sources, confidence };
}

async function responsibilitiesFromData(db: Db, orgId: string, ctx: Ctx): Promise<{ responsibilities: string[]; outcomes: string[]; experience: string | null; education: string | null }> {
  if (ctx.samples.length) {
    const jd = await parseJobDescription(db, orgId, `Title: ${ctx.title}\n${ctx.samples.join("\n")}`);
    const resp = [...new Set(jd.responsibilities.map((r: string) => r.replace(/\s+/g, " ").trim()).filter((r: string) => r.length >= 15 && r.length <= 220))].slice(0, 8);
    if (resp.length >= 3) return { responsibilities: resp, outcomes: jd.outcomes.slice(0, 4), experience: jd.experience || null, education: jd.education || null };
  }
  const fromSimilar = ctx.roleDetail.flatMap((r: any) => r.responsibilities || []).slice(0, 6);
  return { responsibilities: fromSimilar, outcomes: [], experience: null, education: null };
}

/* ---------- model draft ---------- */
const SCHEMA = {
  type: "object", required: ["summary", "responsibilities", "skills"],
  properties: {
    title: { type: "string" }, summary: { type: "string" }, alt_titles: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } }, outcomes: { type: "array", items: { type: "string" } },
    career_level: { type: "string" }, department: { type: "string" }, experience: { type: "string" }, education: { type: "string" },
    skills: { type: "array", items: { type: "object", required: ["name", "required_level", "requirement_type", "importance"], properties: {
      name: { type: "string" }, required_level: { type: "integer" }, requirement_type: { type: "string", enum: [...REQ] }, importance: { type: "string", enum: [...IMP] }, trend: { type: "string", enum: ["Emerging", "Current", "Declining"] }, why: { type: "string" } } } },
    new_skills: { type: "array", items: { type: "object", required: ["name", "definition"], properties: { name: { type: "string" }, definition: { type: "string" }, category: { type: "string" } } } },
  },
};
const out = z.object({
  title: z.string().max(120).optional(), summary: z.string().max(1500), alt_titles: z.array(z.string().max(120)).max(8).optional(),
  responsibilities: z.array(z.string().max(300)).max(15), outcomes: z.array(z.string().max(300)).max(10).optional(),
  career_level: z.string().max(60).optional(), department: z.string().max(120).optional(), experience: z.string().max(200).optional(), education: z.string().max(200).optional(),
  skills: z.array(z.object({ name: z.string().min(1).max(120), required_level: z.coerce.number(), requirement_type: z.string(), importance: z.string(), trend: z.string().optional(), why: z.string().max(300).optional() })).max(25),
  new_skills: z.array(z.object({ name: z.string().min(1).max(120), definition: z.string().max(500), category: z.string().max(80).optional() })).max(8).optional(),
});

function prompt(ctx: Ctx, rules: ReturnType<typeof rulesDraft>) {
  const lib = new Map<string, string>();
  for (const s of [...rules.skills, ...ctx.market.skills.slice(0, 25), ...ctx.wordSkills, ...ctx.inferred]) lib.set((s as any).skill_id || (s as any).id, (s as any).name);
  const system = `You are an expert in job architecture and skills frameworks. You write accurate, specific role profiles for HR teams.
Answer with one JSON object only. Rules:
- Base the profile on the evidence given. Prefer skills from "Library skills" and copy their names exactly.
- Only if an essential skill is missing from the library, put it in "new_skills" with a one-sentence definition (max 5).
- required_level is 1-5: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert. Mandatory = needed on day one.
- 6 to 12 skills. 5 to 8 concrete responsibilities that start with a verb. A 2-3 sentence summary.
- For each skill give "trend": Emerging (demand clearly rising over the next 2-3 years), Declining (being replaced or automated) or Current.
- Never invent company names, salaries or legal requirements.`;
  const user = [
    `Role title searched: "${ctx.title}"`,
    `Organisation industry: ${ctx.org?.industry || "not stated"}. Departments: ${ctx.depts.map(d => d.name).join(", ") || "none"}. Career levels: ${ctx.levels.map(l => `${l.code} ${l.name}`).join(", ") || "none"}.`,
    ctx.market.postings ? `Job-market evidence: ${ctx.market.postings} postings from ${ctx.market.companies} employers. Skills most often named: ${ctx.market.skills.slice(0, 15).map((s: any) => `${s.name} (${Math.round(Number(s.share) * 100)}%)`).join(", ")}.` : "Job-market evidence: none for this title.",
    ctx.similar.length ? `Similar roles in this organisation:\n${ctx.similar.map(r => `- ${r.title} (${r.department}): ${r.skills.map((k: any) => `${k.name} L${k.level} ${k.type}`).join(", ")}`).join("\n")}` : "Similar roles in this organisation: none.",
    ctx.templates.length ? `Role templates: ${ctx.templates.map(t => t.title).join(", ")}.` : "",
    ctx.samples.length ? `Excerpts of real postings for this title:\n${ctx.samples.map(s => `---\n${s.slice(0, 1200)}`).join("\n")}` : "",
    `Library skills (use these names): ${[...lib.values()].join("; ")}`,
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

/** A drafted profile plus the outlook: every skill gets a trend (Emerging / Current / Declining) with its reasons, and the role
    gets a 2–3 year outlook, skills to add and hire-or-train advice. onProgress(percent, stage) reports progress. */
export async function generateRoleDraft(db: Db, orgId: string, title: string, onProgress: (pct: number, stage: string) => void = () => {}) {
  const g = await draftCore(db, orgId, title, onProgress);
  onProgress(90, "Matching a reference occupation");
  const ref = await referenceForTitle(db, title, g.payload.skills.map((x: any) => x.skill_id).filter(Boolean)).catch(() => null);
  if (ref) {
    // skills the occupation rates as important that are in the library but not yet in the draft (at most 4, as Preferred)
    const have = new Set(g.payload.skills.map((x: any) => x.skill_id));
    const extra = [...ref.skills, ...ref.knowledge].filter(k => k.skill_id && !have.has(k.skill_id) && k.importance >= 3.5).slice(0, 4);
    for (const k of extra) { have.add(k.skill_id); g.payload.skills.push({ skill_id: k.skill_id, name: k.skill_name || k.name, source: "library", required_level: k.level || 3, requirement_type: k.requirement_type === "Mandatory" ? "Preferred" : k.requirement_type, importance: k.importance >= 4 ? "High" : "Medium", why: `rated important (${k.importance}/5) for ${ref.title} (O*NET)` } as any); }
    (g.payload as any).reference = { code: ref.code, title: ref.title, description: ref.description, match_score: ref.match_score, flags: ref.flags, job_zone: ref.job_zone,
      work_styles: ref.work_styles.slice(0, 6), work_context: ref.work_context.slice(0, 6), emerging_tasks: ref.emerging_tasks.slice(0, 5),
      technologies: ref.technologies.filter((t: any) => t.hot || t.in_demand).slice(0, 10), attribution: ref.attribution };
  }
  onProgress(93, "Predicting skill trends");
  const aiView = new Map<string, Trend>(g.payload.skills.filter((x: any) => x.ai_trend).map((x: any) => [x.name.toLowerCase(), x.ai_trend as Trend]));
  const o = await roleOutlook(db, orgId, { title: g.payload.title, occupation: ref ? { code: ref.code, title: ref.title } : null, skills: g.payload.skills.map((x: any) => ({ skill_id: x.skill_id, name: x.name, requirement_type: x.requirement_type, required_level: x.required_level })), aiView });
  const byKey = new Map(o.skills.map(x => [x.skill_id || x.name.toLowerCase(), x]));
  g.payload.skills = g.payload.skills.map((x: any) => { const t = byKey.get(x.skill_id || x.name.toLowerCase()); return { ...x, trend: t?.trend || "Current", trend_score: t?.score ?? 0, trend_confidence: t?.confidence, trend_reasons: t?.reasons || [] }; });
  (g.payload as any).outlook = { label: o.label, score: o.score, horizon: o.horizon, summary: o.summary, emerging_share: o.emerging_share, declining_share: o.declining_share, emerging_to_add: o.emerging_to_add, advice: o.advice, occupation: o.occupation };
  onProgress(98, "Saving");
  return g;
}

async function draftCore(db: Db, orgId: string, title: string, onProgress: (pct: number, stage: string) => void) {
  onProgress(5, "Gathering evidence");
  const ctx = await draftContext(db, orgId, title);
  onProgress(20, "Scoring skills from job postings and similar roles");
  const rules = rulesDraft(ctx);
  const data = await responsibilitiesFromData(db, orgId, ctx);
  const find = await skillLookup(db, orgId);
  const evidence = { market_postings: ctx.market.postings, employers: ctx.market.companies, market_titles: ctx.market.titles, similar_roles: ctx.similar.map(s => ({ id: s.id, title: s.title })),
    templates: ctx.templates.map(t => t.title), own_postings: ctx.own?.postings || 0, sources: rules.sources };
  const suggestedDept = (() => { const d = ctx.roleDetail[0]?.department_id; return d ? ctx.depts.find(x => x.id === d) || null : null; })();
  const base = {
    title: title.trim(), summary: "", alt_titles: [] as string[], responsibilities: data.responsibilities, outcomes: data.outcomes, experience: data.experience, education: data.education,
    career_level: null as string | null, suggested_department: suggestedDept, skills: rules.skills as any[], new_skills: [] as any[], evidence, confidence: rules.confidence, notes: [] as string[],
  };
  const st = await aiStatus();
  if (st.connected) {
    try {
      const p = prompt(ctx, rules);
      onProgress(30, "Writing the profile");
      const r = await chatJson(p.system, p.user, SCHEMA, f => onProgress(30 + Math.round(f * 58), "Writing the profile"));
      const o = out.parse(r.data);
      const skills: any[] = []; const unknown: string[] = []; const seen = new Set<string>();
      for (const s of o.skills) {
        const hit = find(s.name);
        const lvl = Math.min(5, Math.max(1, Math.round(Number(s.required_level) || 3)));
        const type = (REQ as readonly string[]).includes(s.requirement_type) ? s.requirement_type : "Preferred";
        const imp = (IMP as readonly string[]).includes(s.importance) ? s.importance : "Medium";
        if (hit) { if (!seen.has(hit.id)) { seen.add(hit.id); skills.push({ skill_id: hit.id, name: hit.name, source: "library", required_level: lvl, requirement_type: type, importance: imp, ai_trend: ["Emerging", "Current", "Declining"].includes((s as any).trend) ? (s as any).trend : undefined, why: s.why || "" }); } }
        else unknown.push(s.name);
      }
      // keep the strongest evidence-based skills the model left out, so the draft never gets thinner than the data
      for (const k of rules.skills.slice(0, 4)) if (!seen.has(k.skill_id) && skills.length < 12) { seen.add(k.skill_id); skills.push({ ...k, why: `${k.why} (added from data)` }); }
      const newSkills = [...(o.new_skills || []), ...unknown.filter(n => !(o.new_skills || []).some(x => x.name.toLowerCase() === n.toLowerCase())).map(n => ({ name: n, definition: "", category: undefined }))]
        .filter(n => !find(n.name)).slice(0, 8).map(n => ({ name: canonicalSpelling(n.name), definition: n.definition || "", category: n.category || null }));
      const resp = o.responsibilities.map(x => x.trim()).filter(x => x.length >= 10);
      return { method: "ai" as const, provider: r.provider, model: r.model, context: { evidence },
        payload: { ...base, summary: o.summary.trim(), alt_titles: (o.alt_titles || []).filter(t => t.toLowerCase() !== title.toLowerCase()).slice(0, 5),
          responsibilities: resp.length >= 3 ? resp.slice(0, 10) : base.responsibilities, outcomes: o.outcomes?.length ? o.outcomes.slice(0, 6) : base.outcomes,
          experience: o.experience || base.experience, education: o.education || base.education, career_level: o.career_level || null,
          suggested_department: ctx.depts.find(d => o.department && d.name.toLowerCase() === o.department.toLowerCase()) || base.suggested_department,
          skills, new_skills: newSkills, confidence: skills.length >= 6 ? (ctx.market.postings >= 10 || ctx.similar.length ? "medium" : "low") : "low",
          notes: [`Written by the local model ${r.model} from the evidence listed; not reviewed.`] } };
    } catch (e: any) {
      base.notes.push(`The local model could not draft this (${e.message}); this draft comes from the app's own data.`);
    }
  } else base.notes.push(`${st.reason || "No AI model is connected."} This draft comes from the app's own data.`);
  // rule-based draft
  const top = base.skills.slice(0, 3).map((s: any) => s.name);
  base.summary = `${title.trim()}${ctx.org?.industry ? ` in ${ctx.org.industry}` : ""}.${top.length ? ` Typically works with ${top.join(", ")}.` : ""}${base.responsibilities[0] ? ` Responsibilities include: ${base.responsibilities[0].replace(/\.$/, "").toLowerCase()}.` : ""}`;
  if (!base.skills.length) base.notes.push("No evidence was found for this title: add the skills by hand when reviewing.");
  return { method: "rules" as const, provider: null, model: null, context: { evidence }, payload: base };
}
