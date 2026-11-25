"use client";
import { useState } from "react";
import { CalendarPlus, Check, HeartHandshake, MessageSquare, Users, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Avatar, Button, Card, Empty, ErrorBox, Field, Hero, Loading, Modal, Pill, ago, useConfirm, useToast } from "@/components/ui";

const TONE: Record<string, string> = { Requested: "In Review", Accepted: "Active", Declined: "Rejected", Cancelled: "Closed", Completed: "Done" };

function Sessions({ m, onClose, canLog }: { m: any; onClose: () => void; canLog: boolean }) {
  const toast = useToast();
  const s = useApi<any[]>(`/mentoring/${m.id}/sessions`);
  const [f, setF] = useState({ held_on: new Date().toISOString().slice(0, 10), minutes: "45", notes: "" }); const [err, setErr] = useState<any>(null);
  const add = async () => { const r = await api("POST", `/mentoring/${m.id}/sessions`, { ...f, minutes: Number(f.minutes) || undefined }); if (!r.ok) return setErr(r.error); toast("Session logged"); setF({ ...f, notes: "" }); s.reload(); };
  return (
    <Modal open onClose={onClose} title={`${m.skill_name} · ${m.mentor_name} & ${m.mentee_name}`}>
      {canLog && <div className="grid gap-2 rounded-2xl bg-sunken/50 p-3 sm:grid-cols-[150px_100px_1fr_auto] sm:items-end">
        <Field label="Date"><input type="date" className="inp" value={f.held_on} max={new Date().toISOString().slice(0, 10)} onChange={e => setF({ ...f, held_on: e.target.value })} /></Field>
        <Field label="Minutes"><input type="number" min={5} max={600} className="inp" value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} /></Field>
        <Field label="What you covered"><input className="inp" maxLength={2000} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <Button variant="primary" onClick={add}><CalendarPlus className="h-4 w-4" />Log</Button></div>}
      <ErrorBox error={err} />
      {s.loading ? <Loading /> : (s.data || []).length ? <ol className="relative ml-2 border-l-2 border-line pl-5">{(s.data || []).map(x => <li key={x.id} className="relative mb-3"><span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-accent" />
        <div className="text-[13px] font-bold">{String(x.held_on).slice(0, 10)}{x.minutes ? <span className="font-normal text-ink-3"> · {x.minutes} min</span> : ""}</div><div className="text-[13px] text-ink-2">{x.notes || "—"}</div><div className="text-[11.5px] text-ink-3">{x.created_by}</div></li>)}</ol>
        : <Empty icon={<CalendarPlus />}>No sessions logged yet.</Empty>}
    </Modal>
  );
}

function PairCard({ m, me, onChanged }: { m: any; me: "mentee" | "mentor"; onChanged: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState<string | null>(null); const [note, setNote] = useState(""); const [sess, setSess] = useState(false);
  const other = me === "mentee" ? { name: m.mentor_name, role: m.mentor_role } : { name: m.mentee_name, role: m.mentee_role };
  const confirm = useConfirm();
  const act = async (key: string, path: string, body: any, msg: string) => {
    if (body?.outcome === "Cancelled" && !(await confirm({ title: "Cancel mentoring", message: `Cancel this ${m.status === "Requested" ? "request" : "mentoring"} with ${other.name}?`, danger: true, confirmLabel: "Cancel mentoring" }))) return;
    if (body?.accept === false && !(await confirm({ title: "Decline request", message: `Decline ${other.name}'s request?`, confirmLabel: "Decline" }))) return;
    setBusy(key); const r = await api("POST", path, body); setBusy(null); r.ok ? toast(msg) : toast(r.error!.message, "bad"); onChanged(); };
  return (
    <div className="anim-in flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 shadow-card">
      <div className="flex items-center gap-3"><Avatar name={other.name} size={44} /><div className="min-w-0 flex-1"><div className="truncate text-[15px] font-bold">{other.name}</div><div className="truncate text-[12px] text-ink-3">{other.role}</div></div><Pill tone={TONE[m.status]}>{m.status}</Pill></div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="rounded-lg bg-accent-soft px-2 py-0.5 font-semibold text-accent">{m.skill_name}</span><span className="text-ink-3">asked {ago(m.created_at)}</span>
        {m.status === "Accepted" || m.status === "Completed" ? <span className="text-ink-3">· {m.sessions} session{m.sessions === 1 ? "" : "s"}{m.minutes ? ` · ${Math.round(m.minutes / 60 * 10) / 10} h` : ""}</span> : null}</div>
      {m.message && <p className="flex gap-2 rounded-xl bg-sunken/60 px-3 py-2 text-[13px] text-ink-2"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />{m.message}</p>}
      {m.response_note && <p className="text-[12.5px] text-ink-3">Reply: {m.response_note}</p>}
      {me === "mentor" && m.status === "Requested" && <div className="flex flex-col gap-2"><input className="inp" placeholder="Reply (optional)" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex gap-2"><Button variant="primary" size="sm" loading={busy === "a"} onClick={() => act("a", `/mentoring/${m.id}/respond`, { accept: true, note }, "Accepted. It's in their plan now.")}><Check className="h-3.5 w-3.5" />Accept</Button>
          <Button size="sm" loading={busy === "d"} onClick={() => act("d", `/mentoring/${m.id}/respond`, { accept: false, note }, "Declined")}><X className="h-3.5 w-3.5" />Decline</Button></div></div>}
      <div className="flex flex-wrap gap-2">
        {(m.status === "Accepted" || m.status === "Completed") && <Button size="sm" onClick={() => setSess(true)}><CalendarPlus className="h-3.5 w-3.5" />Sessions</Button>}
        {m.status === "Accepted" && <Button size="sm" variant="soft" loading={busy === "c"} onClick={() => act("c", `/mentoring/${m.id}/close`, { outcome: "Completed" }, "Marked complete")}>Complete</Button>}
        {((m.status === "Requested" && me === "mentee") || m.status === "Accepted") && <Button size="sm" variant="ghost" loading={busy === "x"} onClick={() => act("x", `/mentoring/${m.id}/close`, { outcome: "Cancelled" }, "Cancelled")}>Cancel</Button>}
      </div>
      {sess && <Sessions m={m} onClose={() => { setSess(false); onChanged(); }} canLog={m.status === "Accepted"} />}
    </div>
  );
}

export default function Mentoring() {
  const d = useApi<any>("/mentoring");
  if (d.loading) return <Loading rows={6} />;
  if (d.error) return <ErrorBox error={d.error} />;
  const { as_mentee, as_mentor } = d.data;
  const waiting = as_mentor.filter((m: any) => m.status === "Requested").length;
  const active = [...as_mentee, ...as_mentor].filter((m: any) => m.status === "Accepted").length;
  return (
    <>
      <Hero>
        <div><div className="text-[13px] font-semibold text-white/70">Mentoring</div><h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">Learn from each other</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]"><span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{active}</b> active</span><span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{waiting}</b> waiting for your answer</span></div></div>
      </Hero>
      {waiting > 0 && <h2 className="mb-3 text-[18px] font-extrabold">Asked to mentor</h2>}
      <div className="stagger mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{as_mentor.filter((m: any) => m.status === "Requested").map((m: any) => <PairCard key={m.id} m={m} me="mentor" onChanged={d.reload} />)}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="My mentors" icon={<HeartHandshake />}>
          {as_mentee.length ? <div className="flex flex-col gap-3">{as_mentee.map((m: any) => <PairCard key={m.id} m={m} me="mentee" onChanged={d.reload} />)}</div>
            : <Empty icon={<HeartHandshake />}>Ask someone from <b>My learning</b>: open a skill and choose a mentor.</Empty>}
        </Card>
        <Card title="People I mentor" icon={<Users />}>
          {as_mentor.filter((m: any) => m.status !== "Requested").length ? <div className="flex flex-col gap-3">{as_mentor.filter((m: any) => m.status !== "Requested").map((m: any) => <PairCard key={m.id} m={m} me="mentor" onChanged={d.reload} />)}</div>
            : <Empty icon={<Users />}>No mentees yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
