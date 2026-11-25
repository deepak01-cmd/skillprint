"use client";
/* Reference occupation (O*NET and other publishers) for a role or a draft: work styles, work context, rated skills,
   in-demand technologies, emerging tasks and the labour-market outlook, always with the publisher's attribution. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Flame, Link2, Search, Sparkles, TrendingUp, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Bar, Button, Card, Empty, ErrorBox, Loading, Modal, Note, Pill, cx, useToast } from "@/components/ui";

const ZONE: Record<number, string> = { 1: "Little or no preparation", 2: "Some preparation", 3: "Medium preparation", 4: "Considerable preparation", 5: "Extensive preparation" };

export function Attribution({ items }: { items?: { publisher: string; name: string; attribution: string; url?: string }[] }) {
  if (!items?.length) return null;
  return <div className="mt-2 flex flex-col gap-1 text-[11px] leading-snug text-ink-3">{items.map((a, i) => <p key={i}>{a.attribution}{a.url ? <> <a className="underline" href={a.url} target="_blank" rel="noreferrer noopener">Source</a></> : null}</p>)}</div>;
}

export function OutlookFlags({ flags }: { flags?: string[] }) {
  if (!flags?.length) return null;
  return <span className="inline-flex flex-wrap gap-1">{flags.map(f => <span key={f} className="inline-flex items-center gap-1 rounded-md bg-good-soft px-2 py-0.5 text-[12px] font-medium text-good"><TrendingUp className="h-3 w-3" />{f}</span>)}</span>;
}

/** The occupation's profile (used on the role page and in drafts). */
export function OccupationProfile({ p, inFramework, compact }: { p: any; inFramework?: Set<string>; compact?: boolean }) {
  const Rated = ({ title, items }: { title: string; items: any[] }) => items?.length ? (
    <div>
      <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-3">{title}</div>
      <ul className="flex flex-col gap-1.5">{items.slice(0, compact ? 6 : 12).map((k: any) => (
        <li key={k.element_id} className="grid grid-cols-[1fr_90px_auto] items-center gap-2 text-[13px]">
          <span className="min-w-0 truncate" title={k.name}>{k.name}{k.skill_id && k.skill_name && k.skill_name.toLowerCase() !== k.name.toLowerCase() && <span className="ml-1 text-[11px] text-ink-3">→ {k.skill_name}</span>}</span>
          <Bar value={k.importance} max={5} tone={k.importance >= 4 ? "accent" : "ink"} />
          <span className="w-16 text-right text-[12px]">{k.skill_id && inFramework ? (inFramework.has(k.skill_id) ? <span className="inline-flex items-center gap-0.5 text-good"><Check className="h-3.5 w-3.5" />mapped</span> : <span className="text-warn">not mapped</span>) : <span className="num text-ink-3">{k.importance}</span>}</span>
        </li>))}</ul>
    </div>) : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-ink-3">{p.code}</span><b className="text-[16px]">{p.title}</b><OutlookFlags flags={p.flags} />
          {p.job_zone && <span className="rounded-md bg-sunken px-2 py-0.5 text-[12px] text-ink-2" title="O*NET Job Zone">Job zone {p.job_zone}: {ZONE[p.job_zone]}</span>}</div>
        {p.description && <p className="text-[13px] text-ink-2">{p.description}</p>}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {p.work_styles?.length > 0 && <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-3">Work styles that matter most</div>
          <ul className="flex flex-col gap-1.5">{p.work_styles.slice(0, compact ? 5 : 8).map((w: any) => (
            <li key={w.element_id} className="grid grid-cols-[1fr_90px] items-center gap-2 text-[13px]" title={w.description || ""}><span>{w.name}</span><Bar value={w.impact} max={3} tone="good" /></li>))}</ul>
        </div>}
        {p.work_context?.length > 0 && <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-3">Working conditions</div>
          <ul className="flex flex-col gap-1">{p.work_context.slice(0, compact ? 5 : 8).map((w: any) => (
            <li key={w.element_id} className="flex items-center justify-between gap-2 text-[13px]"><span className="min-w-0 truncate">{w.name}</span><span className="shrink-0 text-[12px] text-ink-3">{w.label || w.value}</span></li>))}</ul>
        </div>}
        <Rated title="Skills rated important" items={p.skills} />
        <Rated title="Knowledge rated important" items={p.knowledge} />
      </div>
      {p.technologies?.some((t: any) => t.hot || t.in_demand) && <div>
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3"><Flame className="h-3.5 w-3.5 text-warn" />Technologies employers ask for</div>
        <div className="flex flex-wrap gap-1.5">{p.technologies.filter((t: any) => t.hot || t.in_demand).slice(0, compact ? 10 : 20).map((t: any) => (
          <span key={t.example} title={[t.commodity, t.in_demand && "In Demand", t.hot && "Hot Technology"].filter(Boolean).join(" · ")}
            className={cx("rounded-md px-2 py-0.5 text-[12px]", t.skill_id && inFramework?.has(t.skill_id) ? "bg-good-soft text-good" : t.in_demand ? "bg-accent-soft text-accent" : "bg-sunken text-ink-2")}>{t.example}{t.in_demand ? " ★" : ""}</span>))}</div>
        <p className="mt-1 text-[11px] text-ink-3">★ In Demand for this occupation. {inFramework ? "Green: already in this role's framework." : ""}</p>
      </div>}
      {p.emerging_tasks?.length > 0 && <div>
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3"><Sparkles className="h-3.5 w-3.5 text-accent" />New tasks emerging in this occupation</div>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">{p.emerging_tasks.slice(0, compact ? 3 : 8).map((t: any, i: number) => <li key={i}>{t.task}</li>)}</ul>
      </div>}
      {!compact && p.related?.length > 0 && <div>
        <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-3">Related occupations</div>
        <div className="flex flex-wrap gap-1.5">{p.related.map((r: any) => <span key={r.code} className="rounded-md bg-sunken px-2 py-0.5 text-[12px] text-ink-2">{r.title}</span>)}</div>
      </div>}
      <Attribution items={p.attribution} />
    </div>
  );
}

/** Role page tab: the linked occupation, how it was linked, and a way to confirm or change it. */
export function RoleOccupation({ roleId }: { roleId: string }) {
  const d = useApi<any>(`/reference/roles/${roleId}`); const toast = useToast();
  const [picking, setPicking] = useState(false);
  const save = async (code: string | null) => {
    const r = await api("PUT", `/reference/roles/${roleId}`, { code });
    if (!r.ok) return toast(r.error!.message);
    toast(code ? "Occupation linked" : "Marked as no matching occupation"); setPicking(false); d.reload();
  };
  if (d.loading) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data.available) return <Card><Empty>No reference data is published yet. The platform administrator loads it under Reference data.</Empty></Card>;
  const { link, profile, candidates, can_edit } = d.data; const fw = new Set<string>(d.data.in_framework);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px]"><Link2 className="h-4 w-4 text-accent" />
            {link?.code ? <span>Linked to <b>{profile?.title}</b> · {link.method === "confirmed" ? `confirmed by ${link.confirmed_by}` : `found automatically (title match ${Math.round((link.score || 0) * 100)}%), please check`}</span>
              : link?.method === "none" ? <span>No occupation fits this role ({link.confirmed_by})</span>
              : <span className="text-ink-3">No close occupation found automatically.</span>}
          </div>
          {can_edit && <div className="flex gap-2">
            {link?.code && link.method === "auto" && <Button size="sm" variant="primary" onClick={() => save(link.code)}><Check className="h-4 w-4" />Confirm</Button>}
            <Button size="sm" onClick={() => setPicking(true)}><Search className="h-4 w-4" />{link?.code ? "Change" : "Choose occupation"}</Button>
          </div>}
        </div>
        {!link?.code && candidates?.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">Closest:{candidates.slice(0, 4).map((c: any) => <button key={c.code} disabled={!can_edit} onClick={() => save(c.code)} className="rounded-md bg-sunken px-2 py-0.5 hover:bg-accent-soft disabled:cursor-default">{c.title} <span className="num text-ink-3">{Math.round(c.score * 100)}%</span></button>)}</div>}
      </Card>
      {profile ? <Card><OccupationProfile p={profile} inFramework={fw} /></Card> : null}
      <OccupationPicker open={picking} onClose={() => setPicking(false)} onPick={save} initial={candidates} />
    </div>
  );
}

function OccupationPicker({ open, onClose, onPick, initial }: { open: boolean; onClose: () => void; onPick: (code: string | null) => void; initial?: any[] }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState<any[] | null>(null);
  useEffect(() => { if (!open) { setQ(""); setRes(null); } }, [open]);
  useEffect(() => { if (q.trim().length < 2) { setRes(null); return; } const t = setTimeout(async () => { const r = await api("GET", `/reference/occupations?q=${encodeURIComponent(q.trim())}`); if (r.ok) setRes(r.data); }, 250); return () => clearTimeout(t); }, [q]);
  const list = res ?? initial ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Choose the closest occupation" footer={<><Button onClick={() => onPick(null)}><X className="h-4 w-4" />None fits</Button><Button onClick={onClose}>Cancel</Button></>}>
      <input autoFocus className="inp mb-3" placeholder="Search occupations or job titles" value={q} onChange={e => setQ(e.target.value)} />
      {list.length ? <ul className="flex max-h-[50vh] flex-col gap-1 overflow-auto">{list.map((c: any) => (
        <li key={c.code}><button onClick={() => onPick(c.code)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-accent-soft/50">
          <span><b className="font-medium">{c.title}</b>{c.matched_title && c.matched_title !== c.title && <span className="block text-[12px] text-ink-3">also called {c.matched_title}</span>}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">{c.code}</span></button></li>))}</ul>
        : <Note tone="muted">{q.trim().length >= 2 ? "No occupations match." : "Type a job title."}</Note>}
    </Modal>
  );
}
