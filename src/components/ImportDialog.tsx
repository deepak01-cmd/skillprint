"use client";
/* Upload dialog opened from the screen the data belongs to (Skills, Roles, a role's framework, Employees, Organisation).
   Three steps inside one dialog: add the file (or paste rows from Excel) → check every row → save. */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, History, ListChecks, Loader2, UploadCloud, X } from "lucide-react";
import { api, downloadText, upload } from "@/lib/api";
import { Button, DropZone, ErrorBox, Pagination, Pill, cx, fmtNum, usePaged } from "@/components/ui";

export type ImportEntity = "skills" | "departments" | "roles" | "role_skills" | "job_descriptions" | "employees";
const LABEL: Record<ImportEntity, string> = { skills: "skills", departments: "departments", roles: "roles", role_skills: "skill requirements", job_descriptions: "job descriptions", employees: "employees" };
const ACTION: Record<string, string> = { create: "New", update: "Update", skip: "Skip", queue: "Role resolution", error: "Error", created: "Created", updated: "Updated", skipped: "Skipped", queued: "Queued" };
const HINT: Record<ImportEntity, string> = {
  skills: "Existing skills are matched by name and alias, so the library stays free of duplicates. Look-alikes are flagged for you to decide.",
  departments: "Existing departments are updated; new ones are created under their parent.",
  roles: "Optional skills column, for example “SQL:4:Mandatory:High; Python:3”. Existing titles are updated, not duplicated.",
  role_skills: "Level 1–5 or a level name (Competent, Advanced…). Changes to published requirements go for approval unless you publish directly.",
  job_descriptions: "Each description becomes a draft role with its responsibilities and the library skills found in the text.",
  employees: "People with an unrecognised job title are never dropped: they wait in Role resolution until the title is matched.",
};

export interface ImportContext { role_id?: string; role_title?: string; default_department?: string; department_name?: string }

function readBase64(f: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); }); }

export function ImportDialog({ open, onClose, onDone, entities, context, title }: {
  open: boolean; onClose: () => void; onDone?: (applied: any) => void; entities: ImportEntity[]; context?: ImportContext; title?: string;
}) {
  const [entity, setEntity] = useState<ImportEntity>(entities[0]);
  const [meta, setMeta] = useState<any[] | null>(null);
  const [how, setHow] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null); const [text, setText] = useState("");
  const [mode, setMode] = useState("draft"); const [opts, setOpts] = useState<any>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null); const [done, setDone] = useState<any>(null);
  const [filter, setFilter] = useState("");

  // the screen behind refreshes when the dialog closes, so a reloading page cannot close the dialog before the result is seen
  const savedRef = useRef<any>(null);
  const close = () => { if (busy) return; const a = savedRef.current; savedRef.current = null; onClose(); if (a) onDone?.(a); };
  const reset = () => { setFile(null); setText(""); setPreview(null); setDone(null); setErr(null); setFilter(""); setMode("draft"); setOpts({}); };
  useEffect(() => { if (open) { reset(); setEntity(entities[0]); if (!meta) api("GET", "/imports/entities").then(r => r.ok && setMeta(r.data)); } }, [open]); // eslint-disable-line
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  const spec = meta?.find(m => m.entity === entity);
  const without = [context?.role_id && entity === "role_skills" ? "role" : null, context?.default_department && ["roles", "job_descriptions", "employees"].includes(entity) ? "department" : null].filter(Boolean) as string[];
  const columns = (spec?.columns || []).filter((c: string) => !without.includes(c));
  const required = (spec?.required || []).filter((c: string) => !without.includes(c));
  const rows = useMemo(() => (preview?.rows || done?.rows || []).filter((r: any) => !filter || (r.action || r.outcome) === filter), [preview, done, filter]);
  const paged = usePaged(rows, 8);

  const template = async () => { const r = await api("GET", `/imports/templates/${entity}${without.length ? `?without=${without.join(",")}` : ""}`); if (r.ok) downloadText(r.data.file, r.data.content); };
  const check = async () => {
    setBusy(true); setErr(null);
    const options = { ...opts, ...(context?.role_id && entity === "role_skills" ? { role_id: context.role_id } : {}), ...(context?.default_department ? { default_department: context.default_department } : {}) };
    let r;
    if (how === "paste") r = await api("POST", "/imports/preview", { entity, mode, options, filename: "pasted-rows.csv", text });
    else { r = await upload("/imports/preview", { file: file!, entity, mode, options: JSON.stringify(options) }); if (!r.ok && r.status === 0) r = await api("POST", "/imports/preview", { entity, mode, options, filename: file!.name, base64: await readBase64(file!) }); }
    setBusy(false); if (r.ok) { setPreview(r.data); setFilter(""); } else setErr(r.error);
  };
  const save = async () => {
    setBusy(true); setErr(null); const r = await api("POST", `/imports/${preview.id}/commit`); setBusy(false);
    if (!r.ok) return setErr(r.error);
    const report = await api("GET", `/imports/${preview.id}`);
    setDone({ ...r.data, rows: report.ok ? report.data.rows : [] }); setPreview(null); setFilter(""); savedRef.current = r.data.applied;
  };
  const discard = async () => { if (preview) await api("POST", `/imports/${preview.id}/discard`); setPreview(null); };
  const reportCsv = () => {
    const src = preview?.rows || done?.rows || []; const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    downloadText(`${preview?.id || done?.id}-report.csv`, [["row", "result", "record", "details"], ...src.map((r: any) => [r.row, r.action || r.outcome, r.key, (r.messages || []).join(" | ")])].map(l => l.map(esc).join(",")).join("\r\n"));
  };
  if (!open) return null;

  const step = done ? 2 : preview ? 1 : 0;
  const sum = preview?.summary; const app = done?.applied;
  const saveCount = sum ? sum.create + sum.update + sum.queue : 0;
  const counts = (k: string) => (preview?.rows || done?.rows || []).filter((r: any) => (r.action || r.outcome) === k).length;
  const ready = how === "file" ? !!file : text.trim().split("\n").length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-[rgba(15,23,42,.5)] px-4 py-10 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={title || `Upload ${LABEL[entity]}`} className="anim-in flex w-full max-w-3xl flex-col rounded-2xl border border-line bg-card shadow-pop">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-line-2 px-6 pb-4 pt-5">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold">{title || `Upload ${LABEL[entity]}`}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{context?.role_title ? <>For <b className="text-ink-2">{context.role_title}</b> · </> : context?.department_name ? <>Into <b className="text-ink-2">{context.department_name}</b> · </> : null}CSV or Excel, or paste rows copied from a spreadsheet</p>
          </div>
          <div className="flex items-center gap-3">
            <ol className="hidden items-center gap-1.5 text-xs sm:flex" aria-label="Progress">
              {["Add", "Check", "Done"].map((t, i) => <li key={t} className="flex items-center gap-1.5"><span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold", i < step ? "bg-good text-white" : i === step ? "bg-accent text-white" : "bg-sunken text-ink-3")}>{i < step ? "✓" : i + 1}</span><span className={i === step ? "font-semibold text-ink" : "text-ink-3"}>{t}</span>{i < 2 && <span className="h-px w-4 bg-line" />}</li>)}
            </ol>
            <button aria-label="Close" disabled={busy} onClick={close} className="rounded-md p-1 text-ink-3 hover:bg-sunken hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          {/* step 1: add data */}
          {step === 0 && (<>
            {entities.length > 1 && (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-sunken p-1">
                {entities.map(e => <button key={e} onClick={() => setEntity(e)} className={cx("rounded-lg px-3 py-2 text-[13px] font-medium transition-all", entity === e ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink")}>
                  {e === "job_descriptions" ? "Job descriptions (free text)" : e === "roles" ? "Roles (structured columns)" : LABEL[e][0].toUpperCase() + LABEL[e].slice(1)}</button>)}
              </div>
            )}
            <div className="flex items-center gap-1 text-[13px]">
              <button onClick={() => setHow("file")} className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium", how === "file" ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-sunken")}><UploadCloud className="h-4 w-4" />Upload a file</button>
              <button onClick={() => setHow("paste")} className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium", how === "paste" ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-sunken")}><ClipboardPaste className="h-4 w-4" />Paste from Excel</button>
              <button onClick={template} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-accent hover:bg-accent-soft"><Download className="h-4 w-4" />Template</button>
            </div>
            {how === "file" ? <DropZone file={file} onFile={setFile} />
              : <textarea className="inp min-h-[170px] font-mono text-xs" value={text} onChange={e => setText(e.target.value)} aria-label="Pasted rows"
                  placeholder={`Copy the cells in Excel, including the header row, and paste here.\n\n${columns.slice(0, 5).join("\t")}`} />}
            <div className="rounded-xl border border-line-2 bg-sunken px-4 py-3 text-[12.5px] text-ink-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-1">
                <span className="mr-1 font-semibold text-ink">Columns</span>
                {columns.map((c: string) => <code key={c} className={cx("rounded px-1.5 py-px font-mono text-[11px]", required.includes(c) ? "bg-accent-soft text-accent" : "bg-card text-ink-2 ring-1 ring-inset ring-line")}>{c}{required.includes(c) ? "*" : ""}</code>)}
              </div>
              <p>{HINT[entity]} Column names are matched loosely; extra columns are ignored.</p>
            </div>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3 text-[13px]">
              <div className="flex rounded-lg border border-line p-0.5">
                <button onClick={() => setMode("draft")} className={cx("rounded-md px-3 py-1.5 font-medium", mode === "draft" ? "bg-ink text-white" : "text-ink-2")}>Save as drafts</button>
                <button disabled={!spec?.can_publish} title={spec?.can_publish ? "" : "Only HR administrators can publish directly"} onClick={() => setMode("publish")} className={cx("rounded-md px-3 py-1.5 font-medium disabled:opacity-40", mode === "publish" ? "bg-ink text-white" : "text-ink-2")}>Publish directly</button>
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                {entity === "skills" && <label className="flex items-center gap-2"><input type="checkbox" checked={!!opts.create_similar} onChange={e => setOpts({ ...opts, create_similar: e.target.checked })} />Also create skills that look like existing ones</label>}
                {["roles", "job_descriptions"].includes(entity) && !context?.default_department && <label className="flex items-center gap-2"><input type="checkbox" checked={!!opts.create_departments} onChange={e => setOpts({ ...opts, create_departments: e.target.checked })} />Create departments that don't exist yet</label>}
                {entity === "job_descriptions" && <label className="flex items-center gap-2"><input type="checkbox" checked={!!opts.update_existing} onChange={e => setOpts({ ...opts, update_existing: e.target.checked })} />Update roles that already exist</label>}
              </div>
            </div>
            <p className="text-xs text-ink-3">{mode === "draft" ? "New items are saved as drafts; changes to published items go to Approvals." : "Changes go live straight away and are recorded in the audit log as approved by you."}</p>
          </>)}

          {/* step 2/3: results */}
          {(preview || done) && (<>
            {done ? (
              <div className="flex items-center gap-3 rounded-xl border border-good/40 bg-good-soft px-4 py-3">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-good" />
                <div className="text-[13.5px]"><div className="font-semibold text-good">Saved</div>
                  <div className="text-good">{[app.created && `${app.created} created`, app.updated && `${app.updated} updated`, app.queued && `${app.queued} waiting in Role resolution`, app.change_requests && `${app.change_requests} sent for approval`, app.skipped && `${app.skipped} skipped`, app.errors && `${app.errors} not saved (errors)`].filter(Boolean).join(" · ") || "Nothing changed"}</div></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["New", sum.create, "text-good"], ["Updates", sum.update, "text-accent"], [entity === "employees" ? "Role resolution" : "Skipped", entity === "employees" ? sum.queue : sum.skip, "text-ink-2"], ["Errors", sum.error, sum.error ? "text-bad" : "text-ink-3"]].map(([l, n, c]: any) => (
                  <div key={l} className="rounded-xl border border-line px-3 py-2.5"><div className="text-xs text-ink-3">{l}</div><div className={cx("num text-xl font-bold", c)}>{fmtNum(n)}</div></div>))}
              </div>
            )}
            {preview?.summary.error > 0 && <div className="flex items-start gap-2 text-[12.5px] text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Rows with errors are left out. You can save the rest now and fix those rows later.</div>}
            {preview?.unknown_columns?.length > 0 && <p className="text-xs text-ink-3">Ignored columns: {preview.unknown_columns.join(", ")}</p>}
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="flex flex-wrap gap-1.5 border-b border-line-2 bg-sunken px-3 py-2">
                <button onClick={() => setFilter("")} className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", !filter ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken")}>All {(preview?.rows || done?.rows || []).length}</button>
                {["create", "update", "queue", "skip", "error", "created", "updated", "queued", "skipped"].filter(a => counts(a)).map(a => <button key={a} onClick={() => setFilter(a)} className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", filter === a ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken")}>{ACTION[a]} {counts(a)}</button>)}
              </div>
              <table className="t"><thead><tr><th style={{ width: 52 }}>Row</th><th style={{ width: 120 }}>Result</th><th>Record</th><th>Why</th></tr></thead>
                <tbody>{paged.items.map((r: any) => <tr key={r.row + (r.key || "")}><td className="num text-ink-3">{r.row}</td><td><Pill tone={r.action || r.outcome}>{ACTION[r.action || r.outcome] || r.action || r.outcome}</Pill></td><td className="font-medium">{r.key || "—"}</td><td className="text-[12.5px] text-ink-2">{(r.messages || []).join(" · ") || "—"}</td></tr>)}</tbody></table>
              <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} />
            </div>
          </>)}
          <ErrorBox error={err} />
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-line-2 bg-sunken px-6 py-3.5">
          <Link href="/import" className="mr-auto inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-accent"><History className="h-3.5 w-3.5" />Past uploads</Link>
          {step === 0 && <><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!ready || !spec} loading={busy} onClick={check}><ListChecks className="h-4 w-4" />Check rows</Button></>}
          {step === 1 && <><Button onClick={discard}><ArrowLeft className="h-4 w-4" />Back</Button><Button onClick={reportCsv}><FileSpreadsheet className="h-4 w-4" />Report</Button>
            <Button variant="primary" disabled={!saveCount} loading={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save {fmtNum(saveCount)} {saveCount === 1 ? "row" : "rows"}</Button></>}
          {step === 2 && <><Button onClick={reportCsv}><FileSpreadsheet className="h-4 w-4" />Report</Button><Button onClick={() => { const a = savedRef.current; reset(); savedRef.current = a; }}>Upload another</Button><Button variant="primary" onClick={close}>Done</Button></>}
        </div>
      </div>
    </div>
  );
}

/** Opens the dialog when the page URL has ?upload=1 (links from dashboards). */
export function useUploadParam(set: (v: boolean) => void) {
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("upload")) set(true); }, [set]);
}
