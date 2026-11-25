"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Briefcase, CheckCircle2, Database, FileSpreadsheet, Globe2, Layers, Loader2, RefreshCw, Sparkles, Upload, Users, Wand2 } from "lucide-react";
import { api, upload, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { CandidateReview, PipelineExplainer } from "@/components/MarketPipeline";
import { LibraryGovernance } from "@/components/LibraryAdmin";
import { CompanyPostings } from "@/components/CompanyPostings";
import { Button, Card, DropZone, Empty, ErrorBox, Field, Loading, Note, PageHeader, Pill, SearchInput, Stat, Tabs, cx, fmtNum, useToast } from "@/components/ui";

function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

function PlatformTools({ st, reload }: { st: any; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null); const [name, setName] = useState(""); const [licence, setLicence] = useState("");
  const [minPost, setMinPost] = useState(8);
  // long jobs answer at once and run in the background; the page polls for progress and shows the result when done
  const run = async (key: string, f: () => Promise<any>, ok: (d: any) => string) => { setBusy(key); setErr(null); const r = await f(); setBusy(null); if (r.ok) { toast(r.data?.started ? "Started. Progress is shown at the top of this page; you can keep using the app." : ok(r.data)); reload(); } else setErr(r.error); };
  const [watching, setWatching] = useState(false);
  useEffect(() => { if (st.running) setWatching(true); }, [st.running]);
  useEffect(() => { if (!watching) return; const t = setInterval(reload, 2000); return () => clearInterval(t); }, [watching, reload]);
  useEffect(() => { if (watching && !st.running && st.last) { setWatching(false); toast(st.last.error ? `${st.last.kind} failed: ${st.last.error}` : `${st.last.kind} finished${st.last.result?.scanned ? `: ${fmtNum(st.last.result.scanned)} postings scanned` : ""}${st.last.result?.imported !== undefined ? `: ${fmtNum(st.last.result.imported)} postings imported` : ""}${st.last.result?.auto_added?.added ? `, ${st.last.result.auto_added.added} skills added automatically` : ""}`, st.last.error ? "bad" : "ok"); } }, [watching, st.running, st.last, toast]);
  return (
    <>
      {st.running && <div className="rule-bar flex items-center gap-3 py-3 text-[14px]"><Loader2 className="h-4 w-4 animate-spin text-accent" /><b className="font-medium">{st.running.kind[0].toUpperCase() + st.running.kind.slice(1)} running</b><span className="num text-ink-2">{st.running.progress}</span><span className="ml-auto text-[12.5px] text-ink-3">started {new Date(st.running.started).toLocaleTimeString()} · the app stays usable</span></div>}
      <ErrorBox error={err} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Skills catalogue" sub={`${st.catalogue_size} curated skills across tech, engineering, healthcare, sales, finance, HR and operations`} icon={<BookOpen className="h-4 w-4" />}>
          <p className="text-[13px] text-ink-2">{st.catalogue_missing ? <>{st.catalogue_missing} catalogue skills are not in the global library yet. Adding them also re-scans every stored job posting so the new skills are counted.</> : <>Every catalogue skill is in the global library.</>}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!st.catalogue_missing || !!st.running} loading={busy === "cat"} onClick={() => run("cat", () => api("POST", "/data/catalogue/load"), d => `${d.added} skills added`)}><Sparkles className="h-4 w-4" />Add catalogue skills</Button>
            <Button disabled={!!st.running} loading={busy === "scan"} onClick={() => run("scan", () => api("POST", "/data/rescan"), d => `${fmtNum(d.scanned)} postings re-scanned`)}><RefreshCw className="h-4 w-4" />Re-scan postings</Button>
          </div>
        </Card>
        <Card title="Upload job postings" sub="Feeds title groups, skill demand and role templates" icon={<Upload className="h-4 w-4" />}>
          <DropZone file={file} onFile={f => { setFile(f); if (!name) setName(f.name.replace(/\.(xlsx|csv)$/i, "")); }} hint="Columns: company, job_title, location, department, description, additional_details" />
          <div className="mt-3 grid gap-3">
            <Field label="Source name" htmlFor="sn"><input id="sn" className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Licence (optional)" htmlFor="sl" hint="Without a licence the data is used for titles, templates and profile checks, never as trend evidence."><input id="sl" className="inp" value={licence} onChange={e => setLicence(e.target.value)} placeholder="Terms you may use the data under" /></Field>
          </div>
          <div className="mt-4 flex justify-end"><Button variant="primary" disabled={!file || !!st.running} loading={busy === "up"} onClick={() => run("up", () => upload("/data/job-postings", { file: file!, name, licence: licence || undefined }), d => { setFile(null); return `${fmtNum(d.imported)} postings imported (${fmtNum(d.duplicates)} duplicates skipped)`; })}><Upload className="h-4 w-4" />Import postings</Button></div>
          <p className="mt-2 text-xs text-ink-3">A 25,000-row file takes about a minute. Larger files: use <code className="font-mono">npm run import-jobs</code>.</p>
        </Card>
        <Card title="Role templates" sub={`${st.templates} templates feed the role fallback`} icon={<Layers className="h-4 w-4" />}>
          <p className="text-[13px] text-ink-2">Build a template for every market title group with enough postings. Each template carries the library skills mentioned in at least 15% of those postings. Organisations then start new roles from them.</p>
          <div className="mt-4 flex items-end gap-2"><Field label="Minimum postings per title" htmlFor="mp"><input id="mp" type="number" min={3} className="inp w-28" value={minPost} onChange={e => setMinPost(Number(e.target.value))} /></Field>
            <Button variant="primary" disabled={!!st.running} loading={busy === "tpl"} onClick={() => run("tpl", () => api("POST", "/data/templates/bulk", { min_postings: minPost }), d => `${d.created} new, ${d.updated} refreshed templates`)}><Wand2 className="h-4 w-4" />Build templates</Button></div>
          <p className="mt-3 text-xs text-ink-3">{fmtNum(st.big_title_groups)} title groups have 10 or more postings.</p>
        </Card>
      </div>
      {st.last && <p className="text-xs text-ink-3">Last job: {st.last.kind}, finished {new Date(st.last.finished).toLocaleTimeString()}{st.last.error ? ` with an error: ${st.last.error}` : ""}.</p>}
    </>
  );
}

function OrgTools() {
  const toast = useToast();
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [min, setMin] = useState(10);
  const titles = useApi<any[]>(`/market/titles?min_postings=${min}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`);
  const org = useApi<any>("/org");
  const [sel, setSel] = useState<Record<string, string>>({}); const [dept, setDept] = useState(""); const [share, setShare] = useState(0.2);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null); const [res, setRes] = useState<any>(null);
  const picked = Object.keys(sel);
  const create = async () => {
    setBusy(true); setErr(null);
    const r = await api("POST", "/roles/from-market", { department_id: dept, min_share: share, titles: picked.map(n => ({ normalized_title: n, title: sel[n] })) });
    setBusy(false); if (!r.ok) return setErr(r.error);
    setRes(r.data); setSel({}); titles.reload(); toast(`${r.data.created} draft roles created`);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <Card pad={false} title="Job titles in the market" sub="From the imported job postings. Pick the ones your organisation needs." icon={<Globe2 className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3.5">
          <SearchInput className="w-full max-w-xs" value={q} onChange={setQ} placeholder="Search titles, e.g. data engineer" />
          <select className="inp w-auto" value={min} onChange={e => setMin(Number(e.target.value))} aria-label="Minimum postings">{[3, 5, 10, 25, 50].map(n => <option key={n} value={n}>{n}+ postings</option>)}</select>
          {picked.length > 0 && <span className="ml-auto text-xs font-medium text-accent">{picked.length} selected</span>}
        </div>
        {titles.loading && !titles.data ? <Loading rows={8} /> : !(titles.data || []).length ? <Empty>No market titles match. Ask the platform administrator to import job postings.</Empty> :
          <div className="max-h-[560px] overflow-auto scroll-thin"><table className="t"><thead><tr><th style={{ width: 36 }}></th><th>Title</th><th className="text-right">Job postings</th><th className="text-right">Employers posting</th><th className="text-right">Common skills</th><th></th></tr></thead>
            <tbody>{titles.data!.map(t => { const on = t.normalized_title in sel; return (
              <tr key={t.normalized_title} className={cx(!t.existing_role && "click", on && "bg-accent-soft/40")} onClick={() => { if (t.existing_role) return; const n = { ...sel }; on ? delete n[t.normalized_title] : (n[t.normalized_title] = t.display_title); setSel(n); }}>
                <td><input type="checkbox" checked={on} disabled={!!t.existing_role} readOnly aria-label={`Select ${t.display_title}`} /></td>
                <td>{on ? <input className="inp py-1" value={sel[t.normalized_title]} onClick={e => e.stopPropagation()} onChange={e => setSel({ ...sel, [t.normalized_title]: e.target.value })} aria-label="Role title" /> : <span className="font-medium">{t.display_title}</span>}</td>
                <td className="num text-right">{fmtNum(t.postings)}</td><td className="num text-right">{t.companies}</td><td className="num text-right">{t.common_skills}</td>
                <td className="text-right">{t.existing_role ? <Link onClick={e => e.stopPropagation()} href={`/roles/${t.existing_role}`}><Pill tone="Published">in your roles</Pill></Link> : null}</td></tr>); })}</tbody></table></div>}
      </Card>
      <div className="flex flex-col gap-5">
        <Card title="Create draft roles" icon={<Briefcase className="h-4 w-4" />}>
          <div className="flex flex-col gap-4">
            <Field label="Department" htmlFor="dp"><select id="dp" className="inp" value={dept} onChange={e => setDept(e.target.value)}><option value="">Choose…</option>{(org.data?.departments || []).filter((d: any) => d.status === "Active").map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label={`Include skills mentioned in at least ${Math.round(share * 100)}% of postings`} htmlFor="sh"><input id="sh" type="range" min={0.05} max={0.6} step={0.05} value={share} onChange={e => setShare(Number(e.target.value))} /></Field>
            <Note tone="muted">Each role is created as a <b>draft</b> with draft skill requirements at level 3. Review the levels, then submit it for approval as usual.</Note>
            <ErrorBox error={err} />
            <Button variant="primary" size="lg" disabled={!picked.length || !dept} loading={busy} onClick={create}><Sparkles className="h-4 w-4" />Create {picked.length || ""} draft role{picked.length === 1 ? "" : "s"}</Button>
          </div>
        </Card>
        {res && <Card title="Result" icon={<CheckCircle2 className="h-4 w-4" />}><ul className="flex flex-col divide-y divide-line-2 text-[13px]">{res.results.map((r: any) => <li key={r.normalized_title} className="flex items-center justify-between gap-2 py-2"><span>{r.role_id ? <Link className="font-medium text-accent hover:underline" href={`/roles/${r.role_id}`}>{r.title}</Link> : r.title || r.normalized_title}</span><span className="flex items-center gap-2 text-xs text-ink-3">{r.skills !== undefined && `${r.skills} skills`}<Pill tone={r.status === "created" ? "Published" : "Draft"}>{r.status}</Pill></span></li>)}</ul></Card>}
      </div>
    </div>
  );
}

function OrgGrowth({ st, reload }: { st: any; reload: () => void }) {
  const [tab, setTab] = useState("company");
  return (<>
    <Tabs value={tab} onChange={setTab} tabs={[{ id: "company", label: "Your company's postings", count: st.company_postings }, { id: "market", label: "Shared job market", count: st.postings }]} />
    {tab === "company" ? <CompanyPostings st={st} reload={reload} /> : <OrgTools />}
  </>);
}

export default function DataGrowth() {
  const s = useSession();
  const st = useApi<any>("/data/scale");
  const platform = s.user.role === "platform_admin";
  return (
    <>
      <PageHeader eyebrow="Data" title={platform ? "Data growth" : "Grow from the job market"}
        actions={!platform && <Link href="/roles?upload=1"><Button><FileSpreadsheet className="h-4 w-4" />Upload your own roles</Button></Link>} />
      {st.error && <ErrorBox error={st.error} />}
      {st.data && <PipelineExplainer st={st.data} />}
      {st.loading && !st.data ? <Loading /> : st.data && (platform ? <div className="flex flex-col gap-5"><PlatformTools st={st.data} reload={st.reload} /><CandidateReview onChanged={st.reload} /><LibraryGovernance onChanged={st.reload} /></div> : <OrgGrowth st={st.data} reload={st.reload} />)}
    </>
  );
}
