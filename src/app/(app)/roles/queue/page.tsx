"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { AiDraftReview } from "@/components/AiDraftReview";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pill, Tabs, pct, useToast } from "@/components/ui";

export default function RoleQueue() {
  const s = useSession(); const toast = useToast();
  const [tab, setTab] = useState("Open");
  const { data, error, loading, reload } = useApi<any[]>(`/role-queue${tab === "all" ? "" : `?status=${encodeURIComponent(tab)}`}`);
  const org = useApi<any>("/org"); const roles = useApi<any[]>("/roles");
  const [act, setAct] = useState<any>(null); const [err, setErr] = useState<any>(null); const [add, setAdd] = useState<any>(null);
  const depts = (org.data?.departments || []).filter((d: any) => d.status === "Active" && (s.permissions["roles:write"] === "org" || d.id === s.user.department_id));
  const resolve = async (id: string, body: any) => { const r = await api("POST", `/role-queue/${id}/resolve`, body); if (!r.ok) { setErr(r.error); return false; }
    toast(r.data.status === "Resolved" ? `Resolved. ${r.data.employees_created || 0} waiting employee(s) created.` : r.data.status === "Role drafted" ? `Draft role ${r.data.role_id} created. Waiting people are added when it is published.` : `Dismissed`); reload(); return true; };
  return (
    <>
      <PageHeader title="Role resolution"
        actions={<Button variant="primary" onClick={() => { setErr(null); setAdd({ title: "", department_id: "" }); }}>Add a title</Button>} />
      {can(s, "roles:write") && <AiDraftReview />}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "Open", label: "Open" }, { id: "Role drafted", label: "Waiting for publish" }, { id: "Resolved", label: "Resolved" }, { id: "all", label: "All" }]} />
      <ErrorBox error={error} />
      {loading ? <Loading /> : (data || []).length === 0 ? <Card><Empty>{tab === "Open" ? "Nothing waiting. Unknown titles from imports, the add-employee form, job descriptions and search appear here." : "Nothing here."}</Empty></Card> : (
        <div className="flex flex-col gap-3">{data!.map(it => {
          const sg = it.suggestions || {};
          return (
            <Card key={it.id} title={<div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">“{it.raw_title}”</h2><Pill>{it.status}</Pill>
              <span className="text-xs text-ink-3">{it.id} · from {it.source.replace("_", " ")} · seen {it.occurrences}× · {it.department_name || "no department"}{it.pending ? ` · ${it.pending} employee(s) waiting` : ""}</span></div>}
              actions={it.status === "Open" && can(s, "org:manage") && <Button size="sm" onClick={() => { setErr(null); setAct({ it, mode: "dismiss", reason: "" }); }}>Dismiss</Button>}>
              {it.status === "Role drafted" && <Note>Draft role <Link className="font-medium text-accent hover:underline" href={`/roles/${it.resolved_role_id}`}>{it.resolved_role_title}</Link> ({it.resolved_role_status}). Submit and approve it; waiting people are created automatically when it is published.</Note>}
              {it.status === "Resolved" && <Note tone="muted">Resolved by {it.resolved_by}{it.resolved_role_id ? <> as <Link className="font-medium text-accent hover:underline" href={`/roles/${it.resolved_role_id}`}>{it.resolved_role_title}</Link></> : ""} ({(it.resolution || "").replace("_", " ")}).</Note>}
              {it.status === "Open" && <div className="grid gap-4 lg:grid-cols-3">
                <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Similar existing roles</h3>
                  {(sg.candidates || []).length ? <ul className="flex flex-col gap-1.5 text-[13px]">{sg.candidates.map((c: any) => <li key={c.id} className="flex items-center justify-between gap-2"><span><Link className="font-medium text-accent hover:underline" href={`/roles/${c.id}`}>{c.title}</Link> <span className="text-xs text-ink-3">{c.department_name} · {pct(c.score)}</span></span>
                    <Button size="sm" onClick={() => resolve(it.id, { action: "map", role_id: c.id, add_alias: true })}>Map here</Button></li>)}</ul> : <p className="text-[13px] text-ink-3">None close enough.</p>}
                  <Button size="sm" className="mt-2" onClick={() => { setErr(null); setAct({ it, mode: "map", role_id: "" }); }}>Map to another role…</Button></div>
                <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Role templates</h3>
                  {(sg.templates || []).length ? <ul className="flex flex-col gap-1.5 text-[13px]">{sg.templates.map((t: any) => <li key={t.id} className="flex items-center justify-between gap-2"><span>{t.title} <span className="text-xs text-ink-3">{t.industry} · {t.skills} skills · {pct(t.score)}</span></span>
                    <Button size="sm" onClick={() => { setErr(null); setAct({ it, mode: "template", template_id: t.id, title: it.raw_title, department_id: it.department_id || "" }); }}>Use</Button></li>)}</ul> : <p className="text-[13px] text-ink-3">No similar template.</p>}</div>
                {(sg.market || []).length > 0 && <div className="lg:col-span-3"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">In job postings</h3>
                  <ul className="flex flex-col gap-1.5 text-[13px]">{sg.market.map((mk: any) => <li key={mk.normalized_title} className="flex flex-wrap items-center justify-between gap-2"><span><b>{mk.display_title}</b> <span className="text-xs text-ink-3">{mk.postings} postings · {mk.companies} employers{mk.score < 1 ? ` · ${pct(mk.score)} similar` : ""}</span>
                    {mk.top_skills?.length ? <span className="ml-2 text-xs text-ink-2">{mk.top_skills.map((k: any) => `${k.name} ${pct(k.share)}`).join(", ")}</span> : null}</span>
                    <Button size="sm" onClick={() => { setErr(null); setAct({ it, mode: "market", normalized_title: mk.normalized_title, title: it.raw_title, department_id: it.department_id || "" }); }}>Draft from postings</Button></li>)}</ul></div>}
                <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">New role</h3>
                  <p className="text-[13px] text-ink-2">{(sg.inferred_skills || []).length ? `Skills named in the title: ${sg.inferred_skills.map((x: any) => x.name).join(", ")}.` : "No skills could be read from the title."}{sg.seniority ? ` Seniority word: ${sg.seniority}.` : ""}</p>
                  <Button size="sm" className="mt-2" onClick={() => { setErr(null); setAct({ it, mode: "new", title: it.raw_title, department_id: it.department_id || "" }); }}>Create a draft role</Button></div>
              </div>}
            </Card>);
        })}</div>)}
      <Modal open={!!act} onClose={() => setAct(null)} title={act ? { map: "Map to an existing role", template: "Draft a role from the template", new: "Create a new draft role", market: "Draft a role from job postings", dismiss: "Dismiss this title" }[act.mode as string] : ""}
        footer={<><Button onClick={() => setAct(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
          const body = act.mode === "map" ? { action: "map", role_id: act.role_id, add_alias: true } : act.mode === "dismiss" ? { action: "dismiss", reason: act.reason } : act.mode === "market" ? { action: "market", normalized_title: act.normalized_title, title: act.title, department_id: act.department_id } : act.mode === "template" ? { action: "template", template_id: act.template_id, title: act.title, department_id: act.department_id } : { action: "new", title: act.title, department_id: act.department_id };
          if (await resolve(act.it.id, body)) setAct(null); }}>Confirm</Button></>}>
        {act?.mode === "map" && <Field label="Role" htmlFor="qm"><select id="qm" className="inp" value={act.role_id} onChange={e => setAct({ ...act, role_id: e.target.value })}><option value="">Choose…</option>{(roles.data || []).filter(r => r.status !== "Archived").map(r => <option key={r.id} value={r.id}>{r.title} ({r.department_name}, {r.status})</option>)}</select></Field>}
        {(act?.mode === "template" || act?.mode === "new" || act?.mode === "market") && <><Field label="Role title" htmlFor="qt"><input id="qt" className="inp" value={act.title} onChange={e => setAct({ ...act, title: e.target.value })} /></Field>
          <Field label="Department" htmlFor="qd"><select id="qd" className="inp" value={act.department_id} onChange={e => setAct({ ...act, department_id: e.target.value })}><option value="">Choose…</option>{depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Note>The role is created as a Draft with {act.mode === "template" ? "the template's skills" : act.mode === "market" ? "the library skills mentioned in at least 20% of the matching postings (Mandatory at 50% or more), at level 3" : "any skills named in the title"}. Review it, then submit it for approval.</Note></>}
        {act?.mode === "dismiss" && <><Field label="Reason" htmlFor="qr"><input id="qr" className="inp" value={act.reason} onChange={e => setAct({ ...act, reason: e.target.value })} /></Field>
          {act.it.pending > 0 && <Note tone="warn">{act.it.pending} waiting employee record(s) will not be created.</Note>}</>}
        {act && <p className="text-xs text-ink-3">Mapping adds “{act.it.raw_title}” as an alternative title, so the next import matches it automatically.</p>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!add} onClose={() => setAdd(null)} title="Add a role title" footer={<><Button onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/role-queue", { title: add.title, department_id: add.department_id || null }); if (!r.ok) return setErr(r.error); setAdd(null); toast(r.data.status === "exists" ? `Already a role: ${r.data.role.title}` : "Added to the queue"); reload(); }}>Add</Button></>}>
        {add && <><Field label="Title" htmlFor="at"><input id="at" className="inp" value={add.title} onChange={e => setAdd({ ...add, title: e.target.value })} /></Field>
          <Field label="Department (optional)" htmlFor="ad"><select id="ad" className="inp" value={add.department_id} onChange={e => setAdd({ ...add, department_id: e.target.value })}><option value="">None</option>{(org.data?.departments || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></>}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
