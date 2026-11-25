"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api";
import { Button, Card, ErrorBox, Level, Loading, Note, PageHeader, Pill, fmtDate, useToast } from "@/components/ui";

export default function AssessmentPage({ params }: { params: { id: string } }) {
  const toast = useToast();
  const { data: a, error, loading, reload } = useApi<any>(`/assessments/${params.id}`);
  const [v, setV] = useState<Record<string, any>>({}); const [err, setErr] = useState<any>(null);
  useEffect(() => { if (a) setV(Object.fromEntries(a.items.map((i: any) => [i.skill_id, { self_level: i.self_level ?? "", self_evidence: i.self_evidence ?? "", assessed_level: i.assessed_level ?? i.self_level ?? "", feedback: i.feedback ?? "", score: i.score ?? "" }]))); }, [a]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const set = (sid: string, k: string, val: any) => setV({ ...v, [sid]: { ...v[sid], [k]: val } });
  const desc = (sid: string, level: number) => a.descriptors.find((d: any) => d.level === level && d.skill_id === sid)?.skill_descriptor || a.descriptors.find((d: any) => d.level === level)?.descriptor;
  const submit = async () => { const r = await api("POST", `/assessments/${a.id}/submit`, { items: a.items.map((i: any) => ({ skill_id: i.skill_id, self_level: Number(v[i.skill_id].self_level), self_evidence: v[i.skill_id].self_evidence })) }); if (!r.ok) return setErr(r.error); toast("Submitted. Your manager or assessor reviews it next."); reload(); };
  const review = async () => { const r = await api("POST", `/assessments/${a.id}/review`, { items: a.items.map((i: any) => ({ skill_id: i.skill_id, assessed_level: Number(v[i.skill_id].assessed_level), feedback: v[i.skill_id].feedback, score: v[i.skill_id].score === "" ? undefined : Number(v[i.skill_id].score) })) }); if (!r.ok) return setErr(r.error); toast(`Reviewed: levels recorded as ${r.data.recorded_as === "validated" ? "validated" : "manager-assessed"}`); reload(); };
  const uniqueLevels = [...new Map(a.descriptors.map((d: any) => [d.level, d])).values()] as any[];
  return (
    <>
      <PageHeader eyebrow={<><Link className="hover:underline" href="/assessments">Assessments</Link> / <span className="font-mono">{a.id}</span></>} title={`${a.method}: ${a.employee_name}`}
        sub={<>Assigned by {a.assigned_by} · assessor {a.assessor_name || "manager"} · due {fmtDate(a.due_date)}</>} actions={<Pill>{a.status}</Pill>} />
      {a.notice && <div className="mb-4"><Note tone="warn">{a.notice}</Note></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card pad={false} title="Skills">
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th>Self level and evidence</th>{(a.can.review || a.status === "Reviewed") && <th>Assessed level, score and feedback</th>}</tr></thead>
            <tbody>{a.items.map((i: any) => { const x = v[i.skill_id] || {}; return (
              <tr key={i.skill_id}><td className="font-medium">{i.skill_name}</td><td><Level n={i.required_level} /></td>
                <td className="min-w-[260px]">{a.can.submit ? <div className="flex flex-col gap-1">
                  <select aria-label={`Self level for ${i.skill_name}`} className="inp" value={x.self_level} onChange={e => set(i.skill_id, "self_level", e.target.value)}><option value="">Choose…</option>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n ? "" : "(no experience)"}</option>)}</select>
                  {x.self_level !== "" && <span className="text-xs text-ink-3">{desc(i.skill_id, Number(x.self_level))}</span>}
                  <textarea aria-label="Evidence" className="inp" rows={2} placeholder="Evidence: project, repository, certification…" value={x.self_evidence} onChange={e => set(i.skill_id, "self_evidence", e.target.value)} /></div>
                  : <>{i.self_level !== null ? <Level n={i.self_level} /> : <span className="text-ink-3">—</span>}{i.self_evidence && <div className="text-xs text-ink-2">{i.self_evidence}</div>}</>}</td>
                {(a.can.review || a.status === "Reviewed") && <td className="min-w-[280px]">{a.can.review ? <div className="flex flex-col gap-1">
                  <div className="flex gap-2"><select aria-label={`Assessed level for ${i.skill_name}`} className="inp" value={x.assessed_level} onChange={e => set(i.skill_id, "assessed_level", e.target.value)}><option value="">Choose…</option>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select>
                    <input aria-label="Score" className="inp w-24" placeholder="Score %" value={x.score} onChange={e => set(i.skill_id, "score", e.target.value)} /></div>
                  <textarea aria-label="Feedback" className="inp" rows={2} placeholder="Feedback for the employee" value={x.feedback} onChange={e => set(i.skill_id, "feedback", e.target.value)} /></div>
                  : <><Level n={i.assessed_level} />{i.score !== null && <span className="ml-2 text-xs text-ink-3">score {i.score}</span>}{i.feedback && <div className="text-xs text-ink-2">{i.feedback}</div>}</>}</td>}</tr>); })}</tbody></table></div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {a.can.submit && <Button variant="primary" disabled={a.items.some((i: any) => v[i.skill_id]?.self_level === "")} onClick={submit}>Submit my answers</Button>}
            {a.can.review && <Button variant="primary" disabled={a.items.some((i: any) => v[i.skill_id]?.assessed_level === "" || v[i.skill_id]?.assessed_level === undefined)} onClick={review}>Record review</Button>}
            {!a.can.submit && !a.can.review && <span className="text-[13px] text-ink-3">{a.status === "Reviewed" ? "Reviewed. Results are kept as history and cannot be edited." : a.status === "Assigned" && a.method === "Self-assessment" ? "Waiting for the employee to submit." : "Nothing to do here."}</span>}
          </div>
          <div className="px-4 pb-3"><ErrorBox error={err} /></div>
        </Card>
        <Card title="Level definitions"><ul className="flex flex-col gap-2 text-[13px]">{uniqueLevels.map((d: any) => <li key={d.level}><Level n={d.level} /><div className="text-xs text-ink-2">{d.descriptor}</div></li>)}</ul></Card>
      </div>
    </>
  );
}
