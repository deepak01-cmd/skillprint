"use client";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Clock, Paperclip, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/api";
import { Avatar, Card, Empty, Loading, PageHeader, Pill, Stat, Tabs, ago } from "@/components/ui";
import { RequestDetail } from "@/components/LevelRequest";

export default function Requests() {
  const [tab, setTab] = useState("open");
  const list = useApi<any[]>(`/level-requests?view=review${tab === "all" ? "&status=all" : ""}`);
  const all = useApi<any[]>("/level-requests?view=review&status=all");
  const [open, setOpen] = useState<string | null>(null);
  const rows = list.data || [];
  const decided = (all.data || []).filter(r => r.status === "Approved" || r.status === "Rejected");
  return (
    <>
      <PageHeader title="Level requests" />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-3">
        <Stat icon={<Clock />} tone={(all.data || []).some(r => r.status === "Pending") ? "warn" : undefined} label="Waiting for you" value={(all.data || []).filter(r => r.status === "Pending").length} />
        <Stat icon={<TrendingUp />} label="With the employee" value={(all.data || []).filter(r => r.status === "More info needed").length} sub="more evidence asked for" />
        <Stat icon={<CheckCircle2 />} tone="good" label="Approved" value={decided.filter(r => r.status === "Approved").length} sub={`of ${decided.length} decided`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "open", label: "Open" }, { id: "all", label: "All" }]} />
      {list.loading ? <Loading /> : rows.length ? <div className="stagger flex flex-col gap-2.5">{rows.map(r => (
        <button key={r.id} onClick={() => setOpen(r.id)} className="lift grid items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left shadow-card md:grid-cols-[1.2fr_1fr_auto_auto]">
          <div className="flex min-w-0 items-center gap-3"><Avatar name={r.employee_name} size={40} /><div className="min-w-0"><div className="truncate text-[14.5px] font-bold">{r.employee_name}</div><div className="truncate text-[12px] text-ink-3">{r.role_title} · {ago(r.created_at)}</div></div></div>
          <div className="min-w-0"><div className="truncate text-[14px] font-semibold">{r.skill_name}</div>
            <div className="flex items-center gap-1.5 text-[13px]"><span className="num rounded-md bg-sunken px-1.5 font-bold">{r.current_level ?? "?"}</span><ArrowRight className="h-3.5 w-3.5 text-ink-3" /><span className="num rounded-md bg-accent-soft px-1.5 font-bold text-accent">{r.requested_level}</span></div></div>
          <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-3"><Paperclip className="h-3.5 w-3.5" />{r.evidence_count}</span>
          <Pill tone={r.status === "Pending" ? "In Review" : r.status === "More info needed" ? "Changes Requested" : r.status}>{r.status === "Pending" ? "Review" : r.status}</Pill>
        </button>))}</div>
        : <Card><Empty icon={<CheckCircle2 />}>{tab === "open" ? "Nothing waiting. Requests from your team appear here." : "No requests yet."}</Empty></Card>}
      {open && <RequestDetail id={open} onClose={() => setOpen(null)} onChanged={() => { list.reload(); all.reload(); }} />}
    </>
  );
}
