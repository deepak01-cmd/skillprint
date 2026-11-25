/* Demo data: career ladders. The v3 sample has only mid-level roles, so every move is lateral. This adds junior, senior,
   lead and manager versions of a few roles in each demo organisation, with the skill upgrades each step needs
   (higher levels, new leadership and architecture skills, hands-on skills becoming less central on the management
   track), vertical career paths between them, and a few people in the new roles. Safe to run again: existing titles
   are left alone. Only for the demo organisations (accounts ending in .demo). */
import { Db, one, q } from "../db";

type Track = "Individual Contributor" | "Technical Leadership" | "Management";
interface Step { title: string; rank: 2 | 4 | 5 | 6; track: Track; extras: [string, number, "Mandatory" | "Preferred" | "Optional"][] }
interface Ladder { base: string; steps: Step[]; skip?: string; trackChange?: [string, string] }

// skills a step adds, by name (created in the shared library if missing)
const SOFT: Record<string, { category: string; type: string; definition: string }> = {
  "Stakeholder Management": { category: "Business & Leadership", type: "Interpersonal", definition: "Build agreement with stakeholders, manage expectations and communicate trade-offs." },
  "Coaching & Mentoring": { category: "Business & Leadership", type: "Interpersonal", definition: "Develop others through feedback, pairing and structured coaching." },
  "Leadership": { category: "Business & Leadership", type: "Interpersonal", definition: "Set direction, make decisions and take responsibility for a team's results." },
  "Strategic Planning": { category: "Business & Leadership", type: "Technical / functional / industry", definition: "Turn goals into multi-quarter plans, priorities and measurable outcomes." },
  "Budgeting": { category: "Business & Leadership", type: "Technical / functional / industry", definition: "Plan, track and justify team or project budgets." },
  "Software Architecture": { category: "Software Engineering", type: "Technical / functional / industry", definition: "Design systems: structure, interfaces, scalability, reliability and trade-offs." },
};

const L = (title: string, rank: Step["rank"], track: Track, extras: Step["extras"] = []): Step => ({ title, rank, track, extras });
const IC4 = (domain: [string, number][] = []): Step["extras"] => [["Stakeholder Management", 3, "Preferred"], ["Coaching & Mentoring", 2, "Optional"], ...domain.map(([n, l]) => [n, l, "Preferred"] as [string, number, "Preferred"])];
const LEAD5 = (domain: [string, number][] = []): Step["extras"] => [["Stakeholder Management", 4, "Mandatory"], ["Coaching & Mentoring", 3, "Mandatory"], ["Leadership", 3, "Preferred"], ["Strategic Planning", 2, "Optional"], ...domain.map(([n, l]) => [n, l, "Mandatory"] as [string, number, "Mandatory"])];
const MGR = (rank: 5 | 6): Step["extras"] => [["Leadership", rank === 6 ? 5 : 4, "Mandatory"], ["Stakeholder Management", rank === 6 ? 5 : 4, "Mandatory"], ["Coaching & Mentoring", 4, "Mandatory"],
  ["Strategic Planning", rank === 6 ? 4 : 3, "Mandatory"], ["Budgeting", rank === 6 ? 4 : 3, "Preferred"], ["Project Planning", 4, "Preferred"]];

/** Ladders per demo organisation, by the sample role they grow from. */
const LADDERS: Record<string, Ladder[]> = {
  "FinEdge Technologies": [
    { base: "Financial Data Analyst", skip: "Analytics Lead", steps: [L("Junior Data Analyst", 2, "Individual Contributor"), L("Senior Financial Data Analyst", 4, "Individual Contributor", IC4([["Machine Learning", 3]])),
      L("Analytics Lead", 5, "Technical Leadership", LEAD5([["Data Governance", 4]])), L("Head of Data & Analytics", 6, "Management", MGR(6))] },
    { base: "Backend Developer", skip: "Engineering Lead", trackChange: ["Senior Backend Developer", "Engineering Manager"], steps: [L("Associate Software Engineer", 2, "Individual Contributor"), L("Senior Backend Developer", 4, "Individual Contributor", IC4([["Software Architecture", 3]])),
      L("Engineering Lead", 5, "Technical Leadership", LEAD5([["Software Architecture", 4]])), L("Engineering Manager", 5, "Management", MGR(5))] },
    { base: "Credit Risk Analyst", trackChange: ["Senior Credit Risk Analyst", "Credit Risk Manager"], steps: [L("Senior Credit Risk Analyst", 4, "Individual Contributor", IC4([["AI Model Risk Management", 3]])), L("Credit Risk Manager", 5, "Management", MGR(5))] },
  ],
  "MediCore Health Systems": [
    { base: "Clinical Data Analyst", skip: "Clinical Analytics Lead", steps: [L("Junior Clinical Data Analyst", 2, "Individual Contributor"), L("Senior Clinical Data Analyst", 4, "Individual Contributor", IC4([["Machine Learning", 2]])),
      L("Clinical Analytics Lead", 5, "Technical Leadership", LEAD5([["Data Governance", 4]]))] },
    { base: "Healthcare Software Engineer", trackChange: ["Principal Engineer", "Head of Engineering"], steps: [L("Senior Healthcare Software Engineer", 4, "Individual Contributor", IC4([["Software Architecture", 3]])),
      L("Principal Engineer", 5, "Technical Leadership", LEAD5([["Software Architecture", 5]])), L("Head of Engineering", 6, "Management", MGR(6))] },
  ],
  "CloudNova Solutions": [
    { base: "Backend Developer", skip: "Engineering Lead", trackChange: ["Senior Backend Developer", "Engineering Manager"], steps: [L("Associate Software Engineer", 2, "Individual Contributor"),
      L("Senior Backend Developer", 4, "Individual Contributor", IC4([["Software Architecture", 3]])), L("Engineering Lead", 5, "Technical Leadership", LEAD5([["Software Architecture", 4]])),
      L("Engineering Manager", 5, "Management", MGR(5)), L("Director of Engineering", 6, "Management", MGR(6))] },
    { base: "Data Engineer", skip: "Data Engineering Lead", steps: [L("Senior Data Engineer", 4, "Individual Contributor", IC4([["Data Governance", 3]])), L("Data Engineering Lead", 5, "Technical Leadership", LEAD5([["Software Architecture", 4]]))] },
    { base: "DevOps Engineer", steps: [L("Senior DevOps Engineer", 4, "Individual Contributor", IC4([["Cloud Cost Management (FinOps)", 3]])), L("Platform Engineering Lead", 5, "Technical Leadership", LEAD5([["Software Architecture", 4]]))] },
  ],
};

const SUMMARY: Record<string, (base: string) => string> = {
  "2": b => `Works on well-defined tasks with guidance, building the core skills of a ${b}.`,
  "4": b => `Owns complex work end to end, sets quality standards and mentors other ${b}s.`,
  "5:Technical Leadership": () => "Leads the technical direction of a team: designs the approach, reviews work and grows the people around them.",
  "5:Management": () => "Leads and develops a team: hiring, goals, capacity, budget and delivery, staying close enough to the work to make sound calls.",
  "6:Management": () => "Leads the function: strategy, organisation design, budget and the development of its leaders.",
};
const DUTIES: Record<string, string[]> = {
  "2": ["Complete well-scoped tasks with review from senior colleagues", "Learn the team's tools, standards and data", "Ask for feedback and act on it"],
  "4": ["Own complex deliverables from scoping to release", "Review others' work and set quality standards", "Mentor junior and mid-level colleagues", "Explain trade-offs to stakeholders"],
  "5:Technical Leadership": ["Set the technical direction and standards for the team", "Design solutions for the hardest problems", "Coach engineers and analysts toward senior levels", "Agree priorities with stakeholders"],
  "5:Management": ["Hire, develop and retain the team", "Plan capacity, budget and delivery", "Run performance and career conversations", "Represent the team with senior stakeholders"],
  "6:Management": ["Set the function's strategy and multi-year plan", "Own the function's budget and organisation design", "Develop the leaders who report to you", "Partner with executives on priorities"],
};

/** Requirement for a step, derived from the mid-level role's requirement. */
function derive(m: any, rank: number, track: Track) {
  let lvl = Number(m.required_level), req: string = m.requirement_type, imp: string = m.importance;
  if (rank === 2) { if (req === "Optional" || req === "Developmental") return null; lvl = Math.max(1, lvl - 1); }
  else if (track === "Management") {
    // hands-on skills matter less as people move into management: core skills kept at a lower requirement, the rest fade out
    if (req !== "Mandatory") { if (rank === 6) return null; lvl = Math.max(1, lvl - 1); req = "Optional"; imp = "Low"; }
    else { lvl = rank === 6 ? Math.min(3, lvl) : Math.min(4, lvl + 1); req = rank === 6 ? "Optional" : "Preferred"; imp = rank === 6 ? "Low" : "Medium"; }
  } else if (rank === 4) { if (req !== "Optional" && req !== "Developmental") lvl = Math.min(5, lvl + 1); if (req === "Developmental") req = "Optional"; }
  else if (rank === 5) {
    // technical lead: deep in the core skills (two steps for the ones a mid-level needs only at 3 or below), the rest as at senior level
    if (req === "Mandatory") lvl = Math.min(5, lvl + (lvl <= 3 ? 2 : 1)); else if (req === "Preferred") lvl = Math.min(5, lvl + 1);
    if (req === "Developmental") req = "Optional";
  }
  return { level: lvl, req, imp };
}

let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const FIRST = ["Asha", "Neel", "Ira", "Kunal", "Rhea", "Vivek", "Tanvi", "Sameer", "Anika", "Yash", "Mira", "Adil", "Kavya", "Rohit", "Sana", "Varun", "Esha", "Jai", "Nora", "Ishaan"];
const LAST = ["Agarwal", "Bhatt", "Chauhan", "Desai", "Garg", "Hegde", "Jain", "Kulkarni", "Malhotra", "Naidu", "Oberoi", "Prasad", "Qureshi", "Saxena", "Thakur", "Upadhyay"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function skillId(db: Db, name: string) {
  const s = await one(db, `SELECT id FROM skills WHERE org_id IS NULL AND status = 'Active' AND (lower(name) = lower($1) OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) a)) ORDER BY id LIMIT 1`, [name]);
  if (s) return s.id as string;
  const d = SOFT[name]; if (!d) return null;
  return (await one(db, `INSERT INTO skills (org_id, name, definition, category, type) VALUES (NULL, $1, $2, $3, $4) RETURNING id`, [name, d.definition, d.category, d.type]))!.id as string;
}

export async function addCareerLadders(db: Db, orgId: string) {
  const org = await one(db, `SELECT name FROM organisations WHERE id = $1`, [orgId]);
  const ladders = org ? LADDERS[org.name] : undefined;
  if (!ladders) return { roles: 0, paths: 0, people: 0 };
  const levels = new Map((await q(db, `SELECT rank, id FROM career_levels WHERE org_id = $1`, [orgId])).map(r => [Number(r.rank), r.id]));
  const mgrByDept = new Map((await q(db, `SELECT e.department_id, e.id FROM employees e JOIN users u ON u.id = e.user_id AND u.role = 'manager' WHERE e.org_id = $1`, [orgId])).map(r => [r.department_id, r.id]));
  let roles = 0, paths = 0, people = 0;
  const path = async (from: string, to: string, type: string, months: number) => {
    const r = await q(db, `INSERT INTO career_paths (org_id, from_role_id, to_role_id, movement_type, typical_months, approval_required, status) VALUES ($1,$2,$3,$4,$5,true,'Published')
      ON CONFLICT (org_id, from_role_id, to_role_id) DO UPDATE SET movement_type = EXCLUDED.movement_type, typical_months = EXCLUDED.typical_months
      WHERE career_paths.movement_type <> EXCLUDED.movement_type RETURNING id`, [orgId, from, to, type, months]);
    paths += r.length;
  };
  for (const lad of ladders) {
    const base = await one(db, `SELECT * FROM job_roles WHERE org_id = $1 AND title = $2 AND status = 'Published' ORDER BY id LIMIT 1`, [orgId, lad.base]);
    if (!base) continue;
    if (!base.career_level_id && levels.get(3)) await q(db, `UPDATE job_roles SET career_level_id = $2 WHERE id = $1`, [base.id, levels.get(3)]);
    const baseMaps = await q(db, `SELECT * FROM role_skill_mapping WHERE role_id = $1 AND lifecycle_status = 'Active' AND approval_status = 'Published'`, [base.id]);
    const ids: Record<string, string> = { [lad.base]: base.id };
    // skills added on the way up the individual track are kept higher up: a lead needs what a senior needs, plus more
    const carried = new Map<string, [number, string]>();
    const withCarried = (st: Step): Step["extras"] => {
      if (st.track === "Management" || st.rank < 5) return st.extras;
      const own = new Map(st.extras.map(([n, l, r]) => [n, [l, r] as [number, string]]));
      for (const [n, [l]] of carried) if (!own.has(n)) own.set(n, [l, "Preferred"]); else if (own.get(n)![0] < l) own.set(n, [l, own.get(n)![1]]);
      return [...own].map(([n, [l, r]]) => [n, l, r as any]);
    };
    const remember = (st: Step) => { if (st.track !== "Management" && st.rank >= 4) for (const [n, l, r] of withCarried(st)) if (!carried.has(n) || carried.get(n)![0] < l) carried.set(n, [l, r]); };
    for (const st0 of [...lad.steps].sort((a, b) => a.rank - b.rank)) {
      const st: Step = { ...st0, extras: withCarried(st0) };
      remember(st0);
      const key = st.rank === 2 || st.rank === 4 ? String(st.rank) : `${st.rank}:${st.track}`;
      const ex = await one(db, `SELECT id FROM job_roles WHERE org_id = $1 AND lower(title) = lower($2) AND status <> 'Archived'`, [orgId, st.title]);
      if (ex) {
        ids[st.title] = ex.id;
        // roles made by an earlier version: add carried-up skills they are missing
        for (const [name, level, req] of st.extras) {
          const sid = await skillId(db, name); if (!sid) continue;
          await q(db, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, trend_rationale, confidence_score, approval_status, lifecycle_status, created_by)
            VALUES ($1, 'PX-' || $2 || '-' || $3, $2, $3, $4, $5, 'Medium', 'Current', 'Increasing', $6, 0.7, 'Published', 'Active', 'Demo data') ON CONFLICT DO NOTHING`, [orgId, ex.id, sid, level, req, `Needed at ${st.title} level`]);
        }
        continue;
      }
      const r = (await one(db, `INSERT INTO job_roles (org_id, department_id, job_family_id, career_level_id, title, career_track, summary, responsibilities, outcomes, industry, status, version, review_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Published',1,'2027-10-31') RETURNING id`,
        [orgId, base.department_id, base.job_family_id, levels.get(st.rank) ?? null, st.title, st.track, `${st.title}. ${(SUMMARY[key] || SUMMARY["4"])(lad.base)}`,
         [...(DUTIES[key] || []), ...(st.track === "Management" ? [] : (base.responsibilities || []).slice(0, 3))], base.outcomes || [], base.industry]))!;
      ids[st.title] = r.id; roles++;
      await q(db, `INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,1,$2,'Demo data','Career ladder step')`, [r.id, JSON.stringify({ id: r.id, title: st.title, status: "Published" })]);
      const add = async (sid: string, level: number, req: string, imp: string, trend: string, dir: string, why: string, period: string | null, conf: number | null) =>
        q(db, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, observation_period, trend_rationale, confidence_score, approval_status, lifecycle_status, created_by)
          VALUES ($1, 'PX-' || $2 || '-' || $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Published', 'Active', 'Demo data') ON CONFLICT DO NOTHING`, [orgId, r.id, sid, level, req, imp, trend, dir, period, why, conf]);
      for (const m of baseMaps) {
        const d = derive(m, st.rank, st.track); if (!d) continue;
        await add(m.skill_id, d.level, d.req, d.imp, m.skill_trend, m.demand_direction, m.trend_rationale || "", m.observation_period, m.confidence_score);
      }
      for (const [name, level, req] of st.extras) {
        const sid = await skillId(db, name); if (!sid) continue;
        await q(db, `UPDATE role_skill_mapping SET required_level = greatest(required_level, $3), requirement_type = $4 WHERE role_id = $1 AND skill_id = $2`, [r.id, sid, level, req]);
        await add(sid, level, req, req === "Mandatory" ? "High" : "Medium", "Current", "Increasing", `Needed at ${st.title} level`, baseMaps[0]?.observation_period ?? null, 0.7);
      }
      // a few people in the new role, with skills around its requirement
      const reqs = await q(db, `SELECT skill_id, required_level FROM role_skill_mapping WHERE role_id = $1 AND lifecycle_status = 'Active'`, [r.id]);
      for (let i = 0; i < (st.rank === 6 ? 1 : 2); i++) {
        let name = "", email = "";
        for (let t = 0; t < 200; t++) { name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`; email = `${slug(name.split(" ")[0])}.${slug(name.split(" ")[1])}@${slug(org!.name.split(" ")[0])}.demo`; if (!(await one(db, `SELECT 1 FROM employees WHERE lower(email) = lower($1)`, [email]))) break; }
        const e = (await one(db, `INSERT INTO employees (org_id, name, email, department_id, role_id, manager_id, location, joining_date, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
          [orgId, name, email, base.department_id, r.id, mgrByDept.get(base.department_id) ?? null, ["Bengaluru", "Pune", "London", "Singapore"][Math.floor(rnd() * 4)], `20${15 + Math.floor(rnd() * 8)}-0${1 + Math.floor(rnd() * 9)}-15`]))!.id;
        people++;
        for (const m of reqs) {
          if (rnd() < 0.1) continue;
          const lvl = Math.max(1, Math.min(5, Number(m.required_level) + [-1, 0, 0, 0, 1][Math.floor(rnd() * 5)]));
          await q(db, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,$4,$5,'Seed assessor','2026-09-30') ON CONFLICT DO NOTHING`, [orgId, e, m.skill_id, rnd() < 0.5 ? "validated" : "manager", lvl]);
        }
      }
    }
    // vertical paths up the ladder, one level at a time
    const ic = [...lad.steps.filter(s => s.rank === 2).map(s => s.title), lad.base, ...lad.steps.filter(s => s.rank >= 4 && s.track !== "Management").sort((a, b) => a.rank - b.rank).map(s => s.title)];
    for (let i = 0; i + 1 < ic.length; i++) if (ids[ic[i]] && ids[ic[i + 1]]) await path(ids[ic[i]], ids[ic[i + 1]], "Vertical", i === 0 && lad.steps.some(s => s.rank === 2) ? 12 : 24);
    // into management: a track change from senior (or from the lead to the head of the function), and lateral between lead and manager
    const mgmt = lad.steps.filter(s => s.track === "Management").sort((a, b) => a.rank - b.rank);
    const lead = lad.steps.find(s => s.rank === 5 && s.track === "Technical Leadership");
    if (lad.trackChange && ids[lad.trackChange[0]] && ids[lad.trackChange[1]]) await path(ids[lad.trackChange[0]], ids[lad.trackChange[1]], "Vertical (track change)", 24);
    if (lead && mgmt[0] && mgmt[0].rank === lead.rank && ids[lead.title] && ids[mgmt[0].title]) { await path(ids[lead.title], ids[mgmt[0].title], "Lateral", 12); await path(ids[mgmt[0].title], ids[lead.title], "Lateral", 12); }
    if (lead && mgmt[0] && mgmt[0].rank === lead.rank + 1 && !lad.trackChange && ids[lead.title]) await path(ids[lead.title], ids[mgmt[0].title], "Vertical (track change)", 36);
    for (let i = 0; i + 1 < mgmt.length; i++) if (mgmt[i + 1].rank - mgmt[i].rank === 1) await path(ids[mgmt[i].title], ids[mgmt[i + 1].title], "Vertical", 36);
    // skip-level: two levels in one move, for people who are already strong in most of the level in between
    if (lad.skip && ids[lad.skip]) await path(base.id, ids[lad.skip], "Vertical (skip-level)", 36);
  }
  return { roles, paths, people };
}

/* Roles whose skills are shifting, so the Future outlook has Transforming and At risk examples. The label is not set here:
   the outlook engine works it out from the skills (legacy skills declining, new ones rising). */
type Need = [string, number, "Mandatory" | "Preferred" | "Optional"];
const CHANGING: Record<string, { dept: string; title: string; summary: string; skills: Need[] }[]> = {
  "FinEdge Technologies": [
    { dept: "Data & Analytics", title: "MIS Reporting Analyst", summary: "Produces recurring management reports from spreadsheets and legacy reporting tools.",
      skills: [["Excel VBA Macros", 4, "Mandatory"], ["Crystal Reports", 4, "Mandatory"], ["QlikView", 3, "Mandatory"], ["Microsoft Excel", 4, "Mandatory"], ["SQL", 3, "Preferred"]] },
    { dept: "Risk & Compliance", title: "Regulatory Reporting Analyst", summary: "Prepares regulatory and benchmark-rate reports; moving from LIBOR reporting to ISO 20022 payment data.",
      skills: [["LIBOR Rate Reporting", 4, "Mandatory"], ["Regulatory Reporting", 4, "Mandatory"], ["ISO 20022 Payment Data", 3, "Preferred"], ["SQL", 3, "Preferred"], ["Microsoft Excel", 3, "Optional"], ["Python", 2, "Optional"]] },
  ],
  "MediCore Health Systems": [
    { dept: "Healthcare Operations", title: "Medical Coding Specialist", summary: "Codes diagnoses and procedures from clinical records; AI-assisted documentation review is changing the work.",
      skills: [["ICD-9-CM Coding", 3, "Mandatory"], ["Electronic Health Records (EHR)", 3, "Mandatory"], ["Revenue Cycle Management", 3, "Preferred"], ["AI-Assisted Clinical Documentation Review", 3, "Preferred"], ["Clinical Data Standards", 3, "Optional"]] },
    { dept: "Data & Quality", title: "Clinical Report Developer", summary: "Builds fixed clinical and operational reports in legacy reporting tools.",
      skills: [["Crystal Reports", 4, "Mandatory"], ["SAS (Base / Enterprise Guide)", 4, "Mandatory"], ["QlikView", 3, "Mandatory"], ["SQL", 4, "Mandatory"]] },
  ],
  "CloudNova Solutions": [
    { dept: "Cloud & Infrastructure", title: "Configuration Management Engineer", summary: "Maintains server configuration with Puppet and scripts; moving to containers and Kubernetes.",
      skills: [["Puppet Configuration Management", 4, "Mandatory"], ["Linux Administration", 4, "Mandatory"], ["Kubernetes", 2, "Preferred"], ["Docker", 3, "Preferred"], ["CI/CD", 3, "Optional"], ["Python 2", 2, "Optional"]] },
    { dept: "Software Engineering", title: "Legacy Integration Developer", summary: "Maintains SOAP integrations and older web front ends.",
      skills: [["SOAP Web Services", 4, "Mandatory"], ["jQuery", 3, "Mandatory"], ["AngularJS (1.x)", 3, "Mandatory"], ["Java", 4, "Mandatory"], ["Informatica PowerCenter", 3, "Preferred"]] },
  ],
};

export async function addChangingRoles(db: Db, orgId: string) {
  const org = await one(db, `SELECT name FROM organisations WHERE id = $1`, [orgId]);
  const specs = org ? CHANGING[org.name] : undefined;
  if (!specs) return { roles: 0, people: 0 };
  const level3 = (await one(db, `SELECT id FROM career_levels WHERE org_id = $1 AND rank = 3`, [orgId]))?.id ?? null;
  let roles = 0, people = 0;
  for (const sp of specs) {
    if (await one(db, `SELECT 1 FROM job_roles WHERE org_id = $1 AND lower(title) = lower($2) AND status <> 'Archived'`, [orgId, sp.title])) continue;
    const dept = await one(db, `SELECT id FROM departments WHERE org_id = $1 AND name = $2`, [orgId, sp.dept]);
    if (!dept) continue;
    const peer = await one(db, `SELECT job_family_id, industry FROM job_roles WHERE org_id = $1 AND department_id = $2 ORDER BY id LIMIT 1`, [orgId, dept.id]);
    const r = (await one(db, `INSERT INTO job_roles (org_id, department_id, job_family_id, career_level_id, title, career_track, summary, responsibilities, industry, status, version, review_date)
      VALUES ($1,$2,$3,$4,$5,'Individual Contributor',$6,$7,$8,'Published',1,'2027-10-31') RETURNING id`, [orgId, dept.id, peer?.job_family_id ?? null, level3, sp.title, sp.summary, [sp.summary], peer?.industry ?? "General"]))!;
    roles++;
    await q(db, `INSERT INTO role_versions (role_id, version, snapshot, changed_by, note) VALUES ($1,1,$2,'Demo data','Role with shifting skills')`, [r.id, JSON.stringify({ id: r.id, title: sp.title, status: "Published" })]);
    const reqs: { id: string; level: number }[] = [];
    for (const [name, level, req] of sp.skills) {
      const sid = await skillId(db, name); if (!sid) continue;
      const base = await one(db, `SELECT skill_trend, demand_direction, trend_rationale, observation_period FROM role_skill_mapping WHERE skill_id = $1 AND lifecycle_status = 'Active' ORDER BY confidence_score DESC NULLS LAST LIMIT 1`, [sid]);
      await q(db, `INSERT INTO role_skill_mapping (org_id, pixel_id, role_id, skill_id, required_level, requirement_type, importance, skill_trend, demand_direction, observation_period, trend_rationale, confidence_score, approval_status, lifecycle_status, created_by)
        VALUES ($1, 'PX-' || $2 || '-' || $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0.7, 'Published', 'Active', 'Demo data') ON CONFLICT DO NOTHING`,
        [orgId, r.id, sid, level, req, req === "Mandatory" ? "High" : "Medium", base?.skill_trend && base.skill_trend !== "Archived" ? base.skill_trend : "Current", base?.demand_direction ?? "Stable", base?.observation_period ?? null, base?.trend_rationale ?? ""]);
      reqs.push({ id: sid, level });
    }
    const mgr = await one(db, `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id AND u.role = 'manager' WHERE e.org_id = $1 AND e.department_id = $2`, [orgId, dept.id]);
    for (let i = 0; i < 3; i++) {
      let name = "", email = "";
      for (let t = 0; t < 200; t++) { name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`; email = `${slug(name.split(" ")[0])}.${slug(name.split(" ")[1])}@${slug(org!.name.split(" ")[0])}.demo`; if (!(await one(db, `SELECT 1 FROM employees WHERE lower(email) = lower($1)`, [email]))) break; }
      const e = (await one(db, `INSERT INTO employees (org_id, name, email, department_id, role_id, manager_id, location, joining_date, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
        [orgId, name, email, dept.id, r.id, mgr?.id ?? null, ["Bengaluru", "Pune", "Chennai"][i % 3], `20${12 + Math.floor(rnd() * 8)}-0${1 + Math.floor(rnd() * 9)}-15`]))!.id;
      people++;
      // long-serving people: strong in the legacy skills, weaker in the new ones
      for (const k of reqs) await q(db, `INSERT INTO employee_skills (org_id, employee_id, skill_id, source, level, assessed_by, assessed_on) VALUES ($1,$2,$3,'manager',$4,'Seed assessor','2026-09-30') ON CONFLICT DO NOTHING`,
        [orgId, e, k.id, Math.max(1, Math.min(5, k.level + [-1, 0, 0, 1][Math.floor(rnd() * 4)]))]);
    }
  }
  return { roles, people };
}
