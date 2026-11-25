"use client";
/* Career tracks: what each kind of move means, and for one path the steps, the time it usually takes and how every skill changes
   (a lead keeps what the mid-level and senior roles need and adds more). */
import { ArrowRight, ChevronsUp, Clock, GitBranch, MoveHorizontal, Shuffle, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/api";
import { Card, ErrorBox, Loading, Modal, Note, Pill, cx } from "@/components/ui";

export const MOVEMENT_INFO: Record<string, { short: string; text: string; icon: any; tone: string }> = {
  "Vertical": { short: "Promotion, one level up", text: "The next level in the same track, for example Data Analyst to Senior Data Analyst.", icon: TrendingUp, tone: "text-good bg-good-soft" },
  "Vertical (skip-level)": { short: "Two levels up in one move", text: "For people already strong at the level in between: the target role needs the skills of both levels below it, plus its own.", icon: ChevronsUp, tone: "text-accent bg-accent-soft" },
  "Vertical (track change)": { short: "One level up into another track", text: "For example from a senior specialist into management: hands-on skills matter less, leadership skills more.", icon: GitBranch, tone: "text-warn bg-warn-soft" },
  "Lateral": { short: "Same level, different role", text: "A move at the same level, usually in the same area, to broaden skills.", icon: MoveHorizontal, tone: "text-ink-2 bg-sunken" },
  "Cross-functional": { short: "Into another department", text: "A move to a role in another department at the same or an adjacent level.", icon: Shuffle, tone: "text-ink-2 bg-sunken" },
};
const ORDER = ["Vertical", "Vertical (skip-level)", "Vertical (track change)", "Lateral", "Cross-functional"];
const an = (w: string) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
const months = (m: number | null | undefined) => m == null ? "time not set" : m >= 24 && m % 12 === 0 ? `${m / 12} years` : `${m} months`;

/** One card per kind of move: what it means, how many paths, how long they usually take, and an example. */
export function MovementSummary({ paths, active, onPick }: { paths: any[]; active?: string; onPick?: (t: string) => void }) {
  const pub = paths.filter(p => p.status === "Published");
  const types = ORDER.filter(t => pub.some(p => p.movement_type === t));
  if (!types.length) return null;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {types.map(t => {
        const ps = pub.filter(p => p.movement_type === t); const info = MOVEMENT_INFO[t] || MOVEMENT_INFO.Lateral; const I = info.icon;
        const ms = ps.map(p => p.typical_months).filter((m: any) => m != null) as number[];
        const range = ms.length ? (Math.min(...ms) === Math.max(...ms) ? months(ms[0]) : `${months(Math.min(...ms))} to ${months(Math.max(...ms))}`) : "not set";
        const ex = ps[0];
        return (
          <button key={t} onClick={() => onPick?.(active === t ? "" : t)} className={cx("flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-card transition hover:border-accent/50", active === t ? "border-accent ring-2 ring-accent/30" : "border-line/70")}>
            <span className="flex items-center justify-between gap-2"><span className={cx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold", info.tone)}><I className="h-3.5 w-3.5" />{t}</span><b className="num text-[20px]">{ps.length}</b></span>
            <span className="text-[13px] font-medium">{info.short}</span>
            <span className="text-[12px] leading-snug text-ink-3">{info.text}</span>
            <span className="mt-auto flex flex-col gap-0.5 border-t border-line pt-2 text-[12px] text-ink-2">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-ink-3" />Usually takes {range}</span>
              {ex && <span className="truncate" title={`${ex.from_title} → ${ex.to_title}`}>e.g. {ex.from_title} → {ex.to_title}</span>}
            </span>
          </button>);
      })}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { new: "New skills to learn", raise: "Skills to deepen (higher level needed)", less: "Skills that become less central", dropped: "Skills no longer needed", same: "Skills already at the needed level" };

/** The track for one path: steps, time and every skill at every step. */
export function CareerTrack({ pathId, me }: { pathId: string; me?: boolean }) {
  const t = useApi<any>(`/career-paths/${pathId}/track${me ? "?me=1" : ""}`);
  if (t.loading) return <Loading />;
  if (t.error) return <ErrorBox error={t.error} />;
  const d = t.data; const steps = d.steps; const last = steps.length - 1; const info = MOVEMENT_INFO[d.path.movement_type];
  const groups = ["new", "raise", "less", "dropped", "same"].map(k => ({ k, rows: d.skills.filter((s: any) => s.kind === k) })).filter(g => g.rows.length);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((st: any, i: number) => <span key={st.role_id} className="flex items-center gap-2">
          <span className={cx("rounded-lg border px-3 py-1.5 text-[13px]", i === last ? "border-accent bg-accent-soft/60" : "border-line bg-card")}><b className="font-semibold">{st.title}</b><span className="block text-[11px] text-ink-3">{st.level || "level not set"} · {st.track}</span></span>
          {i < last && <span className="flex flex-col items-center text-[11px] text-ink-3"><ArrowRight className="h-4 w-4" />{d.legs[i]?.months ? months(d.legs[i].months) : ""}</span>}</span>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-1 rounded-xl bg-sunken/60 p-3 text-[13px]">
          <div className="flex items-center gap-1.5 font-semibold">{info && <info.icon className="h-4 w-4 shrink-0 text-accent" />}{d.path.movement_type}</div>
          {d.path.level_change != null && <div className="text-ink-2">{d.path.level_change > 0 ? `${d.path.level_change} career level${d.path.level_change > 1 ? "s" : ""} up` : "Same career level"}</div>}
          <div className="flex items-center gap-1 text-ink-2"><Clock className="h-3.5 w-3.5 shrink-0" />Usually takes {months(d.path.typical_months)}</div>
          {d.step_by_step_months ? <div className="text-[12px] text-ink-3">One step at a time: {months(d.step_by_step_months)}</div> : null}
        </div>
        {[["Already at the needed level", d.summary.keep], ["Skills to deepen", d.summary.raise], ["New skills to learn", d.summary.new], ["Levels to gain (total)", d.summary.level_points]].map(([l, v]) => <div key={l as string} className="rounded-xl border border-line p-3"><div className="text-[12px] text-ink-3">{l}</div><b className="num text-[20px]">{v}</b></div>)}
      </div>
      {steps.length > 2 && <Note>{an(steps[last].title).replace(/^./, c => c.toUpperCase())} needs what {an(steps[0].title)} has, the extra skills and levels of {an(steps[1].title)}, and new skills of its own. The table shows the level each role needs.</Note>}
      {me && d.you && <Note tone="good">You already meet {d.you.ready} of the {d.you.needed} skills {an(steps[last].title)} needs.</Note>}
      <div className="overflow-x-auto"><table className="t [&_th]:whitespace-normal [&_th]:align-bottom">
        <thead><tr><th className="w-[22%]">Skill</th>{steps.map((st: any, i: number) => <th key={st.role_id} className="text-center" title={`Level ${an(st.title)} needs (1 to 5) and whether it is Mandatory, Preferred or Optional`}><span className="block text-[10.5px] text-ink-3">{i === 0 ? "Needed now as" : i === last ? "Needed as (target)" : "Needed as"}</span><span className="normal-case tracking-normal text-[12.5px] text-ink">{st.title}</span></th>)}{me && <th className="text-center">Your level</th>}<th>What changes</th></tr></thead>
        {groups.map(g => <tbody key={g.k}>
          <tr><td colSpan={steps.length + (me ? 3 : 2)} className="bg-sunken/50 text-[11px] font-bold uppercase tracking-wider text-ink-3">{KIND_LABEL[g.k]} ({g.rows.length})</td></tr>
          {g.rows.map((s: any) => <tr key={s.skill_id}><td className="font-medium">{s.name}</td>
            {s.cells.map((c: any, i: number) => <td key={i} className="text-center">{c ? <span title={c.requirement_type}><b className="num">{c.level}</b> <span className="text-[11px] text-ink-3">{c.requirement_type}</span></span> : <span className="text-[12px] text-ink-3">not needed</span>}</td>)}
            {me && <td className="num text-center">{s.your_level ?? "—"}</td>}
            <td className={cx("text-[12px]", s.kind === "new" ? "text-accent" : s.kind === "raise" ? "text-warn" : "text-ink-3")}>{s.change}</td></tr>)}
        </tbody>)}
      </table></div>
      <p className="text-[12px] text-ink-3">Levels: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert. Mandatory = needed on day one; Preferred = expected soon after; Optional = useful.</p>
    </div>
  );
}

export function CareerTrackModal({ pathId, onClose, me }: { pathId: string | null; onClose: () => void; me?: boolean }) {
  return <Modal open={!!pathId} onClose={onClose} title="Career track: time and skills" xl>{pathId && <CareerTrack pathId={pathId} me={me} />}</Modal>;
}
