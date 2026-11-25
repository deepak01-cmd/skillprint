"use client";
/* Move planner: how far apart two roles really are, and whether the move heads toward emerging or declining skills. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Card, Empty, ErrorBox, Level, Loading, PageHeader, Pill, cx } from "@/components/ui";
import { Legend } from "@/components/ui";

const DIFF: Record<string, string> = { Low: "text-good", Medium: "text-warn", High: "text-accent" };

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border border-current px-2 py-px font-mono text-[12px] font-medium", cls)}>{children}</span>;
}

/** Category fingerprint: distance from centre is the highest level required in each skill category. */
function Radar({ cats, a, b, aLabel, bLabel }: { cats: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string }) {
  const n = cats.length, cx0 = 150, cy0 = 135, r = 92;
  if (n < 3) return <p className="text-[13px] text-ink-3">Not enough skill categories to draw a fingerprint.</p>;
  const pt = (k: number, v: number) => { const an = (2 * Math.PI * k) / n - Math.PI / 2; return [cx0 + Math.cos(an) * r * v / 5, cy0 + Math.sin(an) * r * v / 5]; };
  const poly = (vals: number[]) => vals.map((v, k) => pt(k, v).join(",")).join(" ");
  return (
    <svg viewBox="-30 0 360 270" width="100%" role="img" aria-label={`Skill fingerprint: ${cats.map((c, i) => `${c} ${aLabel} ${a[i]}, ${bLabel} ${b[i]}`).join("; ")}`}>
      {[1, 3, 5].map(l => <polygon key={l} points={poly(cats.map(() => l))} fill="none" stroke="rgb(var(--line))" />)}
      {cats.map((_, k) => { const [x, y] = pt(k, 5); return <line key={k} x1={cx0} y1={cy0} x2={x} y2={y} stroke="rgb(var(--line))" strokeWidth=".6" />; })}
      {cats.map((c, k) => { const [x, y] = pt(k, 6.1); const anchor = x < cx0 - 5 ? "end" : x > cx0 + 5 ? "start" : "middle";
        return <text key={c} x={x} y={y + 3} textAnchor={anchor} style={{ fill: "rgb(var(--ink-3))", font: "10.5px var(--font-sans)" }}>{c.split(/ & | /)[0]}</text>; })}
      {[1, 3, 5].map(l => <text key={l} x={cx0 + 3} y={cy0 - r * l / 5 + 3} style={{ fill: "rgb(var(--ink-3))", font: "9px var(--font-sans)" }}>{l}</text>)}
      <polygon points={poly(b)} fill="rgb(var(--accent))" fillOpacity=".18" stroke="rgb(var(--accent))" strokeWidth="2" />
      <polygon points={poly(a)} fill="#FF8A4C" fillOpacity=".08" stroke="#FF8A4C" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

function RoleSelect({ id, value, roles, onChange, label }: { id: string; value: string; roles: any[]; onChange: (v: string) => void; label: string }) {
  const depts = [...new Set(roles.map(r => r.department_name))];
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-ink-3">{label}
      <select id={id} className="inp min-w-[200px] text-[14px]" value={value} onChange={e => onChange(e.target.value)}>
        {depts.map(d => <optgroup key={d} label={d}>{roles.filter(r => r.department_name === d).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</optgroup>)}
      </select>
    </label>
  );
}

export default function MovePlanner() {
  const s = useSession();
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [mand, setMand] = useState(false);
  useEffect(() => { const p = new URLSearchParams(window.location.search); if (p.get("from")) setFrom(p.get("from")!); if (p.get("to")) setTo(p.get("to")!); }, []);
  const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }), ...(mand && { mandatory_only: "true" }) }).toString();
  const { data: d, error, loading } = useApi<any>(`/mobility/move${qs ? `?${qs}` : ""}`);
  useEffect(() => { if (d?.from && !from) setFrom(d.from.id); if (d?.to && !to) setTo(d.to.id); }, [d, from, to]);
  if (loading && !d) return <Loading rows={10} />;
  if (error) return <ErrorBox error={error} />;
  if (!d || d.empty) return <Empty>At least two published roles are needed to plan a move.</Empty>;
  const shift = d.fpi.to - d.fpi.from;
  const why = `${d.move_difficulty} because the move needs ${d.new_skills} new skill${d.new_skills === 1 ? "" : "s"} and ${d.level_points_to_close} level point${d.level_points_to_close === 1 ? "" : "s"} (Low ≤${d.thresholds.low.new_skills} and ≤${d.thresholds.low.level_points}, Medium ≤${d.thresholds.medium.new_skills} and ≤${d.thresholds.medium.level_points}).`;
  return (
    <>
      <PageHeader eyebrow="Career mobility" title={<>Move <span className="text-accent">planner</span></>} />
      <div className="rule-bar mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 py-2.5 text-[13px] text-ink-3">
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={mand} onChange={e => setMand(e.target.checked)} />Count Mandatory skills only</label>
        <span className="hidden sm:inline">·</span>
        <span>{d.roles.length} published roles in {s.organisation?.name}</span>
        {s.user.employee_id && d.own_role_id && <Link href="/me/career" className="ml-auto font-medium text-accent hover:underline">My readiness for a move →</Link>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <RoleSelect id="from" label="From" value={d.from.id} roles={d.roles} onChange={v => setFrom(v)} />
              <ArrowRight className="mb-2.5 h-6 w-6 shrink-0 text-accent" aria-hidden />
              <RoleSelect id="to" label="To" value={d.to.id} roles={d.roles.filter((r: any) => r.id !== d.from.id)} onChange={v => setTo(v)} />
              <Chip cls={DIFF[d.move_difficulty]}>{d.move_difficulty} difficulty</Chip>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
              {[[`${Math.round(d.skill_overlap * 100)}%`, "skill overlap"], [d.new_skills, "new skills"], [d.skills_needing_higher_level, "need a higher level"], [d.level_points_to_close, "level points to close"],
                [`${shift > 0 ? "+" : ""}${shift}`, `future-proof shift (${d.fpi.from}→${d.fpi.to})`]].map(([v, l]) => (
                <div key={l as string} className="border-l-[3px] border-ink py-0.5 pl-2.5"><div className="num text-[24px] font-medium leading-tight">{v}</div><div className="text-[12px] text-ink-3">{l}</div></div>))}
            </div>
            <p className="mt-4 text-[13px] text-ink-3">{why} {d.emerging_gained ? `You would gain ${d.emerging_gained} emerging skill${d.emerging_gained > 1 ? "s" : ""}. ` : ""}{d.declining_shed ? `You would shed ${d.declining_shed} declining skill${d.declining_shed > 1 ? "s" : ""}. ` : ""}
              {d.defined_path ? <>A defined career path exists ({d.defined_path.movement_type}).</> : "There is no defined career path between these roles yet."}{d.level_change !== null && d.level_change !== 0 ? ` ${d.level_change > 0 ? "Up" : "Down"} ${Math.abs(d.level_change)} career level${Math.abs(d.level_change) > 1 ? "s" : ""}.` : ""}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="t"><thead><tr><th>Target skill</th><th>{d.from.title}</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th title="How many levels below the needed level the person is">Levels short</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th></tr></thead>
                <tbody>{d.lines.map((l: any) => (
                  <tr key={l.skill_id}>
                    <td><Link href={`/skills/${l.skill_id}`} className="font-medium hover:text-accent">{l.skill_name}</Link><div className="font-mono text-[11.5px] text-ink-3">{l.pixel_id}{l.requirement_type && l.requirement_type !== "Mandatory" ? ` · ${l.requirement_type}` : ""}</div></td>
                    <td>{l.source_level ? <Level n={l.source_level} short /> : <span className="font-mono text-[12px] text-ink-3">new</span>}</td>
                    <td><Level n={l.target_level} short tone="acc" /></td>
                    <td className="num">{l.points ? `+${l.points}` : "–"}</td>
                    <td>{l.trend && <Pill>{l.trend}</Pill>}</td>
                  </tr>))}</tbody></table>
            </div>
            {d.shed.length > 0 && <p className="mt-3 text-[13px] text-ink-3"><span className="text-ink-2">Left behind:</span> {d.shed.map((x: any) => `${x.skill_name}${x.trend === "Declining" ? " (declining)" : ""}`).join(", ")}.</p>}
          </Card>
          {d.archived ? (
            <Card title="Archived for these roles" sub="Shown separately and read-only. Never counted above.">
              {d.archived.length ? <ul className="flex flex-col divide-y divide-line">{d.archived.map((a: any) => <li key={a.pixel_id} className="py-2 text-[13.5px]"><span className="font-mono text-[12px]">{a.pixel_id}</span> {a.skill_name}<div className="text-[12.5px] text-ink-3">{a.archive_reason_category} · {a.archived_on} · {a.archive_reason}</div></li>)}</ul> : <p className="text-[13px] text-ink-3">None archived.</p>}
            </Card>
          ) : d.archived_hidden > 0 && <p className="text-[12.5px] text-ink-3">{d.archived_hidden} archived mapping{d.archived_hidden === 1 ? "" : "s"} hidden for these roles. They need archive access to view.</p>}
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Skill fingerprint">
            <Radar cats={d.fingerprint.categories} a={d.fingerprint.from} b={d.fingerprint.to} aLabel={d.from.title} bLabel={d.to.title} />
            <Legend className="justify-center" items={[{ label: `${d.from.title} (from)`, color: "#FF8A4C" }, { label: `${d.to.title} (to)`, color: "rgb(var(--accent))" }]} /><p className="mt-1 text-center text-[12px] text-ink-3">Average required level (0–5) per skill category</p>
          </Card>
          <Card title={`Nearest moves from ${d.from.title}`}>
            {d.nearest.length ? <div className="-mx-4 -mb-4">{d.nearest.map((n: any) => (
              <button key={n.id} onClick={() => setTo(n.id)} className={cx("flex w-full items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-left transition-colors hover:bg-accent/[.07]", n.id === d.to.id && "bg-accent/[.1]")}>
                <span className="min-w-0"><span className="block text-[14px]">{n.title}</span><span className="block text-[12px] text-ink-3">{n.department_name} · overlap {Math.round(n.overlap * 100)}%</span></span>
                <Chip cls={DIFF[n.difficulty]}>{n.difficulty}</Chip>
              </button>))}</div> : <p className="text-[13px] text-ink-3">No role shares skills with this one yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
