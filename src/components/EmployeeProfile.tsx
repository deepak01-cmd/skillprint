"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Avatar, Button, Card, Empty, ErrorBox, Field, LEVEL_NAMES, Level, Loading, Modal, Pill, Radar, Ring, Tabs, fmtDate, useToast } from "@/components/ui";
import { LearningPanel } from "@/components/Learning";
import { LevelRequestModal, RequestDetail } from "@/components/LevelRequest";
import { BriefcaseBusiness, CheckCircle2, CircleDashed, Lightbulb, Target, TrendingUp } from "lucide-react";

const SOURCE: Record<string, string> = { validated: "Validated", manager: "Manager", self: "Self" };
const METHODS = ["Self-assessment", "Manager assessment", "Technical quiz", "Practical assignment", "Project evaluation", "Peer assessment", "Certification evidence", "Structured interview", "Work sample"];
const EV_TYPES = ["Project", "Repository", "Certification", "Assessment result", "Work sample", "Manager feedback", "Training completion"];
const ACT_TYPES = ["Training course", "Practical project", "Workplace assignment", "Mentoring", "Job shadowing", "Certification", "Workshop", "Reading material", "Peer learning"];

/** Five segments: filled up to the current level (green when the requirement is met), red outline for the missing levels. */
function GapBar({ current, required }: { current: number | null; required: number }) {
  const met = current !== null && current >= required;
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex gap-[3px]" aria-hidden>{[1, 2, 3, 4, 5].map(i => {
        const filled = current !== null && i <= current; const missing = !filled && i <= required;
        return <i key={i} className={`h-2 w-5 rounded-full ${filled ? (met ? "bg-good" : "bg-accent") : missing ? "bg-bad-soft ring-1 ring-inset ring-bad/30" : "bg-sunken"}`} />; })}</span>
      <span className="num whitespace-nowrap text-[12.5px]">{current === null ? <span className="text-ink-3">? / {required}</span> : <><b className={met ? "text-good" : "text-ink"}>{current}</b><span className="text-ink-3"> / {required}</span></>}</span>
    </div>
  );
}

export function EmployeeProfile({ id, self }: { id: string; self?: boolean }) {
  const s = useSession(); const toast = useToast();
  const { data: p, error, loading, reload } = useApi<any>(`/employees/${id}`);
  const plans = useApi<any[]>(`/employees/${id}/plans`);
  const [tab, setTab] = useState("skills");
  const reqs = useApi<any[]>(self ? "/level-requests?view=mine" : s.user.role === "manager" || s.user.role === "hr_admin" || s.user.role === "dept_head" ? "/level-requests?view=review&status=all" : null);
  const myReqs = (reqs.data || []).filter((r: any) => r.employee_id === id);
  const openReq = (skillId: string) => myReqs.find((r: any) => r.skill_id === skillId && (r.status === "Pending" || r.status === "More info needed"));
  const [ask, setAsk] = useState<any>(null); const [reqId, setReqId] = useState<string | null>(null);
  const [assign, setAssign] = useState(false); const [ev, setEv] = useState<any>(null); const [act, setAct] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [method, setMethod] = useState("Manager assessment");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const e = p.employee; const gaps = p.gaps;
  const met = gaps.filter((g: any) => g.status === "Met").length, open = gaps.filter((g: any) => g.status === "Gap").length, none = gaps.filter((g: any) => g.status === "No assessment data").length;
  const allSkills = [...gaps.map((g: any) => ({ id: g.skill_id, name: g.skill_name })), ...p.additional.map((a: any) => ({ id: a.skill_id, name: a.skill_name }))];
  const selfAssess = async (skill_id: string, level: number) => { const r = await api("POST", `/employees/${id}/self-assess`, { skill_id, level }); r.ok ? toast("Self-assessment recorded as self-reported") : toast(r.error!.message, "bad"); reload(); };
  return (
    <>
      {!self && <nav className="mb-3 flex items-center gap-1.5 text-[12.5px] text-ink-3"><Link className="hover:text-accent" href="/employees">Employees</Link> / <span className="mono">{e.id}</span></nav>}
      <section className="anim-in mb-6 grid gap-5 rounded-lg border border-line bg-card p-5 shadow-card lg:grid-cols-[1fr_auto_320px] lg:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={e.name} size={72} />
          <div className="min-w-0">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-.02em]">{e.name}</h1>
            <div className="text-[14px] font-semibold text-accent">{e.role_title}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-ink-3">{e.employee_code && <span title="Employee number">No. {e.employee_code}</span>}<span>{e.department_name}</span>{e.career_level && <span>{e.career_level}</span>}{e.manager_name && <span>Reports to {e.manager_name}</span>}{e.location && <span>{e.location}</span>}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.can.assess && <Button size="sm" variant="primary" onClick={() => { setSel(new Set(gaps.filter((g: any) => g.status !== "Met").map((g: any) => g.skill_id).slice(0, 6))); setErr(null); setAssign(true); }}>Assign assessment</Button>}
              {self && <Link href="/learning"><Button size="sm" variant="soft"><Lightbulb className="h-3.5 w-3.5" />Learn</Button></Link>}
              {self && <Link href="/jobs"><Button size="sm"><BriefcaseBusiness className="h-3.5 w-3.5" />Internal jobs</Button></Link>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 lg:border-x lg:border-line lg:px-6">
          <Ring value={p.match.match_pct} size={116} tone={p.match.match_pct >= 75 ? "good" : p.match.match_pct >= 50 ? "acc" : "warn"} sub="match to role" />
          <ul className="flex flex-col gap-2 text-[13px]">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-good" /><b className="num">{met}</b> of {gaps.length} met</li>
            <li className="flex items-center gap-2"><Target className="h-4 w-4 text-bad" /><b className="num">{open}</b> gaps</li>
            <li className="flex items-center gap-2"><CircleDashed className="h-4 w-4 text-ink-3" /><b className="num">{none}</b> not assessed</li>
          </ul>
        </div>
        <div className="mx-auto w-full max-w-[320px]">{gaps.length >= 3 ? <Radar axes={gaps.slice(0, 8).map((g: any) => ({ label: g.skill_name, current: g.current_level, required: g.required_level }))} /> : null}</div>
      </section>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "skills", label: "Skills and gaps" }, { id: "learn", label: "Learning" }, { id: "requests", label: `Level requests (${myReqs.length})` }, { id: "plan", label: "Development plan" }, { id: "evidence", label: `Evidence (${p.evidence.length})` }, { id: "assessments", label: `Assessments (${p.assessments.length})` }]} />

      {tab === "skills" && <div className="flex flex-col gap-4">
        <Card pad={false} title={`Skills for ${e.role_title}`}>
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th style={{ width: 230 }}>Current vs required</th><th>Assessed by</th><th>Self-reported</th><th>Priority</th>{p.can.self && <th></th>}</tr></thead>
            <tbody>{gaps.map((g: any) => <tr key={g.skill_id}>
              <td><span className="font-medium">{g.skill_name}</span><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3"><Pill tone={g.requirement_type}>{g.requirement_type}</Pill><span>{g.importance} importance</span></div></td>
              <td><GapBar current={g.current_level} required={g.required_level} /></td>
              <td className="text-[12.5px]">{g.source ? <><span className="font-medium">{SOURCE[g.source]}</span><div className="text-ink-3">{g.assessed_by ? `${g.assessed_by} · ` : ""}{fmtDate(g.assessed_on)}</div></> : <span className="text-ink-3">Not assessed yet</span>}</td>
              <td>{g.self_level !== null ? <span className="text-ink-2"><Level n={g.self_level} short muted /><div className="text-[11.5px] text-ink-3">{fmtDate(g.self_assessed_on)}</div></span> : <span className="text-ink-3">—</span>}</td>
              <td>{g.status === "No assessment data" ? <Pill tone="No assessment data">Not assessed</Pill> : g.status === "Met" ? <Pill tone="Met">Met</Pill> : <Pill>{g.priority}</Pill>}</td>
              {p.can.self && <td className="whitespace-nowrap text-right">{openReq(g.skill_id) ? <button onClick={() => setReqId(openReq(g.skill_id).id)}><Pill tone={openReq(g.skill_id).status === "Pending" ? "In Review" : "Changes Requested"}>{openReq(g.skill_id).status === "Pending" ? `Asked for ${openReq(g.skill_id).requested_level}` : "More info needed"}</Pill></button>
                : <Button size="sm" variant="soft" onClick={() => setAsk(g)}><TrendingUp className="h-3.5 w-3.5" />Update level</Button>}</td>}</tr>)}</tbody></table></div>
        </Card>
        {p.additional.length > 0 && <Card pad={false} title="Other recorded skills">
          <table className="t"><thead><tr><th>Skill</th><th>Records</th><th>Level label</th></tr></thead><tbody>{p.additional.map((a: any) => <tr key={a.skill_id} className={a.label.startsWith("Retired") ? "text-ink-3" : ""}><td>{a.skill_name}</td><td className="text-xs">{a.records.map((r: any) => `${SOURCE[r.source]} ${r.level} (${fmtDate(r.assessed_on)})`).join(" · ")}</td><td>{a.label.startsWith("Retired") ? <Pill tone="Archived">{a.label}</Pill> : a.label}</td></tr>)}</tbody></table>
        </Card>}
      </div>}

      {tab === "requests" && <Card pad={false} title="Level requests">
        {myReqs.length ? <table className="t"><thead><tr><th>Skill</th><th>Level change requested</th><th>Evidence</th><th>Status</th><th>Decided</th><th></th></tr></thead>
          <tbody>{myReqs.map((r: any) => <tr key={r.id} className="click" onClick={() => setReqId(r.id)}><td className="font-semibold">{r.skill_name}</td><td className="num">{r.current_level ?? "?"} → {r.requested_level}{r.decided_level !== null && r.decided_level !== r.requested_level ? ` (approved ${r.decided_level})` : ""}</td>
            <td className="num">{r.evidence_count}</td><td><Pill tone={r.status === "Pending" ? "In Review" : r.status === "More info needed" ? "Changes Requested" : r.status}>{r.status}</Pill></td><td className="text-[12.5px] text-ink-3">{r.decided_by_name ? `${r.decided_by_name}${r.decision_note ? ` · ${r.decision_note}` : ""}` : "—"}</td><td className="text-right text-[12.5px] font-semibold text-accent">Open</td></tr>)}</tbody></table>
          : <Empty icon={<TrendingUp />}>{self ? "Grown in a skill? Use “Update level” next to it and attach your evidence." : "No requests."}</Empty>}
      </Card>}

      {tab === "learn" && <LearningPanel employeeId={id} canPlan={!!p.can.plan} />}

      {tab === "plan" && <div className="flex flex-col gap-4">
        {p.can.plan && <div className="flex gap-2"><Button variant="primary" onClick={async () => { const r = await api("POST", `/employees/${id}/plans/generate`, {}); r.ok ? toast(`Plan created with ${r.data.activities} activities`) : toast(r.error!.message, "bad"); plans.reload(); }}>Generate a plan from current gaps</Button></div>}
        {(plans.data || []).length === 0 && <Card><Empty>No development plan yet.</Empty></Card>}
        {(plans.data || []).map(pl => <Card key={pl.id} pad={false} title={<div><h2 className="text-[15px] font-semibold">{pl.title}</h2><div className="text-xs text-ink-3">{pl.id} · created by {pl.created_by} on {fmtDate(pl.created_at)}</div></div>}
          actions={p.can.plan && <Button size="sm" onClick={() => { setErr(null); setAct({ plan: pl, v: { skill_id: gaps[0]?.skill_id, title: "", type: "Mentoring", description: "" } }); }}>Add activity</Button>}>
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Activity</th><th>Skill</th><th>Level then → target</th><th>Level now</th><th>Status</th><th>Evidence and feedback</th>{p.can.plan && <th></th>}</tr></thead>
            <tbody>{pl.activities.map((a: any) => <tr key={a.id}><td><span className="font-medium">{a.title}</span><div className="text-xs text-ink-3">{a.type}{a.mentor ? ` · mentor ${a.mentor}` : ""}{a.due_date ? ` · due ${fmtDate(a.due_date)}` : ""}</div>{a.flag && <div className="text-xs font-semibold text-warn">{a.flag}</div>}</td>
              <td>{a.skill_name}</td><td className="whitespace-nowrap">{a.current_level ?? "—"} → {a.target_level ?? "—"}</td><td><Level n={a.level_now} short /></td><td><Pill>{a.status}</Pill></td>
              <td className="text-xs">{a.evidence && <div>Evidence: {a.evidence}</div>}{a.feedback && <div className="text-ink-2">Feedback: {a.feedback}</div>}</td>
              {p.can.plan && <td className="whitespace-nowrap"><ActivityActions a={a} self={p.can.self} onDone={() => plans.reload()} /></td>}</tr>)}</tbody></table></div>
        </Card>)}
      </div>}

      {tab === "evidence" && <Card pad={false} title="Evidence portfolio" actions={(p.can.self || p.can.assess || p.can.manage) && <Button size="sm" onClick={() => { setErr(null); setEv({ skill_id: allSkills[0]?.id, type: "Project", title: "", link: "" }); }}>Add evidence</Button>}>
        {p.evidence.length ? <table className="t"><thead><tr><th>Skill</th><th>Evidence type</th><th>Title</th><th>Date</th><th>Status</th>{!p.can.self && <th></th>}</tr></thead>
          <tbody>{p.evidence.map((x: any) => <tr key={x.id}><td>{x.skill_name}</td><td>{x.type}</td><td>{x.link ? <a className="font-medium text-accent hover:underline" href={x.link} target="_blank" rel="noreferrer">{x.title}</a> : x.title}</td><td className="num">{fmtDate(x.evidence_date)}</td><td><Pill tone={x.validation_status === "Validated" ? "Met" : x.validation_status === "Pending" ? "Assigned" : "Rejected"}>{x.validation_status}</Pill></td>
            {!p.can.self && <td className="whitespace-nowrap">{x.validation_status === "Pending" && ["Validated", "Rejected"].map(st => <Button key={st} size="sm" className="mr-1" onClick={async () => { const r = await api("PATCH", `/evidence/${x.id}`, { validation_status: st }); r.ok ? toast(`Evidence ${st.toLowerCase()}`) : toast(r.error!.message, "bad"); reload(); }}>{st === "Validated" ? "Validate" : "Reject"}</Button>)}</td>}</tr>)}</tbody></table> : <Empty>No evidence attached yet.</Empty>}
      </Card>}

      {tab === "assessments" && <Card pad={false} title="Assessment history">
        {p.assessments.length ? <table className="t"><thead><tr><th>ID</th><th>Assessment method</th><th>Skills</th><th>Assessor</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{p.assessments.map((a: any) => <tr key={a.id}><td><Link className="font-mono text-xs font-medium text-accent hover:underline" href={`/assessments/${a.id}`}>{a.id}</Link></td><td>{a.method}</td><td className="num">{a.items}</td><td>{a.assessor_name || "—"}</td><td className="num">{fmtDate(a.due_date)}</td><td><Pill>{a.status}</Pill>{a.notice && <div className="text-xs text-warn">{a.notice}</div>}</td></tr>)}</tbody></table> : <Empty>No assessments yet.</Empty>}
      </Card>}

      {ask && <LevelRequestModal skill={ask} onClose={() => setAsk(null)} onDone={() => { setAsk(null); reqs.reload(); reload(); }} />}
      {reqId && <RequestDetail id={reqId} onClose={() => setReqId(null)} onChanged={() => { reqs.reload(); reload(); }} />}
      <Modal wide open={assign} onClose={() => setAssign(false)} title={`Assign an assessment to ${e.name}`} footer={<><Button onClick={() => setAssign(false)}>Cancel</Button><Button variant="primary" disabled={!sel.size} onClick={async () => { const r = await api("POST", "/assessments", { employee_id: id, method, skill_ids: [...sel] }); if (!r.ok) return setErr(r.error); setAssign(false); toast(`${r.data.id} assigned`); reload(); }}>Assign</Button></>}>
        <Field label="Method" htmlFor="am"><select id="am" className="inp" value={method} onChange={x => setMethod(x.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
        <div className="grid gap-1 md:grid-cols-2">{gaps.map((g: any) => <label key={g.skill_id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={sel.has(g.skill_id)} onChange={x => { const n = new Set(sel); x.target.checked ? n.add(g.skill_id) : n.delete(g.skill_id); setSel(n); }} />{g.skill_name} <span className="text-ink-3">({g.status})</span></label>)}</div>
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!ev} onClose={() => setEv(null)} title="Add evidence" footer={<><Button onClick={() => setEv(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/employees/${id}/evidence`, ev); if (!r.ok) return setErr(r.error); setEv(null); toast("Evidence added; pending validation"); reload(); }}>Add</Button></>}>
        {ev && <><Field label="Skill" htmlFor="es"><select id="es" className="inp" value={ev.skill_id} onChange={x => setEv({ ...ev, skill_id: x.target.value })}>{allSkills.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
          <Field label="Type" htmlFor="et"><select id="et" className="inp" value={ev.type} onChange={x => setEv({ ...ev, type: x.target.value })}>{EV_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Title" htmlFor="eti"><input id="eti" className="inp" value={ev.title} onChange={x => setEv({ ...ev, title: x.target.value })} /></Field>
          <Field label="Link (optional)" htmlFor="el"><input id="el" className="inp" value={ev.link} onChange={x => setEv({ ...ev, link: x.target.value })} /></Field></>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!act} onClose={() => setAct(null)} title="Add a development activity" footer={<><Button onClick={() => setAct(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/plans/${act.plan.id}/activities`, act.v); if (!r.ok) return setErr(r.error); setAct(null); toast("Activity added"); plans.reload(); }}>Add</Button></>}>
        {act && <><Field label="Skill" htmlFor="as"><select id="as" className="inp" value={act.v.skill_id} onChange={x => setAct({ ...act, v: { ...act.v, skill_id: x.target.value } })}>{allSkills.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
          <Field label="Title" htmlFor="ati"><input id="ati" className="inp" value={act.v.title} onChange={x => setAct({ ...act, v: { ...act.v, title: x.target.value } })} /></Field>
          <Field label="Type" htmlFor="aty"><select id="aty" className="inp" value={act.v.type} onChange={x => setAct({ ...act, v: { ...act.v, type: x.target.value } })}>{ACT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Mentor (optional)" htmlFor="amn"><input id="amn" className="inp" value={act.v.mentor || ""} onChange={x => setAct({ ...act, v: { ...act.v, mentor: x.target.value } })} /></Field>
          <Field label="Due date (optional)" htmlFor="adu"><input id="adu" type="date" className="inp" value={act.v.due_date || ""} onChange={x => setAct({ ...act, v: { ...act.v, due_date: x.target.value } })} /></Field></>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}

function ActivityActions({ a, self, onDone }: { a: any; self: boolean; onDone: () => void }) {
  const toast = useToast(); const [open, setOpen] = useState(false); const [text, setText] = useState("");
  const patch = async (b: any) => { const r = await api("PATCH", `/activities/${a.id}`, b); r.ok ? toast("Activity updated") : toast(r.error!.message, "bad"); onDone(); };
  if (a.status === "Done") return <span className="text-xs text-ink-3">Done</span>;
  return <>
    {self ? <>{a.status === "Not started" && <Button size="sm" onClick={() => patch({ status: "In progress" })}>Start</Button>}{" "}<Button size="sm" onClick={() => { setText(a.evidence || ""); setOpen(true); }}>Submit evidence</Button></>
      : <>{a.status === "Submitted" && <Button size="sm" variant="primary" onClick={() => patch({ status: "Done" })}>Mark done</Button>}{" "}<Button size="sm" onClick={() => { setText(a.feedback || ""); setOpen(true); }}>Feedback</Button>{a.flag && <>{" "}<Button size="sm" onClick={() => patch({ clear_flag: true })}>Clear flag</Button></>}</>}
    <Modal open={open} onClose={() => setOpen(false)} title={self ? "Submit evidence" : "Reviewer feedback"} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { await patch(self ? { evidence: text, status: "Submitted" } : { feedback: text }); setOpen(false); }}>Save</Button></>}>
      <textarea className="inp" rows={4} value={text} onChange={e => setText(e.target.value)} aria-label="Text" />
    </Modal>
  </>;
}
