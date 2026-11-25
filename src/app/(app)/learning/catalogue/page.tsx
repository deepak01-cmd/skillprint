"use client";
import { useEffect, useState } from "react";
import { ExternalLink, GraduationCap, Library, Plus } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession, can } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, Pill, SearchInput, Stat, Tabs, usePaged, useToast } from "@/components/ui";

const TYPES = ["Course", "Video", "Book", "Article", "Certification", "Project", "Mentoring", "Workshop", "Internal"];
function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

function SkillPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState(value?.name || ""); const dq = useDebounced(q);
  const r = useApi<any[]>(dq.length >= 2 && dq !== value?.name ? `/skills?q=${encodeURIComponent(dq)}` : null);
  return (
    <div className="relative">
      <input className="inp" value={q} onChange={e => { setQ(e.target.value); onChange(null); }} placeholder="Type a skill…" aria-label="Skill" />
      {!value && (r.data || []).length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-card p-1 shadow-pop">
        {(r.data || []).slice(0, 12).map(s => <li key={s.id}><button type="button" className="w-full rounded-lg px-3 py-1.5 text-left text-[13px] hover:bg-sunken" onClick={() => { onChange({ id: s.id, name: s.name }); setQ(s.name); }}>{s.name} <span className="text-ink-3">· {s.category}</span></button></li>)}
      </ul>}
    </div>
  );
}

export default function Catalogue() {
  const s = useSession(); const toast = useToast();
  const [scope, setScope] = useState("company"); const [q, setQ] = useState(""); const dq = useDebounced(q);
  const list = useApi<any[]>(`/learning/resources?scope=${scope}&q=${encodeURIComponent(dq)}`);
  const all = useApi<any[]>(`/learning/resources`);
  const paged = usePaged(list.data || [], 20);
  const [open, setOpen] = useState(false); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  const blank = { skill: null as any, title: "", provider: "", type: "Course", url: "", level_from: 0, level_to: 5, hours: "", cost: "Company paid" };
  const [f, setF] = useState(blank);
  const write = can(s, "skills:write");
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api("POST", "/learning/resources", { skill_id: f.skill?.id, title: f.title, provider: f.provider || null, type: f.type, url: f.url || null, level_from: f.level_from, level_to: f.level_to, hours: f.hours ? Number(f.hours) : null, cost: f.cost });
    setBusy(false); if (!r.ok) return setErr(r.error);
    toast("Added to the catalogue"); setOpen(false); setF(blank); list.reload(); all.reload();
  };
  const toggle = async (x: any) => { const r = await api("PATCH", `/learning/resources/${x.id}`, { status: x.status === "Active" ? "Retired" : "Active" }); r.ok ? list.reload() : toast(r.error!.message, "bad"); };
  const company = (all.data || []).filter(x => x.org_id).length;
  return (
    <>
      <PageHeader title="Learning catalogue" actions={write && <Button variant="primary" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" />Add learning</Button>} />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-3">
        <Stat icon={<Library />} label="Company learning" value={company} />
        <Stat icon={<GraduationCap />} label="Shared catalogue" value={(all.data || []).length - company} />
        <Stat icon={<GraduationCap />} label="Skills covered" value={new Set((all.data || []).map(x => x.skill_id)).size} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onChange={setScope} tabs={[{ id: "company", label: "Your company" }, { id: "catalogue", label: "Shared catalogue" }]} />
        <SearchInput className="mb-5 w-full max-w-xs" value={q} onChange={setQ} placeholder="Search title, skill, provider" />
      </div>
      <Card pad={false}>
        {list.loading ? <Loading /> : paged.items.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Learning</th><th>Skill</th><th>Format</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Levels covered (from → to)</th><th>Hours</th><th>Cost</th>{write && scope === "company" && <th></th>}</tr></thead>
          <tbody>{paged.items.map(x => <tr key={x.id} className={x.status === "Retired" ? "opacity-50" : ""}>
            <td><div className="font-semibold">{x.url ? <a className="hover:text-accent" href={x.url} target="_blank" rel="noopener noreferrer">{x.title} <ExternalLink className="inline h-3 w-3" /></a> : x.title}</div><div className="text-[12px] text-ink-3">{x.provider || "—"}</div></td>
            <td>{x.skill_name}</td><td><Pill tone="Draft">{x.type}</Pill></td><td className="num">{x.level_from}–{x.level_to}</td><td className="num">{x.hours ?? "—"}</td><td><Pill tone={x.cost}>{x.cost}</Pill></td>
            {write && scope === "company" && <td className="text-right"><Button size="sm" onClick={() => toggle(x)}>{x.status === "Active" ? "Retire" : "Restore"}</Button></td>}</tr>)}</tbody></table></div>
          : <Empty icon={<Library />} action={write && scope === "company" && <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />Add the first one</Button>}>{scope === "company" ? "No company learning yet." : "Nothing found."}</Empty>}
        <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add learning" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.skill || f.title.trim().length < 3} onClick={save}>Add</Button></>}>
        <Field label="Skill"><SkillPicker value={f.skill} onChange={v => setF({ ...f, skill: v })} /></Field>
        <Field label="Title" htmlFor="lt"><input id="lt" className="inp" value={f.title} maxLength={200} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider" htmlFor="lp"><input id="lp" className="inp" value={f.provider} maxLength={120} onChange={e => setF({ ...f, provider: e.target.value })} /></Field>
          <Field label="Type" htmlFor="ly"><select id="ly" className="inp" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <Field label="Link" htmlFor="lu"><input id="lu" className="inp" type="url" placeholder="https://" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="From level" htmlFor="l1"><select id="l1" className="inp" value={f.level_from} onChange={e => setF({ ...f, level_from: +e.target.value })}>{[0, 1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></Field>
          <Field label="To level" htmlFor="l2"><select id="l2" className="inp" value={f.level_to} onChange={e => setF({ ...f, level_to: +e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Hours" htmlFor="lh"><input id="lh" className="inp" type="number" min={0.5} step={0.5} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} /></Field>
          <Field label="Cost" htmlFor="lc"><select id="lc" className="inp" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })}>{["Company paid", "Free", "Paid"].map(t => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
