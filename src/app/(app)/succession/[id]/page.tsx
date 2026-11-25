"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Briefcase, Crown, Heart, Plus, Send, Trash2, UserPlus, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Avatar, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pill, Ring, cx, useConfirm, useToast } from "@/components/ui";
import { toneFor } from "@/components/Jobs";

const READY = ["Ready now", "Ready in 1-2 years", "Ready in 3+ years"];
const READY_TONE: Record<string, string> = { "Ready now": "Ready now", "Ready in 1-2 years": "Ready in 6-12 months", "Ready in 3+ years": "Long-term / stretch" };

function Person({ p, right }: { p: any; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
      <Avatar name={p.name} size={40} />
      <div className="min-w-[160px] flex-1"><div className="flex flex-wrap items-center gap-1.5 text-[14px] font-bold">{p.name}{p.aspires && <span title="Wants this role" className="inline-flex items-center gap-0.5 rounded-md bg-accent-3/15 px-1.5 text-[11px] font-semibold text-accent-3"><Heart className="h-3 w-3" />aspires</span>}{p.applied && <span className="inline-flex items-center gap-0.5 rounded-md bg-em-soft px-1.5 text-[11px] font-semibold text-em"><Send className="h-3 w-3" />applied</span>}</div>
        <div className="text-[12px] text-ink-3">{p.role_title} · {p.department_name}</div>
        {p.top_gaps?.length > 0 && <div className="mt-1 text-[11.5px] text-ink-3">To grow: {p.top_gaps.join(", ")}</div>}</div>
      <Ring value={p.match} size={48} stroke={12} tone={toneFor(p.match)} label={<span className="text-[11px]">{p.match}%</span>} />
      {right}
    </div>
  );
}

export default function SuccessionPlan({ params }: { params: { id: string } }) {
  const toast = useToast(); const confirm = useConfirm();
  const d = useApi<any>(`/succession/${params.id}`);
  const [pick, setPick] = useState<any>(null); const [readiness, setReadiness] = useState("Ready in 1-2 years"); const [notes, setNotes] = useState(""); const [err, setErr] = useState<any>(null);
  if (d.loading) return <Loading rows={8} />;
  if (d.error) return <ErrorBox error={d.error} />;
  const p = d.data;
  const save = async () => { const r = await api("POST", `/succession/${p.id}/successors`, { employee_id: pick.employee_id, readiness, notes }); if (!r.ok) return setErr(r.error); toast(`${pick.name} named as a successor`); setPick(null); d.reload(); };
  const remove = async (x: any) => { if (!(await confirm({ title: "Remove successor", message: `Remove ${x.name} as a successor for this role?`, danger: true, confirmLabel: "Remove" }))) return; await api("DELETE", `/succession/${p.id}/successors/${x.employee_id}`); d.reload(); };
  const archive = async () => { if (!(await confirm({ title: "Archive succession plan", message: "The plan and its named successors are kept but no longer shown.", danger: true, confirmLabel: "Archive" }))) return; await api("PATCH", `/succession/${p.id}`, { status: "Archived" }); window.location.href = "/succession"; };
  return (
    <>
      <Link href="/succession" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-accent"><ArrowLeft className="h-4 w-4" />Succession</Link>
      <PageHeader eyebrow={p.department_name} title={<span className="flex flex-wrap items-center gap-2">{p.role_title}<Pill tone={p.criticality === "Critical" ? "Critical" : "Medium"}><Crown className="h-3 w-3" />{p.criticality}</Pill></span>}
        sub={p.reason || undefined} actions={<><Link href={`/roles/${p.role_id}`}><Button size="sm"><Briefcase className="h-3.5 w-3.5" />Role</Button></Link><Button size="sm" variant="ghost" onClick={archive}>Archive</Button></>} />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-4">
        {[["Ready now", p.bench.ready_now, "text-good"], ["1–2 years", p.bench.ready_1_2, "text-em"], ["3+ years", p.bench.ready_3, "text-accent-3"], ["In role today", p.incumbents.length, ""]].map(([l, v, c]) =>
          <div key={l as string} className="rounded-2xl border border-line bg-card p-4 shadow-card"><div className="text-[12.5px] text-ink-3">{l}</div><div className={cx("num text-[28px] font-extrabold", c as string)}>{v as number}</div></div>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card title="Named successors" icon={<UserPlus />}>
            {p.successors.length ? <div className="flex flex-col gap-2.5">{p.successors.map((x: any) => <Person key={x.employee_id} p={x} right={<div className="flex flex-col items-end gap-1"><Pill tone={READY_TONE[x.readiness]}>{x.readiness}</Pill>
              <span className="flex gap-1"><button className="text-[11.5px] font-semibold text-accent hover:underline" onClick={() => { setPick(x); setReadiness(x.readiness); setNotes(x.notes || ""); setErr(null); }}>Edit</button><button onClick={() => remove(x)} className="text-ink-3 hover:text-bad" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button></span></div>} />)}</div>
              : <Empty icon={<UserPlus />}>Pick successors from the candidates.</Empty>}
          </Card>
          <Card title="In the role today" icon={<Users />}>{p.incumbents.length ? <div className="flex flex-col gap-2.5">{p.incumbents.map((x: any) => <Person key={x.employee_id} p={x} />)}</div> : <Empty>Nobody holds this role right now.</Empty>}</Card>
        </div>
        <Card title="Best internal candidates" icon={<Users />} sub="Ranked by skill match to the role">
          {p.candidates.length ? <div className="flex flex-col gap-2.5">{p.candidates.map((x: any) => <Person key={x.employee_id} p={x} right={<Button size="sm" variant="soft" onClick={() => { setPick(x); setReadiness(x.suggested); setNotes(""); setErr(null); }}><Plus className="h-3.5 w-3.5" />Successor</Button>} />)}</div>
            : <Empty>No candidates.</Empty>}
        </Card>
      </div>
      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.name} as successor` : ""} footer={<><Button onClick={() => setPick(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        {pick && <div className="flex items-center gap-3 rounded-2xl bg-sunken/50 p-3"><Ring value={pick.match} size={56} stroke={11} tone={toneFor(pick.match)} label={<span className="text-[12px]">{pick.match}%</span>} /><div className="text-[13px]"><b>{pick.skills_met}/{pick.skills_required}</b> skills met · {pick.mandatory_gaps} must-have gap{pick.mandatory_gaps === 1 ? "" : "s"}<div className="text-ink-3">Suggested: {pick.suggested}</div></div></div>}
        <Field label="Readiness"><div className="flex flex-wrap gap-1.5">{READY.map(r => <button key={r} type="button" onClick={() => setReadiness(r)} className={cx("rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", readiness === r ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-3")}>{r}</button>)}</div></Field>
        <Field label="Notes (optional)" htmlFor="sn"><textarea id="sn" className="inp" rows={3} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Development needed, stretch assignments…" /></Field>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
