"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Level, Loading, Modal, Note, PageHeader, Pill, fmtDate, useToast } from "@/components/ui";

export default function SkillPage({ params }: { params: { id: string } }) {
  const s = useSession(); const toast = useToast();
  const { data: k, error, loading, reload } = useApi<any>(`/skills/${params.id}`);
  const levels = useApi<any>(s.user.org_id ? "/proficiency" : null);
  const market = useApi<any>(`/market/skills/${params.id}`);
  const [retire, setRetire] = useState<any>(null); const [merge, setMerge] = useState<any>(null);
  const all = useApi<any[]>(merge ? "/skills" : null);
  const [desc, setDesc] = useState<Record<number, string>>({}); const [edit, setEdit] = useState(false); const [v, setV] = useState<any>(null); const [err, setErr] = useState<any>(null);
  useEffect(() => { if (k) { setDesc(Object.fromEntries([1, 2, 3, 4, 5].map(l => [l, k.descriptors?.find((d: any) => d.level === l)?.descriptor || ""]))); setV({ name: k.name, definition: k.definition, category: k.category, aliases: (k.aliases || []).join(", ") }); } }, [k]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const editable = k.can_edit || (s.user.role === "platform_admin" && k.global);
  return (
    <>
      <PageHeader eyebrow={<><Link className="hover:underline" href="/skills">Skill library</Link> / <span className="font-mono">{k.id}</span></>} title={<span className="flex items-center gap-2">{k.name} {k.status && <Pill tone={k.status === "Active" ? "Active" : "Archived"}>{k.status}</Pill>}{k.review_date && String(k.review_date).slice(0, 10) <= new Date().toISOString().slice(0, 10) && k.lifecycle !== "Retired" && <Pill tone="In Review">Review due</Pill>}</span>}
        sub={<>{k.category} · {k.global ? "Global skill" : "Company skill"} · version {k.version}{k.parent_name ? ` · part of ${k.parent_name}` : ""}</>}
        actions={editable && !edit && <>{k.lifecycle !== "Retired" && <Button onClick={() => setEdit(true)}>Edit</Button>}
          {k.lifecycle === "Retired" ? !k.merged_into && <Button onClick={async () => { const r = await api("POST", `/skills/${k.id}/reinstate`); r.ok ? toast("Skill reinstated") : toast(r.error!.message, "bad"); reload(); }}>Reinstate</Button>
            : <><Button onClick={() => { setErr(null); setMerge({ into: "" }); }}>Merge into…</Button><Button variant="danger" onClick={() => { setErr(null); setRetire({ reason: "" }); }}>Retire</Button></>}</>} />
      {k.lifecycle === "Retired" && <div className="mb-4"><Note tone="muted"><b>Retired</b> on {fmtDate(k.retired_at)} by {k.retired_by}: {k.retired_reason}. {k.merged_into ? <>Its names now belong to <Link className="font-medium text-accent hover:underline" href={`/skills/${k.merged_into}`}>{k.merged_into}</Link>.</> : "It is no longer detected in postings or offered for roles; its history is kept."}</Note></div>}
      <Modal open={!!retire} onClose={() => setRetire(null)} title={`Retire ${k.name}`} footer={<><Button onClick={() => setRetire(null)}>Cancel</Button><Button variant="danger" disabled={(retire?.reason || "").length < 3} onClick={async () => { const r = await api("POST", `/skills/${k.id}/retire`, { reason: retire.reason }); if (!r.ok) return setErr(r.error); setRetire(null); toast("Skill retired; history kept"); reload(); }}>Retire</Button></>}>
        <Field label="Reason" htmlFor="rr"><textarea id="rr" className="inp" rows={2} value={retire?.reason || ""} onChange={e => setRetire({ reason: e.target.value })} placeholder="For example: added by mistake; a product name, not a skill" /></Field>
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!merge} onClose={() => setMerge(null)} title={`Merge ${k.name} into another skill`} footer={<><Button onClick={() => setMerge(null)}>Cancel</Button><Button variant="primary" disabled={!merge?.into} onClick={async () => { const r = await api("POST", `/skills/${k.id}/merge`, { into: merge.into }); if (!r.ok) return setErr(r.error); setMerge(null); toast(`Merged: ${r.data.names_moved.length} name(s) moved`); reload(); }}>Merge</Button></>}>
        <p className="text-[13px] text-ink-3">Use this for duplicates. “{k.name}” and its other names become names of the skill you choose, people's recorded levels move over, and “{k.name}” is retired. Skills that roles still require cannot be merged, because Pixel IDs never change.</p>
        <Field label="Keep this skill" htmlFor="mi"><select id="mi" className="inp" value={merge?.into || ""} onChange={e => setMerge({ into: e.target.value })}><option value="">Choose…</option>{(all.data || []).filter((x: any) => x.id !== k.id && (k.global ? x.global : true)).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}</select></Field>
        <ErrorBox error={err} />
      </Modal>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Card title="Definition">
            {!edit ? <><p>{k.definition}</p><p className="mt-2 text-[13px] text-ink-2">Aliases: {(k.aliases || []).join(", ") || "—"}</p>
              {k.children?.length > 0 && <p className="mt-1 text-[13px] text-ink-2">Child skills: {k.children.map((c: any) => c.name).join(", ")}</p>}
              {k.related?.length > 0 && <p className="mt-1 text-[13px] text-ink-2">Related: {k.related.map((c: any) => <Link key={c.id} className="mr-2 font-medium text-accent hover:underline" href={`/skills/${c.id}`}>{c.name}</Link>)}</p>}
              {k.global && !editable && s.user.org_id && <p className="mt-2 text-xs text-ink-3">Managed by the platform.</p>}</>
              : <div className="grid gap-3">
                <Field label="Name" htmlFor="kn"><input id="kn" className="inp" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
                <Field label="Definition" htmlFor="kd"><textarea id="kd" className="inp" rows={3} value={v.definition} onChange={e => setV({ ...v, definition: e.target.value })} /></Field>
                <Field label="Category" htmlFor="kc"><input id="kc" className="inp" value={v.category} onChange={e => setV({ ...v, category: e.target.value })} /></Field>
                <Field label="Aliases" htmlFor="ka"><input id="ka" className="inp" value={v.aliases} onChange={e => setV({ ...v, aliases: e.target.value })} /></Field>
                <div className="flex gap-2"><Button variant="primary" onClick={async () => { const r = await api("PATCH", `/skills/${k.id}`, { ...v, aliases: v.aliases.split(",").map((x: string) => x.trim()).filter(Boolean) }); if (!r.ok) return setErr(r.error); setEdit(false); toast("Skill saved"); reload(); }}>Save</Button><Button onClick={() => setEdit(false)}>Cancel</Button></div>
                <ErrorBox error={err} /></div>}
          </Card>
          {s.user.org_id && <Card title="Proficiency levels for this skill" actions={can(s, "proficiency:write") && <Button size="sm" variant="primary" onClick={async () => { const r = await api("PUT", `/skills/${k.id}/descriptors`, { descriptors: Object.entries(desc).map(([l, d]) => ({ level: +l, descriptor: d })) }); r.ok ? toast("Descriptors saved") : toast(r.error!.message, "bad"); reload(); }}>Save descriptors</Button>}>
            <div className="flex flex-col gap-3">{(levels.data?.levels || []).map((l: any) => (
              <div key={l.level} className="grid gap-2 md:grid-cols-[160px_1fr]"><div><Level n={l.level} /><div className="text-xs text-ink-3">{l.descriptor}</div></div>
                <textarea aria-label={`Level ${l.level} descriptor`} className="inp" rows={2} disabled={!can(s, "proficiency:write")} value={desc[l.level] || ""} onChange={e => setDesc({ ...desc, [l.level]: e.target.value })} placeholder="Skill-specific, observable behaviour at this level" /></div>))}</div>
          </Card>}
        </div>
        <div className="flex flex-col gap-4">
          <Card title={`Roles requiring it (${k.roles_mapped ?? 0})`}>
            {k.mappings?.length ? <ul className="flex flex-col gap-2 text-[13px]">{k.mappings.map((m: any) => <li key={m.pixel_id} className="flex items-center justify-between gap-2">{m.company ? <span>{m.role_name} <span className="text-xs text-ink-3">{m.company} · {m.industry}</span></span> : <Link className="font-medium text-accent hover:underline" href={`/roles/${m.role_id}`}>{m.role_name}</Link>}<span className="flex items-center gap-2"><Level n={m.required_level} short /><Pill>{m.skill_trend}</Pill></span></li>)}</ul> : <Empty>{k.roles_mapped ? "Role details are visible to HR and department heads." : "Not mapped to any active role."}</Empty>}
          </Card>
          {market.data && <Card title="Market demand">
            {market.data.postings ? <><div className="num text-2xl font-bold">{Math.round(Number(market.data.share) * 1000) / 10}%</div><p className="text-[13px] text-ink-2">of imported job postings mention it ({market.data.postings} postings, {market.data.companies} employers).</p>
              <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Most common titles</h3><ul className="text-[13px]">{market.data.top_titles.slice(0, 6).map((t: any) => <li key={t.title}>{t.title} <span className="text-ink-3">({t.n})</span></li>)}</ul>
              {market.data.single_period && <p className="mt-2 text-xs text-ink-3">One snapshot: this shows current demand, not a trend.</p>}</> : <p className="text-[13px] text-ink-3">Not mentioned in the imported postings.</p>}
          </Card>}
          {k.archived?.length > 0 && <Card title="Archived mappings (on request)"><ul className="flex flex-col gap-1 text-[13px] text-ink-2">{k.archived.map((a: any) => <li key={a.pixel_id}><span className="font-mono text-xs">{a.pixel_id}</span> {a.role_name}: {a.archive_reason_category}, {fmtDate(a.archived_on)}</li>)}</ul></Card>}
        </div>
      </div>
    </>
  );
}
