"use client";
/* Internal job postings: cards, status tracker, match colours. */
import Link from "next/link";
import { CalendarClock, Check, MapPin, Users } from "lucide-react";
import { Pill, Ring, cx } from "@/components/ui";

const STEPS = ["Applied", "Screening", "Interview", "Offered", "Hired"];
export function daysLeft(d: string | null) { if (!d) return null; const n = Math.ceil((new Date(String(d).slice(0, 10)).getTime() + 864e5 - Date.now()) / 864e5); return n; }
export const toneFor = (m: number) => m >= 75 ? "good" : m >= 50 ? "acc" : m >= 30 ? "warn" : "bad";

export function Tracker({ status }: { status: string }) {
  const end = status === "Not selected" || status === "Withdrawn";
  const at = STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1" aria-label={`Status: ${status}`}>
      {STEPS.map((s, i) => <div key={s} className="flex flex-1 flex-col items-center gap-1">
        <div className={cx("h-1.5 w-full rounded-full", end ? "bg-sunken" : i <= at ? "bg-gradient-to-r from-accent to-accent-3" : "bg-sunken")} />
        <span className={cx("text-[10.5px] font-semibold", !end && i === at ? "text-accent" : "text-ink-3")}>{s}</span></div>)}
    </div>
  );
}

export function JobCard({ j }: { j: any }) {
  const left = daysLeft(j.closes_on);
  return (
    <Link href={`/jobs/${j.id}`} className="lift group flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-accent">{j.department_name}</div>
          <h3 className="mt-0.5 text-[16px] font-bold leading-snug group-hover:text-accent">{j.title}</h3>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-3">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location || "—"} · {j.work_mode}</span>
            {j.career_level && <span>{j.career_level}</span>}
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{j.openings} opening{j.openings > 1 ? "s" : ""}</span>
          </div>
        </div>
        {typeof j.match_pct === "number" && <Ring value={j.match_pct} size={64} stroke={11} tone={toneFor(j.match_pct)} label={<span className="text-[14px]">{j.match_pct}%</span>} />}
      </div>
      {j.top_gaps?.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-[12px]"><span className="text-ink-3">To grow:</span>{j.top_gaps.map((g: string) => <span key={g} className="rounded-lg bg-sunken px-2 py-0.5 font-medium text-ink-2">{g}</span>)}</div>}
      {typeof j.skills_met === "number" && j.skills_required > 0 && <div className="flex items-center gap-2 text-[12px] text-ink-3"><span className="inline-flex items-center gap-1 font-semibold text-good"><Check className="h-3.5 w-3.5" />{j.skills_met}/{j.skills_required} skills</span>{j.mandatory_gaps > 0 && <span>· {j.mandatory_gaps} must-have gap{j.mandatory_gaps > 1 ? "s" : ""}</span>}</div>}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-2 pt-3 text-[12px]">
        <span className="inline-flex items-center gap-1 text-ink-3"><CalendarClock className="h-3.5 w-3.5" />{left === null ? "No closing date" : left <= 0 ? "Closes today" : `${left} day${left > 1 ? "s" : ""} left`}</span>
        {j.current_role ? <Pill tone="Draft">Your role</Pill> : j.application ? <Pill>{j.application.status}</Pill> : j.min_match > 0 && j.match_pct < j.min_match ? <Pill tone="Closed">Needs {j.min_match}%</Pill> : <span className="font-semibold text-accent">View & apply →</span>}
      </div>
    </Link>
  );
}

