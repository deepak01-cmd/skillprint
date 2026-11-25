"use client";
import Link from "next/link";
import { useState } from "react";
import { api, downloadCsv, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Loading, Note, PageHeader, Pill, Stat, pct, useToast } from "@/components/ui";

export default function PlanPage({ params }: { params: { id: string } }) {
  const s = useSession(); const toast = useToast();
  const { data: p, error, loading, reload } = useApi<any>(`/planning/plans/${params.id}`);
  const roles = useApi<any[]>("/roles?status=Published");
  const [edits, setEdits] = useState<Record<string, any>>({}); const [addRole, setAddRole] = useState(""); const [risk, setRisk] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const draft = p.status === "Draft";
  const canRole = (deptId: string) => draft && (s.permissions["planning:write"] === "org" || (s.permissions["planning:write"] === "dept" && deptId === s.user.department_id));
  const saveRole = async (role_id: string, v: any) => { const r = await api("PUT", `/planning/plans/${p.id}/roles/${role_id}`, v); r.ok ? toast("Saved; figures recalculated and logged") : toast(r.error!.message, "bad"); const n = { ...edits }; delete n[role_id]; setEdits(n); reload(); };
  const exportPlan = () => downloadCsv(`${p.id}-plan.csv`, ["Section", "Item", "Current", "Planned", "Expected exits", "Net positions", "Ready now", "Ready 6-12", "External hires", "Demand planned (adjusted)", "Supply", "Shortfall", "Coverage", "Risk", "Assumption version"],
    [...p.roles.map((r: any) => ["Role", r.title, r.current_headcount, r.planned_headcount, r.expected_exits, r.net_positions, r.pipeline_ready_now, r.pipeline_ready_6_12, r.external_hires, "", "", "", "", "", p.assumption_version]),
     ...p.skills.map((k: any) => ["Skill", k.skill_name, k.demand_today, "", "", "", "", "", "", k.adjusted_planned_demand, k.supply ?? "No data", k.shortfall ?? "", k.coverage ?? "", k.risk, p.assumption_version])]);
  const deptOf = new Map((roles.data || []).map(r => [r.id, r.department_id]));
  const skills = p.skills.filter((k: any) => !risk || k.risk === risk);
  return (
    <>
      <PageHeader eyebrow={<><Link className="hover:underline" href="/planning">Workforce planning</Link> / <span className="font-mono">{p.id}</span></>} title={<span className="flex items-center gap-2">{p.name} <Pill>{p.status}</Pill></span>}
        sub={`${p.horizon_months}-month horizon · assumption set v${p.assumption_version}${p.from_snapshot ? " · showing the approved snapshot" : ""}`}
        actions={<><Button onClick={exportPlan}>Export plan</Button>{draft && can(s, "approve") && <Button variant="primary" onClick={async () => { const r = await api("POST", `/planning/plans/${p.id}/approve`); r.ok ? toast("Plan approved and stored as a snapshot") : toast(r.error!.message, "bad"); reload(); }}>Approve plan</Button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net positions to fill" value={p.totals?.net_positions ?? 0} /><Stat label="External hires needed" value={p.totals?.external_hires ?? 0} />
        <Stat label="High-risk skills" value={p.totals?.high_risk_skills ?? 0} tone={p.totals?.high_risk_skills ? "bad" : undefined} /><Stat label="Roles in plan" value={p.roles.length} />
      </div>
      <Note tone="muted">{p.note}</Note>
      <Card className="mt-4" pad={false} title="Role plan" actions={draft && can(s, "planning:write") && <><select className="inp w-64" value={addRole} onChange={e => setAddRole(e.target.value)} aria-label="Add role"><option value="">Add a role…</option>{(roles.data || []).filter(r => !p.roles.some((x: any) => x.role_id === r.id) && canRole(r.department_id)).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
        <Button size="sm" disabled={!addRole} onClick={() => { saveRole(addRole, { attrition_rate: 0.1, planned_headcount: 1 }); setAddRole(""); }}>Add</Button></>}>
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Role</th><th className="text-right">People in role now</th><th className="text-right" title="Share of people expected to leave the role in a year">Expected attrition (per year)</th><th className="text-right" title="People in role now × attrition, over the plan horizon">Expected leavers</th><th className="text-right" title="How many people the role should have at the end of the plan">Headcount needed</th><th className="text-right" title="Headcount needed − people in role now + expected leavers">Positions to fill</th><th className="text-right" title="People in other roles who already meet this role&#x27;s requirements">Internal: ready now</th><th className="text-right" title="People in other roles who are close to this role&#x27;s requirements">Internal: ready in 6-12 months</th><th className="text-right" title="Positions to fill that internal candidates cannot cover">To hire externally</th><th></th></tr></thead>
          <tbody>{p.roles.map((r: any) => { const e = edits[r.role_id]; const editable = canRole(deptOf.get(r.role_id) || r.department_id); return (
            <tr key={r.role_id}><td>{r.title}<div className="text-xs text-ink-3">{r.department_name}</div></td><td className="num text-right">{r.current_headcount}</td>
              <td className="num text-right">{e ? <input aria-label="Attrition %" className="inp w-20 text-right" value={e.attrition} onChange={x => setEdits({ ...edits, [r.role_id]: { ...e, attrition: x.target.value } })} /> : pct(r.attrition_rate)}</td>
              <td className="num text-right">{r.expected_exits}</td>
              <td className="num text-right">{e ? <input aria-label="Planned headcount" className="inp w-20 text-right" value={e.planned} onChange={x => setEdits({ ...edits, [r.role_id]: { ...e, planned: x.target.value } })} /> : r.planned_headcount}</td>
              <td className="num text-right font-semibold">{r.net_positions}{r.surplus ? <span className="text-xs text-ink-3"> (surplus {r.surplus})</span> : ""}</td><td className="num text-right">{r.pipeline_ready_now}</td><td className="num text-right">{r.pipeline_ready_6_12}</td><td className="num text-right font-semibold">{r.external_hires}</td>
              <td className="whitespace-nowrap">{editable && (e ? <><Button size="sm" variant="primary" onClick={() => saveRole(r.role_id, { attrition_rate: Number(e.attrition) / 100, planned_headcount: Number(e.planned) })}>Save</Button>{" "}<Button size="sm" onClick={() => { const n = { ...edits }; delete n[r.role_id]; setEdits(n); }}>Cancel</Button></>
                : <Button size="sm" onClick={() => setEdits({ ...edits, [r.role_id]: { attrition: Math.round(r.attrition_rate * 100), planned: r.planned_headcount } })}>Edit</Button>)}</td></tr>); })}</tbody></table></div>
        {!p.roles.length && <Empty>No role inputs yet.</Empty>}
      </Card>
      {p.skills.length > 0 && <Card className="mt-4" pad={false} title="Skill demand outlook" actions={<select className="inp w-40" value={risk} onChange={e => setRisk(e.target.value)} aria-label="Risk"><option value="">All risk levels</option>{["High", "Medium", "Low", "No assessment data"].map(x => <option key={x}>{x}</option>)}</select>}>
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th className="text-right" title="People the current roles need with this skill">Needed today</th><th className="text-right" title="How many people the role should have at the end of the plan">Headcount needed</th><th className="text-right" title="Extra demand you expect for this skill (for example +20%)">Growth adjustment</th><th className="text-right" title="Needed today, adjusted by the plan&#x27;s headcount and growth">Needed in the plan</th><th className="text-right" title="People at the competent level (3) or above, in any role">People who have it</th><th className="text-right" title="Needed in the plan − people who have it">Shortfall</th><th className="text-right" title="People who have it ÷ needed in the plan">Covered</th><th title="High below 60% covered, Medium below 85%">Shortage risk</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th></tr></thead>
          <tbody>{skills.map((k: any) => <tr key={k.skill_id}><td>{k.skill_name}{k.low_confidence && <div className="text-xs text-warn">Low confidence: {pct(k.validated_share)} assessed</div>}</td><td className="num text-right">{k.demand_today}</td><td className="num text-right">{k.demand_planned}</td>
            <td className="num text-right">{draft && can(s, "org:manage") ? <input aria-label="Growth %" className="inp w-16 text-right" defaultValue={Math.round(k.growth_adjustment * 100)} onBlur={async e => { const g = Number(e.target.value) / 100; if (g !== k.growth_adjustment) { const r = await api("PUT", `/planning/plans/${p.id}/skills/${k.skill_id}`, { growth_adjustment: g }); r.ok ? toast("Growth adjustment saved") : toast(r.error!.message, "bad"); reload(); } }} /> : pct(k.growth_adjustment)}</td>
            <td className="num text-right">{k.adjusted_planned_demand}</td><td className="num text-right">{k.supply ?? <span className="text-xs text-ink-3">{k.supply_note}</span>}</td><td className="num text-right font-semibold">{k.shortfall ?? "—"}</td><td className="num text-right">{pct(k.coverage)}</td><td>{k.risk === "Not applicable" ? <span className="text-xs text-ink-3">n/a</span> : <Pill>{k.risk}</Pill>}</td><td>{k.trend}</td></tr>)}</tbody></table></div>
      </Card>}
    </>
  );
}
