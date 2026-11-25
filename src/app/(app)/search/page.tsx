"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { RoleDraftCard, useRoleDraft } from "@/components/RoleDraftCard";
import { Card, Empty, Level, Note, PageHeader, Pill } from "@/components/ui";

export default function Page() { return <Suspense fallback={null}><Search /></Suspense>; }

function Search() {
  const sp = useSearchParams();
  const s = useSession();
  const [msg, alertMsg] = useState<string | null>(null);
  const [q, setQ] = useState(sp.get("q") || ""); const [incl, setIncl] = useState(false); const [res, setRes] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  useEffect(() => { setDraftTitle(null); if (!res?.role_fallback) return; const t = setTimeout(() => setDraftTitle(q.trim()), 900); return () => clearTimeout(t); }, [res, q]);
  const draft = useRoleDraft(draftTitle);
  useEffect(() => { const v = sp.get("q"); if (v) setQ(v); }, [sp]);
  useEffect(() => { const f = (e: any) => setQ(e.detail); window.addEventListener("app:search", f); return () => window.removeEventListener("app:search", f); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => { const r = await api("GET", `/search?q=${encodeURIComponent(q)}&include_archived=${incl}`); if (r.ok) { setRes(r.data); setErr(null); } else setErr(r.error!.message); }, 250);
    return () => clearTimeout(t);
  }, [q, incl]);
  const section = (title: string, items: any[] | undefined, render: (x: any) => React.ReactNode) => items && items.length > 0 && <Card title={`${title} (${items.length})`}><ul className="flex flex-col gap-1.5 text-[13px]">{items.map(render)}</ul></Card>;
  return (
    <>
      <PageHeader title="Search" />
      <div className="mb-4 flex flex-wrap items-center gap-3"><input autoFocus className="inp max-w-lg" placeholder="Try Python, Data Analyst, K8s or PX-R031-S053" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        {can(s, "archive:read") && <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={incl} onChange={e => setIncl(e.target.checked)} /> Include archived skills</label>}</div>
      {err && <Note tone="bad">{err}</Note>}
      {res?.pixel_match && <div className="mb-4"><Note tone={res.pixel_match.lifecycle_status === "Active" ? "info" : "muted"}><span className="font-mono">{res.pixel_match.pixel_id}</span> is <b>{res.pixel_match.lifecycle_status}</b> ({res.pixel_match.approval_status}). {res.pixel_match.detail_allowed ? <Link className="font-medium text-accent hover:underline" href={`/roles/${res.pixel_match.pixel_id.split("-")[1]}`}>Open its role</Link> : "Viewing archived details needs archive:read."}</Note></div>}
      {res?.legacy_match && <div className="mb-4"><Note>Old ID <span className="font-mono">{res.legacy_match.old_id}</span> {res.legacy_match.pixel_id ? <>is now <span className="font-mono">{res.legacy_match.pixel_id}</span> ({res.legacy_match.lifecycle_status})</> : <>is the framework of role {res.legacy_match.role_id}</>}. <Link className="font-medium text-accent hover:underline" href={`/roles/${res.legacy_match.role_id}`}>Open the role</Link></Note></div>}
      {res?.role_fallback && <div className="mb-4 flex flex-col gap-3">
        <Note tone="warn"><b>“{q}” is not in your framework yet.</b> {res.role_fallback.candidates.length ? <>Closest roles: {res.role_fallback.candidates.slice(0, 3).map((c: any) => <Link key={c.id} className="mr-2 font-medium text-accent hover:underline" href={`/roles/${c.id}`}>{c.title}</Link>)}. </> : ""}
          A draft profile is shown below and sent to HR for review{can(s, "roles:write") ? <> (<Link className="font-medium text-accent hover:underline" href="/roles/queue">Role resolution</Link>)</> : ""}.</Note>
        {draft?.draft && <RoleDraftCard draft={draft.draft} />}
        {draft?.matched && <Note>It is in the framework as <Link className="font-medium text-accent hover:underline" href={`/roles/${draft.matched.id}`}>{draft.matched.title}</Link>.</Note>}
        {draft?.error && <Note tone="bad">{draft.error}</Note>}
      </div>}
      {!res && <Empty>Type at least two characters.</Empty>}
      {res && <div className="grid gap-4 lg:grid-cols-2">
        {section("Roles", res.roles, x => <li key={x.id}><Link className="font-medium text-accent hover:underline" href={`/roles/${x.id}`}>{x.title}</Link> <span className="text-ink-3">{x.id}</span> <Pill>{x.status}</Pill></li>)}
        {section("Skills", res.skills, x => <li key={x.id}><Link className="font-medium text-accent hover:underline" href={`/skills/${x.id}`}>{x.name}</Link> <span className="text-ink-3">{x.category}</span></li>)}
        {section("Roles requiring it (active mappings)", res.mappings, x => <li key={x.pixel_id} className="flex justify-between gap-2"><span><span className="font-mono text-xs">{x.pixel_id}</span> <Link className="font-medium text-accent hover:underline" href={`/roles/${x.role_id}`}>{x.role_name}</Link> · {x.skill_name}</span><Level n={x.required_level} short /></li>)}
        {section("People", res.employees, x => <li key={x.id}><Link className="font-medium text-accent hover:underline" href={`/employees/${x.id}`}>{x.name}</Link> <span className="text-ink-3">{x.role_title}</span></li>)}
        {section("Career paths", res.paths, x => <li key={x.id}>{x.from_title} → {x.to_title} <span className="text-ink-3">{x.movement_type}</span></li>)}
        {section("Archived (on request)", res.archived, x => <li key={x.pixel_id} className="text-ink-2"><span className="font-mono text-xs">{x.pixel_id}</span> {x.role_name} · {x.skill_name}: {x.archive_reason_category}</li>)}
        {!["roles", "skills", "mappings", "employees", "paths", "archived"].some(k => res[k]?.length) && !res.legacy_match && !res.role_fallback && <Empty>Nothing found.</Empty>}
      </div>}
    </>
  );
}
