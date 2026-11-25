/* PRD 33.1 and 33.2 worked examples, reproduced with default thresholds. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRoles, gapFor, readiness, rolePlan, skillOutlook, trendScore, effectiveLevel } from "../src/server/calc";
import { DEFAULT_ASSUMPTIONS as A } from "../src/server/modules/structure";

const req = (id: string, level: number, type = "Mandatory", importance = "High") => ({ skill_id: id, required_level: level, requirement_type: type, importance });

test("33.1 Rahul, Data Analyst: three skill gaps", () => {
  const reqs = [req("SQL", 4), req("Excel", 3), req("PowerBI", 3), req("Python", 2), req("Stats", 3)];
  const actual: Record<string, number> = { SQL: 3, Excel: 3, PowerBI: 2, Python: 2, Stats: 2 };
  const gaps = reqs.map(r => gapFor(r, actual[r.skill_id], A.gap_priority));
  assert.equal(gaps.filter(g => g.status === "Gap").length, 3);
  assert.deepEqual(gaps.map(g => g.gap), [1, 0, 1, 0, 1]);
});

test("14.3 priority example: Python High, Cloud Medium, Excel None, Communication High", () => {
  assert.equal(gapFor(req("Python", 4, "Mandatory", "Critical"), 2, A.gap_priority).priority, "High");
  assert.equal(gapFor(req("Cloud", 3, "Preferred", "Medium"), 2, A.gap_priority).priority, "Medium");
  assert.equal(gapFor(req("Excel", 4, "Mandatory", "High"), 4, A.gap_priority).priority, "None");
  assert.equal(gapFor(req("Comm", 3, "Mandatory", "High"), 1, A.gap_priority).priority, "High");
  assert.equal(gapFor(req("X", 3), null, A.gap_priority).status, "No assessment data");
});

test("33.2 path comparison: Junior Data Analyst to Data Analyst is Low (11 skills, 10 shared, 11 points)", () => {
  // 10 shared skills: 9 need +1, 1 equal; 1 new skill at level 2  -> 9 + 2 = 11 points
  const src = Array.from({ length: 10 }, (_, i) => req(`s${i}`, 2));
  const tgt = [...Array.from({ length: 9 }, (_, i) => req(`s${i}`, 3)), req("s9", 2), req("new1", 2)];
  const r = compareRoles(src, tgt, A.difficulty);
  assert.equal(r.skills_in_target, 11); assert.equal(r.shared_skills, 10); assert.equal(r.new_skills, 1);
  assert.equal(r.skills_needing_higher_level, 9); assert.equal(r.level_points_to_close, 11);
  assert.equal(Math.round(r.skill_overlap * 100), 91); assert.equal(r.move_difficulty, "Low");
});

test("33.2 path comparison: Data Analyst to Data Engineer is High (13 skills, 5 shared, 8 new, 27 points)", () => {
  const src = Array.from({ length: 5 }, (_, i) => req(`s${i}`, 3));
  // 2 shared need +1 (2 points), 8 new skills worth 25 points
  const tgt = [req("s0", 4), req("s1", 4), req("s2", 3), req("s3", 3), req("s4", 3), ...[4, 3, 3, 3, 3, 3, 3, 3].map((l, i) => req(`n${i}`, l))];
  const r = compareRoles(src, tgt, A.difficulty);
  assert.equal(r.skills_in_target, 13); assert.equal(r.shared_skills, 5); assert.equal(r.new_skills, 8);
  assert.equal(r.skills_needing_higher_level, 2); assert.equal(r.level_points_to_close, 27);
  assert.equal(Math.round(r.skill_overlap * 100), 38); assert.equal(r.move_difficulty, "High");
});

test("33.2 readiness: Ananya meets 15 of 16 (94%) -> Ready now, 1 gap point", () => {
  const tgt = Array.from({ length: 16 }, (_, i) => req(`s${i}`, 3));
  const lv = new Map(tgt.map((t, i) => [t.skill_id, { level: i === 0 ? 2 : 3, source: "validated", assessed_on: null }]));
  const r = readiness(tgt, lv, A.readiness);
  assert.equal(r.skills_met, 15); assert.equal(Math.round(r.share_met * 100), 94); assert.equal(r.band, "Ready now"); assert.equal(r.gap_points, 1);
});

test("33.2 readiness: Rahul meets 0 of 13 -> Long-term / stretch, 22 gap points", () => {
  const tgt = Array.from({ length: 13 }, (_, i) => req(`s${i}`, i < 9 ? 4 : 3));
  const lv = new Map(tgt.map((t, i) => [t.skill_id, { level: i < 9 ? 2 : 2, source: "validated", assessed_on: null }]));
  // 9 x (4-2) + 4 x (3-2) = 22
  const r = readiness(tgt, lv, A.readiness);
  assert.equal(r.skills_met, 0); assert.equal(r.band, "Long-term / stretch"); assert.equal(r.gap_points, 22);
});

test("16.6 a skill with no recorded level counts as not met; self-assessed levels do not count by default", () => {
  assert.equal(effectiveLevel([{ level: 4, source: "self" }], false).level, null);
  assert.equal(effectiveLevel([{ level: 4, source: "self" }], true).level, 4);
  assert.equal(effectiveLevel([{ level: 2, source: "manager" }, { level: 3, source: "validated" }], false).level, 3);
});

test("33.2 role plan: Data Analyst 3 people, 12% attrition, planned 4 -> 1 net position, 1 external hire", () => {
  const r = rolePlan({ current: 3, attrition: 0.12, planned: 4, horizonMonths: 12, readyNow: 0, ready6to12: 0 });
  assert.equal(r.expected_exits, 0.36); assert.equal(r.net_positions, 1); assert.equal(r.external_hires, 1);
});

test("33.2 skill outlook: Cloud Computing 12 planned, +10% -> 14 demand, supply 8, shortfall 6, 57% High, Growing", () => {
  const r = skillOutlook({ demandToday: 8, demandPlanned: 12, growth: 0.1, supply: 8, assessedShare: 1, anyAssessment: true }, A.risk);
  assert.equal(r.adjusted_planned_demand, 14); assert.equal(r.shortfall, 6); assert.equal(Math.round(r.coverage! * 100), 57);
  assert.equal(r.risk, "High"); assert.equal(r.trend, "Growing");
});

test("22.6 trend score and confidence", () => {
  const today = new Date("2026-11-18");
  const s = (t: any, v: number, src: string, type = "Outlook report", d = "2026-10-01") => ({ signal_type: t, value: v, source_id: src, source_type: type, evidence_date: d });
  const r = trendScore([s("external_demand", 0.6, "a"), s("expert_rating", 0.4, "b", "Expert review"), s("internal_demand", 0.2, "c", "Company data")], A.evolution, { rolesMapped: 5, today });
  assert.equal(r.trend, "Growing"); assert.equal(r.confidence, "High");
  assert.equal(trendScore([], A.evolution, { rolesMapped: 1, today }).trend, "No evidence");
  const stale = trendScore([s("external_demand", -0.8, "a", "Outlook report", "2024-01-01"), s("expert_rating", -0.6, "b", "Expert review")], A.evolution, { rolesMapped: 3, today });
  assert.equal(stale.trend, "Declining"); assert.equal(stale.confidence, "Low");
});
