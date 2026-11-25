"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pagination, Pill, SearchInput, usePaged, useToast } from "@/components/ui";
import { ImportDialog, useUploadParam } from "@/components/ImportDialog";
import { BookOpen, Plus, Upload } from "lucide-react";

export default function Skills() {
  const s = useSession(); const router = useRouter(); const toast = useToast();
  const [q, setQ] = useState(""); const [incl, setIncl] = useState(false); const [cat, setCat] = useState("");
  const list = useApi<any[]>(`/skills?include_archived=${incl}&include_retired=${incl}`);
  const [up, setUp] = useState(false); useUploadParam(setUp);
  const cats = useApi<string[]>("/skills/categories");
  const [open, setOpen] = useState(false); const [v, setV] = useState<any>({ name: "", definition: "", category: "", aliases: "" });
  const [dups, setDups] = useState<any[] | null>(null); const [opts, setOpts] = useState<string[]>([]); const [err, setErr] = useState<any>(null);
  const requestLib = async (skill_id: string, type: string, text: string) => { const r = await api("POST", "/library-requests", { skill_id, type, text }); if (!r.ok) return setErr(r.error); setOpen(false); toast(r.data.id ? `Request ${r.data.id} sent to the platform administrator` : r.data.note); };
  const platform = s.user.role === "platform_admin";
  const canCreate = platform || can(s, "skills:write");
  const create = async (force = false) => {
    setErr(null);
    const r = await api("POST", "/skills", { ...v, aliases: v.aliases.split(",").map((x: string) => x.trim()).filter(Boolean), force });
    if (r.ok) { setOpen(false); setDups(null); toast(`${r.data.id} ${r.data.name} created`); list.reload(); return; }
    if (r.error?.details?.candidates) { setDups(r.error.details.candidates); setOpts(r.error.details.options || []); }
    setErr(r.error);
  };
  const all = list.data || [];
  const filtered = all.filter(x => (!cat || x.category === cat) && (!q || (x.name + " " + x.id + " " + (x.aliases || []).join(" ")).toLowerCase().includes(q.toLowerCase())));
  const paged = usePaged(filtered, 25);
  const byCat = all.reduce((m: Record<string, number>, x: any) => { m[x.category] = (m[x.category] || 0) + 1; return m; }, {});
  const catList = Object.entries(byCat).sort((a: any, b: any) => b[1] - a[1]);
  return (
    <>
      <PageHeader title={platform ? "Global skill library" : "Skill library"}
        actions={canCreate && <><Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload skills</Button><Button variant="primary" onClick={() => { setV({ name: "", definition: "", category: "", aliases: "" }); setDups(null); setErr(null); setOpen(true); }}><Plus className="h-4 w-4" />{platform ? "New global skill" : "New company skill"}</Button></>} />
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-[136px] lg:self-start">
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Categories</div>
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Categories">
            {[["", all.length] as [string, number], ...catList].map(([c, n]: any) => (
              <button key={c || "all"} onClick={() => setCat(c)} className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${cat === c ? "bg-card font-semibold text-accent shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-card/70"}`}>
                <span className="truncate">{c || "All skills"}</span><span className={`num rounded-full px-1.5 text-[11px] ${cat === c ? "bg-accent-soft" : "bg-sunken text-ink-3"}`}>{n}</span></button>))}
          </nav>
          <label className="mt-4 flex items-start gap-2 px-1 text-[12.5px] text-ink-2"><input type="checkbox" className="mt-0.5" checked={incl} onChange={e => setIncl(e.target.checked)} />Show retired skills{!platform ? " and skills archived in every role" : ""}</label>
        </aside>
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3.5">
            <SearchInput className="w-full max-w-sm" value={q} onChange={setQ} placeholder="Search name, alias or ID" />
            <span className="ml-auto text-xs text-ink-3"><b className="num text-ink-2">{filtered.length}</b> of {all.length} skills</span>
          </div>
          {list.loading && !list.data ? <Loading rows={8} /> : !filtered.length ? <Empty icon={<BookOpen className="h-5 w-5" />} action={canCreate && <Button size="sm" onClick={() => setUp(true)}><Upload className="h-3.5 w-3.5" />Upload skills</Button>}>No skills match{q ? ` “${q}”` : ""}.</Empty> : <>
            <div className="overflow-x-auto"><table className="t">
              <thead><tr><th>Skill</th><th>Category</th><th className="text-right">Roles</th><th>Scope</th><th>Status</th></tr></thead>
              <tbody>{paged.items.map(x => (
                <tr key={x.id} className={`click ${x.status === "Archived (all roles)" ? "opacity-60" : ""}`} onClick={() => router.push(`/skills/${x.id}`)}>
                  <td className="max-w-[520px]"><div className="flex items-baseline gap-2"><Link href={`/skills/${x.id}`} className="font-semibold hover:text-accent">{x.name}</Link><span className="font-mono text-[11px] text-ink-3">{x.id}</span></div>
                    <div className="line-clamp-1 text-xs text-ink-3">{x.definition}</div>
                    {(x.aliases || []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{x.aliases.slice(0, 4).map((a: string) => <span key={a} className="rounded bg-sunken px-1.5 text-[11px] text-ink-2">{a}</span>)}{x.aliases.length > 4 && <span className="text-[11px] text-ink-3">+{x.aliases.length - 4}</span>}</div>}</td>
                  <td className="whitespace-nowrap text-ink-2">{x.category}</td>
                  <td className="num text-right">{x.roles_mapped || <span className="text-ink-3">0</span>}{x.archived_mappings ? <span className="text-xs text-ink-3"> +{x.archived_mappings}</span> : null}</td>
                  <td><Pill tone={x.global ? "Current" : "Submitted"}>{x.global ? "Global" : "Company"}</Pill></td>
                  <td className="whitespace-nowrap">{x.status === "Active" ? <Pill>Active</Pill> : x.status === "Not mapped" ? <span className="text-xs text-ink-3">Not used yet</span> : <Pill tone="Archived">{x.status === "Retired" ? "Retired" : "Archived"}</Pill>}{x.review_date && String(x.review_date).slice(0, 10) <= new Date().toISOString().slice(0, 10) && <Pill tone="In Review" className="ml-1">Review due</Pill>}</td>
                </tr>))}</tbody></table></div>
            <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} /></>}
        </Card>
      </div>
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["skills"]} onDone={() => list.reload()} title={platform ? "Upload global skills" : "Upload skills"} />
      <Modal open={open} onClose={() => setOpen(false)} title={platform ? "New global skill" : "New company skill"} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button>{dups && opts.includes("create_different") && <Button onClick={() => create(true)}>Create a different skill</Button>}<Button variant="primary" onClick={() => create(false)}>Create</Button></>}>
        <Field label="Name" htmlFor="sn"><input id="sn" className="inp" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Definition" htmlFor="sd"><textarea id="sd" className="inp" rows={3} value={v.definition} onChange={e => setV({ ...v, definition: e.target.value })} /></Field>
        <Field label="Category" htmlFor="sc"><input id="sc" className="inp" list="cats" value={v.category} onChange={e => setV({ ...v, category: e.target.value })} /><datalist id="cats">{(cats.data || ["Technical", "Functional", "Behavioural", "Leadership", "Digital", "Domain Knowledge", "Regulatory and Compliance", "Emerging Skills"]).map(c => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Aliases (comma separated)" htmlFor="sa"><input id="sa" className="inp" value={v.aliases} onChange={e => setV({ ...v, aliases: e.target.value })} /></Field>
        {dups && dups.length > 0 && <Note tone="warn"><b>This skill may already exist.</b> No duplicate is created unless you choose to.
          <ul className="mt-2 flex flex-col gap-2">{dups.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2"><span><b>{d.name}</b> <span className="text-ink-3">{d.id} · {d.category}{d.exact ? " · exact match" : ""}</span></span>
            <Link className="rounded border border-line bg-card px-2 py-0.5 text-xs" href={`/skills/${d.id}`}>Use existing</Link>
            {opts.includes("add_as_alias") && <Button size="sm" onClick={() => requestLib(d.id, "alias", v.name)}>Add “{v.name}” as alias</Button>}
            {!platform && <Button size="sm" onClick={() => requestLib(d.id, "update", `Requested change for ${d.name}: ${v.name}. ${v.definition}`)}>Request library update</Button>}</li>)}</ul></Note>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
