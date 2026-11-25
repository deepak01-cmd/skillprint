"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Avatar, Button, Empty, ErrorBox, Loading, Modal, PageHeader, Pill, Ring, ago, cx, useToast } from "@/components/ui";
import { toneFor } from "@/components/Jobs";

const COLS = ["Applied", "Screening", "Interview", "Offered", "Hired", "Not selected"];
const NEXT: Record<string, string[]> = { Applied: ["Screening", "Interview", "Not selected"], Screening: ["Interview", "Not selected"], Interview: ["Offered", "Not selected"], Offered: ["Hired", "Not selected"] };
const COL_TONE: Record<string, string> = { Applied: "from-accent", Screening: "from-accent-2", Interview: "from-warn", Offered: "from-accent-3", Hired: "from-good", "Not selected": "from-ink-3" };

export default function Pipeline({ params }: { params: { id: string } }) {
  const toast = useToast();
  const job = useApi<any>(`/ijp/jobs/${params.id}`);
  const apps = useApi<any[]>(`/ijp/jobs/${params.id}/applications`);
  const [sel, setSel] = useState<any>(null); const [note, setNote] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  if (job.loading || apps.loading) return <Loading rows={8} />;
  if (job.error) return <ErrorBox error={job.error} />;
  if (apps.error) return <ErrorBox error={apps.error} />;
  const all = apps.data || []; const withdrawn = all.filter(a => a.status === "Withdrawn");
  const move = async (a: any, status: string) => {
    setBusy(status); const r = await api("POST", `/ijp/applications/${a.id}/status`, { status, note }); setBusy(null);
    if (!r.ok) return toast(r.error!.message, "bad");
    toast(`${a.name} → ${status}${r.data.job_closed ? ". All openings filled; the posting is closed." : ""}`); setSel(null); setNote(""); apps.reload(); job.reload();
  };
  return (
    <>
      <Link href="/jobs/manage" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-accent"><ArrowLeft className="h-4 w-4" />Internal jobs</Link>
      <PageHeader eyebrow={job.data.department_name} title={job.data.title} actions={<><Pill>{job.data.status}</Pill><Link href={`/jobs/${params.id}`}><Button size="sm"><Eye className="h-3.5 w-3.5" />Posting</Button></Link></>}
        sub={`${all.length - withdrawn.length} applicant${all.length - withdrawn.length === 1 ? "" : "s"} · ${job.data.openings} opening${job.data.openings > 1 ? "s" : ""}`} />
      {all.length === withdrawn.length ? <Empty icon={<Users />}>No applicants yet.</Empty> :
        <div className="scroll-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4">
          {COLS.map(c => { const list = all.filter(a => a.status === c); return (
            <div key={c} className="flex w-[270px] shrink-0 flex-col rounded-2xl border border-line bg-sunken/40 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1.5 pt-1"><span className="flex items-center gap-2 text-[13px] font-bold"><i className={cx("h-2.5 w-2.5 rounded-full bg-gradient-to-br to-transparent", COL_TONE[c])} />{c}</span><span className="num rounded-full bg-card px-2 text-[12px] font-bold text-ink-3">{list.length}</span></div>
              <div className="flex flex-col gap-2">
                {list.map(a => (
                  <button key={a.id} onClick={() => { setSel(a); setNote(""); }} className="lift flex flex-col gap-2 rounded-xl border border-line bg-card p-3 text-left shadow-card">
                    <div className="flex items-center gap-2.5"><Avatar name={a.name} size={34} /><div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold">{a.name}</div><div className="truncate text-[11.5px] text-ink-3">{a.current_role}</div></div>
                      <Ring value={a.match_now} size={42} stroke={12} tone={toneFor(a.match_now)} label={<span className="text-[10.5px]">{a.match_now}%</span>} /></div>
                    <div className="flex items-center justify-between text-[11.5px] text-ink-3"><span>{a.current_department}</span><span>{ago(a.updated_at)}</span></div>
                  </button>))}
                {!list.length && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-3">—</div>}
              </div>
            </div>); })}
        </div>}
      {withdrawn.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">{withdrawn.length} withdrawn</p>}

      <Modal wide open={!!sel} onClose={() => setSel(null)} title={sel?.name || ""}>
        {sel && <>
          <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-sunken/50 p-4">
            <Avatar name={sel.name} size={52} />
            <div className="min-w-0 flex-1"><div className="text-[15px] font-bold">{sel.current_role}</div><div className="text-[12.5px] text-ink-3">{sel.current_department} · {sel.email} · applied {ago(sel.created_at)}</div></div>
            <div className="flex items-center gap-4"><div className="text-center"><Ring value={sel.match_pct} size={64} stroke={11} tone={toneFor(sel.match_pct)} label={<span className="text-[13px]">{sel.match_pct}%</span>} /><div className="mt-1 text-[11px] text-ink-3">when applied</div></div>
              <div className="text-center"><Ring value={sel.match_now} size={64} stroke={11} tone={toneFor(sel.match_now)} label={<span className="text-[13px]">{sel.match_now}%</span>} /><div className="mt-1 text-[11px] text-ink-3">today</div></div></div>
          </div>
          {sel.note && <blockquote className="rounded-xl border-l-4 border-accent bg-accent-soft/40 px-4 py-3 text-[13.5px] italic text-ink-2">“{sel.note}”</blockquote>}
          <div><div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3">Gaps when applied</div>
            {(sel.snapshot?.gaps || []).length ? <ul className="grid gap-1.5 sm:grid-cols-2">{sel.snapshot.gaps.map((g: any) => <li key={g.skill} className="flex items-center justify-between gap-2 rounded-lg bg-sunken/60 px-3 py-1.5 text-[12.5px]"><span className="truncate font-semibold">{g.skill}</span><span className="num shrink-0">{g.current ?? "?"} → {g.required} <Pill tone={g.type} className="ml-1">{g.type}</Pill></span></li>)}</ul> : <span className="text-[13px] text-good">No gaps — meets every requirement.</span>}</div>
          <div><div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3">History</div><ul className="flex flex-col gap-1 border-l-2 border-line pl-4">{[...(sel.history || [])].reverse().map((h: any, i: number) => <li key={i} className="text-[12.5px]"><b>{h.status}</b> <span className="text-ink-3">· {h.by} · {ago(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ul></div>
          {NEXT[sel.status] && <div className="flex flex-col gap-2 border-t border-line pt-4">
            <input className="inp" placeholder="Note (optional, visible to the applicant)" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">{NEXT[sel.status].map(n => <Button key={n} variant={n === "Not selected" ? "danger" : "primary"} loading={busy === n} onClick={() => move(sel, n)}>{n !== "Not selected" && <ArrowRight className="h-4 w-4" />}{n}</Button>)}</div>
            {sel.status === "Offered" && <p className="text-[12px] text-ink-3">Marking as hired doesn't change the person's role. Update it in Employees when the move happens.</p>}
          </div>}
        </>}
      </Modal>
    </>
  );
}
