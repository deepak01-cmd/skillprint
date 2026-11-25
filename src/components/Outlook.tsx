"use client";
/* Skill trends and role outlook: the trend tag with its reasons, and the role outlook panel. */
import { ArrowDownRight, ArrowRight, ArrowUpRight, GraduationCap, RefreshCw, ShieldCheck, Sparkles, TrendingDown, TrendingUp, UserPlus } from "lucide-react";
import { Pill, StackBar, TREND_COLORS, cx } from "@/components/ui";

const LABEL_STYLE: Record<string, { cls: string; icon: any; text: string }> = {
  Growing: { cls: "bg-good-soft text-good", icon: TrendingUp, text: "Growing" },
  Stable: { cls: "bg-accent-soft text-accent", icon: ShieldCheck, text: "Stable" },
  Transforming: { cls: "bg-warn-soft text-warn", icon: RefreshCw, text: "Transforming" },
  "At risk": { cls: "bg-bad-soft text-bad", icon: TrendingDown, text: "At risk" },
};

export function TrendTag({ trend, reasons, confidence }: { trend: string; reasons?: string[]; confidence?: string }) {
  const Icon = trend === "Emerging" ? ArrowUpRight : trend === "Declining" ? ArrowDownRight : ArrowRight;
  return (
    <span className="group relative inline-flex">
      <Pill tone={trend}><Icon className="h-3 w-3" />{trend}</Pill>
      {reasons?.length ? <span className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-72 rounded-lg border border-line bg-card p-3 text-left text-[12px] font-normal leading-snug text-ink-2 shadow-pop group-hover:block">
        <b className="mb-1 block text-ink">{trend}{confidence ? ` · ${confidence.toLowerCase()} confidence` : ""}</b>
        <ul className="list-disc space-y-0.5 pl-4">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></span> : null}
    </span>
  );
}

export function OutlookBadge({ label, big }: { label: string; big?: boolean }) {
  const st = LABEL_STYLE[label] || LABEL_STYLE.Stable; const I = st.icon;
  return <span className={cx("inline-flex items-center gap-1.5 rounded-lg font-semibold", st.cls, big ? "px-3 py-1.5 text-[15px]" : "px-2 py-0.5 text-[12px]")}><I className={big ? "h-4 w-4" : "h-3.5 w-3.5"} />{st.text}</span>;
}

/** Role outlook for the next 2–3 years: label, mix of trends, skills to add, hire-or-train advice. */
export function OutlookPanel({ o, skills }: { o: any; skills?: { trend: string }[] }) {
  const list = skills || o.skills || [];
  const count = (t: string) => list.filter((s: any) => s.trend === t).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3"><OutlookBadge label={o.label} big /><span className="text-[13px] text-ink-3">Outlook for the {o.horizon || "next 2–3 years"}</span></div>
      <p className="text-[14px] text-ink-2">{o.summary}</p>
      {o.occupation?.reasons?.length > 0 && <div className="flex flex-col gap-1 rounded-lg bg-good-soft/50 px-3 py-2 text-[13px] text-ink-2">
        <span className="text-[12px] font-semibold text-good">Occupation: {o.occupation.title}</span>{o.occupation.reasons.map((r: string, i: number) => <span key={i}>{r}</span>)}</div>}
      {list.length > 0 && <StackBar parts={["Emerging", "Current", "Declining"].map(t => ({ label: t, value: count(t), color: TREND_COLORS[t] }))} unit=" skills" />}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3"><Sparkles className="h-3.5 w-3.5 text-accent" />Rising skills to add</div>
          {o.emerging_to_add?.length ? <ul className="flex flex-col gap-1.5">{o.emerging_to_add.map((t: any) => (
            <li key={t.skill_id || t.name} className="flex items-center justify-between gap-2 rounded-lg bg-sunken/60 px-3 py-2 text-[13px]" title={(t.reasons || []).join("\n")}>
              <span className="font-medium">{t.name}</span><span className="shrink-0 text-[12px] text-ink-3">{t.market_share ? `${t.market_share}% of postings · ` : ""}{t.people_with_it} with it</span></li>))}</ul>
            : <p className="text-[13px] text-ink-3">No rising skills missing from this role.</p>}
        </div>
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3"><GraduationCap className="h-3.5 w-3.5 text-accent" />Hire or train</div>
          <ul className="flex flex-col gap-1.5">{(o.advice || []).map((a: any, i: number) => {
            const I = a.kind === "hire" ? UserPlus : a.kind === "train" ? GraduationCap : a.kind === "reskill" ? RefreshCw : ShieldCheck;
            return <li key={i} className="flex items-start gap-2 text-[13px] text-ink-2"><I className={cx("mt-0.5 h-4 w-4 shrink-0", a.kind === "hire" ? "text-bad" : a.kind === "reskill" ? "text-warn" : "text-good")} />{a.text}</li>; })}</ul>
        </div>
      </div>
    </div>
  );
}
