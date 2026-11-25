/* Pure calculation services (PRD 14, 16.4, 16.6, 21.3, 21.4, 22.6). No database access, no UI.
   Every function takes the thresholds it uses, so results are reproducible from stored inputs (Principle 12). */

export type Source = "self" | "manager" | "validated";
export interface LevelRecord { level: number; source: Source; assessed_on?: string | null; assessed_by?: string | null }
export interface Requirement { skill_id: string; skill_name?: string; required_level: number; requirement_type: string; importance: string; pixel_id?: string }

/** Latest trusted level (16.6): the most recent validated or manager-assessed level (validated wins a tie);
    self-reported levels count only if the company chooses to count them. */
export function effectiveLevel(records: LevelRecord[], countSelf: boolean): { level: number | null; source: Source | null; assessed_on: string | null } {
  const trusted = records.filter(r => r.source === "validated" || r.source === "manager")
    .sort((a, b) => String(b.assessed_on ?? "").localeCompare(String(a.assessed_on ?? "")) || (a.source === "validated" ? -1 : 1));
  const r = trusted[0] ?? (countSelf ? records.find(x => x.source === "self") : undefined);
  return r ? { level: r.level, source: r.source, assessed_on: r.assessed_on ?? null } : { level: null, source: null, assessed_on: null };
}

export interface PriorityConfig { importance: Record<string, number>; mandatory_bonus: number; high_at: number; medium_at: number }

/** Skill gap = required - current, never below zero. Missing data is not a zero (14.5). */
export function gapFor(req: Requirement, current: number | null, cfg: PriorityConfig, selfOnly = false) {
  if (current === null) return { gap: null, status: "No assessment data", priority: "Unknown", score: null };
  const gap = Math.max(0, req.required_level - current);
  if (gap === 0) return { gap: 0, status: "Met", priority: "None", score: 0 };
  const score = gap + (cfg.importance[req.importance] ?? 0) + (req.requirement_type === "Mandatory" ? cfg.mandatory_bonus : 0) - (selfOnly ? 1 : 0);
  return { gap, status: "Gap", priority: score >= cfg.high_at ? "High" : score >= cfg.medium_at ? "Medium" : "Low", score };
}

export interface DifficultyConfig { low: { new_skills: number; level_points: number }; medium: { new_skills: number; level_points: number } }

/** Path comparison metrics (16.4). Source and target are role requirements from the active framework. */
export function compareRoles(source: Requirement[], target: Requirement[], cfg: DifficultyConfig, countTypes?: string[]) {
  const t = countTypes ? target.filter(r => countTypes.includes(r.requirement_type)) : target;
  const s = countTypes ? source.filter(r => countTypes.includes(r.requirement_type)) : source;
  const srcBy = new Map(s.map(r => [r.skill_id, r]));
  const lines = t.map(r => {
    const src = srcBy.get(r.skill_id);
    const from = src ? src.required_level : 0;
    return { skill_id: r.skill_id, skill_name: r.skill_name, source_level: src ? src.required_level : null, target_level: r.required_level,
      difference: r.required_level - from, kind: src ? "shared" : "new", points: Math.max(0, r.required_level - from) };
  });
  const shared = lines.filter(l => l.kind === "shared").length;
  const newSkills = lines.length - shared;
  const higher = lines.filter(l => l.kind === "shared" && l.difference > 0).length;
  const levelPoints = lines.reduce((a, l) => a + l.points, 0);
  const overlap = lines.length ? shared / lines.length : 0;
  const difficulty = newSkills <= cfg.low.new_skills && levelPoints <= cfg.low.level_points ? "Low"
    : newSkills <= cfg.medium.new_skills && levelPoints <= cfg.medium.level_points ? "Medium" : "High";
  return { skills_in_target: lines.length, shared_skills: shared, new_skills: newSkills, skills_needing_higher_level: higher,
    level_points_to_close: levelPoints, skill_overlap: Math.round(overlap * 10000) / 10000, move_difficulty: difficulty, lines };
}

export interface Band { band: string; min: number }

/** Readiness (16.6): a skill is met when the trusted level is at least the required level; no level counts as not met. */
export function readiness(target: Requirement[], levels: Map<string, { level: number | null; source: string | null; assessed_on: string | null }>, bands: Band[]) {
  const lines = target.map(r => {
    const l = levels.get(r.skill_id) ?? { level: null, source: null, assessed_on: null };
    const actual = l.level;
    const met = actual !== null && actual >= r.required_level;
    return { skill_id: r.skill_id, skill_name: r.skill_name, required_level: r.required_level, actual_level: actual,
      gap: Math.max(0, r.required_level - (actual ?? 0)), met, assessment_type: l.source, assessed_on: l.assessed_on };
  });
  const met = lines.filter(l => l.met).length;
  const share = lines.length ? met / lines.length : 0;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const band = (sorted.find(b => share >= b.min) ?? sorted[sorted.length - 1]).band;
  return { skills_required: lines.length, skills_met: met, share_met: Math.round(share * 1000) / 1000,
    gap_points: lines.reduce((a, l) => a + l.gap, 0), band, lines };
}

/** Role-level supply and demand (21.3). */
export function rolePlan(i: { current: number; attrition: number; planned: number; horizonMonths: number; readyNow: number; ready6to12: number }) {
  const exits = i.current * i.attrition * (i.horizonMonths / 12);
  const raw = i.planned - (i.current - exits);
  const rounded = Math.round(raw);
  const net = Math.max(0, rounded);
  const surplus = rounded < 0 ? -rounded : 0;
  const filledInternal = Math.min(net, i.readyNow);
  return { current_headcount: i.current, expected_exits: Math.round(exits * 100) / 100, planned_headcount: i.planned, net_positions: net, surplus,
    pipeline_ready_now: i.readyNow, pipeline_ready_6_12: i.ready6to12, filled_internal: filledInternal, external_hires: Math.max(0, net - filledInternal) };
}

/** Skill demand outlook (21.4). */
export function skillOutlook(i: { demandToday: number; demandPlanned: number; growth: number; supply: number; assessedShare: number; anyAssessment: boolean },
                             risk: { high_below: number; medium_below: number }) {
  const adjusted = Math.ceil(Math.round(i.demandPlanned * (1 + i.growth) * 1e6) / 1e6);
  const shortfall = Math.max(0, adjusted - i.supply);
  const coverage = adjusted > 0 ? i.supply / adjusted : null;
  const level = adjusted === 0 ? "Not applicable" : coverage! < risk.high_below ? "High" : coverage! < risk.medium_below ? "Medium" : "Low";
  return { demand_today: i.demandToday, demand_planned: i.demandPlanned, growth_adjustment: i.growth, adjusted_planned_demand: adjusted,
    supply: i.anyAssessment ? i.supply : null, supply_note: i.anyAssessment ? null : "No assessment data", shortfall: i.anyAssessment ? shortfall : null,
    coverage: coverage === null || !i.anyAssessment ? null : Math.round(coverage * 1000) / 1000, risk: i.anyAssessment ? level : "No assessment data",
    trend: i.growth > 0 ? "Growing" : i.growth < 0 ? "Declining" : "Stable", low_confidence: i.assessedShare < 0.5 };
}

export interface Signal { signal_type: "external_demand" | "expert_rating" | "internal_demand" | "automation_exposure"; value: number; source_id: string; source_type: string; evidence_date: string }
export interface TrendConfig { weights: Record<string, number>; emerging_at: number; growing_at: number; declining_at: number; freshness_months: number }

/** Skill trend score T = sum(w_i * s_i) (22.6). Weights renormalise over the signal types present. */
export function trendScore(signals: Signal[], cfg: TrendConfig, ctx: { rolesMapped: number; today: Date }) {
  if (!signals.length) return { score: null, trend: "No evidence", confidence: "Low", sources: 0, stale: 0 };
  const byType = new Map<string, number[]>();
  for (const s of signals) byType.set(s.signal_type, [...(byType.get(s.signal_type) || []), s.value]);
  let wsum = 0, total = 0;
  for (const [type, vals] of byType) { const w = cfg.weights[type] ?? 0; wsum += w; total += w * (vals.reduce((a, b) => a + b, 0) / vals.length); }
  const score = wsum ? Math.round((total / wsum) * 1000) / 1000 : 0;
  const trend = score >= cfg.emerging_at && ctx.rolesMapped <= 2 ? "Emerging" : score >= cfg.growing_at ? "Growing" : score <= cfg.declining_at ? "Declining" : "Stable";
  const cutoff = new Date(ctx.today); cutoff.setMonth(cutoff.getMonth() - cfg.freshness_months);
  const stale = signals.filter(s => new Date(s.evidence_date) < cutoff).length;
  const sources = new Set(signals.filter(s => new Date(s.evidence_date) >= cutoff).map(s => s.source_id)).size;
  const hasExpert = signals.some(s => s.source_type === "Expert review" || s.signal_type === "expert_rating");
  let confidence = sources >= 3 && hasExpert ? "High" : sources >= 2 ? "Medium" : "Low";
  if (stale && confidence !== "Low") confidence = confidence === "High" ? "Medium" : "Low";
  return { score, trend, confidence, sources, stale };
}

/** Map a Module 18 trend to the framework label (SA-05, 22.9). */
export const M18_TO_SAMPLE: Record<string, string> = { Emerging: "Emerging", Growing: "Current", Stable: "Current", Declining: "Declining" };

/** Match to a role, used everywhere a percentage is shown (dashboard, profile, internal jobs, succession):
    each requirement earns the share of its required level reached, weighted by type (Mandatory 3, Preferred 2, Optional 1, Developmental 0.5). */
export const MATCH_WEIGHT: Record<string, number> = { Mandatory: 3, Preferred: 2, Optional: 1, Developmental: 0.5 };
export function weightedMatch(lines: { required_level: number; requirement_type: string; current: number | null }[]) {
  let w = 0, got = 0, met = 0, mustGaps = 0;
  for (const l of lines) {
    const wt = MATCH_WEIGHT[l.requirement_type] ?? 1; w += wt;
    got += wt * (l.current === null ? 0 : Math.min(l.current, l.required_level) / l.required_level);
    if (l.current !== null && l.current >= l.required_level) met++; else if (l.requirement_type === "Mandatory") mustGaps++;
  }
  return { match_pct: w ? Math.round(got / w * 100) : 0, skills_met: met, skills_required: lines.length, mandatory_gaps: mustGaps };
}
