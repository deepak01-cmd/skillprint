"use client";
import { useEffect, useState } from "react";
import { Download, Eye, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Avatar, Card, Empty, Loading, PageHeader, Pagination, Pill, Stat, usePaged } from "@/components/ui";

function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
const ROLE: Record<string, string> = { hr_admin: "HR", dept_head: "Dept head", manager: "Manager", employee: "Employee", expert: "Expert" };

export default function AccessLog() {
  const s = useSession();
  const [actor, setActor] = useState(""); const [resource, setResource] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [emp, setEmp] = useState("");
  const da = useDebounced(actor); const de = useDebounced(emp);
  const qs = new URLSearchParams(Object.entries({ actor: da, resource, from, to, employee_id: de }).filter(([, v]) => v) as [string, string][]).toString();
  const d = useApi<any>(s.user.role === "hr_admin" ? `/access-log?${qs}` : null);
  const rows: any[] = d.data?.rows || []; const paged = usePaged(rows, 30);
  if (s.user.role !== "hr_admin") return <Empty icon={<ShieldCheck />}>Only HR administrators see the access log.</Empty>;
  const people = new Set(rows.map(r => r.subject_id).filter(Boolean)).size; const viewers = new Set(rows.map(r => r.actor_id)).size;
  return (
    <>
      <PageHeader title="Who saw whom" actions={<a href="/api/v1/reports/access/download?format=xlsx"><span className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-card px-4 text-[13.5px] font-semibold hover:text-accent"><Download className="h-4 w-4" />Export 90 days</span></a>} />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-3">
        <Stat icon={<Eye />} label="Views shown" value={rows.length} sub={rows.length >= 1000 ? "latest 1,000" : undefined} />
        <Stat icon={<Eye />} label="People whose data was opened" value={people} />
        <Stat icon={<ShieldCheck />} label="Viewers" value={viewers} />
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className="inp" placeholder="Viewer name" value={actor} onChange={e => setActor(e.target.value)} />
        <input className="inp" placeholder="Employee ID (e.g. E1001)" value={emp} onChange={e => setEmp(e.target.value.trim())} />
        <select className="inp" value={resource} onChange={e => setResource(e.target.value)} aria-label="What"><option value="">Everything</option>{(d.data?.resources || []).map((r: string) => <option key={r}>{r}</option>)}</select>
        <input className="inp" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
        <input className="inp" type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
      </div>
      <Card pad={false}>
        {d.loading ? <Loading /> : paged.items.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Whose data</th><th>What</th><th>Detail</th><th>Address</th></tr></thead>
          <tbody>{paged.items.map(r => <tr key={r.id}>
            <td className="whitespace-nowrap text-[12.5px]">{new Date(r.at).toLocaleString()}</td>
            <td><div className="flex items-center gap-2"><Avatar name={r.actor_name} size={26} /><span className="font-semibold">{r.actor_name}</span><Pill tone="Draft">{ROLE[r.actor_role] || r.actor_role}</Pill></div></td>
            <td>{r.subject_name ? <button className="font-medium hover:text-accent" onClick={() => setEmp(r.subject_id)}>{r.subject_name}</button> : <span className="text-ink-3">—</span>}</td>
            <td><Pill tone={r.resource === "report export" ? "Medium" : r.resource.includes("evidence") ? "In progress" : "Mandatory"}>{r.resource}</Pill></td>
            <td className="max-w-[260px] truncate text-[12.5px] text-ink-3">{r.detail || "—"}</td><td className="mono text-[12px] text-ink-3">{r.ip || "—"}</td></tr>)}</tbody></table></div>
          : <Empty icon={<Eye />}>No views match.</Empty>}
        <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} />
      </Card>
    </>
  );
}
