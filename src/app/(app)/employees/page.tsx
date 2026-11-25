"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, Plus, Upload, Users } from "lucide-react";
import { api, downloadText, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { ImportDialog, useUploadParam } from "@/components/ImportDialog";
import { Avatar, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, Pill, SearchInput, useConfirm, useToast } from "@/components/ui";

function useDebounced<T>(v: T, ms = 250) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

/** Type-ahead person picker backed by the paged employee search. */
function PersonPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [opts, setOpts] = useState<any[]>([]); const [open, setOpen] = useState(false);
  useEffect(() => { if (dq.length < 2) { setOpts([]); return; } api("GET", `/employees?page=1&size=10&q=${encodeURIComponent(dq)}`).then(r => r.ok && setOpts(r.data.items)); }, [dq]);
  if (value) return <div className="inp flex items-center gap-2"><Avatar name={value.name} size={22} /><span className="flex-1 truncate">{value.name}</span><button className="text-xs text-accent" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="relative">
      <input className="inp" placeholder="Type a name…" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label="Reporting manager" />
      {open && opts.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-card py-1 shadow-pop">
        {opts.map(o => <li key={o.id}><button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent-soft" onMouseDown={() => { onChange({ id: o.id, name: o.name }); setQ(""); }}><Avatar name={o.name} size={22} /><span>{o.name}</span><span className="ml-auto truncate text-xs text-ink-3">{o.role_title}</span></button></li>)}
      </ul>}
    </div>
  );
}

export default function Employees() {
  const s = useSession(); const router = useRouter(); const toast = useToast(); const confirm = useConfirm();
  const [status, setStatus] = useState("Active"); const [q, setQ] = useState(""); const dq = useDebounced(q); const [dept, setDept] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("department_id") || "" : ""); const [sort, setSort] = useState("name"); const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [dq, dept, status, sort]);
  const { data, error, loading, reload } = useApi<any>(`/employees?page=${page}&size=50&status=${status}&sort=${sort}${dq ? `&q=${encodeURIComponent(dq)}` : ""}${dept ? `&department_id=${dept}` : ""}`);
  const org = useApi<any>("/org"); const roles = useApi<any[]>("/roles?status=Published");
  const [add, setAdd] = useState(false); const [v, setV] = useState<any>({}); const [mgr, setMgr] = useState<{ id: string; name: string } | null>(null); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  const manage = can(s, "employees:manage");
  const [up, setUp] = useState(false); useUploadParam(setUp);
  const depts = (org.data?.departments || []).filter((d: any) => d.status === "Active");
  const exportCsv = async () => { const r = await api("GET", "/exports/employees"); r.ok ? downloadText(r.data.file, r.data.content) : toast(r.error!.message, "bad"); };
  return (
    <>
      <PageHeader title="Employees"
        actions={manage && <><Button onClick={exportCsv}><Download className="h-4 w-4" />Export</Button><Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload</Button>
          <Button variant="primary" onClick={() => { setV({ name: "", email: "", department_id: "", role_id: "" }); setMgr(null); setErr(null); setAdd(true); }}><Plus className="h-4 w-4" />Add employee</Button></>} />
      <ErrorBox error={error} />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3.5">
          <SearchInput className="w-full max-w-xs" value={q} onChange={setQ} placeholder="Search name, email, role or ID" />
          <select className="inp w-auto min-w-[180px]" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select className="inp w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status"><option>Active</option><option>Inactive</option></select>
          <select className="inp w-auto" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"><option value="name">Sort: name</option><option value="department">Sort: department</option><option value="role">Sort: role</option><option value="joined">Sort: newest joiners</option></select>
          {data && <span className="ml-auto text-xs text-ink-3"><b className="num text-ink-2">{data.total.toLocaleString()}</b> people</span>}
        </div>
        {loading && !data ? <Loading rows={8} /> : data && data.items.length === 0 ? <Empty icon={<Users className="h-5 w-5" />}>No one matches these filters.</Empty> : data && (
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Manager</th><th className="text-right">Assessed skills</th><th></th></tr></thead>
            <tbody className={loading ? "opacity-60" : ""}>{data.items.map((e: any) => (
              <tr key={e.id} className="click" onClick={() => router.push(`/employees/${e.id}`)}>
                <td><div className="flex items-center gap-3"><Avatar name={e.name} /><div className="min-w-0"><Link className="font-medium hover:text-accent" href={`/employees/${e.id}`}>{e.name}</Link><div className="truncate text-xs text-ink-3">{e.employee_code ? `No. ${e.employee_code} · ` : ""}{e.email}</div></div></div></td>
                <td>{e.role_title}{e.career_level && <div className="text-xs text-ink-3">{e.career_level}</div>}</td><td className="text-ink-2">{e.department_name}</td><td className="text-ink-2">{e.manager_name || "—"}</td>
                <td className="num text-right">{e.assessed_skills}</td>
                <td className="whitespace-nowrap text-right" onClick={x => x.stopPropagation()}>{e.synthetic && <Pill tone="Draft">synthetic</Pill>}{manage && <Button size="sm" variant="ghost" className="ml-1" onClick={async () => { if (e.status === "Active" && !(await confirm({ title: "Deactivate employee", message: `${e.name} is removed from lists, gaps and plans. History is kept and you can reactivate them later.`, danger: true, confirmLabel: "Deactivate" }))) return; const r = await api("PATCH", `/employees/${e.id}`, { status: e.status === "Active" ? "Inactive" : "Active" }); r.ok ? toast("Updated; history kept") : toast(r.error!.message, "bad"); reload(); }}>{e.status === "Active" ? "Deactivate" : "Reactivate"}</Button>}</td>
              </tr>))}</tbody></table></div>)}
        {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["employees"]} onDone={() => reload()} title="Upload employees" />
      <Modal open={add} onClose={() => setAdd(false)} title="Add employee" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); const r = await api("POST", "/employees", { ...v, role_id: v.role_id || undefined, role_title: v.role_id ? undefined : v.role_title || undefined, login_password: v.login_password || undefined, manager_id: mgr?.id || null }); setBusy(false);
        if (!r.ok) return setErr(r.error); setAdd(false); toast(r.data.status === "queued" ? r.data.note : `${r.data.id} added${r.data.user_id ? " with a login" : ""}`); reload(); }}>Add employee</Button></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name" htmlFor="en"><input id="en" className="inp" value={v.name || ""} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Work email" htmlFor="ee"><input id="ee" className="inp" type="email" value={v.email || ""} onChange={e => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Employee number (optional)" htmlFor="ec" hint="Your company's own ID. The system ID is created automatically."><input id="ec" className="inp" maxLength={40} value={v.employee_code || ""} onChange={e => setV({ ...v, employee_code: e.target.value })} /></Field>
          <Field label="Department" htmlFor="ed"><select id="ed" className="inp" value={v.department_id} onChange={e => setV({ ...v, department_id: e.target.value })}><option value="">Choose…</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Job role" htmlFor="er"><select id="er" className="inp" value={v.role_id} onChange={e => setV({ ...v, role_id: e.target.value })}><option value="">Choose a published role…</option>{(roles.data || []).filter(r => !v.department_id || r.department_id === v.department_id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
          <Field label="…or type the role title" htmlFor="ert" hint="Not listed? It is matched or sent to role resolution, so the person is never lost."><input id="ert" className="inp" disabled={!!v.role_id} value={v.role_title || ""} onChange={e => setV({ ...v, role_title: e.target.value })} placeholder="For example: Sr. Reporting Analyst" /></Field>
          <Field label="Reporting manager"><PersonPicker value={mgr} onChange={setMgr} /></Field>
          <Field label="Login password (optional)" htmlFor="elp" hint="Gives this person a login with their email."><input id="elp" type="password" className="inp" value={v.login_password || ""} onChange={e => setV({ ...v, login_password: e.target.value })} /></Field>
        </div>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
