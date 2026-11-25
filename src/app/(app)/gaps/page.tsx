"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { Bar, Card, Empty, ErrorBox, Loading, Note, PageHeader } from "@/components/ui";

export default function Gaps() {
  const { data: g, error, loading } = useApi<any>("/gaps");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const max = Math.max(1, ...g.skills.map((x: any) => x.with_gap || 0));
  const label = { org: "organisation", dept: "department", team: "team" }[g.scope as string];
  return (
    <>
      <PageHeader title={`Skill gaps: ${label}`} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card pad={false} title="By skill">
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th className="text-right">People requiring it</th><th>People with a gap</th><th className="text-right" title="Among people with a gap: how many levels below the needed level, on average">Average levels short</th><th className="text-right" title="Gaps on Mandatory skills or two or more levels short">High-priority gaps</th><th className="text-right" title="Required skills with no confirmed level yet">Not yet assessed</th></tr></thead>
            <tbody>{g.skills.map((x: any) => x.suppressed ? <tr key={x.skill_id} className="text-ink-3"><td>{x.skill_name}</td><td colSpan={5}>{x.detail}</td></tr> : (
              <tr key={x.skill_id}><td><Link className="hover:underline" href={`/skills/${x.skill_id}`}>{x.skill_name}</Link><div className="text-xs text-ink-3">{x.skill_category}</div></td><td className="num text-right">{x.employees}</td>
                <td className="min-w-[160px]"><div className="flex items-center gap-2"><Bar value={x.with_gap} max={x.employees || 1} tone="bad" /><span className="num w-16 shrink-0 text-right text-[12.5px]"><b>{x.with_gap}</b> of {x.employees}</span></div></td>
                <td className="num text-right">{x.avg_gap || "—"}</td><td className="num text-right">{x.high_priority}</td><td className="num text-right text-ink-3">{x.no_data}</td></tr>))}</tbody></table></div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card pad={false} title="By department">
            <table className="t"><thead><tr><th>Department</th><th className="text-right">People</th><th className="text-right">Skill gaps</th><th className="text-right" title="Gaps on Mandatory skills or two or more levels short">High-priority gaps</th></tr></thead>
              <tbody>{g.departments.map((d: any) => <tr key={d.department_id} className={d.suppressed ? "text-ink-3" : ""}><td>{d.department_name}</td><td className="num text-right">{d.employees}</td>{d.suppressed ? <td colSpan={2} className="text-right text-xs">{d.detail}</td> : <><td className="num text-right">{d.gaps}</td><td className="num text-right">{d.high}</td></>}</tr>)}</tbody></table>
          </Card>
          {g.individual && <Card pad={false} title="By person (your direct reports)">
            {g.individual.length ? <table className="t"><thead><tr><th>Name</th><th className="text-right">Skill gaps</th><th className="text-right" title="Gaps on Mandatory skills or two or more levels short">High-priority gaps</th><th className="text-right" title="Required skills with no confirmed level yet">Not yet assessed</th></tr></thead>
              <tbody>{g.individual.map((p: any) => <tr key={p.employee_id}><td><Link className="font-medium text-accent hover:underline" href={`/employees/${p.employee_id}`}>{p.name}</Link></td><td className="num text-right">{p.gaps}</td><td className="num text-right">{p.high}</td><td className="num text-right">{p.no_data}</td></tr>)}</tbody></table> : <Empty>No direct reports.</Empty>}
          </Card>}
        </div>
      </div>
    </>
  );
}
