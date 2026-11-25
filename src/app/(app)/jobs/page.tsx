"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Empty, Hero, Loading, Pill, Ring, SearchInput, Tabs, ago } from "@/components/ui";
import { JobCard, Tracker, toneFor } from "@/components/Jobs";

export default function Jobs() {
  const s = useSession();
  const jobs = useApi<any[]>("/ijp/jobs"); const mine = useApi<any[]>("/ijp/applications/mine");
  const [tab, setTab] = useState("open"); const [q, setQ] = useState(""); const [dept, setDept] = useState(""); const [sort, setSort] = useState("match");
  const list = useMemo(() => {
    let l = (jobs.data || []).filter(j => (!q || `${j.title} ${j.department_name} ${j.location}`.toLowerCase().includes(q.toLowerCase())) && (!dept || j.department_name === dept));
    if (sort === "new") l = [...l].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (sort === "closing") l = [...l].sort((a, b) => String(a.closes_on || "9999").localeCompare(String(b.closes_on || "9999")));
    return l;
  }, [jobs.data, q, dept, sort]);
  const depts = [...new Set((jobs.data || []).map(j => j.department_name))].sort();
  const strong = (jobs.data || []).filter(j => j.match_pct >= 75 && !j.current_role).length;
  const active = (mine.data || []).filter(a => !["Withdrawn", "Hired", "Not selected"].includes(a.status)).length;
  return (
    <>
      <Hero>
        <div>
          <div className="text-[13px] font-semibold text-white/70">Internal jobs · {s.organisation?.name}</div>
          <h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">Your next move is inside</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
            <span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{(jobs.data || []).length}</b> open</span>
            <span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{strong}</b> strong matches</span>
            <span className="glass rounded-xl px-3 py-2"><b className="num text-[18px]">{active}</b> active applications</span>
          </div>
        </div>
      </Hero>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "open", label: "Open jobs", count: (jobs.data || []).length }, { id: "mine", label: "My applications", count: (mine.data || []).length }]} />
      {tab === "open" && <>
        <div className="mb-5 flex flex-wrap gap-2">
          <SearchInput className="w-full max-w-xs" value={q} onChange={setQ} placeholder="Search jobs" />
          <select className="inp w-auto" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
          <select className="inp w-auto" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"><option value="match">Best match</option><option value="new">Newest</option><option value="closing">Closing soon</option></select>
        </div>
        {jobs.loading ? <Loading rows={6} /> : list.length ? <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map(j => <JobCard key={j.id} j={j} />)}</div>
          : <Empty icon={<BriefcaseBusiness />}>No open jobs match.</Empty>}
      </>}
      {tab === "mine" && ((mine.data || []).length ? <div className="stagger flex flex-col gap-3">{(mine.data || []).map(a => (
        <Link key={a.id} href={`/jobs/${a.job_id}`} className="lift grid items-center gap-4 rounded-2xl border border-line bg-card p-4 shadow-card md:grid-cols-[1fr_1.3fr_auto]">
          <div className="min-w-0"><div className="truncate text-[15px] font-bold">{a.title}</div><div className="text-[12px] text-ink-3">{a.department_name} · applied {ago(a.created_at)}</div></div>
          <Tracker status={a.status} />
          <div className="flex items-center gap-3"><Ring value={a.match_pct} size={44} stroke={12} tone={toneFor(a.match_pct)} label={<span className="text-[11px]">{a.match_pct}%</span>} /><Pill>{a.status}</Pill></div>
        </Link>))}</div> : <Empty icon={<BriefcaseBusiness />}>You haven't applied to anything yet.</Empty>)}
    </>
  );
}
