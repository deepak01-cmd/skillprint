"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, scope, useSession } from "@/components/session";
import { Bar, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pagination, Pill, SearchInput, Tabs, usePaged, useToast } from "@/components/ui";
import { ImportDialog, useUploadParam } from "@/components/ImportDialog";
import { titleMatches } from "@/lib/titleMatch";
import { Briefcase, FileText, Plus, Upload } from "lucide-react";

export default function Roles() {
  const s = useSession(); const router = useRouter(); const toast = useToast();
  const { data, error, loading, reload } = useApi<any[]>("/roles");
  const org = useApi<any>("/org");
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [dept, setDept] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("department_id") || "" : "");
  const [creating, setCreating] = useState(false); const [jd, setJd] = useState(false); const [up, setUp] = useState(false); useUploadParam(setUp);
  const [form, setForm] = useState<any>({ title: "", department_id: "", job_family_id: "", career_level_id: "", career_track: "Individual Contributor", summary: "", responsibilities: "", outcomes: "", experience: "", education: "" });
  const [suggested, setSuggested] = useState<any[]>([]); const [pick, setPick] = useState<Set<string>>(new Set());
  const [match, setMatch] = useState<any>(null);
  const [jdText, setJdText] = useState(""); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  const canWrite = can(s, "roles:write");
  const myDepts = useMemo(() => (org.data?.departments || []).filter((d: any) => d.status === "Active" && (scope(s, "roles:write") === "org" || d.id === s.user.department_id)), [org.data, s]);

  // spelling variants count as the same: "dot net", "dotnet" and ".NET" all find ".NET Developer"; seniority words are ignored
  // same role at the same level only: "Backend Lead" does not list "Backend Developer" (see lib/titleMatch)
  const rows = (data || []).filter(r => (!q || r.id.toLowerCase() === q.trim().toLowerCase() || [r.title, ...(r.alt_titles || [])].some((t: string) => titleMatches(q, t))) && (!status || r.status === status) && (!dept || r.department_id === dept));
  const parse = async () => {
    setBusy(true); setErr(null);
    const r = await api("POST", "/roles/parse-description", { text: jdText });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setForm((f: any) => ({ ...f, title: r.data.title || f.title, responsibilities: r.data.responsibilities.join("\n"), outcomes: r.data.outcomes.join("\n"), experience: r.data.experience || "", education: r.data.education || "" }));
    setSuggested(r.data.suggested_skills); setPick(new Set(r.data.suggested_skills.map((x: any) => x.skill_id))); setMatch(r.data.role_match);
    setJd(false); setCreating(true);
  };
  const create = async () => {
    setBusy(true); setErr(null);
    const body = { ...form, job_family_id: form.job_family_id || null, career_level_id: form.career_level_id || null,
      responsibilities: form.responsibilities.split("\n").map((x: string) => x.trim()).filter(Boolean), outcomes: form.outcomes.split("\n").map((x: string) => x.trim()).filter(Boolean),
      experience: form.experience || null, education: form.education || null };
    const r = await api("POST", "/roles", body);
    if (!r.ok) { setBusy(false); return setErr(r.error); }
    for (const sid of pick) await api("POST", `/roles/${r.data.id}/skills`, { skill_id: sid, required_level: 3, requirement_type: "Mandatory", importance: "Medium", explanation: "Suggested from the job description" });
    setBusy(false); toast(`${r.data.id} created as a draft`); router.push(`/roles/${r.data.id}`);
  };

  const counts = (data || []).reduce((m: Record<string, number>, r: any) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const paged = usePaged(rows, 25);
  const deptScoped = scope(s, "roles:write") === "dept";
  const myDept = (org.data?.departments || []).find((d: any) => d.id === s.user.department_id);
  return (
    <>
      <PageHeader title="Job roles"
        actions={canWrite && <><Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload</Button><Button variant="primary" onClick={() => { setErr(null); setSuggested([]); setMatch(null); setCreating(true); }}><Plus className="h-4 w-4" />New role</Button></>} />
      <ErrorBox error={error} />
      <Tabs value={status} onChange={setStatus} tabs={[{ id: "", label: "All", count: (data || []).length }, ...["Published", "Draft", "In Review", "Archived"].filter(x => counts[x]).map(x => ({ id: x, label: x, count: counts[x] }))]} />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3.5">
          <SearchInput className="w-full max-w-xs" value={q} onChange={setQ} placeholder="Search titles, alternative titles or IDs" />
          <select className="inp w-auto min-w-[200px]" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{(org.data?.departments || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <span className="ml-auto text-xs text-ink-3"><b className="num text-ink-2">{rows.length}</b> roles</span>
        </div>
        {loading ? <Loading rows={8} /> : !rows.length ? <Empty icon={<Briefcase className="h-5 w-5" />} action={<span className="flex flex-wrap justify-center gap-2">{q.trim().length >= 3 && <Link href={`/roles/draft?title=${encodeURIComponent(q.trim())}`}><Button size="sm" variant="primary">Generate framework with AI for “{q.trim()}”</Button></Link>}{canWrite && <Button size="sm" onClick={() => setUp(true)}><Upload className="h-3.5 w-3.5" />Upload roles</Button>}</span>}>No roles match these filters.</Empty> : <>
          <div className="overflow-x-auto"><table className="t">
            <thead><tr><th>Role</th><th>Department</th><th>Family · level</th><th style={{ width: 170 }}>Skills</th><th className="text-right">People</th><th>Status</th></tr></thead>
            <tbody>{paged.items.map(r => (
              <tr key={r.id} className="click" onClick={() => router.push(`/roles/${r.id}`)}>
                <td><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Briefcase className="h-4 w-4" /></span>
                  <div className="min-w-0"><div className="flex items-baseline gap-2"><Link href={`/roles/${r.id}`} className="font-semibold hover:text-accent">{r.title}</Link><span className="font-mono text-[11px] text-ink-3">{r.id}</span></div>
                    {(r.alt_titles || []).length > 0 && <div className="truncate text-xs text-ink-3">Also: {r.alt_titles.slice(0, 3).join(", ")}</div>}</div></div></td>
                <td className="text-ink-2">{r.department_name}</td>
                <td className="text-ink-2">{r.job_family_name || "—"}<div className="text-xs text-ink-3">{r.career_level_name || "No level"}</div></td>
                <td><div className="flex items-center gap-2"><div className="w-20"><Bar value={r.active_skills} max={Math.max(12, ...rows.map((x: any) => x.active_skills))} tone={r.active_skills ? "accent" : "warn"} /></div><span className="num text-[13px]">{r.active_skills}</span>{r.archived_skills ? <span className="text-xs text-ink-3" title="Archived, on request">+{r.archived_skills}</span> : null}</div></td>
                <td className="num text-right">{r.headcount}</td><td><Pill>{r.status}</Pill></td>
              </tr>))}</tbody>
          </table></div>
          <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} /></>}
      </Card>
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["roles", "job_descriptions"]} onDone={() => reload()} title="Upload roles"
        context={deptScoped && myDept ? { default_department: myDept.id, department_name: myDept.name } : undefined} />
      <Modal open={jd} onClose={() => setJd(false)} title="Fill from a job description" footer={<><Button onClick={() => setJd(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={parse}>Extract details</Button></>}>
        <p className="text-[13px] text-ink-2">Paste the text of a job description. The platform extracts the title, responsibilities, outcomes, experience, education and skills that match your library. You review everything before saving.</p>
        <textarea className="inp min-h-[220px] font-mono text-xs" value={jdText} onChange={e => setJdText(e.target.value)} placeholder={"Title: Senior Data Analyst\nResponsibilities:\n- Build Power BI dashboards\n- Write SQL to extract sales data\n..."} aria-label="Job description text" />
        <ErrorBox error={err} />
      </Modal>

      <Modal wide open={creating} onClose={() => setCreating(false)} title="New role" footer={<><Button className="mr-auto" variant="ghost" onClick={() => { setCreating(false); setJd(true); }}><FileText className="h-4 w-4" />Fill from a job description</Button><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={busy || !form.title || !form.department_id} onClick={create}>Create draft role</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Role title" htmlFor="rt"><input id="rt" className="inp" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Department" htmlFor="rd"><select id="rd" className="inp" value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}><option value="">Choose…</option>{myDepts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Job family" htmlFor="rf"><select id="rf" className="inp" value={form.job_family_id} onChange={e => setForm({ ...form, job_family_id: e.target.value })}><option value="">None</option>{(org.data?.families || []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          <Field label="Career level" htmlFor="rl"><select id="rl" className="inp" value={form.career_level_id} onChange={e => setForm({ ...form, career_level_id: e.target.value })}><option value="">None</option>{(org.data?.levels || []).map((l: any) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <Field label="Career track" htmlFor="rk"><select id="rk" className="inp" value={form.career_track} onChange={e => setForm({ ...form, career_track: e.target.value })}>{["Individual Contributor", "Management", "Technical Leadership"].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Required experience" htmlFor="rx"><input id="rx" className="inp" value={form.experience} onChange={e => setForm({ ...form, experience: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="Summary" htmlFor="rs"><textarea id="rs" className="inp" rows={2} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></Field></div>
          <Field label="Responsibilities (one per line)" htmlFor="rr"><textarea id="rr" className="inp" rows={5} value={form.responsibilities} onChange={e => setForm({ ...form, responsibilities: e.target.value })} /></Field>
          <Field label="Expected outcomes (one per line)" htmlFor="ro"><textarea id="ro" className="inp" rows={5} value={form.outcomes} onChange={e => setForm({ ...form, outcomes: e.target.value })} /></Field>
        </div>
        {suggested.length > 0 && (
          <div>
            <h3 className="mb-1 text-[13px] font-semibold">Skills found in the description ({pick.size} selected)</h3>
            <p className="mb-2 text-xs text-ink-3">Each is added as a Draft mapping at level 3, Mandatory, Medium importance. Adjust them on the role page before submitting.</p>
            <div className="flex flex-wrap gap-2">{suggested.map(x => (
              <label key={x.skill_id} className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
                <input type="checkbox" checked={pick.has(x.skill_id)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(x.skill_id) : n.delete(x.skill_id); setPick(n); }} />{x.name} <span className="text-ink-3">“{x.matched_term}”</span>
              </label>))}</div>
          </div>
        )}
        {match?.status === "matched" && <Note tone="warn"><b>This looks like an existing role:</b> <Link className="font-medium text-accent hover:underline" href={`/roles/${match.role.id}`}>{match.role.title}</Link> ({match.method === "exact" ? "same title" : "same title after normalisation"}). Use it instead of creating a duplicate, unless the work is genuinely different.</Note>}
        {match?.status === "unresolved" && match.candidates?.length > 0 && <Note>Similar roles exist: {match.candidates.slice(0, 3).map((c: any) => c.title).join(", ")}. Check them before creating a new one.</Note>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
