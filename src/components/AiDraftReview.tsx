"use client";
/* HR review of drafted role profiles (from searches for titles that are not in the framework). */
import Link from "next/link";
import { useState } from "react";
import { Bot, Check, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, ErrorBox, Field, Note, useToast } from "@/components/ui";
import { RoleDraftCard } from "@/components/RoleDraftCard";

export function ApproveForm({ d, depts, onDone }: { d: any; depts: any[]; onDone: () => void }) {
  const toast = useToast();
  const p = d.payload || {};
  const [dept, setDept] = useState(p.suggested_department?.id || ""); const [title, setTitle] = useState(p.title || d.query);
  const [newAs, setNewAs] = useState<Record<string, string>>(Object.fromEntries((p.new_skills || []).map((n: any) => [n.name, "company"])));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null); const [rejecting, setRejecting] = useState(false); const [note, setNote] = useState("");
  const approve = async () => {
    setBusy(true); setErr(null);
    const r = await api("POST", `/ai/role-drafts/${d.id}/approve`, { department_id: dept, title, new_skills: (p.new_skills || []).map((n: any) => ({ ...n, category: n.category || undefined, as: newAs[n.name] || "skip" })) });
    setBusy(false); if (!r.ok) return setErr(r.error);
    toast(`Draft role ${r.data.role_id} created with ${r.data.skills} skills. Check the levels, then submit it for approval.`); onDone();
  };
  const reject = async () => { const r = await api("POST", `/ai/role-drafts/${d.id}/reject`, { note }); r.ok ? (toast("Draft rejected"), onDone()) : setErr(r.error); };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Role title" htmlFor={`t${d.id}`}><input id={`t${d.id}`} className="inp" value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label="Department" htmlFor={`d${d.id}`}><select id={`d${d.id}`} className="inp" value={dept} onChange={e => setDept(e.target.value)}><option value="">Choose…</option>{depts.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <div className="flex gap-2"><Button variant="primary" disabled={!dept || !title} loading={busy} onClick={approve}><Check className="h-4 w-4" />Create draft role</Button><Button onClick={() => setRejecting(!rejecting)}><X className="h-4 w-4" />Reject</Button></div>
      </div>
      {(p.new_skills || []).length > 0 && <div className="flex flex-col gap-1.5 text-[13px]"><div className="text-[12.5px] font-medium text-ink-2">New skills named by the draft</div>
        {(p.new_skills || []).map((n: any) => <label key={n.name} className="flex flex-wrap items-center gap-2"><span className="min-w-[160px] font-medium">{n.name}</span>
          <select className="inp w-auto py-1" value={newAs[n.name]} onChange={e => setNewAs({ ...newAs, [n.name]: e.target.value })}><option value="company">Create as a company skill</option><option value="request">Ask the platform to add it to the shared library</option><option value="skip">Leave out</option></select>
          {n.definition && <span className="text-[12px] text-ink-3">{n.definition}</span>}</label>)}</div>}
      {rejecting && <div className="flex gap-2"><input className="inp" placeholder="Reason (optional)" value={note} onChange={e => setNote(e.target.value)} /><Button variant="danger" onClick={reject}>Reject draft</Button></div>}
      <ErrorBox error={err} />
    </div>
  );
}

export function AiDraftReview() {
  const s = useSession();
  const list = useApi<any[]>("/ai/role-drafts?status=Ready");
  const st = useApi<any>("/ai/status");
  const org = useApi<any>("/org");
  const depts = (org.data?.departments || []).filter((d: any) => d.status === "Active" && (s.permissions["roles:write"] === "org" || d.id === s.user.department_id));
  const regenerate = async (id: string) => { await api("POST", `/ai/role-drafts/${id}/regenerate`, {}); list.reload(); };
  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex items-start gap-2 text-[13px]">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        {st.data ? (st.data.connected ? (st.data.online ? <span>Online AI model <b className="font-medium">{st.data.model}</b> (OpenRouter) is connected: searches for missing roles get a written draft profile. Draft requests (role title, similar roles, skill names) are sent to OpenRouter.</span> : <span>Local AI model <b className="font-medium">{st.data.model}</b> is connected: searches for missing roles get a written draft profile.</span>)
          : <span className="text-ink-3">No local AI model connected: drafts are made from job-market data, templates and similar roles. {st.data.provider === "off" ? st.data.reason : <>For AI-written drafts, put a model file such as <code className="font-mono">qwen2.5-3b-instruct-q4_k_m.gguf</code> in the app's <b>models</b> folder and restart (see models/README.txt).</>}</span>) : null}
      </div>
      {(list.data || []).length > 0 && <>
        <h2 className="font-serif text-[20px] font-bold">Drafted profiles waiting for review <span className="num text-[14px] font-normal text-ink-3">{list.data!.length}</span></h2>
        {list.data!.map(d => <RoleDraftCard key={d.id} draft={d} compact onRegenerate={() => regenerate(d.id)}
          footer={<><div className="mb-2 text-[12px] text-ink-3">Requested by {d.created_by_name} from a search for “{d.query}”. Approving creates a <b>draft</b> role; it is published only after the normal approval.</div><ApproveForm d={d} depts={depts} onDone={list.reload} /></>} />)}
      </>}
      {list.data && !list.data.length && <Note tone="muted">No drafted profiles waiting. <Link className="font-medium text-accent hover:underline" href="/search">Try a search</Link></Note>}
    </div>
  );
}
