"use client";
/* How job postings become market titles, skills, candidates and templates, with the live numbers at each step.
   Plus the review of skill candidates found in posting text (platform administrator). */
import { useMemo, useState } from "react";
import { Check, ChevronDown, EyeOff, Link2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { VARIANTS } from "@/server/terms";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, Pagination, Pill, SearchInput, cx, fmtNum, usePaged, useToast } from "@/components/ui";

export function PipelineExplainer({ st }: { st: any }) {
  const [open, setOpen] = useState(false);
  const steps = [
    { n: fmtNum(st.postings), l: "job postings", d: `from ${fmtNum(st.employers)} employers` },
    { n: fmtNum(st.raw_titles), l: "title spellings", d: "as employers wrote them" },
    { n: fmtNum(st.market_titles), l: "market titles", d: "after grouping variants" },
    { n: fmtNum(st.postings_with_skills), l: "postings with library skills", d: `${fmtNum(st.global_skills)} skills, with all their spellings` },
    { n: fmtNum(st.open_candidates), l: "new skill candidates", d: `${fmtNum(st.candidates_covered)} terms already covered` },
    { n: fmtNum(st.templates), l: "role templates", d: `${fmtNum(st.template_ready_titles)} titles have enough postings` },
  ];
  return (
    <Card className="mb-5" title="How job postings become data" sub="Every upload runs these steps automatically. Numbers are live.">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.l} className="relative border-l-[3px] border-ink py-0.5 pl-3">
            <div className="font-mono text-[11px] text-accent">STEP {i + 1}</div>
            <div className="num text-[22px] font-medium leading-tight">{s.n}</div>
            <div className="text-[13px] font-medium">{s.l}</div>
            <div className="text-[12px] text-ink-3">{s.d}</div>
          </li>))}
      </ol>
      <button onClick={() => setOpen(!open)} className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
        <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} />{open ? "Hide" : "How titles and skill spellings are matched"}</button>
      {open && (
        <div className="mt-3 grid gap-5 text-[13.5px] lg:grid-cols-2">
          <div>
            <h3 className="font-serif text-[16px] font-bold">Job titles</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-2">
              <li>Seniority words are recorded separately and removed: Senior, Sr., Jr., Lead, II, Principal…</li>
              <li>Spelling variants become one word: “Dot Net”, “dotnet”, “.NET” → <span className="font-mono">dotnet</span>; “Node JS”, “NodeJS” → <span className="font-mono">nodejs</span>.</li>
              <li>Noise is removed: numbers and years (“2027”), brackets, locations after a dash, shifts, “fresher”, “co-op”, plurals.</li>
              <li>Words that fewer than {st.employers >= 60 ? 3 : 2} employers use in titles are dropped (team codes, product names). What is left is the market title.</li>
            </ol>
          </div>
          <div>
            <h3 className="font-serif text-[16px] font-bold">Skill spellings treated as the same</h3>
            <div className="mt-2 max-h-[260px] overflow-auto border-t border-ink scroll-thin">
              <table className="t"><tbody>{VARIANTS.map(v => <tr key={v.canonical}><td className="font-medium">{v.canonical}</td><td className="font-mono text-[12px] text-ink-3">{v.spellings.join(" · ")}</td></tr>)}</tbody></table>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

const draft = (c: any) => `${c.term}: ${c.kind === "listed" ? "tool, standard or certification" : "skill"} named in job postings from ${c.companies} employers${c.top_titles?.[0] ? `, most often for ${c.top_titles[0].title} roles` : ""}. Describe what someone with this skill can do.`;

export function CandidateReview({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<any[] | null>(null); const [err, setErr] = useState<any>(null);
  const [f, setF] = useState("open"); const [q, setQ] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<any[] | null>(null); const [busy, setBusy] = useState(false); const [cats, setCats] = useState<string[]>([]);
  const [auto, setAuto] = useState<{ enabled: boolean; min_employers: number } | null>(null); const [minEmp, setMinEmp] = useState(10);
  const load = async () => { const r = await api("GET", "/market/candidates"); r.ok ? setList(r.data) : setErr(r.error); };
  useMemo(() => { load(); api("GET", "/skills/categories").then(r => r.ok && setCats(r.data)); api("GET", "/data/settings").then(r => { if (r.ok) { setAuto(r.data.skill_auto_add); setMinEmp(r.data.skill_auto_add.min_employers); } }); }, []); // eslint-disable-line
  const saveAuto = async (v: { enabled: boolean; min_employers: number }) => {
    const r = await api("PUT", "/data/settings", { skill_auto_add: v });
    if (!r.ok) return setErr(r.error);
    setAuto(r.data.skill_auto_add); toast(v.enabled ? `Automatic growth on${r.data.added_now ? `: ${r.data.added_now} skills added now` : ""}` : "Automatic growth off"); load(); onChanged();
  };
  const rows = (list || []).filter(c => (f === "open" ? c.status === "Candidate" : f === "suggested" ? c.status === "Candidate" && c.suggested_skill_id : f === "proposed" ? c.status === "Proposed" : f === "done" ? (c.status === "Added" || c.status === "Ignored") : true) && (!q || c.term.toLowerCase().includes(q.toLowerCase())));
  const paged = usePaged(rows, 25);
  const act = async (action: string, items: any[]) => {
    setBusy(true); setErr(null);
    const r = await api("POST", "/market/candidates/bulk", { action, items }); setBusy(false);
    if (!r.ok) return setErr(r.error);
    const skipped = r.data.results.filter((x: any) => x.status === "skipped");
    toast(r.data.proposed ? `${r.data.proposed} proposed. A library reviewer or another platform administrator approves them.` : `${r.data.done} done${skipped.length ? `, ${skipped.length} skipped (${skipped[0].reason})` : ""}. Re-scan the postings to count them.`, skipped.length && !r.data.done ? "bad" : "ok");
    setSel(new Set()); setAdding(null); load(); onChanged();
  };
  const selected = (list || []).filter(c => sel.has(c.term) && c.status === "Candidate");
  const counts = { proposed: (list || []).filter(c => c.status === "Proposed").length, open: (list || []).filter(c => c.status === "Candidate").length, suggested: (list || []).filter(c => c.status === "Candidate" && c.suggested_skill_id).length, done: (list || []).filter(c => c.status === "Added" || c.status === "Ignored").length };
  return (
    <Card pad={false} title="Skill candidates found in postings" sub="Terms many employers ask for that the library does not have yet. Nothing enters the library without your decision.">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {[["open", `To review ${counts.open}`], ["suggested", `Looks like an existing skill ${counts.suggested}`], ["proposed", `Waiting for approval ${counts.proposed}`], ["done", `Decided ${counts.done}`]].map(([k, l]) =>
          <button key={k} onClick={() => setF(k)} className={cx("border-b-[3px] px-2 py-1 text-[13.5px] font-medium", f === k ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{l}</button>)}
        <SearchInput className="ml-auto w-full max-w-[240px]" value={q} onChange={setQ} placeholder="Find a term" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-sunken/40 px-4 py-3 text-[13px]">
        <label className="flex items-center gap-2"><span>Used by at least</span>
          <input type="number" min={2} className="inp w-20 py-1" value={minEmp} onChange={e => setMinEmp(Math.max(2, Number(e.target.value) || 2))} aria-label="Minimum employers" /><span>employers</span></label>
        <Button size="sm" onClick={() => setSel(new Set((list || []).filter(c => c.status === "Candidate" && c.companies >= minEmp).map(c => c.term)))}>Select {(list || []).filter(c => c.status === "Candidate" && c.companies >= minEmp).length} terms</Button>
        <span className="hidden h-4 w-px bg-line sm:block" />
        <label className="flex cursor-pointer items-center gap-2" title="After each upload or re-scan, add terms at or above this many employers that do not look like an existing skill. They are marked for review.">
          <input type="checkbox" checked={!!auto?.enabled} onChange={e => saveAuto({ enabled: e.target.checked, min_employers: minEmp })} />
          <span>Add them to the library automatically after each upload{auto?.enabled ? <span className="text-ink-3"> (on, from {auto.min_employers} employers)</span> : ""}</span></label>
        {auto?.enabled && auto.min_employers !== minEmp && <Button size="sm" variant="ghost" onClick={() => saveAuto({ enabled: true, min_employers: minEmp })}>Use {minEmp}</Button>}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/[.06] px-4 py-2.5 text-[13px]">
          <b className="font-medium">{selected.length} selected</b>
          <Button size="sm" loading={busy} disabled={!selected.some(c => c.suggested_skill_id)} onClick={() => act("alias", selected.filter(c => c.suggested_skill_id).map(c => ({ term: c.term })))}><Link2 className="h-3.5 w-3.5" />Add as alternative names of the suggested skill</Button>
          <Button size="sm" onClick={() => setAdding(selected.filter(c => !c.suggested_skill_id || selected.length === 1).map(c => ({ term: c.term, name: c.term, category: c.suggested_category || cats[0] || "Technical Methods", definition: draft(c) })))}><Plus className="h-3.5 w-3.5" />Add as new skills…</Button>
          {selected.length > 1 && <Button size="sm" variant="primary" loading={busy} disabled={!selected.some(c => !c.suggested_skill_id)} onClick={() => act("add", selected.filter(c => !c.suggested_skill_id).map(c => ({ term: c.term, category: c.suggested_category || "Technical Methods", definition: draft(c) })))}><Check className="h-3.5 w-3.5" />Add {selected.filter(c => !c.suggested_skill_id).length} now with drafted definitions</Button>}
          <Button size="sm" variant="ghost" loading={busy} onClick={() => act("ignore", selected.map(c => ({ term: c.term })))}><EyeOff className="h-3.5 w-3.5" />Ignore</Button>
        </div>
      )}
      <ErrorBox error={err} />
      {!list ? <Loading rows={6} /> : !rows.length ? <Empty>{f === "open" ? "No terms waiting for review." : "Nothing here."}</Empty> : <>
        <div className="overflow-x-auto"><table className="t">
          <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select page" checked={paged.items.length > 0 && paged.items.every(c => sel.has(c.term) || c.status !== "Candidate")} onChange={e => { const n = new Set(sel); paged.items.filter(c => c.status === "Candidate").forEach(c => e.target.checked ? n.add(c.term) : n.delete(c.term)); setSel(n); }} /></th>
            <th>Term</th><th className="text-right">Employers posting</th><th className="text-right">Job postings</th><th>Most often in</th><th>Looks like</th><th></th></tr></thead>
          <tbody>{paged.items.map(c => (
            <tr key={c.term}>
              <td>{c.status === "Candidate" && <input type="checkbox" aria-label={`Select ${c.term}`} checked={sel.has(c.term)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(c.term) : n.delete(c.term); setSel(n); }} />}</td>
              <td><span className="font-medium">{c.term}</span><div className="whitespace-nowrap text-[12px] text-ink-3">{c.kind === "listed" ? "known tool" : "from posting text"}</div></td>
              <td className="num text-right">{c.companies}</td><td className="num text-right">{fmtNum(c.postings)}</td>
              <td className="max-w-[220px] truncate text-[12.5px] text-ink-2">{(c.top_titles || []).slice(0, 2).map((t: any) => t.title).join(", ")}</td>
              <td className="text-[13px]">{c.status === "Proposed" ? <span className="text-warn">{c.proposal?.action === "alias" ? `same as ${c.suggested_skill_name || "a skill"}` : "new skill"} · proposed by {c.proposed_by_name}</span> : c.status !== "Candidate" ? (c.skill_name ? <span className="text-good">{c.status === "Added" ? "covered by" : ""} {c.skill_name}</span> : <Pill>{c.status}</Pill>) : c.suggested_skill_name ? <span>{c.suggested_skill_name}</span> : <span className="text-ink-3">—</span>}</td>
              <td className="whitespace-nowrap text-right">{c.status === "Candidate" && <>
                {c.suggested_skill_id && <Button size="sm" variant="ghost" onClick={() => act("alias", [{ term: c.term }])} title={`Add “${c.term}” as another name of ${c.suggested_skill_name}`}><Check className="h-3.5 w-3.5" />Same as {c.suggested_skill_name}</Button>}
                <Button size="sm" variant="ghost" onClick={() => setAdding([{ term: c.term, name: c.term, category: c.suggested_category || cats[0] || "Technical Methods", definition: draft(c) }])}><Plus className="h-3.5 w-3.5" />New skill</Button>
                <Button size="sm" variant="ghost" onClick={() => act("ignore", [{ term: c.term }])} aria-label={`Ignore ${c.term}`}><EyeOff className="h-3.5 w-3.5" /></Button></>}</td>
            </tr>))}</tbody></table></div>
        <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} /></>}
      <Modal wide open={!!adding} onClose={() => setAdding(null)} title={`Add ${adding?.length || 0} new global skill${adding?.length === 1 ? "" : "s"}`}
        footer={<><Button onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => act("add", adding!)}>Add to the library</Button></>}>
        <div className="max-h-[60vh] overflow-auto scroll-thin">
          {(adding || []).map((a, i) => (
            <div key={a.term} className="grid gap-3 border-t border-line py-3 md:grid-cols-[1fr_1fr]">
              <Field label="Skill name" htmlFor={`n${i}`}><input id={`n${i}`} className="inp" value={a.name} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></Field>
              <Field label="Category" htmlFor={`c${i}`}><input id={`c${i}`} className="inp" list="cand-cats" value={a.category} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} /></Field>
              <div className="md:col-span-2"><Field label="Definition" htmlFor={`d${i}`}><textarea id={`d${i}`} className="inp" rows={2} value={a.definition} onChange={e => setAdding(adding!.map((x, j) => j === i ? { ...x, definition: e.target.value } : x))} /></Field></div>
            </div>))}
          <datalist id="cand-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
        </div>
      </Modal>
    </Card>
  );
}
