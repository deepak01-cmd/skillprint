"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, downloadCsv, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Level, Loading, PageHeader, Pill, fmtDate } from "@/components/ui";
import { MappingHistory } from "@/components/MappingHistory";
import { ImportDialog } from "@/components/ImportDialog";
import { Download, Upload, Wand2 } from "lucide-react";
import { LEVEL, rankOf, same, titleTokens as tokens, wordsIn } from "@/lib/titleMatch";

export default function FrameworkExplorer() {
  const s = useSession();
  const [trend, setTrend] = useState(""); const [req, setReq] = useState(""); const [dept, setDept] = useState(""); const [arch, setArch] = useState(false); const [q, setQ] = useState("");
  const [hist, setHist] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...(trend && { trend }), ...(req && { requirement_type: req }), ...(dept && { department_id: dept }), ...(arch && { include_archived: "true" }) }).toString();
  const { data, error, loading, reload } = useApi<any>(`/framework${qs ? `?${qs}` : ""}`); const [up, setUp] = useState(false);
  const org = useApi<any>("/org");
  const qt = tokens(q);
  const qRank = rankOf(qt);
  const titleWords = qt.filter(t => !(t in LEVEL));
  const asTitle = qRank != null || qt.length >= 2; // a full title, or one with a level word: compare levels
  const roleOk = (m: any) => { const rt = tokens(m.role_name); return (titleWords.length ? wordsIn(titleWords, rt.filter(t => !(t in LEVEL)), same) : true) && (!asTitle || (rankOf(rt) ?? 3) === (qRank ?? 3)); };
  const skillOk = (m: any) => wordsIn(qt, tokens(m.skill_name));
  let rows = (data?.skills || []).filter((m: any) => !qt.length || roleOk(m) || skillOk(m) || m.pixel_id.toLowerCase().includes(q.trim().toLowerCase()));
  const [resolved, setResolved] = useState<any>(null);
  useEffect(() => {
    setResolved(null); const t = q.trim(); if (t.length < 3 || !data || rows.length) return;
    const h = setTimeout(async () => { const r = await api("GET", `/roles/resolve?title=${encodeURIComponent(t)}`); if (r.ok) setResolved({ q: t, ...r.data }); }, 450);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data, rows.length]);
  if (!rows.length && resolved?.status === "matched") rows = (data?.skills || []).filter((m: any) => m.role_id === resolved.role.id);
  const cand = resolved && resolved.status !== "matched" ? (resolved.candidates || []).slice(0, 3) : [];
  return (
    <>
      <PageHeader title="Framework explorer"
        actions={<>{can(s, "framework:draft") && <Button onClick={() => setUp(true)}><Upload className="h-4 w-4" />Upload requirements</Button>}<Button onClick={async () => { const r = await api("GET", "/framework/export"); if (r.ok) downloadCsv("role-skill-framework.csv", r.data.header, r.data.rows); }}><Download className="h-4 w-4" />Export</Button></>} />
      <ImportDialog open={up} onClose={() => setUp(false)} entities={["role_skills"]} onDone={() => reload()} title="Upload skill requirements for many roles" />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input className="inp max-w-xs" placeholder="Search skill, role or Pixel ID" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
          <select className="inp max-w-[160px]" value={trend} onChange={e => setTrend(e.target.value)} aria-label="Trend"><option value="">All trends</option>{["Current", "Emerging", "Declining"].map(t => <option key={t}>{t}</option>)}</select>
          <select className="inp max-w-[180px]" value={req} onChange={e => setReq(e.target.value)} aria-label="Requirement type"><option value="">All requirement types</option>{["Mandatory", "Preferred", "Optional", "Developmental"].map(t => <option key={t}>{t}</option>)}</select>
          <select className="inp max-w-[220px]" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{(org.data?.departments || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          {can(s, "archive:read") && <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={arch} onChange={e => setArch(e.target.checked)} /> Show archived (on request)</label>}
          <span className="ml-auto text-xs text-ink-3">{resolved?.status === "matched" && rows.length ? <>Matched to <Link className="font-medium text-accent" href={`/roles/${resolved.role.id}`}>{resolved.role.title}</Link> · </> : null}{rows.length} active mappings</span>
        </div>
        <ErrorBox error={error} />
        {loading ? <Loading /> : rows.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Role</th><th>Skill</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th title="Mandatory: needed on day one. Preferred: expected soon after joining. Optional: useful. Developmental: grow into it.">Requirement type</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th>Why this trend</th><th title="How sure the trend is (0 to 1), and whether the evidence has been checked">Trend confidence</th><th></th></tr></thead>
          <tbody>{rows.map((m: any) => <tr key={m.pixel_id}><td className="whitespace-nowrap font-mono text-xs">{m.pixel_id}</td><td><Link className="font-medium text-accent hover:underline" href={`/roles/${m.role_id}`}>{m.role_name}</Link></td><td className="font-medium">{m.skill_name}</td>
            <td title={m.level_descriptor}><Level n={m.required_level} /></td><td>{m.requirement_type}</td><td><Pill>{m.skill_trend}</Pill></td><td className="max-w-sm text-xs text-ink-2">{m.trend_rationale}</td>
            <td className="num whitespace-nowrap">{m.confidence_score ?? "—"} <span className="text-xs text-ink-3">{m.evidence_status}</span></td><td><Button size="sm" onClick={() => setHist(m.pixel_id)}>History</Button></td></tr>)}</tbody></table></div> : q.trim().length >= 3 ? <div className="flex flex-col items-start gap-3 p-6">
            <div className="text-[15px] font-semibold">“{q.trim()}” is not in your framework yet</div>
            {cand.length > 0 && <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">Similar roles at the same level (not the same role):{cand.map((c: any) => <Link key={c.id} href={`/roles/${c.id}`}><Pill>{c.title}</Pill></Link>)}</div>}
            {can(s, "roles:read") && <Link href={`/roles/draft?title=${encodeURIComponent(q.trim())}`}><Button variant="primary"><Wand2 className="h-4 w-4" />Generate framework with AI</Button></Link>}
          </div> : <Empty>No active mappings match.</Empty>}
      </Card>
      {arch && data?.archived && <section className="mt-4 rounded-lg border border-l-4 border-ink-3 bg-card">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><span className="rounded bg-ink-3 px-1.5 text-[11px] font-bold uppercase tracking-wider text-white">Archived</span><h2 className="text-[15px] font-semibold">Retired mappings ({data.archived.length})</h2></div>
        <table className="t"><thead><tr><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Role</th><th>Skill</th><th>Last required</th><th>Reason</th><th>Archived on</th></tr></thead>
          <tbody>{data.archived.map((m: any) => <tr key={m.pixel_id} className="text-ink-2"><td className="whitespace-nowrap font-mono text-xs">{m.pixel_id}</td><td>{m.role_name}</td><td>{m.skill_name}</td><td><Level n={m.last_required_level} muted /></td><td className="min-w-[260px]"><b>{m.archive_reason_category}.</b> {m.archive_reason}</td><td className="num">{fmtDate(m.archived_on)}</td></tr>)}</tbody></table>
      </section>}
      <MappingHistory pid={hist} onClose={() => setHist(null)} />
    </>
  );
}
