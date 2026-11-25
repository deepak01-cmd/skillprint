"use client";
/* Platform administrator: reference data releases (O*NET and other publishers). Load files, check what was recognised, publish. */
import { useEffect, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, FileUp, Library, Plus, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { api, upload, useApi } from "@/lib/api";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pill, Stat, fmtDate, useConfirm, useToast } from "@/components/ui";

const fmt = (n: any) => Number(n || 0).toLocaleString();
const STATUS_TONE: Record<string, string> = { Active: "Published", Draft: "Draft", Loading: "Pending", Retired: "Archived" };

export default function ReferenceData() {
  const list = useApi<any>("/reference/sources");
  const [sel, setSel] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const loading = list.data?.loading;
  useEffect(() => { if (!loading) return; const t = setInterval(() => list.reload(), 2500); return () => clearInterval(t); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = list.data?.sources || [];
  useEffect(() => { if (!sel && sources.length) setSel(sources[0].id); }, [sources, sel]);
  return (
    <>
      <PageHeader title="Reference data" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New release</Button>} />
      <ErrorBox error={list.error} />
      {loading && <div className="mb-4"><Note>Loading files into {loading.source}: {loading.progress}</Note></div>}
      {list.loading ? <Loading /> : !sources.length ? <Card><Empty icon={<Library className="h-6 w-6" />} action={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New release</Button>}>No reference data yet. Create a release, then upload its files.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card pad={false} title="Releases">
            <ul className="divide-y divide-line">{sources.map((s: any) => (
              <li key={s.id}><button onClick={() => setSel(s.id)} className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-sunken/60 ${sel === s.id ? "bg-accent-soft/50" : ""}`}>
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{s.publisher} · {s.name}</b><Pill tone={STATUS_TONE[s.status]}>{s.status === "Active" ? "Published" : s.status}</Pill></span>
                <span className="text-[12px] text-ink-3">{s.version ? `Version ${s.version} · ` : ""}{fmt(s.counts?.occupations)} occupations · {fmt(s.counts?.ratings)} ratings · {s.files} files</span>
              </button></li>))}</ul>
          </Card>
          {sel && <SourceDetail id={sel} onChange={list.reload} onDeleted={() => { setSel(null); list.reload(); }} busy={!!loading} />}
        </div>)}
      <SourceForm open={creating} onClose={() => setCreating(false)} onSaved={id => { setCreating(false); setSel(id); list.reload(); }} onetAttribution={list.data?.onet_attribution} />
    </>
  );
}

function SourceForm({ open, onClose, onSaved, initial, onetAttribution }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; initial?: any; onetAttribution?: string }) {
  const blank = { publisher: "", name: "", version: "", released: "", licence: "", attribution: "", url: "" };
  const [f, setF] = useState<any>(blank); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(initial ? { ...blank, ...Object.fromEntries(Object.entries(initial).filter(([k]) => k in blank).map(([k, v]) => [k, v ?? ""])), released: initial.released ? String(initial.released).slice(0, 10) : "" } : blank); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const onet = () => setF({ ...f, publisher: "O*NET", name: "O*NET Database", licence: "CC BY 4.0 (Creative Commons Attribution 4.0 International)", url: "https://www.onetcenter.org/database.html", attribution: (onetAttribution || "").replace("O*NET Database", `O*NET ${f.version || ""} Database`.replace("  ", " ")) });
  const save = async () => {
    setBusy(true); setErr(null);
    const r = initial ? await api("PATCH", `/reference/sources/${initial.id}`, f) : await api("POST", "/reference/sources", f);
    setBusy(false); if (!r.ok) return setErr(r.error); onSaved(initial?.id || r.data.id);
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Release details" : "New reference data release"} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.publisher.trim() || !f.name.trim()} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        {!initial && <div><Button size="sm" onClick={onet}>Fill in for O*NET</Button></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Publisher" htmlFor="rp"><input id="rp" className="inp" value={f.publisher} onChange={set("publisher")} maxLength={120} placeholder="O*NET, ESCO, Lightcast…" /></Field>
          <Field label="Dataset" htmlFor="rn"><input id="rn" className="inp" value={f.name} onChange={set("name")} maxLength={160} placeholder="O*NET Database" /></Field>
          <Field label="Version" htmlFor="rv"><input id="rv" className="inp" value={f.version} onChange={set("version")} maxLength={60} placeholder="31.0" /></Field>
          <Field label="Release date" htmlFor="rd"><input id="rd" type="date" className="inp" value={f.released} onChange={set("released")} /></Field>
        </div>
        <Field label="Licence" htmlFor="rl" hint="Required before publishing. Record the licence that allows this use."><input id="rl" className="inp" value={f.licence} onChange={set("licence")} maxLength={400} placeholder="CC BY 4.0" /></Field>
        <Field label="Attribution shown with the data" htmlFor="ra" hint="Required before publishing. Use the wording the publisher asks for."><textarea id="ra" className="inp min-h-[96px]" value={f.attribution} onChange={set("attribution")} maxLength={2000} /></Field>
        <Field label="Source web page" htmlFor="ru"><input id="ru" className="inp" value={f.url} onChange={set("url")} placeholder="https://…" /></Field>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function SourceDetail({ id, onChange, onDeleted, busy }: { id: string; onChange: () => void; onDeleted: () => void; busy: boolean }) {
  const d = useApi<any>(`/reference/sources/${id}`); const toast = useToast(); const confirm = useConfirm();
  const [editing, setEditing] = useState(false); const [err, setErr] = useState<any>(null); const [sending, setSending] = useState(false); const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (d.data?.status !== "Loading") return; const t = setInterval(() => d.reload(), 2500); return () => clearInterval(t); }, [d.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { d.reload(); onChange(); };
  const send = async (files: File[]) => {
    if (!files.length) return; setSending(true); setErr(null);
    const r = await upload(`/reference/sources/${id}/files`, { files });
    setSending(false); if (!r.ok) return setErr(r.error);
    toast(`Loading ${r.data.files.length} file${r.data.files.length > 1 ? "s" : ""}${r.data.skipped?.length ? ` (${r.data.skipped.length} skipped)` : ""}`); refresh();
  };
  const act = async (path: string, msg: string, method = "POST") => { setErr(null); const r = await api(method as any, path); if (!r.ok) return setErr(r.error); toast(msg); method === "DELETE" ? onDeleted() : refresh(); };
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} />;
  const s = d.data; const c = s.counts || {};
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title={<span>{s.publisher} · {s.name} {s.version && <span className="font-normal text-ink-3">· {s.version}</span>}</span>}
        actions={<div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>Details</Button>
          {(s.status === "Draft" || s.status === "Retired") && <Button size="sm" variant="primary" disabled={busy} onClick={async () => { if (await confirm({ title: s.status === "Retired" ? "Put this release back?" : "Publish this release?", message: "It becomes the reference data every organisation sees. The current release of the same dataset is retired (it can be put back).", confirmLabel: s.status === "Retired" ? "Put back" : "Publish" })) act(`/reference/sources/${id}/publish`, "Published"); }}>{s.status === "Retired" ? <><RotateCcw className="h-4 w-4" />Put back</> : <><CheckCircle2 className="h-4 w-4" />Publish</>}</Button>}
          {s.status === "Active" && <Button size="sm" onClick={async () => { if (await confirm({ title: "Retire this release?", message: "Roles and drafts stop using it. It can be put back.", confirmLabel: "Retire" })) act(`/reference/sources/${id}/retire`, "Retired"); }}><Archive className="h-4 w-4" />Retire</Button>}
          {s.status === "Draft" && <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: "Delete this draft release?", message: "Its loaded rows are removed.", confirmLabel: "Delete", danger: true })) act(`/reference/sources/${id}`, "Deleted", "DELETE"); }}><Trash2 className="h-4 w-4" /></Button>}
        </div>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-2">
            <span>Status <b className="text-ink">{s.status === "Active" ? `Published ${fmtDate(s.published_at)}` : s.status}</b></span>
            <span>Licence <b className={s.licence ? "text-ink" : "text-bad"}>{s.licence || "not recorded"}</b></span>
            {s.url && <a className="text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer noopener">Source page</a>}
          </div>
          {s.attribution ? <p className="rounded-lg bg-sunken/60 p-3 text-[12px] text-ink-2">{s.attribution}</p> : <Note tone="warn">No attribution line yet. Publishing needs the licence and the attribution the publisher asks for.</Note>}
          {s.status === "Loading" && <Note>Loading: {s.loading?.progress || "working"}…</Note>}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Occupations" value={fmt(c.occupations)} sub={`${fmt(c.titles)} job titles`} />
        <Stat label="Descriptors" value={fmt(c.descriptors)} sub={`${fmt(c.skills_linked)} matched to the library`} />
        <Stat label="Ratings" value={fmt(c.ratings)} sub="importance, level, impact, context" />
        <Stat label="Outlook signals" value={fmt((c.outlook_flags || 0) + (c.technologies || 0))} sub={`${fmt(c.outlook_flags)} Bright Outlook · ${fmt(c.technologies)} technologies`} />
      </div>
      {s.status === "Draft" && <Card title="Add files">
        <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); send(Array.from(e.dataTransfer.files)); }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center ${drag ? "border-accent bg-accent-soft/40" : "border-line"}`}>
          <UploadCloud className="h-8 w-8 text-accent" />
          <div className="text-[14px] font-medium">Drop files here, in any order</div>
          <div className="text-[12px] text-ink-3">.xlsx, .csv, tab-separated .txt, or a .zip of them · the format of each file is recognised from its columns</div>
          <input ref={input} type="file" multiple accept=".xlsx,.csv,.txt,.tsv,.zip" className="hidden" onChange={e => { send(Array.from(e.target.files || [])); e.target.value = ""; }} />
          <Button variant="primary" loading={sending} disabled={busy} onClick={() => input.current?.click()}><FileUp className="h-4 w-4" />Choose files</Button>
        </div>
      </Card>}
      <ErrorBox error={err} />
      <Card title="Files" pad={false}>
        {(s.files || []).length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>File</th><th>Recognised as</th><th>Rows</th><th>Loaded</th><th>Notes</th></tr></thead>
          <tbody>{s.files.map((f: any, i: number) => <tr key={i}><td className="font-medium">{f.file}</td><td>{f.label ? f.label : <Pill tone="Declining">Not recognised</Pill>}</td><td className="num">{fmt(f.rows)}</td><td className="num">{fmt(f.loaded)}</td><td className="max-w-md text-[12px] text-ink-3">{(f.warnings || []).join(" ")}</td></tr>)}</tbody></table></div>
          : <Empty>No files loaded yet.</Empty>}
      </Card>
      {(s.descriptors_by_kind || []).length > 0 && <Card title="Matched to the skill library" actions={s.unmatched?.length ? <a href={`/api/v1/reference/sources/${id}/unmatched.csv`}><Button size="sm"><Download className="h-4 w-4" />Not matched (CSV)</Button></a> : null}>
        <div className="flex flex-wrap gap-2 text-[13px]">{s.descriptors_by_kind.map((k: any) => <span key={k.kind} className="rounded-lg bg-sunken/60 px-3 py-1.5"><b className="capitalize">{k.kind.replace("_", " ")}</b> <span className="num text-ink-3">{fmt(k.linked)} of {fmt(k.n)} matched</span></span>)}</div>
        <p className="mt-2 text-[12px] text-ink-3">Descriptors not matched stay in the reference data and are shown on roles. To add one to the library, propose it in Library approvals.</p>
      </Card>}
      {s.previous && <Card title="Compared with the previous release">
        <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">{["occupations", "titles", "ratings", "technologies"].map(k => { const a = Number(s.previous.counts?.[k] || 0), b = Number(c[k] || 0); return <div key={k}><div className="text-[12px] capitalize text-ink-3">{k}</div><b className="num">{fmt(b)}</b> <span className={`num text-[12px] ${b >= a ? "text-good" : "text-bad"}`}>{b - a >= 0 ? "+" : ""}{fmt(b - a)}</span></div>; })}</div>
      </Card>}
      <SourceForm open={editing} onClose={() => setEditing(false)} initial={s} onSaved={() => { setEditing(false); refresh(); }} />
    </div>
  );
}
