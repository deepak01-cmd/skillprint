"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Crown, Plus, ShieldCheck, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Empty, ErrorBox, Field, Hero, Loading, Modal, Pill, cx, useToast } from "@/components/ui";

const RISK: Record<string, { tone: string; cls: string }> = {
  "No successor": { tone: "Rejected", cls: "from-bad/80 to-bad" }, "No one ready now": { tone: "Medium", cls: "from-warn/80 to-warn" },
  "Thin bench": { tone: "In progress", cls: "from-accent-2/80 to-accent-2" }, Covered: { tone: "Active", cls: "from-good/80 to-good" },
};

export default function Succession() {
  const s = useSession(); const toast = useToast();
  const list = useApi<any[]>("/succession"); const roles = useApi<any[]>("/roles");
  const [open, setOpen] = useState(false); const [f, setF] = useState({ role_id: "", criticality: "High", reason: "" }); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  if (list.loading) return <Loading rows={6} />;
  if (list.error) return <ErrorBox error={list.error} />;
  const rows = list.data || [];
  const planned = new Set(rows.map(r => r.role_id));
  const choices = (roles.data || []).filter(r => r.status === "Published" && !planned.has(r.id) && (s.user.role === "hr_admin" || r.department_id === s.user.department_id));
  const covered = rows.filter(r => r.risk === "Covered").length; const exposed = rows.filter(r => r.risk === "No successor" || r.risk === "No one ready now").length;
  const save = async () => { setBusy(true); setErr(null); const r = await api("POST", "/succession", f); setBusy(false); if (!r.ok) return setErr(r.error); toast("Critical role added"); setOpen(false); setF({ role_id: "", criticality: "High", reason: "" }); list.reload(); };
  return (
    <>
      <Hero>
        <div><div className="text-[13px] font-semibold text-white/70">Succession planning</div><h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">Who's next for every critical role</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]"><span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{rows.length}</b> critical roles</span>
            <span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{covered}</b> covered</span><span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{exposed}</b> exposed</span></div></div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add critical role</Button>
      </Hero>
      {rows.length ? <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(r => { const tot = Math.max(1, r.ready_now + r.ready_1_2 + r.ready_3); return (
        <Link key={r.id} href={`/succession/${r.id}`} className="lift flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-card">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[12px] font-semibold text-accent">{r.department_name}</div><div className="text-[16px] font-bold leading-snug">{r.role_title}</div></div>
            <Pill tone={r.criticality === "Critical" ? "Critical" : r.criticality === "High" ? "Medium" : "Draft"}><Crown className="h-3 w-3" />{r.criticality}</Pill></div>
          <div className="flex items-center gap-3 text-[12.5px] text-ink-3"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.incumbents} in role</span><span>{r.successors} successor{r.successors === 1 ? "" : "s"}</span></div>
          <div><div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-sunken">
            {r.ready_now > 0 && <div className="grow-x bg-good" style={{ width: `${r.ready_now / tot * 100}%` }} />}{r.ready_1_2 > 0 && <div className="grow-x bg-accent-2" style={{ width: `${r.ready_1_2 / tot * 100}%` }} />}{r.ready_3 > 0 && <div className="grow-x bg-accent-3/70" style={{ width: `${r.ready_3 / tot * 100}%` }} />}</div>
            <div className="mt-1.5 flex gap-3 text-[11.5px] text-ink-3"><span><b className="text-good">{r.ready_now}</b> now</span><span><b className="text-em">{r.ready_1_2}</b> 1–2 y</span><span><b className="text-accent-3">{r.ready_3}</b> 3+ y</span></div></div>
          <div className="mt-auto flex items-center gap-2 border-t border-line-2 pt-3 text-[12.5px] font-semibold">{r.risk === "Covered" ? <ShieldCheck className="h-4 w-4 text-good" /> : <AlertTriangle className={cx("h-4 w-4", r.risk === "No successor" ? "text-bad" : "text-warn")} />}<Pill tone={RISK[r.risk].tone}>{r.risk}</Pill></div>
        </Link>); })}</div>
        : <Empty icon={<Crown />} action={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add the first critical role</Button>}>Mark the roles you can't afford to leave empty.</Empty>}
      <Modal open={open} onClose={() => setOpen(false)} title="Add a critical role" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.role_id} onClick={save}>Add</Button></>}>
        <Field label="Role" htmlFor="sr"><select id="sr" className="inp" value={f.role_id} onChange={e => setF({ ...f, role_id: e.target.value })}><option value="">Choose…</option>{choices.map(r => <option key={r.id} value={r.id}>{r.title} · {r.department_name}</option>)}</select></Field>
        <Field label="Criticality"><div className="flex gap-1.5">{["Critical", "High", "Medium"].map(c => <button key={c} type="button" onClick={() => setF({ ...f, criticality: c })} className={cx("rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", f.criticality === c ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-3")}>{c}</button>)}</div></Field>
        <Field label="Why it matters (optional)" htmlFor="sw"><textarea id="sw" className="inp" rows={3} maxLength={1000} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
