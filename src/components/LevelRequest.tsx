"use client";
/* Ask for a new level with evidence; review a request and decide. */
import { useRef, useState } from "react";
import { Check, Download, ExternalLink, FileText, Link2, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Avatar, Button, ErrorBox, Field, LEVEL_NAMES, Loading, Modal, Pill, ago, cx, useConfirm, useToast } from "@/components/ui";

const TYPES = ["Certification", "Project", "Work sample", "Repository", "Assessment result", "Training completion", "Manager feedback"];
const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt";
const kb = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function LevelPicker({ value, onChange, current }: { value: number | null; onChange: (n: number) => void; current: number | null }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map(n => (
        <button type="button" key={n} disabled={n === current} onClick={() => onChange(n)}
          className={cx("flex flex-col items-center rounded-xl border px-1 py-2 text-center transition-all disabled:cursor-not-allowed disabled:opacity-40", value === n ? "border-accent bg-accent-soft text-accent shadow-glow" : "border-line hover:border-accent/50")}>
          <span className="num text-[18px] font-extrabold leading-none">{n}</span><span className="mt-1 text-[10.5px] font-semibold">{LEVEL_NAMES[n]}</span>
          {n === current && <span className="text-[9.5px] text-ink-3">now</span>}
        </button>))}
    </div>
  );
}

/** Evidence editor: files (checked again on the server) and links. */
function EvidenceEditor({ files, setFiles, links, setLinks }: { files: { file: File; title: string; type: string }[]; setFiles: (f: any[]) => void; links: { title: string; url: string; type: string }[]; setLinks: (l: any[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const toast = useToast();
  const add = (list: FileList | null) => {
    const next = [...files];
    for (const f of Array.from(list || [])) {
      if (next.length >= 5) { toast("Up to 5 files", "bad"); break; }
      if (f.size > 5 * 1048576) { toast(`${f.name} is larger than 5 MB`, "bad"); continue; }
      next.push({ file: f, title: f.name.replace(/\.[^.]+$/, ""), type: /cert/i.test(f.name) ? "Certification" : "Work sample" });
    }
    setFiles(next);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }} onClick={() => input.current?.click()} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter") input.current?.click(); }}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line bg-sunken/40 px-4 py-4 text-[13px] hover:border-accent/60">
        <Paperclip className="h-4 w-4 text-accent" /><b className="text-accent">Attach files</b><span className="text-ink-3">· PDF, Word, Excel, PowerPoint, images · 5 MB each</span>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {files.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
          <FileText className="h-4 w-4 shrink-0 text-accent" />
          <input className="inp min-w-[140px] flex-1 py-1" value={f.title} maxLength={300} onChange={e => setFiles(files.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} aria-label="Title" />
          <select className="inp w-auto py-1" value={f.type} onChange={e => setFiles(files.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} aria-label="Type">{TYPES.map(t => <option key={t}>{t}</option>)}</select>
          <span className="text-[11.5px] text-ink-3">{kb(f.file.size)}</span>
          <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded-lg p-1 text-ink-3 hover:text-bad" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
        </div>))}
      {links.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
          <Link2 className="h-4 w-4 shrink-0 text-accent" />
          <input className="inp min-w-[120px] flex-1 py-1" placeholder="Title" value={l.title} maxLength={300} onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
          <input className="inp min-w-[160px] flex-[1.4] py-1" placeholder="https://" type="url" value={l.url} onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
          <select className="inp w-auto py-1" value={l.type} onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} aria-label="Type">{TYPES.map(t => <option key={t}>{t}</option>)}</select>
          <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="rounded-lg p-1 text-ink-3 hover:text-bad" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
        </div>))}
      {links.length < 10 && <button type="button" onClick={() => setLinks([...links, { title: "", url: "", type: "Project" }])} className="self-start text-[12.5px] font-semibold text-accent hover:underline"><Plus className="mr-1 inline h-3.5 w-3.5" />Add a link</button>}
    </div>
  );
}
const toForm = (files: { file: File; title: string; type: string }[], links: any[]) => {
  const fields: Record<string, any> = { links: JSON.stringify(links.filter(l => l.url.trim()).map(l => ({ ...l, title: l.title.trim() || l.url }))), file_titles: JSON.stringify(files.map(f => f.title)), file_types: JSON.stringify(files.map(f => f.type)) };
  return fields;
};
async function send(path: string, fields: Record<string, any>, files: File[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const f of files) fd.append("file", f);
  const res = await fetch(`/api/v1${path}`, { method: "POST", body: fd, cache: "no-store" }).catch(() => null);
  if (!res) return { ok: false, error: { message: "Can't reach the server" } } as any;
  const data = await res.json().catch(() => null);
  return res.ok ? { ok: true, data } : { ok: false, error: data || { message: "The request failed" } };
}

export function LevelRequestModal({ skill, onClose, onDone }: { skill: { skill_id: string; skill_name: string; current_level: number | null; required_level?: number }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [level, setLevel] = useState<number | null>(skill.required_level && (skill.current_level ?? -1) < skill.required_level ? skill.required_level : null);
  const [note, setNote] = useState(""); const [files, setFiles] = useState<any[]>([]); const [links, setLinks] = useState<any[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const evidence = files.length + links.filter(l => l.url.trim()).length;
  const submit = async () => {
    setBusy(true); setErr(null);
    const r = await send("/level-requests", { skill_id: skill.skill_id, requested_level: level, note, ...toForm(files, links) }, files.map(f => f.file));
    setBusy(false); if (!r.ok) return setErr(r.error);
    toast(r.data.reviewer === "manager" ? "Sent to your manager for review" : "Sent to HR for review"); onDone();
  };
  return (
    <Modal wide open onClose={onClose} title={`Update your level · ${skill.skill_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={level === null || !evidence} onClick={submit}><Send className="h-4 w-4" />Send for review</Button></>}>
      <Field label={`New level${skill.required_level ? ` · your role needs ${skill.required_level}` : ""}`}><LevelPicker value={level} onChange={setLevel} current={skill.current_level} /></Field>
      <Field label="What changed?" htmlFor="lqn"><textarea id="lqn" className="inp" rows={3} maxLength={2000} placeholder="Projects, courses or responsibilities that show this level" value={note} onChange={e => setNote(e.target.value)} /></Field>
      <Field label={`Evidence${evidence ? ` · ${evidence}` : " · at least one"}`}><EvidenceEditor files={files} setFiles={setFiles} links={links} setLinks={setLinks} /></Field>
      <ErrorBox error={err} />
    </Modal>
  );
}

/** One request with its evidence. Reviewers decide; the employee adds evidence or withdraws. */
export function RequestDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const confirm = useConfirm();
  const d = useApi<any>(`/level-requests/${id}`);
  const [level, setLevel] = useState<number | null>(null); const [note, setNote] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]); const [links, setLinks] = useState<any[]>([]);
  const r = d.data;
  const decide = async (decision: string) => {
    setBusy(decision); setErr(null);
    const res = await api("POST", `/level-requests/${id}/decide`, { decision, level: level ?? r.requested_level, note });
    setBusy(null); if (!res.ok) return setErr(res.error);
    toast(decision === "approve" ? `Approved at level ${res.data.level}` : decision === "reject" ? "Request rejected" : "Asked for more information"); onChanged(); onClose();
  };
  const addMore = async () => {
    setBusy("add"); setErr(null);
    const res = await send(`/level-requests/${id}/evidence`, { note, ...toForm(files, links) }, files.map(f => f.file));
    setBusy(null); if (!res.ok) return setErr(res.error);
    toast("Evidence added"); setFiles([]); setLinks([]); setNote(""); d.reload(); onChanged();
  };
  return (
    <Modal wide open onClose={onClose} title={r ? `${r.skill_name}: level ${r.current_level ?? "?"} → ${r.requested_level}` : "Request"}>
      {d.loading || !r ? <Loading /> : <>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunken/50 p-4">
          <Avatar name={r.employee_name} size={44} />
          <div className="min-w-0 flex-1"><div className="text-[15px] font-bold">{r.employee_name}</div><div className="text-[12.5px] text-ink-3">{r.role_title} · asked {ago(r.created_at)}</div></div>
          <Pill>{r.status === "Pending" ? "In Review" : r.status}</Pill>
        </div>
        {r.note && <blockquote className="rounded-xl border-l-4 border-accent bg-accent-soft/40 px-4 py-3 text-[13.5px] text-ink-2">“{r.note}”</blockquote>}
        <div><div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3">Evidence · {r.evidence.length}</div>
          <ul className="grid gap-2 md:grid-cols-2">{r.evidence.map((x: any) => (
            <li key={x.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{x.kind === "file" ? <FileText className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{x.title}</div><div className="text-[11.5px] text-ink-3">{x.type}{x.kind === "file" ? ` · ${x.file_name} · ${kb(x.size_bytes)}` : ""}</div></div>
              {x.kind === "file" ? <a href={`/api/v1/level-requests/files/${x.id}`} className="rounded-lg p-2 text-accent hover:bg-accent-soft" aria-label={`Download ${x.file_name}`}><Download className="h-4 w-4" /></a>
                : <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="rounded-lg p-2 text-accent hover:bg-accent-soft" aria-label="Open link"><ExternalLink className="h-4 w-4" /></a>}
            </li>))}</ul></div>
        <div><div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3">History</div>
          <ul className="flex flex-col gap-1 border-l-2 border-line pl-4">{[...(r.history || [])].reverse().map((h: any, i: number) => <li key={i} className="text-[12.5px]"><b>{h.status}</b>{h.level !== undefined ? ` at level ${h.level}` : ""} <span className="text-ink-3">· {h.by} · {ago(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ul></div>
        {r.can_decide && <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Field label="Approve at level"><LevelPicker value={level ?? r.requested_level} onChange={setLevel} current={null} /></Field>
          <input className="inp" placeholder="Note to the employee (needed to reject or ask for more)" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2"><Button variant="primary" loading={busy === "approve"} onClick={() => decide("approve")}><Check className="h-4 w-4" />Approve level {level ?? r.requested_level}</Button>
            <Button loading={busy === "more_info"} onClick={() => decide("more_info")}>Ask for more evidence</Button>
            <Button variant="danger" loading={busy === "reject"} onClick={() => decide("reject")}><X className="h-4 w-4" />Reject</Button></div>
        </div>}
        {r.can_edit && <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="text-[13px] font-bold">{r.status === "More info needed" ? "Add what was asked for, then send it back" : "Add more evidence"}</div>
          <EvidenceEditor files={files} setFiles={setFiles} links={links} setLinks={setLinks} />
          {r.status === "More info needed" && <input className="inp" placeholder="Reply (optional)" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />}
          <div className="flex flex-wrap gap-2"><Button variant="primary" loading={busy === "add"} disabled={!files.length && !links.some(l => l.url.trim()) && r.status !== "More info needed"} onClick={addMore}>{r.status === "More info needed" ? "Send back for review" : "Add evidence"}</Button>
            <Button variant="danger" onClick={async () => { if (!(await confirm({ title: "Withdraw request", message: "Withdraw this level request? Your evidence is not kept.", danger: true, confirmLabel: "Withdraw" }))) return; await api("POST", `/level-requests/${id}/withdraw`); toast("Request withdrawn"); onChanged(); onClose(); }}>Withdraw</Button></div>
        </div>}
        <ErrorBox error={err} />
      </>}
    </Modal>
  );
}
