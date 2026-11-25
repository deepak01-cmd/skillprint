"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Level, Loading, Modal, Note, PageHeader, Pill, pct, useToast } from "@/components/ui";
import { CompareResult } from "@/components/CompareResult";
import { CareerTrackModal } from "@/components/CareerTrack";

export default function MyCareer() {
  const s = useSession(); const toast = useToast();
  const eid = s.user.employee_id!;
  const me = useApi<any>("/me"); const asp = useApi<any>(`/employees/${eid}/aspirations`);
  const roles = useApi<any[]>("/roles?status=Published");
  const paths = useApi<any[]>(me.data?.employee ? `/career-paths?from=${me.data.employee.role_id}` : null);
  const [to, setTo] = useState(""); const cmp = useApi<any>(to && me.data?.employee ? `/roles/${me.data.employee.role_id}/compare/${to}` : null);
  const [add, setAdd] = useState<any>(null); const [err, setErr] = useState<any>(null); const [track, setTrack] = useState<string | null>(null);
  if (me.loading || asp.loading) return <Loading />;
  const e = me.data.employee;
  const used = new Set((asp.data?.aspirations || []).map((a: any) => a.priority));
  const toPlan = async (a: any) => { const r = await api("POST", `/employees/${eid}/plans/generate`, { title: `Towards ${a.target_title}`, skills: a.readiness.lines.filter((l: any) => !l.met).map((l: any) => ({ skill_id: l.skill_id, target: l.required_level, source: "readiness" })) }); r.ok ? toast(`Plan created with ${r.data.activities} activities`) : toast(r.error!.message, "bad"); };
  return (
    <>
      <PageHeader title="My career options"
        actions={used.size < 2 && <Button variant="primary" onClick={() => { setErr(null); setAdd({ target_role_id: "", priority: used.has("Primary") ? "Secondary" : "Primary", shared_with_manager: false }); }}>Add an aspiration</Button>} />
      <div className="flex flex-col gap-4">
        {(asp.data?.aspirations || []).length === 0 && <Card><Empty>You have not recorded an aspiration. You can record up to two target roles; they stay private until you share them.</Empty></Card>}
        {(asp.data?.aspirations || []).map((a: any) => (
          <Card key={a.id} title={<div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">{a.priority}: {a.target_title}</h2><Pill tone={a.movement_type ? "Published" : "Draft"}>{a.path_label}</Pill><Pill>{a.readiness.band}</Pill></div>}
            actions={<>
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={a.shared_with_manager} onChange={async ev => { await api("PATCH", `/aspirations/${a.id}`, { shared_with_manager: ev.target.checked }); toast(ev.target.checked ? "Shared with your manager" : "Now private"); asp.reload(); }} /> Share with my manager</label>
              <Button size="sm" onClick={() => toPlan(a)}>Send gaps to my development plan</Button>
              <Button size="sm" variant="danger" onClick={async () => { await api("DELETE", `/aspirations/${a.id}`); asp.reload(); }}>Remove</Button></>}>
            {!a.movement_type && <div className="mb-3"><Note tone="warn">There is no defined path from your role to this one. The comparison below still applies; talk it through with your manager.</Note></div>}
            <div className="mb-3 grid grid-cols-3 gap-2 md:max-w-lg">
              <div className="rounded-md border border-line px-3 py-2"><div className="text-xs text-ink-3">Skills met</div><div className="num text-lg font-bold">{a.readiness.skills_met} / {a.readiness.skills_required}</div></div>
              <div className="rounded-md border border-line px-3 py-2"><div className="text-xs text-ink-3">Share met</div><div className="num text-lg font-bold">{pct(a.readiness.share_met)}</div></div>
              <div className="rounded-md border border-line px-3 py-2"><div className="text-xs text-ink-3">Gap points</div><div className="num text-lg font-bold">{a.readiness.gap_points}</div></div>
            </div>
            <table className="t"><thead><tr><th>Skill</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th>My level</th><th>Self-reported</th><th className="text-right" title="How many levels below the needed level the person is">Levels short</th><th>Assessment</th></tr></thead>
              <tbody>{a.readiness.lines.map((l: any) => <tr key={l.skill_id}><td>{l.skill_name}</td><td><Level n={l.required_level} short /></td><td><Level n={l.actual_level} short /></td><td className="text-ink-3">{l.self_level ?? "—"}</td><td className="num text-right">{l.gap || ""}</td><td className="text-xs">{l.met ? <Pill>Met</Pill> : l.actual_level === null ? "No recorded level" : ""} {l.assessment_type || ""} {l.assessed_on || ""}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-ink-3">Assumption set v{a.readiness.assumption_set.version}. Self-reported levels {a.readiness.count_self_assessed ? "count" : "do not count"} until validated.</p>
          </Card>))}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card title="Explore any role" actions={<select className="inp w-72" value={to} onChange={x => setTo(x.target.value)} aria-label="Role"><option value="">Choose a role…</option>{(roles.data || []).filter(r => r.id !== e.role_id).map(r => <option key={r.id} value={r.id}>{r.title} ({r.department_name})</option>)}</select>}>
            {cmp.data ? <CompareResult c={cmp.data} /> : <Empty>Compare your current role with any published role.</Empty>}
          </Card>
          <Card title="Defined paths from my role">{(paths.data || []).length ? <ul className="flex flex-col gap-2 text-[13px]">{paths.data!.map(p => <li key={p.id} className="flex justify-between gap-2"><button className="text-left font-medium text-accent hover:underline" onClick={() => setTo(p.to_role_id)}>{p.to_title}</button><span className="flex items-center gap-2 text-ink-3">{p.movement_type}<button className="font-medium text-accent hover:underline" onClick={() => setTrack(p.id)}>View track</button></span></li>)}</ul> : <Empty>No defined paths yet.</Empty>}</Card>
        </div>
      </div>
      <Modal open={!!add} onClose={() => setAdd(null)} title="Add a career aspiration" footer={<><Button onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" disabled={!add?.target_role_id} onClick={async () => { const r = await api("POST", `/employees/${eid}/aspirations`, add); if (!r.ok) return setErr(r.error); setAdd(null); toast("Aspiration saved"); asp.reload(); }}>Save</Button></>}>
        {add && <><Field label="Target role" htmlFor="tr"><select id="tr" className="inp" value={add.target_role_id} onChange={x => setAdd({ ...add, target_role_id: x.target.value })}><option value="">Choose…</option>{(roles.data || []).filter(r => r.id !== e.role_id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
          <Field label="Priority" htmlFor="pr"><select id="pr" className="inp" value={add.priority} onChange={x => setAdd({ ...add, priority: x.target.value })}>{["Primary", "Secondary"].map(p => <option key={p} disabled={used.has(p)}>{p}</option>)}</select></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={add.shared_with_manager} onChange={x => setAdd({ ...add, shared_with_manager: x.target.checked })} /> Share with my manager</label></>}
        <ErrorBox error={err} />
      </Modal>
      <CareerTrackModal pathId={track} onClose={() => setTrack(null)} me />
    </>
  );
}
