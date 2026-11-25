"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { api, downloadCsv, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { OutlookPanel, TrendTag } from "@/components/Outlook";
import { Attribution, RoleOccupation } from "@/components/Reference";
import { Bar, Button, Card, Empty, ErrorBox, Field, Level, Loading, Modal, Note, PageHeader, Pill, Tabs, fmtDate, pct, useToast } from "@/components/ui";
import { CompareResult } from "@/components/CompareResult";
import { ImportDialog } from "@/components/ImportDialog";
import { ListChecks, Plus, Star, TrendingUp, Upload, Users } from "lucide-react";
import { MappingHistory } from "@/components/MappingHistory";

const REASONS = ["End of life", "Replaced by successor", "Regulation change", "No demand"];
const REQ = ["Mandatory", "Preferred", "Optional", "Developmental"];
const IMP = ["Critical", "High", "Medium", "Low"];
const TRENDS = ["Current", "Emerging", "Declining"];

export default function RolePage({ params }: { params: { id: string } }) {
  const s = useSession(); const toast = useToast(); const router = useRouter();
  const role = useApi<any>(`/roles/${params.id}`);
  const fw = useApi<any>(role.data?.can_read_framework ? `/roles/${params.id}/skills` : null);
  const [tab, setTab] = useState("framework");
  const [showArch, setShowArch] = useState(false); const [arch, setArch] = useState<any>(null);
  const [archiveFor, setArchiveFor] = useState<any>(null); const [editFor, setEditFor] = useState<any>(null); const [adding, setAdding] = useState(false);
  const [restoreFor, setRestoreFor] = useState<any>(null); const [hist, setHist] = useState<string | null>(null);
  const [q, setQ] = useState(""); const [trend, setTrend] = useState(""); const [open, setOpen] = useState<string | null>(null); const [up, setUp] = useState(false);

  useEffect(() => { if (role.data && !role.data.can_read_framework) setTab("profile"); else if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "market") setTab("market"); }, [role.data]);
  const loadArchived = async () => { const r = await api("GET", `/roles/${params.id}/skills?include_archived=true`); if (r.ok) setArch(r.data.archived); else toast(r.error!.message, "bad"); };
  const refresh = () => { role.reload(); fw.reload(); if (showArch) loadArchived(); };

  if (role.loading) return <Loading />;
  if (role.error) return <ErrorBox error={role.error} />;
  const r = role.data; const f = fw.data; const perm = f?.permissions || {};
  const skills = (f?.skills || []).filter((m: any) => (!q || (m.skill_name + m.pixel_id + m.skill_category).toLowerCase().includes(q.toLowerCase())) && (!trend || m.skill_trend === trend));
  const flagged = (f?.skills || []).filter((m: any) => m.review_flag);
  const submitRole = async () => { const x = await api("POST", `/roles/${r.id}/submit`); x.ok ? toast(`Sent for approval as ${x.data.id}`) : toast(x.error!.message, "bad"); refresh(); };

  return (
    <>
      <PageHeader eyebrow={<><Link href="/roles" className="hover:underline">Job roles</Link> <span className="text-ink-3">/</span> <span className="font-mono">{r.id}</span></>}
        title={<span className="flex flex-wrap items-center gap-2">{r.title} <Pill>{r.status}</Pill>{r.pending_change && <Pill tone="In Review">{r.pending_change.id} in review</Pill>}</span>}
        sub={<>{r.department_name} · {r.job_family_name || "No job family"} · {r.career_level_name || "No level"} · {r.career_track} · {r.industry} · version {r.version} · {r.headcount} people</>}
        actions={<>{r.status === "Published" && can(s, "paths:read") && <Link href={`/moves?from=${r.id}`}><Button>Plan a move from this role</Button></Link>}{r.can_edit && r.status === "Draft" && <Button variant="primary" onClick={submitRole}>Submit role for approval</Button>}</>} />
      {f && <div className="-mt-2 mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[ListChecks, "Active skills", f.active_count, f.drafts?.length ? `${f.drafts.length} in draft` : "In the framework"], [Star, "Mandatory", (f.skills || []).filter((m: any) => m.requirement_type === "Mandatory").length, "Must-have skills"],
          [TrendingUp, "Emerging", (f.skills || []).filter((m: any) => m.skill_trend === "Emerging").length, `${(f.skills || []).filter((m: any) => m.skill_trend === "Declining").length} declining`], [Users, "People in role", r.headcount, r.career_level_name || "No level set"]].map(([I, l, v, sub]: any) => (
          <div key={l} className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><I className="h-4 w-4" /></span><div><div className="text-xs text-ink-3">{l}</div><div className="num text-lg font-bold leading-tight">{v}</div><div className="text-[11.5px] text-ink-3">{sub}</div></div></div>))}
      </div>}
      <Tabs value={tab} onChange={setTab} tabs={[...(r.can_read_framework ? [{ id: "framework", label: `Skill framework (${r.active_skills})` }] : []), { id: "profile", label: "Role profile" }, ...(r.can_read_framework ? [{ id: "market", label: "Market check" }] : []), { id: "outlook", label: "Future outlook" }, { id: "occupation", label: "Occupation data" }, { id: "compare", label: "Compare and paths" }, { id: "history", label: "History" }]} />

      {tab === "framework" && f && (
        <div className="flex flex-col gap-4">
          {flagged.length > 0 && <Note tone="warn">{flagged.length} restored mapping{flagged.length > 1 ? "s" : ""} flagged for review: {flagged.map((m: any) => m.pixel_id).join(", ")}. Check the level, requirement type and trend, then save to clear the flag.</Note>}
          <Card pad={false} title={<div className="flex flex-wrap items-center gap-3"><h2 className="text-[15px] font-semibold">Active skills</h2><span className="text-[13px] text-ink-3">{f.active_count} active</span>
            {perm.archive_read && f.archived_count > 0 && <span className="text-[13px] text-ink-3">{f.archived_count} archived skill{f.archived_count > 1 ? "s" : ""}: <button className="font-medium text-accent hover:underline" onClick={() => { const n = !showArch; setShowArch(n); if (n) loadArchived(); }}>{showArch ? "hide" : "view"}</button></span>}</div>}
            actions={<>
              <input className="inp w-56" placeholder="Search skills or Pixel IDs" value={q} onChange={e => setQ(e.target.value)} aria-label="Search skills" />
              <select className="inp w-36" value={trend} onChange={e => setTrend(e.target.value)} aria-label="Trend"><option value="">All trends</option>{TRENDS.map(t => <option key={t}>{t}</option>)}</select>
              <Button onClick={async () => { const x = await api("GET", `/framework/export?role_id=${r.id}`); if (x.ok) downloadCsv(`framework-${r.id}.csv`, x.data.header, x.data.rows); }}>Export CSV</Button>
              {perm.draft && <Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload skills</Button>}
              {perm.draft && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add skill</Button>}
            </>}>
            <div className="overflow-x-auto"><table className="t">
              <thead><tr><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Skill</th><th>Category</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th title="Mandatory: needed on day one. Preferred: expected soon after joining. Optional: useful. Developmental: grow into it.">Requirement type</th><th title="How much the skill matters to success in the role (High, Medium, Low)">Importance to role</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th title="How sure the trend is (0 to 1), based on how much evidence there is">Trend confidence</th>{(perm.archive_write || perm.draft) && <th></th>}</tr></thead>
              <tbody>{skills.map((m: any) => (<Fragment key={m.pixel_id}>
                <tr key={m.pixel_id} className="click" onClick={() => setOpen(open === m.pixel_id ? null : m.pixel_id)} aria-expanded={open === m.pixel_id}>
                  <td className="whitespace-nowrap font-mono text-xs">{m.pixel_id}{m.review_flag && <Pill tone="Medium" className="ml-1">review</Pill>}</td>
                  <td className="font-medium">{m.skill_name}</td><td className="text-ink-2">{m.skill_category}</td><td title={`${m.level_name}: ${m.level_descriptor}`}><Level n={m.required_level} /></td>
                  <td className={m.requirement_type === "Mandatory" ? "font-semibold" : ""}>{m.requirement_type}</td><td>{m.importance}</td><td><Pill>{m.skill_trend}</Pill></td>
                  <td className="num whitespace-nowrap">{m.confidence_score ?? "—"} <span className="text-xs text-ink-3">{m.evidence_status}</span></td>
                  {(perm.archive_write || perm.draft) && <td className="whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {m.pending_change ? <Pill tone="In Review">{m.pending_change.type} in review</Pill> : <>
                      {perm.draft && <Button size="sm" onClick={() => setEditFor(m)}>Edit</Button>}{" "}
                      {perm.archive_write && <Button size="sm" variant="danger" onClick={() => setArchiveFor(m)}>Archive</Button>}</>}
                  </td>}
                </tr>
                {open === m.pixel_id && <tr key={m.pixel_id + "d"}><td colSpan={9} className="bg-paper text-[13px] text-ink-2"><div className="grid max-w-4xl gap-1">
                  <div><b className="text-ink">Definition.</b> {m.skill_definition}</div>
                  <div><b className="text-ink">Level {m.required_level} {m.level_name}{m.level_descriptor_skill_specific ? " (for this skill)" : ""}.</b> {m.level_descriptor}</div><div><b className="text-ink">Trend rationale.</b> {m.trend_rationale || "—"}</div>
                  {m.explanation && <div><b className="text-ink">Why this role needs it.</b> {m.explanation}</div>}
                  <div className="text-xs text-ink-3">{m.industry} · {m.observation_period || "no observation period"} · demand {m.demand_direction} · version {m.version} · knowledge-based judgement, not verified evidence · <button className="font-medium text-accent hover:underline" onClick={e => { e.stopPropagation(); setHist(m.pixel_id); }}>Change history</button></div></div></td></tr>}
              </Fragment>))}</tbody>
            </table></div>
            {!skills.length && <Empty>No active skills match.</Empty>}
          </Card>

          {showArch && (
            <section className="rounded-lg border border-ink-3 border-l-4 bg-card" aria-label="Archived skills">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2"><span className="rounded bg-ink-3 px-1.5 text-[11px] font-bold uppercase tracking-wider text-white">Archived</span><h2 className="text-[15px] font-semibold">Archived skills for {r.title}</h2></div>
                <div className="flex gap-2">{perm.archive_export && <Button size="sm" onClick={async () => { const x = await api("GET", `/roles/${r.id}/skills/archived/export`); if (x.ok) { downloadCsv(x.data.file, x.data.header, x.data.rows); toast("Archive export downloaded and logged"); } }}>Export archived (logged)</Button>}<Button size="sm" onClick={() => setShowArch(false)}>Close</Button></div>
              </div>
              {!arch ? <Loading /> : <div className="overflow-x-auto"><table className="t"><thead><tr><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Skill</th><th>Industry</th><th>Last level needed</th><th>Reason</th><th>Archived on</th><th title="How sure the trend is (0 to 1), based on how much evidence there is">Trend confidence</th>{perm.archive_write && <th></th>}</tr></thead>
                <tbody>{arch.map((m: any) => <tr key={m.pixel_id} className="text-ink-2"><td className="whitespace-nowrap font-mono text-xs">{m.pixel_id}</td><td className="font-medium">{m.skill_name}</td><td>{m.industry}</td><td><Level n={m.last_required_level} muted /></td>
                  <td className="min-w-[260px]"><b>{m.archive_reason_category}.</b> {m.archive_reason}</td><td className="num whitespace-nowrap">{fmtDate(m.archived_on)}<div className="text-xs text-ink-3">{m.archived_by}</div></td><td className="num">{m.confidence_score}</td>
                  {perm.archive_write && <td>{m.pending_change ? <Pill tone="In Review">{m.pending_change.type} in review</Pill> : <Button size="sm" onClick={() => setRestoreFor(m)}>Restore</Button>}</td>}</tr>)}</tbody></table></div>}
            </section>
          )}

          {f.drafts && f.drafts.length > 0 && (
            <Card pad={false} title="Drafts and changes for this role">
              <div className="overflow-x-auto"><table className="t"><thead><tr><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Skill</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th title="Mandatory: needed on day one. Preferred: expected soon after joining. Optional: useful. Developmental: grow into it.">Requirement type</th><th title="How much the skill matters to success in the role (High, Medium, Low)">Importance to role</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th>Status</th><th></th></tr></thead>
                <tbody>{f.drafts.map((m: any) => <tr key={m.pixel_id}><td className="font-mono text-xs">{m.pixel_id}</td><td className="font-medium">{m.skill_name}<div className="text-xs text-ink-3">{m.explanation}</div></td><td><Level n={m.required_level} /></td><td>{m.requirement_type}</td><td>{m.importance}</td><td><Pill>{m.skill_trend}</Pill></td><td><Pill>{m.approval_status}</Pill></td>
                  <td className="whitespace-nowrap">{m.approval_status !== "In Review" && <><Button size="sm" onClick={() => setEditFor(m)}>Edit</Button>{" "}
                    {r.status === "Published" && <Button size="sm" variant="primary" onClick={async () => { const x = await api("POST", `/pixels/${m.pixel_id}/submit`); x.ok ? toast(`Sent for approval as ${x.data.id}`) : toast(x.error!.message, "bad"); refresh(); }}>Submit</Button>}{" "}
                    <Button size="sm" onClick={async () => { const x = await api("DELETE", `/pixels/${m.pixel_id}`); x.ok ? toast("Draft withdrawn") : toast(x.error!.message, "bad"); refresh(); }}>Withdraw</Button></>}</td></tr>)}</tbody></table></div>
              <p className="px-4 py-2 text-xs text-ink-3">{r.status === "Published" ? "Submit each new mapping for approval. It joins the framework once an HR administrator approves it." : "These drafts are submitted together with the role."}</p>
            </Card>
          )}
        </div>
      )}
      {tab === "framework" && fw.error && <ErrorBox error={fw.error} />}
      {tab === "profile" && <Profile r={r} onChange={refresh} />}
      {tab === "outlook" && <RoleOutlook id={r.id} />}
      {tab === "occupation" && <RoleOccupation roleId={r.id} />}
      {tab === "compare" && <Compare r={r} />}
      {tab === "market" && <MarketCheck r={r} canDraft={!!perm.draft} onAdded={refresh} />}
      {tab === "history" && <History r={r} />}

      <ArchiveDialog m={archiveFor} onClose={() => setArchiveFor(null)} onDone={(msg: string) => { setArchiveFor(null); toast(msg); refresh(); }} direct={perm.archive_write_direct} />
      <MappingHistory pid={hist} onClose={() => setHist(null)} />
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["role_skills"]} onDone={() => refresh()} title="Upload required skills" context={{ role_id: r.id, role_title: r.title }} />
      <RestoreDialog m={restoreFor} onClose={() => setRestoreFor(null)} onDone={(msg: string) => { setRestoreFor(null); toast(msg); refresh(); }} />
      <EditDialog m={editFor} onClose={() => setEditFor(null)} onDone={(msg: string) => { setEditFor(null); toast(msg); refresh(); }} />
      <AddSkill open={adding} role={r} existing={new Set([...(f?.skills || []), ...(f?.drafts || [])].map((x: any) => x.skill_id))} onClose={() => setAdding(false)} onDone={(msg: string) => { setAdding(false); toast(msg); refresh(); }} />
    </>
  );
}

function ArchiveDialog({ m, onClose, onDone, direct }: any) {
  const [check, setCheck] = useState<any>(null); const [cat, setCat] = useState(""); const [reason, setReason] = useState(""); const [confirm, setConfirm] = useState(false); const [err, setErr] = useState<any>(null);
  useEffect(() => { setCat(""); setReason(""); setConfirm(false); setErr(null); setCheck(null); if (m) api("GET", `/pixels/${m.pixel_id}/archive-check`).then(r => r.ok && setCheck(r.data)); }, [m]);
  if (!m) return null;
  const go = async () => {
    const r = await api("POST", `/pixels/${m.pixel_id}/archive`, { reason_category: cat, reason, confirm });
    if (!r.ok) return setErr(r.error);
    onDone(r.data.status === "archived" ? `${m.pixel_id} archived. It left every default view.` : `Sent for approval as ${r.data.change.id}: ${r.data.reason_for_review}`);
  };
  return (
    <Modal open onClose={onClose} title={`Archive ${m.skill_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={check?.last_active && !confirm}>{check?.needs_approval ? "Send for approval" : "Archive"}</Button></>}>
      <div className="flex flex-wrap gap-3 text-[13px]"><span className="font-mono">{m.pixel_id}</span><Level n={m.required_level} /><span>{m.requirement_type}</span><Pill>{m.skill_trend}</Pill></div>
      {check && <Note tone={check.needs_approval ? "warn" : "info"}>{check.needs_approval ? `This goes to HR review first: ${check.reason_for_review}. Nothing changes until it is approved.` : "This applies immediately. The mapping keeps its Pixel ID and can be restored."}</Note>}
      <Field label="Reason category" htmlFor="ac"><select id="ac" className="inp" value={cat} onChange={e => setCat(e.target.value)}><option value="">Choose…</option>{REASONS.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Reason" htmlFor="ar"><textarea id="ar" className="inp" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: vendor support ended; teams now use a successor technology." /></Field>
      {check?.last_active && <Note tone="bad"><b>This role would have no active skills left.</b><label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} /> I understand and want to continue</label></Note>}
      {check && <details className="text-[13px]"><summary className="cursor-pointer text-ink-2">What happens across the platform</summary>
        <ul className="mt-2 list-disc pl-5 text-ink-2">
          <li>Employee profiles keep recorded levels as history, labelled retired ({check.affected.profiles} records).</li>
          <li>Open assessments for this skill close with a notice ({check.affected.open_assessments}).</li>
          <li>Open development activities are flagged for review ({check.affected.open_activities}).</li>
          <li>Gap analysis, career mobility, planning, search, counts and suggestions stop using it.</li>
          <li>Requirement type becomes Legacy only; last level and importance are kept.</li></ul></details>}
      <ErrorBox error={err} />
    </Modal>
  );
}

function RestoreDialog({ m, onClose, onDone }: any) {
  const [note, setNote] = useState(""); const [err, setErr] = useState<any>(null);
  if (!m) return null;
  return (
    <Modal open onClose={onClose} title={`Restore ${m.skill_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/pixels/${m.pixel_id}/restore`, { note }); if (!r.ok) return setErr(r.error); onDone(r.data.status === "restored" ? `${m.pixel_id} restored with a review flag` : `Restore sent for approval as ${r.data.change.id}`); }}>Restore</Button></>}>
      <p className="text-[13px]">{m.pixel_id} returns with the same Pixel ID, trend <b>Declining</b>, requirement type <b>Optional</b>, level {m.last_required_level} and a review flag.</p>
      <Field label="Note (optional)" htmlFor="rn"><textarea id="rn" className="inp" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <ErrorBox error={err} />
    </Modal>
  );
}

function EditDialog({ m, onClose, onDone }: any) {
  const [v, setV] = useState<any>({}); const [err, setErr] = useState<any>(null);
  useEffect(() => { if (m) setV({ required_level: m.required_level, requirement_type: m.requirement_type, importance: m.importance, skill_trend: m.skill_trend, explanation: m.explanation, reason: "" }); setErr(null); }, [m]);
  if (!m) return null;
  const published = m.approval_status === "Published";
  return (
    <Modal open onClose={onClose} title={`Edit ${m.skill_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("PATCH", `/pixels/${m.pixel_id}`, v); if (!r.ok) return setErr(r.error); onDone(r.data.status === "in_review" ? `Change sent for approval as ${r.data.change.id}` : "Draft updated"); }}>{published ? "Send change for approval" : "Save draft"}</Button></>}>
      {published && <Note>Changes to a published mapping go through approval. The current requirement stays in force until then.</Note>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Required level" htmlFor="el"><select id="el" className="inp" value={v.required_level} onChange={e => setV({ ...v, required_level: +e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Requirement type" htmlFor="er"><select id="er" className="inp" value={v.requirement_type} onChange={e => setV({ ...v, requirement_type: e.target.value })}>{REQ.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Importance" htmlFor="ei"><select id="ei" className="inp" value={v.importance} onChange={e => setV({ ...v, importance: e.target.value })}>{IMP.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Trend" htmlFor="et"><select id="et" className="inp" value={v.skill_trend} onChange={e => setV({ ...v, skill_trend: e.target.value })}>{TRENDS.map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Why this role needs it" htmlFor="ee"><textarea id="ee" className="inp" rows={2} value={v.explanation || ""} onChange={e => setV({ ...v, explanation: e.target.value })} /></Field>
      {published && <Field label="Reason for the change" htmlFor="ers"><input id="ers" className="inp" value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></Field>}
      <ErrorBox error={err} />
    </Modal>
  );
}

function AddSkill({ open, role, existing, onClose, onDone }: any) {
  const [q, setQ] = useState(""); const [incl, setIncl] = useState(false); const [pick, setPick] = useState<any>(null);
  const [v, setV] = useState<any>({ required_level: 3, requirement_type: "Mandatory", importance: "Medium", skill_trend: "Current", explanation: "" }); const [err, setErr] = useState<any>(null);
  const list = useApi<any[]>(open ? `/skills?q=${encodeURIComponent(q)}&include_archived=${incl}` : null);
  useEffect(() => { if (open) { setPick(null); setErr(null); } }, [open]);
  if (!open) return null;
  const restoring = pick && pick.archived_mappings > 0 && pick.status !== "Active" ? null : null;
  return (
    <Modal wide open onClose={onClose} title={`Add a skill to ${role.title}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick} onClick={async () => {
      const r = await api("POST", `/roles/${role.id}/skills`, { skill_id: pick.id, ...v });
      if (!r.ok) return setErr(r.error);
      onDone(r.data.restored_existing ? (r.data.status === "restored" ? `Existing mapping ${r.data.mapping.pixel_id} restored with its history` : `Restore sent for approval`) : `${r.data.mapping.pixel_id} saved as a draft`);
    }}>Save as draft</Button></>}>
      <div className="flex flex-wrap items-center gap-3"><input className="inp max-w-sm" placeholder="Search the skill library" value={q} onChange={e => setQ(e.target.value)} aria-label="Search skills" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={incl} onChange={e => setIncl(e.target.checked)} /> Include skills archived in every role</label></div>
      <div className="max-h-56 overflow-auto rounded-md border border-line">{(list.data || []).filter(x => !existing.has(x.id)).map(x => (
        <button key={x.id} onClick={() => setPick(x)} className={`flex w-full justify-between gap-2 border-b border-line px-3 py-1.5 text-left text-[13px] ${pick?.id === x.id ? "bg-accent-soft" : "hover:bg-sunken"}`}>
          <span><b>{x.name}</b> <span className="text-ink-3">{x.category}{x.global ? "" : " · company skill"}</span></span><span className="text-xs text-ink-3">{x.status === "Active" ? `${x.roles_mapped} roles` : x.status}</span></button>))}
        {list.data && !list.data.length && <Empty>No skills match. Skills archived in every role appear only when included.</Empty>}</div>
      {pick && <Note tone={pick.archived_mappings ? "warn" : "info"}><b>{pick.name}</b>: {pick.definition} Pixel ID <span className="font-mono">PX-{role.id}-{pick.id}</span>.{pick.archived_mappings ? " If this skill was archived for this role, saving restores that mapping with its history instead of creating a duplicate." : ""}</Note>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Required level" htmlFor="al"><select id="al" className="inp" value={v.required_level} onChange={e => setV({ ...v, required_level: +e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Requirement type" htmlFor="art"><select id="art" className="inp" value={v.requirement_type} onChange={e => setV({ ...v, requirement_type: e.target.value })}>{REQ.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Importance" htmlFor="aim"><select id="aim" className="inp" value={v.importance} onChange={e => setV({ ...v, importance: e.target.value })}>{IMP.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Trend" htmlFor="atr"><select id="atr" className="inp" value={v.skill_trend} onChange={e => setV({ ...v, skill_trend: e.target.value })}>{TRENDS.map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Why this role needs it" htmlFor="aex"><textarea id="aex" className="inp" rows={2} value={v.explanation} onChange={e => setV({ ...v, explanation: e.target.value })} placeholder="Link the skill to the role's responsibilities" /></Field>
      <ErrorBox error={err} />{restoring}
    </Modal>
  );
}

function Profile({ r, onChange }: any) {
  const toast = useToast(); const router = useRouter(); const s = useSession();
  const org = useApi<any>("/org"); const similar = useApi<any[]>(`/roles/${r.id}/similar`);
  const [edit, setEdit] = useState(false); const [v, setV] = useState<any>(null); const [err, setErr] = useState<any>(null);
  useEffect(() => { setV({ title: r.title, summary: r.summary, responsibilities: (r.responsibilities || []).join("\n"), outcomes: (r.outcomes || []).join("\n"), alt_titles: (r.alt_titles || []).join(", "), experience: r.experience || "", education: r.education || "", career_level_id: r.career_level_id || "", job_family_id: r.job_family_id || "", review_date: r.review_date ? String(r.review_date).slice(0, 10) : "" }); }, [r]);
  if (!v) return null;
  const save = async () => {
    const x = await api("PATCH", `/roles/${r.id}`, { ...v, responsibilities: v.responsibilities.split("\n").filter((l: string) => l.trim()), outcomes: v.outcomes.split("\n").filter((l: string) => l.trim()),
      alt_titles: v.alt_titles.split(",").map((t: string) => t.trim()).filter(Boolean), career_level_id: v.career_level_id || null, job_family_id: v.job_family_id || null, review_date: v.review_date || null });
    if (!x.ok) return setErr(x.error); setEdit(false); toast(r.status === "Published" ? "Saved as a new draft version. The published framework stays in force until it is approved." : "Saved"); onChange();
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Role profile" actions={r.can_edit && r.status !== "Archived" && r.status !== "In Review" && <>
        {!edit && <Button onClick={() => setEdit(true)}>Edit</Button>}
        <Button onClick={async () => { const x = await api("POST", `/roles/${r.id}/duplicate`, {}); if (x.ok) { toast(`Duplicated as ${x.data.id}`); router.push(`/roles/${x.data.id}`); } else toast(x.error!.message, "bad"); }}>Duplicate as template</Button>
        {can(s, "org:manage") && <Button variant="danger" onClick={async () => { const x = await api("POST", `/roles/${r.id}/archive`, {}); x.ok ? toast(`Role archived; ${x.data.paths_flagged} career path(s) flagged`) : toast(x.error!.message, "bad"); onChange(); }}>Archive role</Button>}</>}>
        {!edit ? (
          <dl className="grid gap-3 text-[13px] md:grid-cols-[180px_1fr]">
            <dt className="font-semibold">Alternative titles</dt><dd>{(r.alt_titles || []).join(", ") || "—"}</dd>
            <dt className="font-semibold">Summary</dt><dd>{r.summary || "—"}</dd>
            <dt className="font-semibold">Responsibilities</dt><dd><ul className="list-disc pl-5">{(r.responsibilities || []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></dd>
            <dt className="font-semibold">Expected outcomes</dt><dd><ul className="list-disc pl-5">{(r.outcomes || []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></dd>
            <dt className="font-semibold">Experience</dt><dd>{r.experience || "—"}</dd><dt className="font-semibold">Education</dt><dd>{r.education || "—"}</dd>
            <dt className="font-semibold">Next review</dt><dd>{fmtDate(r.review_date)}</dd>
          </dl>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title" htmlFor="pt"><input id="pt" className="inp" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Alternative titles (comma separated)" htmlFor="pa"><input id="pa" className="inp" value={v.alt_titles} onChange={e => setV({ ...v, alt_titles: e.target.value })} /></Field>
            <Field label="Job family" htmlFor="pf"><select id="pf" className="inp" value={v.job_family_id} onChange={e => setV({ ...v, job_family_id: e.target.value })}><option value="">None</option>{(org.data?.families || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Career level" htmlFor="pl"><select id="pl" className="inp" value={v.career_level_id} onChange={e => setV({ ...v, career_level_id: e.target.value })}><option value="">None</option>{(org.data?.levels || []).map((x: any) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
            <div className="md:col-span-2"><Field label="Summary" htmlFor="ps"><textarea id="ps" className="inp" rows={2} value={v.summary} onChange={e => setV({ ...v, summary: e.target.value })} /></Field></div>
            <Field label="Responsibilities (one per line)" htmlFor="pr"><textarea id="pr" className="inp" rows={5} value={v.responsibilities} onChange={e => setV({ ...v, responsibilities: e.target.value })} /></Field>
            <Field label="Outcomes (one per line)" htmlFor="po"><textarea id="po" className="inp" rows={5} value={v.outcomes} onChange={e => setV({ ...v, outcomes: e.target.value })} /></Field>
            <Field label="Experience" htmlFor="px"><input id="px" className="inp" value={v.experience} onChange={e => setV({ ...v, experience: e.target.value })} /></Field>
            <Field label="Next review date" htmlFor="pd"><input id="pd" type="date" className="inp" value={v.review_date} onChange={e => setV({ ...v, review_date: e.target.value })} /></Field>
            <div className="flex gap-2 md:col-span-2"><Button variant="primary" onClick={save}>Save</Button><Button onClick={() => setEdit(false)}>Cancel</Button></div>
            <div className="md:col-span-2"><ErrorBox error={err} /></div>
          </div>
        )}
      </Card>
      <Card title="Similar roles">
        {(similar.data || []).length ? <ul className="flex flex-col gap-2 text-[13px]">{similar.data!.map(x => <li key={x.id} className="flex justify-between gap-2"><Link className="font-medium text-accent hover:underline" href={`/roles/${x.id}`}>{x.title}</Link><span className="text-ink-3">{pct(x.overlap)} overlap</span></li>)}</ul> : <Empty>No close matches.</Empty>}
      </Card>
    </div>
  );
}

function Compare({ r }: any) {
  const roles = useApi<any[]>("/roles?status=Published"); const paths = useApi<any[]>(`/career-paths?from=${r.id}`);
  const [to, setTo] = useState(""); const cmp = useApi<any>(to ? `/roles/${r.id}/compare/${to}` : null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Compare with another role" actions={<select className="inp w-72" value={to} onChange={e => setTo(e.target.value)} aria-label="Target role"><option value="">Choose a target role…</option>{(roles.data || []).filter(x => x.id !== r.id).map(x => <option key={x.id} value={x.id}>{x.title} ({x.department_name})</option>)}</select>}>
        {r.status !== "Published" && <Note tone="warn">Only published roles can be compared.</Note>}
        {cmp.error && <ErrorBox error={cmp.error} />}
        {cmp.data && <CompareResult c={cmp.data} />}
        {!to && <Empty>Pick a role to see shared skills, new skills, level points to close and move difficulty.</Empty>}
      </Card>
      <Card title="Defined career paths from this role">
        {(paths.data || []).length ? <ul className="flex flex-col gap-2 text-[13px]">{paths.data!.map(p => <li key={p.id} className="flex justify-between gap-2"><button className="text-left font-medium text-accent hover:underline" onClick={() => setTo(p.to_role_id)}>{p.to_title}</button><span className="flex gap-1"><Pill>{p.status}</Pill><span className="text-ink-3">{p.movement_type}</span></span></li>)}</ul> : <Empty>No paths defined.</Empty>}
      </Card>
    </div>
  );
}

function History({ r }: any) {
  const s = useSession();
  const audit = useApi<any>(can(s, "audit:read") ? `/audit?entity_id=${r.id}` : null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Published versions">{r.versions.length ? <table className="t"><thead><tr><th>Version</th><th>By</th><th>Note</th><th>When</th></tr></thead><tbody>{r.versions.map((v: any) => <tr key={v.version}><td>v{v.version}</td><td>{v.changed_by}</td><td>{v.note}</td><td className="num">{new Date(v.at).toLocaleString()}</td></tr>)}</tbody></table> : <Empty>Not published yet.</Empty>}</Card>
      <Card title="Change log">{!can(s, "audit:read") ? <Empty>The change log is visible to HR and department heads.</Empty> : (audit.data?.events || []).length ? <table className="t"><thead><tr><th>Action</th><th>By</th><th>When</th></tr></thead><tbody>{audit.data.events.map((e: any) => <tr key={e.id}><td>{e.action.replace(/_/g, " ")}</td><td>{e.actor_name}</td><td className="num">{new Date(e.at).toLocaleString()}</td></tr>)}</tbody></table> : <Empty>No changes recorded.</Empty>}</Card>
    </div>
  );
}

function MarketCheck({ r, canDraft, onAdded }: any) {
  const toast = useToast();
  const { data: m, error, loading, reload } = useApi<any>(`/market/roles/${r.id}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const addDraft = async (k: any) => { const x = await api("POST", `/roles/${r.id}/skills`, { skill_id: k.skill_id, required_level: 3, requirement_type: k.share >= 0.5 ? "Mandatory" : "Optional", importance: "Medium", explanation: `Mentioned in ${pct(k.share)} of ${m.postings} job postings with this title` });
    x.ok ? toast(x.data.restored_existing ? "Existing mapping restored" : `${x.data.mapping.pixel_id} saved as a draft`) : toast(x.error!.message, "bad"); reload(); onAdded(); };
  return (
    <div className="flex flex-col gap-4">
      <Note tone={m.postings ? (m.small_sample ? "warn" : "info") : "muted"}>{m.note}{m.small_sample && m.postings ? " Small sample: treat the percentages as indicative." : ""} Matched market titles: {m.matched_titles.map((t: any) => `${t.display_title} (${t.postings})`).join(", ") || "none"}.{m.similar_titles.length ? ` Similar: ${m.similar_titles.slice(0, 4).map((t: any) => t.display_title).join(", ")}.` : ""}</Note>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false} title="Skills in this framework: how often postings mention them">
          <table className="t"><thead><tr><th>Skill</th><th title="Mandatory: needed on day one. Preferred: expected soon after joining. Optional: useful. Developmental: grow into it.">Requirement type</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th>Mentioned in postings</th></tr></thead>
            <tbody>{m.mapped.sort((a: any, b: any) => b.market_share - a.market_share).map((k: any) => <tr key={k.pixel_id}><td>{k.skill_name}</td><td>{k.requirement_type}</td><td><Pill>{k.skill_trend}</Pill></td>
              <td className="min-w-[160px]">{m.postings ? <div className="flex items-center gap-2"><Bar value={k.market_share} max={1} tone={k.market_share < 0.1 && k.requirement_type === "Mandatory" ? "warn" : "accent"} /><span className="num w-10 text-right">{pct(k.market_share)}</span></div> : "—"}</td></tr>)}</tbody></table>
        </Card>
        <Card pad={false} title="Mentioned in postings but not in this framework">
          {m.not_mapped.length ? <table className="t"><thead><tr><th>Skill</th><th>Mentioned in postings</th><th></th></tr></thead>
            <tbody>{m.not_mapped.map((k: any) => <tr key={k.skill_id}><td><Link className="hover:underline" href={`/skills/${k.skill_id}`}>{k.name}</Link></td><td className="min-w-[160px]"><div className="flex items-center gap-2"><Bar value={k.share} max={1} /><span className="num w-10 text-right">{pct(k.share)}</span></div></td>
              <td>{k.already_in_role ? <span className="text-xs text-ink-3">draft or archived</span> : canDraft && <Button size="sm" onClick={() => addDraft(k)}>Add as draft</Button>}</td></tr>)}</tbody></table> : <Empty>{m.postings ? "Nothing frequent is missing (15% or more of postings)." : "No postings to compare with."}</Empty>}
          <p className="px-4 py-2 text-xs text-ink-3">Drafts go through approval as usual. Market data suggests; your framework decides.</p>
        </Card>
      </div>
    </div>
  );
}

function RoleOutlook({ id }: { id: string }) {
  const o = useApi<any>(`/outlook/roles/${id}`);
  if (o.loading) return <Loading />;
  if (o.error) return <ErrorBox error={o.error} />;
  const d = o.data;
  return (
    <div className="flex flex-col gap-4">
      <Card><OutlookPanel o={d} /><Attribution items={d.attribution} /></Card>
      <Card title="Skill trends" pad={false}>
        {d.skills.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Skill</th><th title="Mandatory: needed on day one. Preferred: expected soon after joining. Optional: useful. Developmental: grow into it.">Requirement type</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th>Why it is suggested</th><th title="How sure the trend is (0 to 1), based on how much evidence there is">Trend confidence</th></tr></thead>
          <tbody>{[...d.skills].sort((a: any, b: any) => b.score - a.score).map((k: any) => <tr key={k.skill_id || k.name}><td className="font-medium">{k.name}</td><td>{k.requirement_type}</td>
            <td><TrendTag trend={k.trend} reasons={k.reasons} confidence={k.confidence} /></td><td className="max-w-md text-xs text-ink-2">{(k.reasons || []).slice(0, 2).join(" · ")}</td><td className="text-xs">{k.confidence}</td></tr>)}</tbody></table></div>
          : <Empty>No skills mapped yet.</Empty>}
      </Card>
    </div>
  );
}
