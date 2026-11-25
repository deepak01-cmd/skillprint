"use client";
import Link from "next/link";
import { useState } from "react";
import { Archive, Briefcase, Building2, GraduationCap, Layers, Pencil, Plus, RotateCcw, ShieldCheck, Upload, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Avatar, Button, Card, ErrorBox, Field, Loading, Modal, PageHeader, Pill, SearchInput, Stat, cx, useToast } from "@/components/ui";
import { ImportDialog, useUploadParam } from "@/components/ImportDialog";

export default function Org() {
  const s = useSession(); const toast = useToast();
  const { data, error, loading, reload } = useApi<any>("/org");
  const [dept, setDept] = useState<any>(null); const [fam, setFam] = useState(false); const [up, setUp] = useState(false); useUploadParam(setUp);
  const [v, setV] = useState<any>({}); const [err, setErr] = useState<any>(null); const [q, setQ] = useState(""); const [showArchived, setShowArchived] = useState(false);
  const manage = can(s, "org:manage");
  if (loading) return <Loading rows={8} />;
  if (error) return <ErrorBox error={error} />;
  const p = data.archive_policy;
  const setPolicy = async (k: string, val: boolean) => { const r = await api("PATCH", "/org/settings", { archive_policy: { ...p, [k]: val } }); r.ok ? toast("Approval policy updated") : toast(r.error!.message, "bad"); reload(); };
  const depts = data.departments.filter((d: any) => (showArchived || d.status === "Active") && (!q || d.name.toLowerCase().includes(q.toLowerCase())));
  const active = data.departments.filter((d: any) => d.status === "Active");
  const totalPeople = active.reduce((a: number, d: any) => a + Number(d.employees || 0), 0);
  const totalRoles = active.reduce((a: number, d: any) => a + Number(d.roles || 0), 0);
  const archivedCount = data.departments.length - active.length;
  return (
    <>
      <PageHeader eyebrow="Organisation" title={data.org.name}
        sub={<span className="flex flex-wrap items-center gap-2"><Pill tone="Submitted">{data.org.industry}</Pill>{data.org.domain && <span>{data.org.domain}</span>}<span className="text-ink-3">· Tenant {data.org.id}</span></span>}
        actions={manage && <><Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload departments</Button><Button onClick={() => { setV({ name: "" }); setErr(null); setFam(true); }}><Layers className="h-4 w-4" />New job family</Button>
          <Button variant="primary" onClick={() => { setV({ name: "", parent_id: "" }); setErr(null); setDept({}); }}><Plus className="h-4 w-4" />New department</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat icon={<Building2 className="h-5 w-5" />} label="Departments" value={active.length} sub={archivedCount ? `${archivedCount} archived` : "All active"} />
        <Stat icon={<Briefcase className="h-5 w-5" />} label="Roles" value={totalRoles} sub={`${data.families.length} job families`} />
        <Stat icon={<Users className="h-5 w-5" />} label="People" value={totalPeople.toLocaleString()} sub="Active employees" />
        <Stat icon={<GraduationCap className="h-5 w-5" />} label="Career levels" value={data.levels.length} sub={data.levels.map((l: any) => l.code).join(" · ")} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold">Departments</h2>
            <SearchInput className="ml-auto w-full max-w-[240px]" value={q} onChange={setQ} placeholder="Find a department" />
            {archivedCount > 0 && <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived</label>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {depts.map((d: any) => (
              <div key={d.id} className={cx("anim-in group flex flex-col rounded-xl border border-line bg-card p-5 shadow-card transition-shadow hover:shadow-md", d.status === "Archived" && "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Building2 className="h-5 w-5" /></span>
                    <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{d.name}</div><div className="text-xs text-ink-3">{d.parent_name ? `Part of ${d.parent_name}` : "Top level"} · {d.id}</div></div>
                  </div>
                  {d.status !== "Active" && <Pill>{d.status}</Pill>}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Link href={`/roles?department_id=${d.id}`} className="rounded-lg bg-sunken px-3 py-2 hover:bg-accent-soft"><div className="text-xs text-ink-3">Roles</div><div className="num text-lg font-bold">{d.roles}</div></Link>
                  <Link href={`/employees?department_id=${d.id}`} className="rounded-lg bg-sunken px-3 py-2 hover:bg-accent-soft"><div className="text-xs text-ink-3">People</div><div className="num text-lg font-bold">{d.employees}</div></Link>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-2 pt-3">
                  <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2">{d.heads ? <><Avatar name={String(d.heads).split(",")[0]} size={22} /><span className="truncate">{d.heads}</span></> : <span className="text-ink-3">No department head</span>}</div>
                  {manage && <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setV({ name: d.name, parent_id: d.parent_id || "" }); setErr(null); setDept(d); }} aria-label={`Edit ${d.name}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { const r = await api("PATCH", `/departments/${d.id}`, { status: d.status === "Active" ? "Archived" : "Active" }); r.ok ? toast(d.status === "Active" ? "Department archived; history kept" : "Department restored") : toast(r.error!.message, "bad"); reload(); }}>
                      {d.status === "Active" ? <><Archive className="h-3.5 w-3.5" />Archive</> : <><RotateCcw className="h-3.5 w-3.5" />Restore</>}</Button></div>}
                </div>
              </div>))}
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <Card title="Job families" icon={<Layers className="h-4 w-4" />} sub={`${data.families.length} families`}>
            <div className="flex flex-wrap gap-2">{data.families.map((f: any) => <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-1 text-[12.5px]">{f.name}<span className="num rounded bg-card px-1 text-[11px] text-ink-3 ring-1 ring-line">{f.roles}</span></span>)}</div>
          </Card>
          <Card title="Career levels" icon={<GraduationCap className="h-4 w-4" />} sub={manage ? "Click a name to rename it" : undefined}>
            <ol className="flex flex-col gap-2">{data.levels.map((l: any, i: number) => <li key={l.id} className="flex items-center gap-3">
              <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent">{l.code}</span>
              {manage ? <input aria-label={`Name for ${l.code}`} className="inp py-1" defaultValue={l.name} onBlur={async e => { if (e.target.value !== l.name) { const r = await api("PATCH", `/career-levels/${l.id}`, { name: e.target.value }); r.ok ? toast("Level renamed") : toast(r.error!.message, "bad"); } }} /> : <span className="text-[13px]">{l.name}</span>}
              <span className="flex gap-0.5" aria-hidden>{data.levels.map((_: any, j: number) => <i key={j} className={cx("h-1.5 w-1.5 rounded-full", j <= i ? "bg-accent" : "bg-line")} />)}</span></li>)}</ol>
          </Card>
          <Card title="Approval rules for archiving" icon={<ShieldCheck className="h-4 w-4" />}>
            <div className="flex flex-col divide-y divide-line-2">
              {[["mandatory", "Mandatory skills need approval"], ["openAssessments", "Skills with open assessments need approval"], ["all", "Every archive and restore needs approval"]].map(([k, l]) => (
                <label key={k} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-[13px]">
                  <span>{l}</span>
                  <span className="relative inline-flex"><input type="checkbox" className="peer sr-only" checked={!!p[k]} disabled={!manage} onChange={e => setPolicy(k, e.target.checked)} />
                    <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-disabled:opacity-50" /><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform peer-checked:translate-x-4" /></span>
                </label>))}
            </div>
          </Card>
        </div>
      </div>
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["departments"]} onDone={() => reload()} title="Upload departments" />
      <Modal open={!!dept} onClose={() => setDept(null)} title={dept?.id ? `Edit ${dept.name}` : "New department"} footer={<><Button onClick={() => setDept(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
        const r = dept.id ? await api("PATCH", `/departments/${dept.id}`, { name: v.name, parent_id: v.parent_id || null }) : await api("POST", "/departments", { name: v.name, parent_id: v.parent_id || null });
        if (!r.ok) return setErr(r.error); setDept(null); toast("Saved"); reload(); }}>Save</Button></>}>
        <Field label="Name" htmlFor="dn"><input id="dn" className="inp" value={v.name || ""} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Parent department" htmlFor="dp"><select id="dp" className="inp" value={v.parent_id || ""} onChange={e => setV({ ...v, parent_id: e.target.value })}><option value="">None (top level)</option>{active.filter((d: any) => d.id !== dept?.id).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <ErrorBox error={err} />
      </Modal>
      <Modal open={fam} onClose={() => setFam(false)} title="New job family" footer={<><Button onClick={() => setFam(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/job-families", { name: v.name, description: v.description }); if (!r.ok) return setErr(r.error); setFam(false); toast("Job family created"); reload(); }}>Create</Button></>}>
        <Field label="Name" htmlFor="fn"><input id="fn" className="inp" value={v.name || ""} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Description" htmlFor="fd"><input id="fd" className="inp" value={v.description || ""} onChange={e => setV({ ...v, description: e.target.value })} /></Field>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
