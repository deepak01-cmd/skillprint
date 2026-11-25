"use client";
/* Platform administrator: approval rule, library reviewers and automatic-growth runs with undo. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { History, ShieldCheck, Undo2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, Button, Card, Empty, ErrorBox, Pill, cx, fmtDate, useToast } from "@/components/ui";

export function LibraryGovernance({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [st, setSt] = useState<any>(null); const [runs, setRuns] = useState<any[] | null>(null);
  const [email, setEmail] = useState(""); const [err, setErr] = useState<any>(null); const [open, setOpen] = useState<string | null>(null);
  const load = async () => { const [a, b] = await Promise.all([api("GET", "/library/settings"), api("GET", "/library/runs")]); if (a.ok) setSt(a.data); if (b.ok) setRuns(b.data); };
  useEffect(() => { load(); }, []);
  const setTwo = async (v: boolean) => { const r = await api("PUT", "/library/settings", { two_step: v }); if (r.ok) { toast(v ? "Two-step approval on" : "Two-step approval off: decisions apply at once"); load(); } else setErr(r.error); };
  const reviewer = async (e: string, on: boolean) => { const r = await api("POST", "/library/reviewers", { email: e, reviewer: on }); if (r.ok) { toast(on ? `${r.data.name} can now approve proposals` : `${r.data.name} is no longer a reviewer`); setEmail(""); load(); } else setErr(r.error); };
  const undo = async (id: string) => { const r = await api("POST", `/library/runs/${id}/retire`, {}); if (r.ok) { toast(`${r.data.retired} skill(s) retired${r.data.kept ? `, ${r.data.kept} kept because roles already use them` : ""}`); load(); onChanged(); } else setErr(r.error); };
  if (!st) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Who approves library changes" icon={<ShieldCheck className="h-4 w-4" />}>
        <label className="flex cursor-pointer items-start gap-3 text-[13.5px]">
          <input type="checkbox" className="mt-1" checked={st.two_step} onChange={e => setTwo(e.target.checked)} />
          <span><b className="font-medium">Require a second person's approval</b><span className="block text-ink-3">New global skills and “same as” links from job postings, including automatic ones, become proposals. A library reviewer or another platform administrator approves them; nobody approves their own.</span></span>
        </label>
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-[12.5px] font-medium text-ink-2">Library reviewers</div>
          {st.reviewers.length ? <ul className="flex flex-col divide-y divide-line">{st.reviewers.map((r: any) => (
            <li key={r.id} className="flex items-center gap-2.5 py-2 text-[13px]"><Avatar name={r.name} size={26} /><span className="min-w-0 flex-1"><span className="block">{r.name}</span><span className="block truncate text-[12px] text-ink-3">{r.email} · {r.organisation || "Platform"}</span></span>
              {r.role !== "platform_admin" && <Button size="sm" variant="ghost" onClick={() => reviewer(r.email, false)}>Remove</Button>}</li>))}</ul> : <p className="text-[13px] text-ink-3">None yet.</p>}
          <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (email) reviewer(email, true); }}>
            <input className="inp" type="email" placeholder="Email of an expert reviewer or HR administrator" value={email} onChange={e => setEmail(e.target.value)} aria-label="Reviewer email" />
            <Button type="submit"><UserPlus className="h-4 w-4" />Add</Button>
          </form>
          <p className="mt-2 text-[12px] text-ink-3">Reviewers approve on the <Link className="text-accent hover:underline" href="/library/approvals">Library approvals</Link> page.</p>
        </div>
        <ErrorBox error={err} />
      </Card>
      <Card title="Additions by run" sub="Automatic additions and approved batches. Undo retires that run's skills; skills already used by roles are kept." icon={<History className="h-4 w-4" />}>
        {!runs?.length ? <Empty>No additions yet.</Empty> : <ul className="-mx-4 -mb-4">{runs.map(r => {
          const active = r.skills.filter((s: any) => s.status === "Active").length;
          return (
            <li key={r.id} className="border-t border-line px-4 py-2.5">
              <div className="flex items-center gap-3 text-[13px]">
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="min-w-0 flex-1 text-left"><span className="font-mono text-[12px] text-ink-3">{r.id}</span> <b className="font-medium">{r.mode}</b> <span className="text-ink-3">· {fmtDate(r.at)} · {r.skills.length} skill(s){r.note ? ` · ${r.note}` : ""}</span></button>
                {active > 0 ? <Button size="sm" variant="danger" onClick={() => undo(r.id)}><Undo2 className="h-3.5 w-3.5" />Undo {active}</Button> : <Pill tone="Archived">undone</Pill>}
              </div>
              {open === r.id && <div className="mt-2 flex flex-wrap gap-1.5">{r.skills.map((s: any) => <Link key={s.id} href={`/skills/${s.id}`} className={cx("rounded border px-2 py-0.5 text-[12px]", s.status === "Active" ? "border-line" : "border-line text-ink-3 line-through")}>{s.name}{s.in_use ? ` · used by ${s.in_use}` : ""}</Link>)}</div>}
            </li>); })}</ul>}
      </Card>
    </div>
  );
}
