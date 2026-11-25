"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, PageHeader, Pill, cx } from "@/components/ui";
import { Legend } from "@/components/ui";

export default function Team() {
  const m = useApi<any>("/team/matrix"); const mob = useApi<any[]>("/mobility/team");
  if (m.loading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  const cell = (g: any, key: string) => {
    if (!g) return <td key={key} className="bg-sunken" />;
    const tone = g.status === "Met" ? "bg-good-soft text-good" : g.status === "Gap" ? (g.priority === "High" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn") : "bg-sunken text-ink-3";
    return <td key={key} className={cx("text-center text-xs font-semibold num", tone)} title={`${g.skill_name}: ${g.current_level ?? "no data"} of ${g.required_level} (${g.status})`}>{g.current_level ?? "?"}/{g.required_level}</td>;
  };
  return (
    <>
      <PageHeader title="My team" />
      <Card pad={false} title="Team skill matrix" sub="Each cell: current level / level the person's role requires">
        <Legend className="px-4 pb-3 sm:px-6" items={[{ label: "Meets the requirement", color: "#0E9F6E" }, { label: "Below required level", color: "#C27803" }, { label: "High-priority gap", color: "#E02424" }, { label: "Not assessed yet", color: "#9CA3AF" }]} />
        {m.data.rows.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th className="sticky left-0 bg-card">Person</th>{m.data.skills.map((s: any) => <th key={s.id} className="max-w-[90px] whitespace-normal text-[11px] leading-tight">{s.name}</th>)}</tr></thead>
          <tbody>{m.data.rows.map((r: any) => { const by = new Map(r.gaps.map((g: any) => [g.skill_id, g])); return <tr key={r.employee_id}><td className="sticky left-0 whitespace-nowrap bg-card"><Link className="font-medium text-accent hover:underline" href={`/employees/${r.employee_id}`}>{r.name}</Link><div className="text-xs text-ink-3">{r.role_title}</div></td>{m.data.skills.map((s: any) => cell(by.get(s.id), s.id))}</tr>; })}</tbody></table></div> : <Empty>No direct reports.</Empty>}
      </Card>
      <Card className="mt-4" pad={false} title="Shared career aspirations">
        {(mob.data || []).length ? <table className="t"><thead><tr><th>Person</th><th>Current role</th><th>Target role</th><th>Priority</th><th title="How close the person is to the target role&#x27;s requirements">Readiness for target</th><th className="text-right">Skills met</th><th className="text-right" title="All the levels still missing across the role&#x27;s skills, added up">Levels short (total)</th></tr></thead>
          <tbody>{mob.data!.map(a => <tr key={a.id}><td><Link className="font-medium text-accent hover:underline" href={`/employees/${a.employee_id}`}>{a.employee_name}</Link></td><td>{a.current_title}</td><td>{a.target_title}</td><td>{a.priority}</td><td><Pill>{a.readiness.band}</Pill></td><td className="num text-right">{a.readiness.skills_met}/{a.readiness.skills_required}</td><td className="num text-right">{a.readiness.gap_points}</td></tr>)}</tbody></table> : <Empty>No shared aspirations yet.</Empty>}
      </Card>
    </>
  );
}
