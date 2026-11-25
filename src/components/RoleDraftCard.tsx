"use client";
/* A drafted role profile for a title that is not in the framework. Shown at once, clearly marked as unreviewed. */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Database, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Card, Level, Note, Pill, cx } from "@/components/ui";
import { OutlookPanel, TrendTag } from "@/components/Outlook";
import { OccupationProfile } from "@/components/Reference";

/** Starts (or reuses) the draft for a title and follows it until it is ready. */
export function useRoleDraft(title: string | null) {
  const [state, setState] = useState<{ draft?: any; matched?: any; error?: string } | null>(null);
  const timer = useRef<any>(null);
  useEffect(() => {
    clearTimeout(timer.current); setState(null);
    if (!title || title.trim().length < 3) return;
    let stop = false;
    const poll = async (id: string) => {
      const r = await api("GET", `/ai/role-drafts/${id}`);
      if (stop) return;
      if (r.ok) { setState({ draft: r.data }); if (r.data.status === "Generating") timer.current = setTimeout(() => poll(id), 1200); }
    };
    api("POST", "/ai/role-drafts", { title }).then(r => {
      if (stop) return;
      if (!r.ok) return setState({ error: r.error?.message });
      setState(r.data);
      if (r.data.draft?.status === "Generating") timer.current = setTimeout(() => poll(r.data.draft.id), 1500);
    });
    return () => { stop = true; clearTimeout(timer.current); };
  }, [title]);
  return state;
}

export function RoleDraftCard({ draft, compact, footer, onRegenerate }: { draft: any; compact?: boolean; footer?: React.ReactNode; onRegenerate?: () => void }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { if (draft.status !== "Generating") return; const t = setInterval(() => setSecs(x => x + 1), 1000); return () => clearInterval(t); }, [draft.status]);
  if (draft.status === "Generating") return <DraftProgress draft={draft} secs={secs} />;
  if (draft.status === "Failed") return <Note tone="bad">The draft for “{draft.query}” could not be made: {draft.error}.{onRegenerate && <button className="ml-2 font-medium text-accent hover:underline" onClick={onRegenerate}>Try again</button>}</Note>;
  const p = draft.payload || {};
  const ai = draft.method === "ai";
  return (
    <section className="anim-in rounded-xl border-2 border-dashed border-accent/50 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-paper">{ai ? <Bot className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}{ai ? "AI draft" : "Draft from data"}</span>
            <Pill tone={draft.status === "Approved" ? "Approved" : draft.status === "Rejected" ? "Rejected" : "In Review"}>{draft.status === "Ready" ? "not reviewed" : draft.status.toLowerCase()}</Pill>
            <span className="font-mono text-[11.5px] text-ink-3">confidence {p.confidence}{ai && draft.model ? ` · ${draft.model}` : ""}</span>
          </div>
          <h2 className="font-serif text-[22px] font-bold leading-tight">{p.title}</h2>
          {p.alt_titles?.length > 0 && <div className="text-[12.5px] text-ink-3">Also called: {p.alt_titles.join(", ")}</div>}
        </div>
        {onRegenerate && draft.status !== "Approved" && <button onClick={onRegenerate} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"><RefreshCw className="h-3.5 w-3.5" />Draft again</button>}
      </div>
      <div className={cx("grid gap-5 px-4 py-4", !compact && "lg:grid-cols-[1fr_1.1fr]")}>
        <div className="flex min-w-0 flex-col gap-3 text-[13.5px]">
          {p.summary && <p>{p.summary}</p>}
          {p.responsibilities?.length > 0 && <div><div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-3">Responsibilities</div>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">{p.responsibilities.slice(0, compact ? 5 : 10).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
          {(p.experience || p.education) && <div className="text-[12.5px] text-ink-3">{[p.experience, p.education].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="min-w-0">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-3">Skills ({p.skills?.length || 0})</div>
          {p.skills?.length ? <table className="t"><tbody>{p.skills.slice(0, compact ? 8 : 15).map((s: any) => (
            <tr key={s.skill_id || s.name}><td><Link href={s.skill_id ? `/skills/${s.skill_id}` : "#"} className="font-medium hover:text-accent">{s.name}</Link>{!compact && s.why && <div className="text-[11.5px] text-ink-3">{s.why}</div>}</td>
              <td><Level n={s.required_level} short tone="acc" /></td><td><Pill tone={s.requirement_type}>{s.requirement_type}</Pill></td><td>{s.trend && <TrendTag trend={s.trend} reasons={s.trend_reasons} confidence={s.trend_confidence} />}</td></tr>))}</tbody></table>
            : <p className="text-[13px] text-ink-3">No skills found for this title yet.</p>}
          {p.new_skills?.length > 0 && <div className="mt-3 text-[12.5px]"><span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">New skills (not in the library) </span>{p.new_skills.map((n: any) => <span key={n.name} className="mr-1.5 inline-block rounded border border-dashed border-accent/60 px-1.5 py-0.5">{n.name}</span>)}</div>}
        </div>
      </div>
      {p.outlook && <div className="border-t border-line px-4 py-4"><div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">Future outlook</div><OutlookPanel o={p.outlook} skills={p.skills} /></div>}
      {p.reference && !compact && <div className="border-t border-line px-4 py-4"><div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">Closest occupation (reference data)</div><OccupationProfile p={p.reference} compact /></div>}
      <div className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        {p.evidence?.sources?.length ? <>Based on {p.evidence.sources.join(" · ")}. </> : "No matching evidence was found. "}
        {(p.notes || []).join(" ")} Nothing enters your framework until HR approves it.
      </div>
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </section>
  );
}

const STEPS = ["Gathering evidence", "Scoring skills from job postings and similar roles", "Writing the profile", "Matching a reference occupation", "Predicting skill trends", "Saving"];
/** Progress while a draft is generated: percentage from the server, and the steps. */
export function DraftProgress({ draft, secs }: { draft: any; secs: number }) {
  const pct = Math.max(2, Math.min(99, draft.progress || 0));
  const at = Math.max(0, STEPS.indexOf(draft.stage || "Gathering evidence"));
  return (
    <section className="anim-in rounded-xl border border-line/70 bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-center gap-4">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <div className="min-w-0 flex-1"><div className="text-[18px] font-semibold">Drafting “{draft.query}”</div><div className="text-[13px] text-ink-3">{draft.stage || "Starting"}{secs > 25 ? " · a local model can take a minute or two" : ""}</div></div>
        <div className="num text-[28px] font-semibold text-accent">{pct}%</div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{STEPS.map((st, i) => (
        <li key={st} className={cx("rounded-lg px-3 py-2 text-[12px]", i < at ? "bg-good-soft text-good" : i === at ? "bg-accent-soft font-semibold text-accent" : "bg-sunken text-ink-3")}>{i < at ? "✓ " : ""}{st}</li>))}</ol>
      <div className="mt-3 text-right text-[12px] text-ink-3 num">{secs}s</div>
    </section>
  );
}
