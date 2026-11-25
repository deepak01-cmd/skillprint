"use client";
import { Level, Pill, pct } from "@/components/ui";

export function CompareResult({ c }: { c: any }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]"><b>{c.from.title}</b> → <b>{c.to.title}</b> <Pill tone={c.defined_path ? "Published" : "Draft"}>{c.path_label}</Pill>{c.level_change !== null && <span className="text-ink-3">{c.level_change > 0 ? `${c.level_change} career level${c.level_change > 1 ? "s" : ""} up` : c.level_change === 0 ? "same career level" : `${-c.level_change} level${c.level_change < -1 ? "s" : ""} down`}</span>}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[["Skills the target role needs", c.skills_in_target], ["Already in current role", c.shared_skills], ["New skills to learn", c.new_skills], ["Need a higher level", c.skills_needing_higher_level], ["Levels to gain (total)", c.level_points_to_close], ["Skills in common", pct(c.skill_overlap)]].map(([l, v]) => <div key={l as string} className="rounded-md border border-line px-3 py-2"><div className="text-xs text-ink-3">{l}</div><div className="num text-lg font-bold">{v}</div></div>)}
        <div className="rounded-md border border-line px-3 py-2"><div className="text-xs text-ink-3">Move difficulty</div><Pill tone={c.move_difficulty === "Low" ? "Met" : c.move_difficulty === "Medium" ? "Medium" : "High"}>{c.move_difficulty}</Pill></div>
      </div>
      <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Level the current (from) role needs">Needed now</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Needed in target role</th><th className="text-right">Levels to gain</th><th title="Shared: the current role needs it too. New: a skill to learn.">In current role?</th></tr></thead>
        <tbody>{c.lines.map((l: any) => <tr key={l.skill_id}><td>{l.skill_name}</td><td><Level n={l.source_level} short /></td><td><Level n={l.target_level} short /></td><td className="num text-right">{l.difference > 0 ? `+${l.difference}` : l.difference}</td><td>{l.kind === "new" ? <Pill tone="Medium">No: new skill</Pill> : <span className="text-ink-3">Yes</span>}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-ink-3">Thresholds (assumption set v{c.assumption_version}): Low with at most {c.thresholds.low.new_skills} new skills and {c.thresholds.low.level_points} points; Medium with at most {c.thresholds.medium.new_skills} and {c.thresholds.medium.level_points}. Guidance for conversations, not a decision.</p>
    </div>
  );
}

