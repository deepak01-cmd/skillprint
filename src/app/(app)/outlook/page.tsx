"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GraduationCap, RefreshCw, TrendingDown, TrendingUp, UserPlus } from "lucide-react";
import { useApi } from "@/lib/api";
import { Card, Donut, Empty, ErrorBox, Loading, Note, PageHeader, Pill, Stat, cx } from "@/components/ui";
import { OutlookBadge, TrendTag } from "@/components/Outlook";
import { Attribution } from "@/components/Reference";

const LABELS = ["Growing", "Stable", "Transforming", "At risk"] as const;
const COLORS: Record<string, string> = { Growing: "rgb(22 163 74)", Stable: "rgb(124 47 247)", Transforming: "rgb(217 119 6)", "At risk": "rgb(220 38 38)" };

/** Which roles and skills stay relevant, which are rising and which are being replaced, and whether to hire or train for them. */
export default function OutlookPage() {
  const { data: d, error, loading } = useApi<any>("/outlook");
  const [f, setF] = useState("");
  const roles = useMemo(() => (d?.roles || []).filter((r: any) => !f || r.label === f), [d, f]);
  if (loading) return <><PageHeader title="Future outlook" /><Loading rows={6} /></>;
  if (error) return <><PageHeader title="Future outlook" /><ErrorBox error={error} /></>;
  const total = d.roles.length;
  return (
    <>
      <PageHeader title="Future outlook" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {LABELS.map(l => <button key={l} onClick={() => setF(f === l ? "" : l)} className={cx("text-left", f === l && "ring-2 ring-accent rounded-xl")}>
          <Stat label={`${l} roles`} value={d.counts[l]} tone={l === "Growing" ? "good" : l === "At risk" ? "bad" : l === "Transforming" ? "warn" : undefined} sub={total ? `${Math.round(d.counts[l] / total * 100)}% of roles` : undefined} /></button>)}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Roles by outlook">
          <div className="flex flex-col items-center gap-3">
            <Donut data={LABELS.map(l => ({ label: l, value: d.counts[l], color: COLORS[l] }))} label={total} sub="roles" />
          </div>
        </Card>
        <Card title={f ? `${f} roles` : "Roles ranked by outlook"} pad={false} actions={f ? <button className="text-[13px] text-accent" onClick={() => setF("")}>Show all</button> : null}>
          {roles.length ? <div className="max-h-[420px] overflow-auto"><table className="t"><thead><tr><th>Role</th><th>Outlook</th><th>People</th><th>Rising skills</th><th>Declining skills</th></tr></thead>
            <tbody>{roles.map((r: any) => <tr key={r.id}><td><Link className="font-medium text-accent hover:underline" href={`/roles/${r.id}`}>{r.title}</Link><div className="text-[12px] text-ink-3">{r.department_name}</div></td>
              <td><div className="flex flex-col items-start gap-1"><OutlookBadge label={r.label} />{r.outlook_flags?.length > 0 && <span className="text-[11px] text-good" title="O*NET Bright Outlook (U.S. projections) for the linked occupation">↗ {r.outlook_flags.join(", ")}</span>}</div></td><td className="num">{r.headcount}</td>
              <td className="max-w-[220px]"><div className="flex flex-wrap gap-1">{r.emerging.slice(0, 3).map((n: string) => <Pill key={n} tone="Emerging">{n}</Pill>)}{r.emerging.length > 3 && <span className="text-[12px] text-ink-3">+{r.emerging.length - 3}</span>}</div></td>
              <td className="max-w-[220px]"><div className="flex flex-wrap gap-1">{r.declining.slice(0, 3).map((n: string) => <Pill key={n} tone="Declining">{n}</Pill>)}{r.declining.length > 3 && <span className="text-[12px] text-ink-3">+{r.declining.length - 3}</span>}</div></td></tr>)}</tbody></table></div>
            : <Empty>No published roles.</Empty>}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-good" />Rising skills: hire or train</span>} pad={false}>
          {d.emerging.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th title="Active employees assessed at level 3 or above">Have it</th><th title="People in roles that require it">Needed by</th><th>What to do</th></tr></thead>
            <tbody>{d.emerging.slice(0, 25).map((k: any) => { const gap = k.people_in_roles_needing_it - k.people_with_it; const plan = k.people_with_it === 0 && k.people_in_roles_needing_it > 0 ? "hire" : gap > 0 ? "train" : "keep";
              return <tr key={k.skill_id}><td className="font-medium">{k.name}<div className="text-[12px] text-ink-3">{k.roles} roles</div></td><td><TrendTag trend={k.trend} reasons={k.reasons} confidence={k.confidence} /></td>
                <td className="num">{k.people_with_it}</td><td className="num">{k.people_in_roles_needing_it}</td>
                <td className="whitespace-nowrap">{plan === "hire" ? <span className="inline-flex items-center gap-1 text-[13px] text-bad"><UserPlus className="h-4 w-4" />Hire</span> : plan === "train" ? <span className="inline-flex items-center gap-1 text-[13px] text-warn"><GraduationCap className="h-4 w-4" />Train {gap}</span> : <span className="text-[13px] text-good">Covered</span>}</td></tr>; })}</tbody></table></div>
            : <Empty>No rising skills in your framework yet.</Empty>}
        </Card>
        <Card title={<span className="inline-flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-bad" />Declining skills: reskill people</span>} pad={false}>
          {d.declining.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th>People with it</th><th>Roles using it</th></tr></thead>
            <tbody>{d.declining.slice(0, 25).map((k: any) => <tr key={k.skill_id}><td className="font-medium">{k.name}</td><td><TrendTag trend={k.trend} reasons={k.reasons} confidence={k.confidence} /></td>
              <td className="num">{k.people_with_it ? <span className="inline-flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5 text-warn" />{k.people_with_it}</span> : 0}</td><td className="num">{k.roles}</td></tr>)}</tbody></table></div>
            : <Empty>No declining skills in your framework.</Empty>}
        </Card>
      </div>
      <div className="mt-4"><Note tone="muted">Trends combine job-posting momentum{d.market && !d.market.momentum_available ? " (not enough dated postings yet, so it is not used)" : ""}, your company's skill evidence, industry knowledge, automation exposure{d.reference?.linked_roles ? ` and labour-market reference data for the occupations ${d.reference.linked_roles} of your roles are linked to` : ""}. Hover a trend to see why.</Note><Attribution items={d.reference?.attribution} /></div>
    </>
  );
}
