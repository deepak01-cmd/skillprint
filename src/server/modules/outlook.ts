/* Skill and role outlook: which skills are emerging, current or declining, what that means for each role over the next
   2–3 years, and whether to hire or train. Several independent signals are combined, each with its reason:
   - market momentum: change in the share of dated job postings that ask for the skill (recent 6 months vs the 18 months before),
     used only when both periods have enough postings;
   - industry knowledge: a built-in list of rising and falling technologies and practices (outlook/knowledge.ts);
   - automation exposure: tasks that AI and automation are taking over;
   - the company's own evidence (Skill evolution: expert ratings, planned demand);
   - labour-market reference data (O*NET): Hot Technology / In Demand flags for skills, Bright Outlook flags and emerging
     tasks for the occupation a role is linked to;
   - optionally the local AI model's view (lowest weight).
   Nothing here changes the framework by itself; it informs people. */
import { Db, one, q } from "../db";
import { forbidden, notFound } from "../errors";
import { has, orgOf } from "../scope";
import { Route } from "../http/router";
import { knowledgeFor } from "../outlook/knowledge";
import { listActive } from "./mapping";
import { marketMatch, pooledProfile } from "./market";
import { attributions, flagBonus, newTaskCounts, outlookFlags, roleLink, roleLinks, technologySignals } from "./reference";

export type Trend = "Emerging" | "Current" | "Declining";
export interface SkillOutlook { skill_id: string | null; name: string; trend: Trend; score: number; confidence: "High" | "Medium" | "Low"; reasons: string[];
  market: { recent_share: number; prior_share: number; change_pct: number; postings: number } | null }
const W = { market: 0.45, company: 0.35, industry: 0.3, labour: 0.3, automation: 0.25, ai: 0.15 };
const REQ_W: Record<string, number> = { Mandatory: 3, Preferred: 2, Optional: 1, Developmental: 0.5 };
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const labelOf = (s: number): Trend => s >= 0.3 ? "Emerging" : s <= -0.25 ? "Declining" : "Current";

/** Market windows from the dated shared postings: recent = last 6 months of data, prior = the 18 months before. */
async function marketWindows(db: Db) {
  const a = await one(db, `SELECT max(posted_date) AS anchor FROM global_postings WHERE posted_date IS NOT NULL`);
  if (!a?.anchor) return null;
  const t = await one(db, `SELECT count(*) FILTER (WHERE posted_date > $1::date - 182)::int AS recent, count(*) FILTER (WHERE posted_date <= $1::date - 182 AND posted_date > $1::date - 730)::int AS prior
    FROM global_postings WHERE posted_date > $1::date - 730`, [a.anchor]);
  return { anchor: a.anchor, recent: t!.recent, prior: t!.prior, usable: t!.recent >= 300 && t!.prior >= 300 };
}

/** Outlook for many skills at once (by library id, or by name for skills not in the library). */
export async function skillOutlooks(db: Db, orgId: string | null, skills: { skill_id: string | null; name: string }[], aiView?: Map<string, Trend>): Promise<Map<string, SkillOutlook>> {
  const out = new Map<string, SkillOutlook>();
  if (!skills.length) return out;
  const ids = [...new Set(skills.map(s => s.skill_id).filter(Boolean))] as string[];
  const win = await marketWindows(db);
  const counts = new Map<string, { r: number; p: number }>();
  if (win?.usable && ids.length) {
    for (const c of await q(db, `SELECT sid, count(*) FILTER (WHERE posted_date > $2::date - 182)::int AS r, count(*) FILTER (WHERE posted_date <= $2::date - 182)::int AS p
        FROM global_postings g CROSS JOIN LATERAL unnest(g.skill_ids) sid WHERE sid = ANY($1) AND posted_date > $2::date - 730 GROUP BY sid`, [ids, win.anchor])) counts.set(c.sid, { r: c.r, p: c.p });
  }
  const tech = await technologySignals(db, ids);
  const evidence = new Map<string, { type: string; v: number }[]>();
  if (orgId && ids.length) for (const e of await q(db, `SELECT skill_id, signal_type, value::float AS v FROM evidence_items WHERE (org_id = $1) AND skill_id = ANY($2)`, [orgId, ids]))
    evidence.set(e.skill_id, [...(evidence.get(e.skill_id) || []), { type: e.signal_type, v: e.v }]);
  for (const s of skills) {
    const parts: { w: number; v: number }[] = []; const reasons: string[] = []; let market: SkillOutlook["market"] = null; let independent = 0;
    const c = s.skill_id ? counts.get(s.skill_id) : undefined;
    if (win?.usable && c && c.r + c.p >= 12) {
      const rs = (c.r + 0.5) / win.recent, ps = (c.p + 0.5) / win.prior, ratio = rs / ps;
      const v = clamp(Math.log2(ratio) / 1.5); const conf = Math.min(1, (c.r + c.p) / 60);
      parts.push({ w: W.market * conf, v }); independent++;
      market = { recent_share: Math.round(rs * 1000) / 10, prior_share: Math.round(ps * 1000) / 10, change_pct: Math.round((ratio - 1) * 100), postings: c.r + c.p };
      reasons.push(`Job postings: asked for in ${market.recent_share}% of recent postings vs ${market.prior_share}% before (${market.change_pct >= 0 ? "+" : ""}${market.change_pct}%)`);
    }
    const ev = s.skill_id ? evidence.get(s.skill_id) : undefined;
    if (ev?.length) {
      const v = clamp(ev.reduce((a, e) => a + e.v, 0) / ev.length); parts.push({ w: W.company, v }); independent++;
      reasons.push(`Your company's evidence (${ev.length} item${ev.length > 1 ? "s" : ""}): ${v > 0.15 ? "rising demand" : v < -0.15 ? "falling demand" : "steady"}`);
    }
    const tg = s.skill_id ? tech.get(s.skill_id) : undefined;
    if (tg) {
      // these flags measure how often postings ask for the technology now (strong demand), not growth: a supporting signal only
      const v = tg.in_demand ? Math.min(0.25, 0.15 + 0.02 * Math.min(tg.in_demand, 5)) : Math.min(0.18, 0.1 + 0.02 * Math.min(tg.hot, 4));
      parts.push({ w: W.labour, v }); independent++;
      reasons.push(`Strong current demand (O*NET): ${[tg.in_demand && `In Demand in ${tg.in_demand} occupation${tg.in_demand > 1 ? "s" : ""}`, tg.hot && `a Hot Technology in ${tg.hot}`].filter(Boolean).join(", ")}`);
    }
    const k = knowledgeFor(s.name);
    if (k.industry) { parts.push({ w: W.industry, v: k.industry.value }); independent++; reasons.push(`Industry knowledge: ${k.industry.reason}`); }
    if (k.automation) { parts.push({ w: W.automation, v: k.automation.value }); reasons.push(`Automation: ${k.automation.reason}`); }
    const ai = aiView?.get(s.name.toLowerCase());
    if (ai) { parts.push({ w: W.ai, v: ai === "Emerging" ? 0.6 : ai === "Declining" ? -0.6 : 0 }); reasons.push(`AI model's view: ${ai.toLowerCase()}`); }
    const wsum = parts.reduce((a, p) => a + p.w, 0);
    const score = wsum ? Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / wsum * 100) / 100 : 0;
    if (!parts.length) reasons.push("No trend signal yet; treated as current");
    const confidence = independent >= 3 || (independent >= 2 && market) ? "High" : independent >= 2 || market ? "Medium" : "Low";
    out.set(s.skill_id || s.name.toLowerCase(), { skill_id: s.skill_id, name: s.name, trend: labelOf(score), score, confidence, reasons, market });
  }
  return out;
}

export type RoleLabel = "Growing" | "Stable" | "Transforming" | "At risk";
/** One rule for the role label, used by the role view and the organisation view so they never disagree. */
export function labelRole(lines: { trend: Trend; score: number; requirement_type?: string }[], bonus = 0): { label: RoleLabel; score: number; emShare: number; deShare: number } {
  let w = 0, sc = 0, em = 0, de = 0;
  for (const l of lines) { const wt = REQ_W[l.requirement_type || "Preferred"] ?? 1; w += wt; sc += wt * l.score; if (l.trend === "Emerging") em += wt; if (l.trend === "Declining") de += wt; }
  const score = Math.round(((w ? sc / w : 0) + bonus) * 100) / 100, emShare = w ? em / w : 0, deShare = w ? de / w : 0;
  const label: RoleLabel = deShare >= 0.4 || score <= -0.2 ? "At risk" : deShare >= 0.2 && emShare >= 0.15 ? "Transforming" : score >= 0.25 || emShare >= 0.4 ? "Growing" : "Stable";
  return { label, score, emShare, deShare };
}

/** What the skill trends mean for a role, plus skills to add and hire-or-train advice. */
export async function roleOutlook(db: Db, orgId: string, input: { title: string; role_id?: string | null; occupation?: { code: string; title: string } | null; skills: { skill_id: string | null; name: string; requirement_type?: string; required_level?: number }[]; aiView?: Map<string, Trend> }) {
  const so = await skillOutlooks(db, orgId, input.skills.map(s => ({ skill_id: s.skill_id, name: s.name })), input.aiView);
  const lines = input.skills.map(s => ({ ...s, ...(so.get(s.skill_id || s.name.toLowerCase())!) }));
  // the reference occupation linked to the role (or given for a draft): its labour-market outlook
  let occCode = input.occupation?.code ?? null;
  if (!occCode && input.role_id) { const r = await one(db, `SELECT id, title, alt_titles FROM job_roles WHERE id = $1`, [input.role_id]); occCode = r ? (await roleLink(db, orgId, r))?.code ?? null : null; }
  const flags = occCode ? (await outlookFlags(db, [occCode])).get(occCode) || [] : [];
  const newTasks = occCode ? (await newTaskCounts(db, [occCode])).get(occCode) || 0 : 0;
  const fb = flagBonus(flags, newTasks);
  const occTitle = input.occupation?.title ?? (occCode ? (await one(db, `SELECT title FROM ref_occupations WHERE code = $1 LIMIT 1`, [occCode]))?.title : null);
  const { label, score, emShare, deShare } = labelRole(lines, fb.bonus);
  // skills the market asks for in this kind of role that are rising and not yet required
  const have = new Set(lines.map(l => l.skill_id).filter(Boolean));
  const mm = await marketMatch(db, [input.title]).catch(() => ({ exact: [] as any[], similar: [] as any[] }));
  const titles = [...mm.exact.map((x: any) => x.normalized_title), ...mm.similar.slice(0, 2).map((x: any) => x.normalized_title)];
  const market = titles.length ? await pooledProfile(db, titles) : { postings: 0, companies: 0, skills: [] as any[] };
  // a handful of postings is too thin to suggest new skills from
  const candidates = market.postings >= 5 ? market.skills.filter((m: any) => !have.has(m.skill_id) && m.share >= 0.05).slice(0, 40) : [];
  const cOut = await skillOutlooks(db, orgId, candidates.map((m: any) => ({ skill_id: m.skill_id, name: m.name })));
  const toAdd = candidates.map((m: any) => ({ ...cOut.get(m.skill_id)!, market_share: m.share })).filter(x => x.trend === "Emerging").slice(0, 6);
  // people who already have them (level 3 or more, confirmed by a manager or an assessment)
  const supplyIds = [...toAdd.map(t => t.skill_id), ...lines.filter(l => l.trend === "Declining").map(l => l.skill_id)].filter(Boolean) as string[];
  const supply = new Map((supplyIds.length ? await q(db, `SELECT es.skill_id, count(DISTINCT es.employee_id)::int AS n FROM employee_skills es JOIN employees e ON e.id = es.employee_id AND e.status = 'Active'
      WHERE es.org_id = $1 AND es.skill_id = ANY($2) AND es.source IN ('manager','validated') AND es.level >= 3 GROUP BY es.skill_id`, [orgId, supplyIds]) : []).map(r => [r.skill_id, r.n]));
  const inRole = input.role_id ? Number((await one(db, `SELECT count(*)::int AS n FROM employees WHERE role_id = $1 AND status = 'Active'`, [input.role_id]))!.n) : 0;
  const advice: { kind: "train" | "hire" | "reskill" | "keep"; text: string }[] = [];
  for (const t of toAdd) { const n = supply.get(t.skill_id!) || 0; advice.push(n >= 3 ? { kind: "train", text: `${t.name}: ${n} people already have it, so train or redeploy internally` } : { kind: "hire", text: `${t.name}: only ${n} ${n === 1 ? "person has" : "people have"} it, so hire or start upskilling now` }); }
  for (const l of lines.filter(l => l.trend === "Declining")) advice.push({ kind: "reskill", text: `${l.name} is losing relevance: plan to reduce reliance on it${inRole ? ` and retrain the ${inRole} ${inRole === 1 ? "person" : "people"} in this role` : ""}` });
  if (flags.some(f => /rapid growth|new/i.test(f))) advice.unshift({ kind: "hire", text: `Demand for ${occTitle || "this occupation"} is projected to grow quickly (O*NET Bright Outlook): build a hiring and development pipeline early` });
  if (!advice.length) advice.push({ kind: "keep", text: label === "Growing" ? "Demand is rising: keep hiring pipelines warm and develop people toward senior levels" : "No major shifts expected: keep developing current skills" });
  const summary = label === "Growing" ? "This role is gaining relevance: most of its skills are current or rising."
    : label === "At risk" ? "A large part of this role's skills are declining or being automated; plan to reshape it."
    : label === "Transforming" ? "This role is changing: some skills are declining while new ones are rising."
    : "This role looks stable over the next 2–3 years.";
  return { title: input.title, label, score, horizon: "next 2–3 years", summary, emerging_share: Math.round(emShare * 100), declining_share: Math.round(deShare * 100),
    skills: lines.map(l => ({ skill_id: l.skill_id, name: l.name, requirement_type: l.requirement_type, required_level: l.required_level, trend: l.trend, score: l.score, confidence: l.confidence, reasons: l.reasons, market: l.market })),
    emerging_to_add: toAdd.map(t => ({ skill_id: t.skill_id, name: t.name, score: t.score, reasons: t.reasons, market_share: Math.round(t.market_share * 100), people_with_it: supply.get(t.skill_id!) || 0 })),
    advice, occupation: occCode ? { code: occCode, title: occTitle, flags, new_tasks: newTasks, reasons: fb.reasons } : null,
    evidence: { market_postings: market.postings, market_titles: titles.slice(0, 3) } };
}

async function roleSkills(db: Db, orgId: string, roleId: string) {
  return (await listActive(db, orgId, { roleId })).map((m: any) => ({ skill_id: m.skill_id, name: m.skill_name, requirement_type: m.requirement_type, required_level: m.required_level }));
}

export const routes: Route[] = [
  { method: "GET", pattern: "/outlook/roles/:id", handler: async ({ db, user, params }) => {
    if (!has(user, "roles:read")) throw forbidden();
    const r = await one(db, `SELECT id, title FROM job_roles WHERE id = $1 AND org_id = $2`, [params.id, orgOf(user)]);
    if (!r) throw notFound("Role");
    const o = await roleOutlook(db, orgOf(user), { title: r.title, role_id: r.id, skills: await roleSkills(db, orgOf(user), r.id) });
    return { ...o, attribution: o.occupation ? await attributions(db) : [] };
  } },
  /** Organisation view: every published role ranked by outlook, rising and falling skills with how many people have them. */
  { method: "GET", pattern: "/outlook", handler: async ({ db, user }) => {
    if (!["hr_admin", "dept_head", "manager"].includes(user.role)) throw forbidden();
    const orgId = orgOf(user);
    const dept = user.role === "dept_head" ? user.department_id : null;
    const roles = await q(db, `SELECT r.id, r.title, d.name AS department_name, (SELECT count(*)::int FROM employees e WHERE e.role_id = r.id AND e.status = 'Active') AS headcount
      FROM job_roles r JOIN departments d ON d.id = r.department_id WHERE r.org_id = $1 AND r.status = 'Published' AND ($2::text IS NULL OR r.department_id = $2) ORDER BY r.title`, [orgId, dept]);
    const fw = await listActive(db, orgId, { roleIds: roles.map(r => r.id) });
    const uniq = new Map<string, string>(); fw.forEach((m: any) => uniq.set(m.skill_id, m.skill_name));
    const so = await skillOutlooks(db, orgId, [...uniq.entries()].map(([id, name]) => ({ skill_id: id, name })));
    const links = await roleLinks(db, orgId, roles);
    const codes = [...new Set(links.values())];
    const flagsBy = await outlookFlags(db, codes); const tasksBy = await newTaskCounts(db, codes);
    const out = roles.map(r => {
      const ls = fw.filter((m: any) => m.role_id === r.id).map((m: any) => ({ ...so.get(m.skill_id)!, requirement_type: m.requirement_type }));
      const code = links.get(r.id); const flags = code ? flagsBy.get(code) || [] : [];
      const { label, score } = labelRole(ls, flagBonus(flags, code ? tasksBy.get(code) || 0 : 0).bonus);
      return { ...r, label, score, occupation_code: code || null, outlook_flags: flags, emerging: ls.filter(l => l.trend === "Emerging").map(l => l.name), declining: ls.filter(l => l.trend === "Declining").map(l => l.name), skills: ls.length };
    }).sort((a, b) => b.score - a.score);
    const supply = new Map((await q(db, `SELECT es.skill_id, count(DISTINCT es.employee_id)::int AS n FROM employee_skills es JOIN employees e ON e.id = es.employee_id AND e.status = 'Active'
      WHERE es.org_id = $1 AND es.source IN ('manager','validated') AND es.level >= 3 GROUP BY es.skill_id`, [orgId])).map(r => [r.skill_id, r.n]));
    const demand = new Map<string, number>(); fw.forEach((m: any) => demand.set(m.skill_id, (demand.get(m.skill_id) || 0) + (roles.find(r => r.id === m.role_id)?.headcount || 0)));
    const skills = [...so.values()].map(s => ({ ...s, people_with_it: supply.get(s.skill_id!) || 0, people_in_roles_needing_it: demand.get(s.skill_id!) || 0, roles: fw.filter((m: any) => m.skill_id === s.skill_id).length }));
    const counts = { Growing: 0, Stable: 0, Transforming: 0, "At risk": 0 } as Record<RoleLabel, number>; out.forEach(r => counts[r.label as RoleLabel]++);
    const win = await marketWindows(db);
    return { roles: out, counts, emerging: skills.filter(s => s.trend === "Emerging").sort((a, b) => b.score - a.score),
      declining: skills.filter(s => s.trend === "Declining").sort((a, b) => a.score - b.score),
      market: win ? { anchor: win.anchor, recent_postings: win.recent, prior_postings: win.prior, momentum_available: win.usable } : null,
      reference: { linked_roles: links.size, attribution: await attributions(db) } };
  } },
];
