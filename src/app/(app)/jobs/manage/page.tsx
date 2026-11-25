"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BriefcaseBusiness, FileUp, Pencil, Plus, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pill, SearchInput, Stat, Tabs, ago, cx, useToast } from "@/components/ui";
import { UploadFlow } from "@/components/UploadFlow";

const STATUSES = ["Open", "Draft", "On hold", "Closed"];

function JobForm({ job, roles, onClose, onSaved }: { job: any | null; roles: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(job ? { ...job, closes_on: job.closes_on ? String(job.closes_on).slice(0, 10) : "", location: job.location || "" }
    : { role_id: "", title: "", location: "", work_mode: "Hybrid", openings: 1, description: "", min_match: 0, closes_on: "", status: "Open" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const role = roles.find(r => r.id === f.role_id);
  const save = async () => {
    setBusy(true); setErr(null);
    const body: any = { title: f.title || role?.title, location: f.location || null, work_mode: f.work_mode, openings: Number(f.openings), description: f.description, min_match: Number(f.min_match), closes_on: f.closes_on || null, status: f.status };
    const r = job ? await api("PATCH", `/ijp/jobs/${job.id}`, body) : await api("POST", "/ijp/jobs", { ...body, role_id: f.role_id });
    setBusy(false); if (!r.ok) return setErr(r.error);
    toast(job ? "Posting updated" : f.status === "Draft" ? "Saved as draft" : "Posted — employees can see it now"); onSaved();
  };
  return (
    <Modal wide open onClose={onClose} title={job ? "Edit posting" : "New internal job"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!job && !f.role_id} onClick={save}>{job ? "Save" : f.status === "Draft" ? "Save draft" : "Post job"}</Button></>}>
      <div className="grid gap-3.5 md:grid-cols-2">
        <Field label="Role from the framework" htmlFor="jr">{job ? <input id="jr" className="inp" disabled value={job.role_title} /> :
          <select id="jr" className="inp" value={f.role_id} onChange={e => setF({ ...f, role_id: e.target.value, title: f.title || "" })}><option value="">Choose a published role…</option>{roles.map(r => <option key={r.id} value={r.id}>{r.title} · {r.department_name}</option>)}</select>}</Field>
        <Field label="Posting title" htmlFor="jt"><input id="jt" className="inp" maxLength={160} placeholder={role?.title || ""} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Location" htmlFor="jl"><input id="jl" className="inp" maxLength={120} value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work mode" htmlFor="jm"><select id="jm" className="inp" value={f.work_mode} onChange={e => setF({ ...f, work_mode: e.target.value })}>{["Onsite", "Hybrid", "Remote"].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Openings" htmlFor="jo"><input id="jo" className="inp" type="number" min={1} max={500} value={f.openings} onChange={e => setF({ ...f, openings: e.target.value })} /></Field>
        </div>
        <Field label="Closing date" htmlFor="jc"><input id="jc" className="inp" type="date" min={new Date().toISOString().slice(0, 10)} value={f.closes_on} onChange={e => setF({ ...f, closes_on: e.target.value })} /></Field>
        <Field label={`Minimum match: ${f.min_match}%`} htmlFor="jmm" hint={Number(f.min_match) ? "People below this can see the job but not apply" : "Anyone can apply"}><input id="jmm" type="range" min={0} max={100} step={5} value={f.min_match} onChange={e => setF({ ...f, min_match: e.target.value })} /></Field>
      </div>
      <Field label="Description" htmlFor="jd"><textarea id="jd" className="inp" rows={5} maxLength={8000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Status"><div className="flex flex-wrap gap-1.5">{(job ? STATUSES : ["Open", "Draft"]).map(x => <button type="button" key={x} onClick={() => setF({ ...f, status: x })} className={cx("rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", f.status === x ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-3")}>{x}</button>)}</div></Field>
      <ErrorBox error={err} />
    </Modal>
  );
}

export default function ManageJobs() {
  const s = useSession(); const toast = useToast();
  const jobs = useApi<any[]>("/ijp/jobs?view=manage");
  const roles = useApi<any[]>("/roles");
  const [tab, setTab] = useState("Open"); const [q, setQ] = useState("");
  const [form, setForm] = useState<any>(undefined); const [up, setUp] = useState(false);
  const published = (roles.data || []).filter(r => r.status === "Published" && (s.user.role === "hr_admin" || r.department_id === s.user.department_id));
  const list = useMemo(() => (jobs.data || []).filter(j => (tab === "All" || j.status === tab) && (!q || `${j.title} ${j.department_name}`.toLowerCase().includes(q.toLowerCase()))), [jobs.data, tab, q]);
  const count = (st: string) => (jobs.data || []).filter(j => j.status === st).length;
  const setStatus = async (j: any, status: string) => { const r = await api("PATCH", `/ijp/jobs/${j.id}`, { status }); r.ok ? toast(`${j.title}: ${status}`) : toast(r.error!.message, "bad"); jobs.reload(); };
  return (
    <>
      <PageHeader title="Internal jobs" actions={<><Button onClick={() => setUp(true)}><FileUp className="h-4 w-4" />Upload CSV</Button><Button variant="primary" onClick={() => setForm(null)}><Plus className="h-4 w-4" />New job</Button></>} />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<BriefcaseBusiness />} label="Open" value={count("Open")} />
        <Stat icon={<Users />} label="Applicants" value={(jobs.data || []).reduce((a, j) => a + (j.applicants || 0), 0)} />
        <Stat icon={<Users />} tone="good" label="Hired" value={(jobs.data || []).reduce((a, j) => a + (j.hired || 0), 0)} />
        <Stat icon={<Pencil />} label="Drafts" value={count("Draft")} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[...STATUSES.map(x => ({ id: x, label: x, count: count(x) })), { id: "All", label: "All", count: (jobs.data || []).length }]} />
        <SearchInput className="mb-5 w-full max-w-xs" value={q} onChange={setQ} placeholder="Search postings" />
      </div>
      <Card pad={false}>
        {jobs.loading ? <Loading /> : list.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Posting</th><th>Location</th><th>Openings</th><th>Applicants</th><th>Closes</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.map(j => <tr key={j.id}>
            <td><Link href={`/jobs/manage/${j.id}`} className="font-bold hover:text-accent">{j.title}</Link><div className="text-[12px] text-ink-3">{j.department_name} · posted {ago(j.created_at)}</div></td>
            <td className="text-ink-2">{j.location || "—"} · {j.work_mode}</td>
            <td className="num">{j.hired ? `${j.hired}/` : ""}{j.openings}</td>
            <td><Link href={`/jobs/manage/${j.id}`} className="inline-flex items-center gap-1.5 font-bold text-accent hover:underline"><Users className="h-3.5 w-3.5" />{j.applicants}</Link></td>
            <td className="num text-ink-2">{j.closes_on ? String(j.closes_on).slice(0, 10) : "—"}</td>
            <td><select aria-label="Status" className="inp w-auto py-1 text-[12.5px]" value={j.status} onChange={e => setStatus(j, e.target.value)}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></td>
            <td className="whitespace-nowrap text-right"><Button size="sm" onClick={() => setForm(j)}><Pencil className="h-3.5 w-3.5" />Edit</Button></td></tr>)}</tbody></table></div>
          : <Empty icon={<BriefcaseBusiness />} action={<Button variant="primary" size="sm" onClick={() => setForm(null)}><Plus className="h-3.5 w-3.5" />Post a job</Button>}>No {tab === "All" ? "" : tab.toLowerCase() + " "}postings.</Empty>}
      </Card>
      {form !== undefined && <JobForm job={form} roles={published} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); jobs.reload(); }} />}
      <UploadFlow open={up} onClose={() => { setUp(false); jobs.reload(); }} title="Upload internal jobs" templatePath="/ijp/upload/template" previewPath="/ijp/upload/preview" commitPath={id => `/ijp/upload/${id}/commit`}
        hint="One posting per row: role, title, department, location, work_mode, openings, description, min_match, closes_on, status"
        canCommit={p => p.summary.create > 0}
        onDone={r => <><div className="text-[18px] font-extrabold">{r.created} posting{r.created === 1 ? "" : "s"} created</div><div className="text-[13px] text-ink-3">Open postings are visible to employees now.</div></>}
        renderPreview={p => <>
          <div className="flex flex-wrap gap-2"><Pill tone="Open">{p.summary.create} ready</Pill>{p.summary.error > 0 && <Pill tone="Rejected">{p.summary.error} with problems</Pill>}{p.unknown_columns?.length > 0 && <Pill tone="Draft">Ignored columns: {p.unknown_columns.join(", ")}</Pill>}</div>
          <div className="scroll-thin max-h-[46vh] overflow-auto rounded-xl border border-line"><table className="t"><thead><tr><th>Row</th><th>Posting</th><th>Details</th><th>Validation result</th></tr></thead>
            <tbody>{p.rows.map((r: any) => <tr key={r.row}><td className="num text-ink-3">{r.row}</td><td className="font-semibold">{r.key || "—"}</td>
              <td className="text-[12px] text-ink-3">{r.data ? `${r.data.location || "—"} · ${r.data.work_mode} · ${r.data.openings} opening(s)${r.data.closes_on ? ` · closes ${r.data.closes_on}` : ""} · ${r.data.status}` : ""}</td>
              <td>{r.action === "create" ? <Pill tone="Open">OK</Pill> : <Pill tone="Rejected">Fix</Pill>}{r.messages.length > 0 && <div className="mt-1 text-[12px] text-ink-3">{r.messages.join(" · ")}</div>}</td></tr>)}</tbody></table></div>
        </>} />
    </>
  );
}
