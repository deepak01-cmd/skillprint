"use client";
import { useState } from "react";
import { BarChart3, CalendarClock, Download, FileSpreadsheet, FileText, Mail, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, IconBadge, Modal, PageHeader, Pill, ago, cx, useConfirm, useToast } from "@/components/ui";

const ICON: Record<string, any> = { skill_gaps: BarChart3, skills_inventory: FileSpreadsheet, learning: FileText, mobility: FileSpreadsheet, succession: ShieldCheck, access: ShieldCheck };

export default function Reports() {
  const s = useSession(); const toast = useToast(); const confirm = useConfirm();
  const cat = useApi<any[]>("/reports"); const sched = useApi<any[]>("/reports/schedules"); const runs = useApi<any[]>("/reports/runs"); const org = useApi<any>("/org");
  const [dept, setDept] = useState("");
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({ report: "skill_gaps", format: "xlsx", frequency: "monthly", department_id: "", recipients: s.user.email });
  const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null);
  const hr = s.user.role === "hr_admin";
  const depts = (org.data?.departments || []).filter((d: any) => d.status === "Active");
  const name = (k: string) => (cat.data || []).find(c => c.key === k)?.title || k;
  const href = (k: string, fmt: string) => `/api/v1/reports/${k}/download?format=${fmt}${dept && hr ? `&department_id=${dept}` : ""}`;
  const save = async () => {
    setBusy("save"); setErr(null);
    const r = await api("POST", "/reports/schedules", { ...f, department_id: f.department_id || null, recipients: String(f.recipients).split(/[,;\s]+/).filter(Boolean) });
    setBusy(null); if (!r.ok) return setErr(r.error);
    toast("Scheduled"); setOpen(false); sched.reload();
  };
  const run = async (id: string) => { setBusy(id); const r = await api("POST", `/reports/schedules/${id}/run`); setBusy(null); r.ok ? toast(`Report ready · ${r.data.delivered}`) : toast(r.error!.message, "bad"); runs.reload(); sched.reload(); };
  return (
    <>
      <PageHeader title="Reports" actions={<Button variant="primary" onClick={() => { setErr(null); setOpen(true); }}><CalendarClock className="h-4 w-4" />Schedule a report</Button>} />
      {hr && <div className="mb-4 flex items-center gap-2"><span className="text-[13px] text-ink-3">Scope</span><select className="inp w-auto" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">Whole organisation</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>}
      <div className="stagger mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(cat.data || []).map(c => { const I = ICON[c.key] || FileSpreadsheet; return (
          <div key={c.key} className="lift flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-card">
            <div className="flex items-center gap-3"><IconBadge size={40}><I /></IconBadge><div className="text-[16px] font-bold">{c.title}</div></div>
            <p className="flex-1 text-[13px] text-ink-3">{c.about}</p>
            <div className="flex gap-2"><a href={href(c.key, "xlsx")}><Button size="sm" variant="primary"><Download className="h-3.5 w-3.5" />Excel</Button></a><a href={href(c.key, "csv")}><Button size="sm"><Download className="h-3.5 w-3.5" />CSV</Button></a></div>
          </div>); })}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Scheduled" icon={<CalendarClock />} pad={false}>
          {(sched.data || []).length ? <table className="t"><thead><tr><th>Report</th><th>When</th><th>To</th><th>Next</th><th></th></tr></thead>
            <tbody>{(sched.data || []).map(x => <tr key={x.id} className={x.active ? "" : "opacity-50"}>
              <td><div className="font-semibold">{name(x.report)}</div><div className="text-[12px] text-ink-3">{x.format.toUpperCase()} · {x.department_name || "Whole organisation"}</div></td>
              <td className="capitalize">{x.frequency}</td><td className="text-[12px]">{x.recipients.length ? x.recipients.join(", ") : <span className="text-ink-3">history only</span>}</td>
              <td className="text-[12.5px] text-ink-3">{x.active ? new Date(x.next_run_at).toLocaleDateString() : "paused"}</td>
              <td className="whitespace-nowrap text-right"><span className="inline-flex gap-1">
                <Button size="sm" loading={busy === x.id} onClick={() => run(x.id)} title="Run now"><Play className="h-3.5 w-3.5" /></Button>
                <Button size="sm" onClick={async () => { await api("PATCH", `/reports/schedules/${x.id}`, { active: !x.active }); sched.reload(); }}>{x.active ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="danger" onClick={async () => { if (!(await confirm({ title: "Delete schedule", message: `${name(x.report)} will no longer run. Past runs stay in the history.`, danger: true, confirmLabel: "Delete" }))) return; await api("DELETE", `/reports/schedules/${x.id}`); sched.reload(); }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button></span></td></tr>)}</tbody></table>
            : <Empty icon={<CalendarClock />}>Nothing scheduled.</Empty>}
        </Card>
        <Card title="History" icon={<FileSpreadsheet />} pad={false}>
          {(runs.data || []).length ? <ul className="divide-y divide-line-2">{(runs.data || []).slice(0, 12).map(r => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3"><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{r.file_name}</div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">{ago(r.created_at)} · {r.rows} rows · {r.delivered.startsWith("emailed") ? <span className="inline-flex items-center gap-1 text-good"><Mail className="h-3 w-3" />{r.delivered}</span> : r.delivered}</div></div>
              <a href={`/api/v1/reports/runs/${r.id}/download`} className="rounded-lg p-2 text-accent hover:bg-accent-soft" aria-label="Download"><Download className="h-4 w-4" /></a></li>))}</ul>
            : <Empty icon={<FileSpreadsheet />}>Scheduled runs are kept here for 180 days.</Empty>}
        </Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule a report" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={save}><Plus className="h-4 w-4" />Schedule</Button></>}>
        <Field label="Report" htmlFor="rr"><select id="rr" className="inp" value={f.report} onChange={e => setF({ ...f, report: e.target.value })}>{(cat.data || []).map(c => <option key={c.key} value={c.key}>{c.title}</option>)}</select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How often"><div className="flex gap-1.5">{[["weekly", "Weekly · Mondays"], ["monthly", "Monthly · 1st"]].map(([v, l]) => <button key={v} type="button" onClick={() => setF({ ...f, frequency: v })} className={cx("rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", f.frequency === v ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-3")}>{l}</button>)}</div></Field>
          <Field label="Format"><div className="flex gap-1.5">{[["xlsx", "Excel"], ["csv", "CSV"]].map(([v, l]) => <button key={v} type="button" onClick={() => setF({ ...f, format: v })} className={cx("rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", f.format === v ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-3")}>{l}</button>)}</div></Field>
        </div>
        {hr && <Field label="Scope" htmlFor="rd"><select id="rd" className="inp" value={f.department_id} onChange={e => setF({ ...f, department_id: e.target.value })}><option value="">Whole organisation</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        <Field label="Email to" htmlFor="re" hint="HR administrators, or the head of the chosen department. Leave empty to keep it in the history only."><input id="re" className="inp" value={f.recipients} onChange={e => setF({ ...f, recipients: e.target.value })} placeholder="name@company.com, …" /></Field>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
