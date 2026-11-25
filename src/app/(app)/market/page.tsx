"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Bar, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Pill, Stat, Tabs, fmtDate, pct, useToast } from "@/components/ui";

export default function Market() {
  const s = useSession(); const toast = useToast();
  const admin = s.user.role === "platform_admin";
  const sum = useApi<any>("/market/summary");
  const [tab, setTab] = useState("titles"); const [q, setQ] = useState(""); const [sel, setSel] = useState<string | null>(null);
  const titles = useApi<any[]>(`/market/titles?q=${encodeURIComponent(q)}`);
  const detail = useApi<any>(sel ? `/market/titles/${encodeURIComponent(sel)}` : null);
  const cands = useApi<any[]>(tab === "candidates" ? "/market/candidates" : null);
  const [add, setAdd] = useState<any>(null); const [lic, setLic] = useState<any>(null); const [err, setErr] = useState<any>(null);
  if (sum.loading) return <Loading />;
  if (sum.error) return <ErrorBox error={sum.error} />;
  const d = sum.data; const t = d.totals;
  if (!t.postings) return <><PageHeader title="Market intelligence" /><Card><Empty>No job postings imported yet. Run <span className="font-mono">npx tsx scripts/import-jobs.ts file.xlsx</span>.</Empty></Card></>;
  return (
    <>
      <PageHeader title="Market intelligence" sub={`${t.postings.toLocaleString()} postings · ${t.companies} employers · ${fmtDate(t.period_from)} to ${fmtDate(t.period_to)}`}
        actions={admin && d.sources[0] && !d.sources[0].licence && <Button onClick={() => { setErr(null); setLic({ id: d.sources[0].id, licence: "" }); }}>Record usage rights</Button>} />
      <div className="mb-4 flex flex-col gap-2">{d.caveats.map((c: string) => <Note key={c} tone="warn">{c}</Note>)}</div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Postings" value={t.postings.toLocaleString()} sub={`${d.sources.length} import(s)`} /><Stat label="Employers" value={t.companies} />
        <Stat label="Distinct market titles" value={t.titles.toLocaleString()} sub="after normalisation" /><Stat label="Mention a library skill" value={pct(t.with_library_skill / t.postings)} sub={`${d.library_skills_not_seen.length} library skills never mentioned`} />
        <Stat label="Candidate new skills" value={d.open_candidates} sub="for platform review" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "titles", label: "Market titles" }, { id: "skills", label: "Skill demand" }, ...(d.role_coverage ? [{ id: "roles", label: "Your roles in the market" }] : []), { id: "candidates", label: "Candidate skills" }]} />

      {tab === "titles" && <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card pad={false} title="Titles" actions={<input className="inp w-64" placeholder="Search a title, e.g. data engineer" value={q} onChange={e => setQ(e.target.value)} aria-label="Search titles" />}>
          <div className="max-h-[640px] overflow-auto"><table className="t"><thead><tr><th>Title</th><th className="text-right">Job postings</th><th className="text-right">Employers posting</th></tr></thead>
            <tbody>{(titles.data || []).map(x => <tr key={x.normalized_title} className={`click ${sel === x.normalized_title ? "bg-accent-soft" : ""}`} onClick={() => setSel(x.normalized_title)}><td>{x.display_title}<div className="text-xs text-ink-3">{x.normalized_title}</div></td><td className="num text-right">{x.postings}</td><td className="num text-right">{x.companies}</td></tr>)}</tbody></table></div>
        </Card>
        <Card title={detail.data ? detail.data.display_title : "Choose a title"} actions={admin && detail.data && (detail.data.template ? <Pill tone="Met">Template {detail.data.template.id}</Pill> : <Button size="sm" variant="primary" onClick={async () => { const r = await api("POST", `/market/titles/${encodeURIComponent(sel!)}/promote`, {}); r.ok ? toast(`Template ${r.data.template_id} created with ${r.data.skills} skills`) : toast(r.error!.message, "bad"); detail.reload(); }}>Make role template</Button>)}>
          {!detail.data ? <Empty>Pick a title to see what its postings ask for.</Empty> : <div className="flex flex-col gap-3">
            <div className="text-[13px] text-ink-2">{detail.data.postings} postings at {detail.data.companies} employers{detail.data.small_sample && <Pill tone="Medium" className="ml-2">small sample</Pill>}</div>
            <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Library skills mentioned</h3>
              {detail.data.skill_profile.length ? <ul className="flex flex-col gap-1.5">{detail.data.skill_profile.slice(0, 15).map((k: any) => <li key={k.skill_id} className="grid grid-cols-[200px_1fr_44px] items-center gap-2 text-[13px]"><Link className="truncate hover:underline" href={`/skills/${k.skill_id}`}>{k.name}</Link><Bar value={Number(k.share)} max={1} /><span className="num text-right">{pct(Number(k.share))}</span></li>)}</ul> : <p className="text-[13px] text-ink-3">No library skill is mentioned. The library may not cover this kind of work yet.</p>}</div>
            <div className="grid gap-3 md:grid-cols-2 text-[13px]">
              <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Title variants</h3><ul>{detail.data.raw_variants.map((v: any) => <li key={v.title}>{v.title} <span className="text-ink-3">({v.n})</span></li>)}</ul></div>
              <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Employers</h3><ul>{detail.data.top_companies.map((v: any) => <li key={v.name}>{v.name} <span className="text-ink-3">({v.n})</span></li>)}</ul>
                <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Seniority</h3><ul>{detail.data.seniority.map((v: any) => <li key={v.level}>{v.level} <span className="text-ink-3">({v.n})</span></li>)}</ul></div>
            </div>
          </div>}
        </Card>
      </div>}

      {tab === "skills" && <Card pad={false} title="How often library skills are mentioned">
        <table className="t"><thead><tr><th>Skill</th><th>Share of postings</th><th className="text-right">Job postings</th><th className="text-right">Employers posting</th></tr></thead>
          <tbody>{d.top_skills.map((k: any) => <tr key={k.skill_id}><td><Link className="hover:underline" href={`/skills/${k.skill_id}`}>{k.name}</Link></td><td className="min-w-[200px]"><div className="flex items-center gap-2"><Bar value={k.share} max={d.top_skills[0].share} /><span className="num w-12 text-right">{pct(k.share)}</span></div></td><td className="num text-right">{k.postings}</td><td className="num text-right">{k.companies}</td></tr>)}</tbody></table>
        {d.library_skills_not_seen.length > 0 && <p className="px-4 py-2 text-xs text-ink-3">Never mentioned: {d.library_skills_not_seen.map((x: any) => x.name).join(", ")}.</p>}
      </Card>}

      {tab === "roles" && d.role_coverage && <Card pad={false} title="Postings with the same title as your published roles">
        <table className="t"><thead><tr><th>Role</th><th className="text-right">Job postings</th><th className="text-right">Similar market titles</th><th></th></tr></thead>
          <tbody>{d.role_coverage.map((r: any) => <tr key={r.role_id}><td>{r.title}</td><td className="num text-right">{r.postings || <span className="text-ink-3">0</span>}</td><td className="num text-right">{r.similar}</td><td><Link className="font-medium text-accent hover:underline" href={`/roles/${r.role_id}?tab=market`}>Market check</Link></td></tr>)}</tbody></table>
      </Card>}

      {tab === "candidates" && <Card pad={false} title="Tools, standards and certifications that are not in the library">
        {cands.loading ? <Loading /> : <table className="t"><thead><tr><th>Term</th><th className="text-right">Job postings</th><th className="text-right">Employers posting</th><th>Typical titles</th><th>Status</th>{admin && <th></th>}</tr></thead>
          <tbody>{(cands.data || []).map(c => <tr key={c.term}><td className="font-medium">{c.term}</td><td className="num text-right">{c.postings}</td><td className="num text-right">{c.companies}</td><td className="text-xs text-ink-2">{c.top_titles.slice(0, 3).map((x: any) => x.title).join(", ")}</td>
            <td><Pill tone={c.status === "Added" ? "Met" : c.status === "Ignored" ? "Withdrawn" : "Suggested"}>{c.status}</Pill>{c.skill_name && <div className="text-xs">{c.skill_name}</div>}</td>
            {admin && <td className="whitespace-nowrap">{c.status === "Candidate" && <><Button size="sm" variant="primary" onClick={() => { setErr(null); setAdd({ term: c.term, name: c.term, category: "", definition: "" }); }}>Add skill</Button>{" "}
              <Button size="sm" onClick={async () => { await api("POST", `/market/candidates/${encodeURIComponent(c.term)}/decide`, { action: "ignore" }); cands.reload(); }}>Ignore</Button></>}</td>}</tr>)}</tbody></table>}
      </Card>}

      <Modal open={!!add} onClose={() => setAdd(null)} title={`Add “${add?.term}” to the global library`} footer={<><Button onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/market/candidates/${encodeURIComponent(add.term)}/decide`, { action: "add", name: add.name, category: add.category, definition: add.definition }); if (!r.ok) return setErr(r.error); setAdd(null); toast(`${r.data.skill_id} created. ${r.data.note}`); cands.reload(); }}>Add</Button></>}>
        {add && <><Field label="Skill name" htmlFor="cn"><input id="cn" className="inp" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Category" htmlFor="cc"><input id="cc" className="inp" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} placeholder="e.g. Software & Platforms" /></Field>
          <Field label="Definition" htmlFor="cd"><textarea id="cd" className="inp" rows={3} value={add.definition} onChange={e => setAdd({ ...add, definition: e.target.value })} /></Field></>}
        <ErrorBox error={err} />
      </Modal>
      <Modal open={!!lic} onClose={() => setLic(null)} title="Record usage rights for this data" footer={<><Button onClick={() => setLic(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", `/market/sources/${lic.id}/licence`, { licence: lic.licence }); if (!r.ok) return setErr(r.error); setLic(null); toast("Usage rights recorded"); sum.reload(); }}>Save</Button></>}>
        <p className="text-[13px] text-ink-2">PRD 18.2: before external data is used as evidence, record its usage rights, redistribution permissions and attribution requirements.</p>
        {lic && <textarea className="inp" rows={4} value={lic.licence} onChange={e => setLic({ ...lic, licence: e.target.value })} aria-label="Licence" />}
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
