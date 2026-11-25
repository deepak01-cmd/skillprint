"use client";
/* HR: the company's own job postings. Private to the company. Grow company skills, draft roles and role frameworks from them. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Check, EyeOff, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { api, upload, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, DropZone, Empty, ErrorBox, Field, Loading, Modal, Pagination, Pill, cx, fmtDate, fmtNum, usePaged, useToast } from "@/components/ui";

const draft = (c: any) => `${c.term}: named in ${c.postings} of our own job postings${c.top_titles?.[0] ? `, most often for ${c.top_titles[0].title} roles` : ""}. Describe what someone with this skill can do.`;

export function CompanyPostings({ st, reload }: { st: any; reload: () => void }) {
  const s = useSession(); const toast = useToast();
  const sum = useApi<any>("/company-postings");
  const [share, setShare] = useState(0.2);
  const titles = useApi<any[]>(`/company-postings/titles?min_share=${share}`);
  const cands = useApi<any[]>("/company-postings/candidates");
  const org = useApi<any>("/org");
  const [file, setFile] = useState<File | null>(null); const [name, setName] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<any>(null);
  const [pick, setPick] = useState<Set<string>>(new Set()); const [dept, setDept] = useState(""); const [res, setRes] = useState<any>(null);
  const [csel, setCsel] = useState<Set<string>>(new Set()); const [adding, setAdding] = useState<any[] | null>(null); const [cf, setCf] = useState("open");
  const canSkills = can(s, "skills:write");
  const refreshAll = () => { sum.reload(); titles.reload(); cands.reload(); reload(); };
  // follow a running upload or re-scan of this company's postings
  const [watching, setWatching] = useState(false);
  useEffect(() => { if (st.running) setWatching(true); }, [st.running]);
  useEffect(() => { if (!watching) return; const t = setInterval(reload, 2000); return () => clearInterval(t); }, [watching, reload]);
  useEffect(() => { if (watching && !st.running && st.last) { setWatching(false); refreshAll(); toast(st.last.error ? `${st.last.kind} failed: ${st.last.error}` : `${st.last.kind} finished${st.last.result?.imported !== undefined ? `: ${fmtNum(st.last.result.imported)} postings imported` : ""}`, st.last.error ? "bad" : "ok"); } }, [watching, st.running, st.last]); // eslint-disable-line

  const up = async () => {
    setBusy("up"); setErr(null);
    const r = await upload("/data/job-postings", { file: file!, name: name || file!.name });
    setBusy(null); if (!r.ok) return setErr(r.error);
    setFile(null); setName(""); toast("Upload started. Progress is shown above; you can keep working."); reload();
  };
  const rescan = async () => { const r = await api("POST", "/company-postings/rescan", {}); r.ok ? (toast("Re-scan started"), reload()) : setErr(r.error); };
  const del = async (id: string) => { const r = await api("DELETE", `/company-postings/sources/${id}`); r.ok ? (toast("Upload removed"), refreshAll()) : setErr(r.error); };
  const makeRoles = async () => {
    setBusy("roles"); setErr(null);
    const r = await api("POST", "/company-postings/roles", { department_id: dept || undefined, min_share: share, titles: [...pick].map(n => ({ normalized_title: n })) });
    setBusy(null); if (!r.ok) return setErr(r.error);
    setRes(r.data); setPick(new Set()); titles.reload(); toast(`${r.data.created} draft role(s) created, ${r.data.extended} framework(s) extended`);
  };
  const candAct = async (action: string, items: any[]) => {
    setBusy("c"); setErr(null);
    const r = await api("POST", "/company-postings/candidates/bulk", { action, items }); setBusy(null);
    if (!r.ok) return setErr(r.error);
    const req = r.data.results.filter((x: any) => x.status === "Requested").length;
    toast(`${r.data.done} done${req ? ` (${req} sent to the platform as library requests)` : ""}. Re-scan your postings to count new skills.`);
    setCsel(new Set()); setAdding(null); cands.reload(); sum.reload();
  };

  const tRows = titles.data || [];
  const pTitles = usePaged(tRows, 15);
  const cRows = useMemo(() => (cands.data || []).filter(c => cf === "open" ? c.status === "Candidate" : c.status !== "Candidate"), [cands.data, cf]);
  const pc = usePaged(cRows, 15);
  const chosen = tRows.filter(t => pick.has(t.normalized_title));
  const needsDept = chosen.some(t => !t.role);
  const d = sum.data;
  return (
    <div className="flex flex-col gap-5">
      {st.running && <div className="rule-bar flex items-center gap-3 py-3 text-[14px]"><Loader2 className="h-4 w-4 animate-spin text-accent" /><b className="font-medium">{st.running.kind[0].toUpperCase() + st.running.kind.slice(1)} running</b><span className="num text-ink-2">{st.running.progress}</span><span className="ml-auto text-[12.5px] text-ink-3">you can keep working</span></div>}
      <ErrorBox error={err} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card title="Upload your job postings" sub="Private to your company. Never shared with other companies or used in shared market figures." icon={<Upload className="h-4 w-4" />}>
          <DropZone file={file} onFile={f => { setFile(f); if (!name) setName(f.name.replace(/\.(xlsx|csv)$/i, "")); }} hint="Columns: company, job_title, location, department, description, additional_details" />
          <div className="mt-3 flex items-end gap-2"><div className="flex-1"><Field label="Name" htmlFor="cpn"><input id="cpn" className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="For example: careers site, 2026" /></Field></div>
            <Button variant="primary" disabled={!file || !canSkills || !!st.running} loading={busy === "up"} onClick={up}><Upload className="h-4 w-4" />Import</Button></div>
          {!canSkills && <p className="mt-2 text-[12px] text-ink-3">Only HR administrators upload postings.</p>}
        </Card>
        <Card title="Your postings" icon={<Briefcase className="h-4 w-4" />} actions={canSkills && d?.postings > 0 && <Button size="sm" disabled={!!st.running} onClick={rescan}><RefreshCw className="h-3.5 w-3.5" />Re-scan</Button>}>
          {!d ? <Loading /> : !d.postings ? <Empty>No postings yet. Upload the job descriptions you advertise: their titles become roles and their requirements become skills.</Empty> : <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[[fmtNum(d.postings), "postings"], [fmtNum(d.titles), "job titles"], [fmtNum(d.with_skills), "with known skills"], [fmtNum(d.candidates), "new skill terms"]].map(([v, l]) =>
                <div key={l} className="border-l-[3px] border-ink pl-2.5"><div className="num text-[22px] font-medium leading-tight">{v}</div><div className="text-[12px] text-ink-3">{l}</div></div>)}
            </div>
            <ul className="mt-4 divide-y divide-line border-t border-line text-[13px]">{d.sources.map((x: any) => (
              <li key={x.id} className="flex items-center gap-2 py-2"><span className="min-w-0 flex-1"><b className="font-medium">{x.name}</b> <span className="text-ink-3">· {fmtNum(x.postings)} postings · {fmtDate(x.imported_at)} · {x.imported_by}</span></span>
                {canSkills && <Button size="sm" variant="ghost" onClick={() => del(x.id)} aria-label={`Remove ${x.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>}</li>))}</ul></>}
        </Card>
      </div>

      {tRows.length > 0 && (
        <Card pad={false} title="Roles from your postings" sub="New titles become draft roles. For titles you already have, the skills your postings ask for and the role's framework lacks are added as draft requirements for approval."
          actions={<label className="flex items-center gap-2 text-[12.5px] text-ink-3">Skills in at least<select className="inp w-auto py-1" value={share} onChange={e => setShare(Number(e.target.value))}>{[0.1, 0.2, 0.3, 0.5].map(v => <option key={v} value={v}>{v * 100}%</option>)}</select>of postings</label>}>
          {pick.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/[.06] px-4 py-2.5 text-[13px]">
            <b className="font-medium">{pick.size} selected</b>
            {needsDept && <select className="inp w-auto py-1" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department for new roles"><option value="">Department for new roles…</option>{(org.data?.departments || []).filter((x: any) => x.status === "Active").map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            <Button size="sm" variant="primary" loading={busy === "roles"} disabled={needsDept && !dept} onClick={makeRoles}><Plus className="h-3.5 w-3.5" />Create {chosen.filter(t => !t.role).length} draft role(s), extend {chosen.filter(t => t.role && t.missing_skills.length).length} framework(s)</Button>
          </div>}
          <div className="overflow-x-auto"><table className="t"><thead><tr><th style={{ width: 34 }}></th><th>Title in your postings</th><th className="text-right">Job postings</th><th>Your role</th><th>Skills to add</th></tr></thead>
            <tbody>{pTitles.items.map(t => { const can_ = !t.role || t.missing_skills.length > 0; return (
              <tr key={t.normalized_title} className={cx(can_ && "click")} onClick={() => { if (!can_) return; const n = new Set(pick); n.has(t.normalized_title) ? n.delete(t.normalized_title) : n.add(t.normalized_title); setPick(n); }}>
                <td><input type="checkbox" disabled={!can_} checked={pick.has(t.normalized_title)} readOnly aria-label={`Select ${t.display_title}`} /></td>
                <td><span className="font-medium">{t.display_title}</span>{t.variants.length > 1 && <div className="truncate text-[12px] text-ink-3">also: {t.variants.filter((v: string) => v !== t.display_title).slice(0, 3).join(", ")}</div>}</td>
                <td className="num text-right">{t.postings}</td>
                <td>{t.role ? <Link onClick={e => e.stopPropagation()} href={`/roles/${t.role.id}`} className="font-medium text-accent hover:underline">{t.role.title}</Link> : <Pill tone="Suggested">new role</Pill>}</td>
                <td className="text-[12.5px]">{t.role ? (t.missing_skills.length ? t.missing_skills.slice(0, 4).map((m: any) => `${m.name} (${Math.round(m.share * 100)}%)`).join(", ") + (t.missing_skills.length > 4 ? ` +${t.missing_skills.length - 4}` : "") : <span className="text-good">framework covers them</span>) : `${t.common_skills} skills`}</td>
              </tr>); })}</tbody></table></div>
          <Pagination page={pTitles.page} size={pTitles.size} total={pTitles.total} onPage={pTitles.setPage} />
          {res && <div className="border-t border-line px-4 py-3 text-[13px]">{res.results.map((r: any) => <div key={r.normalized_title}>{r.role_id ? <Link className="font-medium text-accent hover:underline" href={`/roles/${r.role_id}`}>{r.title}</Link> : r.title}: {r.status === "created" ? `draft role with ${r.skills} skills` : r.status === "framework_extended" ? `${r.skills} skill(s) added as drafts` : r.status.replace(/_/g, " ")}</div>)}</div>}
        </Card>
      )}

      {(cands.data || []).length > 0 && (
        <Card pad={false} title="Skills your postings ask for" sub="Terms in your postings that neither the shared library nor your company skills cover. Adding them creates company skills; “same as” on a shared skill sends a request to the platform.">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            {[["open", `To review ${(cands.data || []).filter(c => c.status === "Candidate").length}`], ["done", "Decided"]].map(([k, l]) =>
              <button key={k} onClick={() => setCf(k)} className={cx("border-b-[3px] px-2 py-1 text-[13.5px] font-medium", cf === k ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{l}</button>)}
            {canSkills && csel.size > 0 && <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setAdding((cands.data || []).filter(c => csel.has(c.term)).map(c => ({ term: c.term, name: c.term, category: c.suggested_category || "Technical Methods", definition: draft(c) })))}><Plus className="h-3.5 w-3.5" />Add {csel.size} as company skills…</Button>
              <Button size="sm" variant="ghost" loading={busy === "c"} onClick={() => candAct("ignore", [...csel].map(term => ({ term })))}><EyeOff className="h-3.5 w-3.5" />Ignore</Button></span>}
          </div>
          {!cRows.length ? <Empty>Nothing here.</Empty> : <div className="overflow-x-auto"><table className="t"><thead><tr><th style={{ width: 34 }}></th><th>Term</th><th className="text-right">Job postings</th><th>Most often in</th><th>Looks like</th><th></th></tr></thead>
            <tbody>{pc.items.map(c => <tr key={c.term}>
              <td>{c.status === "Candidate" && canSkills && <input type="checkbox" checked={csel.has(c.term)} onChange={e => { const n = new Set(csel); e.target.checked ? n.add(c.term) : n.delete(c.term); setCsel(n); }} aria-label={`Select ${c.term}`} />}</td>
              <td className="font-medium">{c.term}</td><td className="num text-right">{c.postings}</td>
              <td className="max-w-[220px] truncate text-[12.5px] text-ink-2">{(c.top_titles || []).slice(0, 2).map((t: any) => t.title).join(", ")}</td>
              <td className="text-[13px]">{c.status !== "Candidate" ? <span className="text-ink-3">{c.status}{c.skill_name ? ` · ${c.skill_name}` : ""}</span> : c.suggested_skill_name ? <>{c.suggested_skill_name}{c.suggested_global && <span className="text-ink-3"> (shared)</span>}</> : "—"}</td>
              <td className="whitespace-nowrap text-right">{c.status === "Candidate" && canSkills && <>
                {c.suggested_skill_id && <Button size="sm" variant="ghost" onClick={() => candAct("alias", [{ term: c.term }])}><Check className="h-3.5 w-3.5" />Same as {c.suggested_skill_name}</Button>}
                <Button size="sm" variant="ghost" onClick={() => setAdding([{ term: c.term, name: c.term, category: c.suggested_category || "Technical Methods", definition: draft(c) }])}><Plus className="h-3.5 w-3.5" />Company skill</Button></>}</td>
            </tr>)}</tbody></table></div>}
          <Pagination page={pc.page} size={pc.size} total={pc.total} onPage={pc.setPage} />
        </Card>
      )}
      <Modal wide open={!!adding} onClose={() => setAdding(null)} title={`Add ${adding?.length || 0} company skill${adding?.length === 1 ? "" : "s"}`}
        footer={<><Button onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" loading={busy === "c"} onClick={() => candAct("add", adding!)}>Add to your skills</Button></>}>
        <div className="max-h-[60vh] overflow-auto scroll-thin">{(adding || []).map((a, i) => (
          <div key={a.term} className="grid gap-3 border-t border-line py-3 md:grid-cols-2">
            <Field label="Skill name" htmlFor={`cn${i}`}><input id={`cn${i}`} className="inp" value={a.name} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></Field>
            <Field label="Category" htmlFor={`cc${i}`}><input id={`cc${i}`} className="inp" value={a.category} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} /></Field>
            <div className="md:col-span-2"><Field label="Definition" htmlFor={`cd${i}`}><textarea id={`cd${i}`} className="inp" rows={2} value={a.definition} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, definition: e.target.value } : x))} /></Field></div>
          </div>))}</div>
      </Modal>
    </div>
  );
}
