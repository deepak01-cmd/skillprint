"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pill, Tabs, useToast } from "@/components/ui";

const LABEL: Record<string, string> = { archive: "Archive mapping", raise_level: "Raise required level", lower_level: "Lower required level", add_skill: "Add skill" };
const SIGNALS: Record<string, string> = { external_demand: "External demand change", expert_rating: "Expert rating", internal_demand: "Internal planned demand", automation_exposure: "Automation or substitution exposure" };

export default function Evolution() {
  const s = useSession(); const toast = useToast();
  const [tab, setTab] = useState("suggestions");
  const trends = useApi<any[]>("/evolution/skills"); const sugg = useApi<any[]>("/evolution/suggestions");
  const evidence = useApi<any[]>(tab === "evidence" ? "/evolution/evidence" : null); const sources = useApi<any[]>("/evolution/sources");
  const [review, setReview] = useState<any>(null); const [decide, setDecide] = useState<any>(null); const [addEv, setAddEv] = useState<any>(null); const [addSrc, setAddSrc] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const manage = can(s, "evolution:manage");
  return (
    <>
      <PageHeader title="Skill and role evolution"
        actions={<>{can(s, "evidence:write") && <Button onClick={() => { setErr(null); setAddEv({ source_id: "", skill_id: "", signal_type: "expert_rating", value: 0, summary: "", evidence_date: new Date().toISOString().slice(0, 10) }); }}>Add evidence</Button>}
          {manage && <Button variant="primary" onClick={async () => { const r = await api("POST", "/evolution/review"); r.ok ? toast(`Review run: ${r.data.created} new, ${r.data.needs_review} need review`) : toast(r.error!.message, "bad"); sugg.reload(); }}>Run review</Button>}</>} />
      <Note tone="warn">Sample evidence is unverified. Load real evidence before relying on these trends.</Note>
      <div className="mt-4"><Tabs value={tab} onChange={setTab} tabs={[{ id: "suggestions", label: `Suggestions (${(sugg.data || []).filter(x => !["Accepted", "Rejected"].includes(x.status)).length} open)` }, { id: "trends", label: "Skill trends" }, { id: "evidence", label: "Evidence" }, { id: "sources", label: "Sources" }]} /></div>

      {tab === "suggestions" && <Card pad={false}>{sugg.loading ? <Loading /> : (sugg.data || []).length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Suggestion</th><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Role and skill</th><th>Proposed trend change</th><th title="How sure the suggestion is (0 to 1), based on how much evidence agrees">Confidence</th><th>Expert reviews</th><th>Status</th><th></th></tr></thead>
        <tbody>{sugg.data!.map(g => <tr key={g.id}><td className="font-mono text-xs">{g.id}</td><td className="font-mono text-xs">{g.subject_id}</td><td><Link className="font-medium text-accent hover:underline" href={`/roles/${g.role_id}`}>{g.role_name}</Link><div className="text-xs text-ink-3">{g.skill_name} · level {g.required_level}, {g.requirement_type}, {g.skill_trend}</div></td>
          <td className="min-w-[260px]"><b>{LABEL[g.suggestion_type]}</b>{g.payload.required_level ? ` to ${g.payload.required_level}` : ""}<div className="text-xs text-ink-2">{g.rationale}</div></td><td><Pill tone={g.confidence === "High" ? "Met" : g.confidence === "Medium" ? "Medium" : "Draft"}>{g.confidence}</Pill></td>
          <td className="text-xs">{(g.reviews || []).map((r: any, i: number) => <div key={i}><b>{r.verdict}</b> {r.reviewer}{r.comment ? `: ${r.comment}` : ""}</div>)}</td>
          <td><Pill>{g.status}</Pill>{g.draft_change_id && <div className="font-mono text-xs"><Link className="font-medium text-accent hover:underline" href="/approvals">{g.draft_change_id}</Link></div>}</td>
          <td className="whitespace-nowrap">{!["Accepted", "Rejected"].includes(g.status) && <><Button size="sm" onClick={() => { setErr(null); setReview({ g, verdict: "Agree", comment: "" }); }}>Review</Button>{" "}{manage && <Button size="sm" variant="primary" onClick={() => { setErr(null); setDecide({ g, decision: "Accept", reason: "" }); }}>Decide</Button>}</>}</td></tr>)}</tbody></table></div>
        : <Empty>No suggestions. {manage ? "Run a review to score evidence and propose changes." : ""}</Empty>}</Card>}

      {tab === "trends" && <Card pad={false}>{trends.loading ? <Loading /> : <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Trend from evidence</th><th className="text-right" title="Below 0: demand falling; above 0: demand rising">Evidence score (-1 to +1)</th><th title="How sure the suggestion is (0 to 1), based on how much evidence agrees">Confidence</th><th className="text-right">Sources</th><th>Trend in the framework now</th><th className="text-right">Roles</th><th className="text-right">People</th></tr></thead>
        <tbody>{(trends.data || []).map(t => <tr key={t.skill_id}><td><Link className="hover:underline" href={`/skills/${t.skill_id}`}>{t.skill_name}</Link><div className="text-xs text-ink-3">{t.category}</div></td><td><Pill>{t.trend}</Pill>{t.stale ? <div className="text-xs text-warn">{t.stale} stale item(s)</div> : null}</td><td className="num text-right">{t.score ?? "—"}</td>
          <td><Pill tone={t.confidence === "High" ? "Met" : t.confidence === "Medium" ? "Medium" : "Draft"}>{t.confidence}</Pill></td><td className="num text-right">{t.sources}</td><td>{t.current_labels.map((l: string) => <Pill key={l} className="mr-1">{l}</Pill>)}</td><td className="num text-right">{t.exposure.roles}</td><td className="num text-right">{t.exposure.employees}</td></tr>)}</tbody></table></div>}</Card>}

      {tab === "evidence" && <Card pad={false}>{evidence.loading ? <Loading /> : (evidence.data || []).length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Date</th><th>Skill</th><th>Type of signal</th><th className="text-right" title="Below 0: demand falling; above 0: demand rising">Signal value (-1 to +1)</th><th>Source</th><th>Summary</th></tr></thead>
        <tbody>{evidence.data!.map(e => <tr key={e.id}><td className="num">{e.evidence_date}</td><td>{e.skill_name}</td><td>{SIGNALS[e.signal_type]}</td><td className="num text-right">{e.value}</td><td>{e.source_name}<div className="text-xs text-ink-3">{e.source_type}</div></td><td className="max-w-md text-xs">{e.summary}</td></tr>)}</tbody></table></div> : <Empty>No evidence.</Empty>}</Card>}

      {tab === "sources" && <Card pad={false} actions={manage && <Button size="sm" onClick={() => { setErr(null); setAddSrc({ name: "", type: "Outlook report", licence: "", url: "", reliability: "Medium" }); }}>Add source</Button>} title="Evidence sources">
        <table className="t"><thead><tr><th>Source</th><th>Source type</th><th>Licence</th><th>Source reliability</th><th className="text-right">Evidence items</th></tr></thead>
          <tbody>{(sources.data || []).map(x => <tr key={x.id}><td>{x.name}{!x.org_id && <div className="text-xs text-ink-3">Shared, managed by the platform</div>}</td><td>{x.type}</td><td className="max-w-sm text-xs">{x.licence}</td><td>{x.reliability}</td><td className="num text-right">{x.items}</td></tr>)}</tbody></table></Card>}

      <Modal open={!!review} onClose={() => setReview(null)} title={`Expert review: ${review?.g.id}`} footer={<><Button onClick={() => setReview(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/evolution/suggestions/${review.g.id}/review`, { verdict: review.verdict, comment: review.comment }); if (!r.ok) return setErr(r.error); setReview(null); toast("Review recorded"); sugg.reload(); }}>Record</Button></>}>
        {review && <><p className="text-[13px]">{review.g.rationale}</p>
          <Field label="Verdict" htmlFor="rv"><select id="rv" className="inp" value={review.verdict} onChange={e => setReview({ ...review, verdict: e.target.value })}>{["Agree", "Change", "Disagree"].map(v => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Comment" htmlFor="rc"><textarea id="rc" className="inp" rows={3} value={review.comment} onChange={e => setReview({ ...review, comment: e.target.value })} /></Field></>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!decide} onClose={() => setDecide(null)} title={`Decide on ${decide?.g.id}`} footer={<><Button onClick={() => setDecide(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/evolution/suggestions/${decide.g.id}/decide`, { decision: decide.decision, reason: decide.reason }); if (!r.ok) return setErr(r.error); setDecide(null); toast(r.data.change_id ? `Accepted: Draft change ${r.data.change_id} awaits approval` : `Suggestion ${r.data.status.toLowerCase()}`); sugg.reload(); }}>Confirm</Button></>}>
        {decide && <><Note>Accepting creates a Draft change request only. Nothing in the framework changes until it is approved.</Note>
          <Field label="Decision" htmlFor="dd"><select id="dd" className="inp" value={decide.decision} onChange={e => setDecide({ ...decide, decision: e.target.value })}>{["Accept", "Defer", "Reject"].map(v => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Reason (required to reject)" htmlFor="dr"><textarea id="dr" className="inp" rows={2} value={decide.reason} onChange={e => setDecide({ ...decide, reason: e.target.value })} /></Field></>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!addEv} onClose={() => setAddEv(null)} title="Add evidence" footer={<><Button onClick={() => setAddEv(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/evolution/evidence", addEv); if (!r.ok) return setErr(r.error); setAddEv(null); toast("Evidence added; trends recalculate"); trends.reload(); }}>Add</Button></>}>
        {addEv && <div className="grid gap-3 md:grid-cols-2">
          <Field label="Source" htmlFor="es"><select id="es" className="inp" value={addEv.source_id} onChange={e => setAddEv({ ...addEv, source_id: e.target.value })}><option value="">Choose…</option>{(sources.data || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Skill" htmlFor="ek"><select id="ek" className="inp" value={addEv.skill_id} onChange={e => setAddEv({ ...addEv, skill_id: e.target.value })}><option value="">Choose…</option>{(trends.data || []).map(t => <option key={t.skill_id} value={t.skill_id}>{t.skill_name}</option>)}</select></Field>
          <Field label="Signal type" htmlFor="et"><select id="et" className="inp" value={addEv.signal_type} onChange={e => setAddEv({ ...addEv, signal_type: e.target.value })}>{Object.entries(SIGNALS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Direction (-1 falling to +1 rising)" htmlFor="ev"><input id="ev" type="number" step="0.1" min={-1} max={1} className="inp" value={addEv.value} onChange={e => setAddEv({ ...addEv, value: e.target.value })} /></Field>
          <Field label="Evidence date" htmlFor="ed"><input id="ed" type="date" className="inp" value={addEv.evidence_date} onChange={e => setAddEv({ ...addEv, evidence_date: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="Summary in your own words" htmlFor="esu" hint="Summarise; do not copy licensed content."><textarea id="esu" className="inp" rows={3} value={addEv.summary} onChange={e => setAddEv({ ...addEv, summary: e.target.value })} /></Field></div></div>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!addSrc} onClose={() => setAddSrc(null)} title="Add an evidence source" footer={<><Button onClick={() => setAddSrc(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/evolution/sources", addSrc); if (!r.ok) return setErr(r.error); setAddSrc(null); toast("Source added"); sources.reload(); }}>Add</Button></>}>
        {addSrc && <><Field label="Name" htmlFor="sn"><input id="sn" className="inp" value={addSrc.name} onChange={e => setAddSrc({ ...addSrc, name: e.target.value })} /></Field>
          <Field label="Type" htmlFor="st"><select id="st" className="inp" value={addSrc.type} onChange={e => setAddSrc({ ...addSrc, type: e.target.value })}>{["Company data", "Public framework", "Outlook report", "Job-posting dataset", "Technology signal", "Expert review"].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Licence note (required)" htmlFor="sl" hint="A source without a licence note cannot be used."><input id="sl" className="inp" value={addSrc.licence} onChange={e => setAddSrc({ ...addSrc, licence: e.target.value })} /></Field>
          <Field label="Reliability" htmlFor="sr"><select id="sr" className="inp" value={addSrc.reliability} onChange={e => setAddSrc({ ...addSrc, reliability: e.target.value })}>{["High", "Medium", "Low"].map(x => <option key={x}>{x}</option>)}</select></Field></>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
