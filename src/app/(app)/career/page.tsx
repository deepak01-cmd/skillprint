"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pill, Tabs, pct, useToast } from "@/components/ui";
import { CompareResult } from "@/components/CompareResult";
import { CareerTrackModal, MOVEMENT_INFO, MovementSummary } from "@/components/CareerTrack";

const MOVES = ["Vertical", "Vertical (skip-level)", "Vertical (track change)", "Lateral", "Cross-functional"];

export default function Career() {
  const s = useSession(); const toast = useToast();
  const [tab, setTab] = useState("paths");
  const paths = useApi<any[]>("/career-paths"); const roles = useApi<any[]>("/roles?status=Published");
  const dist = useApi<any>(["hr_admin", "dept_head"].includes(s.user.role) ? "/mobility/distribution" : null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const cmp = useApi<any>(from && to ? `/roles/${from}/compare/${to}` : null);
  const sugg = useApi<any[]>(can(s, "paths:write") && from ? `/career-paths/suggestions?from=${from}` : null);
  const [add, setAdd] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const [kind, setKind] = useState(""); const [track, setTrack] = useState<string | null>(null);
  const shown = (paths.data || []).filter(p => !kind || p.movement_type === kind);
  const write = can(s, "paths:write");
  return (
    <>
      <PageHeader title="Career mobility"
        actions={write && <Button variant="primary" onClick={() => { setErr(null); setAdd({ from_role_id: from, to_role_id: "", movement_type: "Lateral", typical_months: 18, extra_requirements: "" }); }}>New career path</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "paths", label: "Path library" }, { id: "compare", label: "Compare roles" }, ...(dist.data ? [{ id: "dist", label: "Readiness distribution" }] : [])]} />
      {tab === "paths" && <MovementSummary paths={paths.data || []} active={kind} onPick={setKind} />}
      {tab === "paths" && <Card pad={false}>{paths.loading ? <Loading /> : shown.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Path ID</th><th>From role</th><th>To role</th><th>Type of move</th><th className="text-right" title="Career levels between the two roles (+1 = one level up)">Levels up</th><th className="text-right">Usual time (months)</th><th>Status</th><th></th></tr></thead>
        <tbody>{shown.map(p => <tr key={p.id}><td className="font-mono text-xs">{p.id}</td><td>{p.from_title}</td><td>{p.to_title}</td><td title={MOVEMENT_INFO[p.movement_type]?.text}>{p.movement_type}</td><td className="num text-right">{p.level_change ?? "—"}</td><td className="num text-right">{p.typical_months ?? "—"}</td><td><Pill>{p.status}</Pill>{p.review_flag && <Pill tone="Medium" className="ml-1">review</Pill>}</td>
          <td className="whitespace-nowrap"><Button size="sm" variant="primary" onClick={() => setTrack(p.id)}>View track</Button>{" "}{write && <>{p.status === "Draft" && <Button size="sm" onClick={async () => { const r = await api("POST", `/career-paths/${p.id}/submit`); r.ok ? toast(`Sent for approval as ${r.data.id}`) : toast(r.error!.message, "bad"); paths.reload(); }}>Submit</Button>}{" "}
            <Button size="sm" onClick={() => { setFrom(p.from_role_id); setTo(p.to_role_id); setTab("compare"); }}>Compare</Button>{" "}
            {p.status === "Published" && can(s, "approve") && <Button size="sm" onClick={async () => { const r = await api("POST", `/career-paths/${p.id}/archive`); r.ok ? toast("Path archived") : toast(r.error!.message, "bad"); paths.reload(); }}>Archive</Button>}</>}</td></tr>)}</tbody></table></div> : <Empty>{kind ? `No ${kind} paths.` : "No career paths yet."}</Empty>}</Card>}
      <CareerTrackModal pathId={track} onClose={() => setTrack(null)} />
      {tab === "compare" && <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Compare two published roles" actions={<>
          <select className="inp w-60" value={from} onChange={e => setFrom(e.target.value)} aria-label="From role"><option value="">From…</option>{(roles.data || []).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
          <select className="inp w-60" value={to} onChange={e => setTo(e.target.value)} aria-label="To role"><option value="">To…</option>{(roles.data || []).filter(r => r.id !== from).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></>}>
          {cmp.error && <ErrorBox error={cmp.error} />}{cmp.data ? <CompareResult c={cmp.data} /> : <Empty>Choose two roles.</Empty>}
        </Card>
        {write && <Card title="Suggested paths from this role">
          {!from ? <Empty>Choose a From role.</Empty> : (sugg.data || []).length ? <ul className="flex flex-col gap-2 text-[13px]">{sugg.data!.map(x => <li key={x.to_role_id} className="flex items-center justify-between gap-2"><span>{x.to_title}<div className="text-xs text-ink-3">{pct(x.skill_overlap)} overlap · {x.new_skills} new · {x.move_difficulty}</div></span>
            <Button size="sm" onClick={() => { setErr(null); setAdd({ from_role_id: from, to_role_id: x.to_role_id, movement_type: x.suggested_movement, typical_months: 18, extra_requirements: "" }); }}>Draft path</Button></li>)}</ul> : <Empty>No candidates above 35% overlap.</Empty>}
        </Card>}
      </div>}
      {tab === "dist" && dist.data && <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card pad={false} title="Readiness by target role (aggregated)">
          <p className="px-4 pt-2 text-xs text-ink-3">Groups smaller than {dist.data.min_group_size} people are suppressed. Readiness must not feed performance ratings or pay decisions.</p>
          {dist.data.roles.length ? <table className="t"><thead><tr><th>Target role</th><th className="text-right">People</th><th>Readiness bands</th></tr></thead>
            <tbody>{dist.data.roles.map((r: any) => <tr key={r.target_role_id}><td>{r.target_title}</td><td className="num text-right">{r.employees}</td><td>{r.suppressed ? <span className="text-xs text-ink-3">Fewer than {dist.data.min_group_size} people</span> : Object.entries(r.bands).map(([b, n]) => <Pill key={b} tone={b} className="mr-1">{b}: {String(n)}</Pill>)}</td></tr>)}</tbody></table> : <Empty>No aspirations recorded.</Empty>}
        </Card>
        <Card title="Roles with no incoming paths"><ul className="flex flex-col gap-1 text-[13px]">{dist.data.roles_without_incoming_paths.map((r: any) => <li key={r.id}>{r.title}</li>)}</ul></Card>
      </div>}
      <Modal open={!!add} onClose={() => setAdd(null)} title="New career path (draft)" footer={<><Button onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/career-paths", add); if (!r.ok) return setErr(r.error); setAdd(null); toast(r.data.warning ? `Draft saved. Check: ${r.data.warning}` : "Draft path saved. Submit it for approval."); paths.reload(); }}>Save draft</Button></>}>
        {add && <div className="grid gap-3">
          <Field label="From role" htmlFor="pf"><select id="pf" className="inp" value={add.from_role_id} onChange={e => setAdd({ ...add, from_role_id: e.target.value })}><option value="">Choose…</option>{(roles.data || []).filter(r => s.permissions["paths:write"] === "org" || r.department_id === s.user.department_id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
          <Field label="To role" htmlFor="pt"><select id="pt" className="inp" value={add.to_role_id} onChange={e => setAdd({ ...add, to_role_id: e.target.value })}><option value="">Choose…</option>{(roles.data || []).filter(r => r.id !== add.from_role_id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
          <Field label="Type of move" htmlFor="pm" hint={MOVEMENT_INFO[add.movement_type]?.text}><select id="pm" className="inp" value={add.movement_type} onChange={e => setAdd({ ...add, movement_type: e.target.value })}>{MOVES.map(m => <option key={m} value={m}>{m}: {MOVEMENT_INFO[m]?.short}</option>)}</select></Field>
          <Field label="Typical months in role before the move" htmlFor="pmo"><input id="pmo" type="number" className="inp" value={add.typical_months} onChange={e => setAdd({ ...add, typical_months: +e.target.value })} /></Field>
          <Field label="Extra requirements (optional)" htmlFor="px"><input id="px" className="inp" value={add.extra_requirements} onChange={e => setAdd({ ...add, extra_requirements: e.target.value })} placeholder="For example: a leadership trial or rotation" /></Field>
        </div>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
