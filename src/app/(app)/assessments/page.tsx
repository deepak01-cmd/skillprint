"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Card, Empty, ErrorBox, Loading, PageHeader, Pill, Tabs, fmtDate } from "@/components/ui";

export default function Assessments() {
  const s = useSession(); const router = useRouter();
  const { data, error, loading } = useApi<any[]>("/assessments");
  const [tab, setTab] = useState("open");
  const rows = (data || []).filter(a => tab === "open" ? ["Assigned", "Submitted"].includes(a.status) : true);
  const sub = s.user.role === "employee" ? "Assessments assigned to you. Your answers are recorded as self-reported until an assessor reviews them."
    : s.user.role === "expert" ? "Assessments where you are the assessor. Your review records a validated level." : "Assessments for people in your scope. Assign new ones from an employee's profile.";
  return (
    <>
      <PageHeader title="Assessments" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "open", label: "Open" }, { id: "all", label: "All" }]} />
      <ErrorBox error={error} />
      <Card pad={false}>{loading ? <Loading /> : rows.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>ID</th><th>Employee</th><th>Assessment method</th><th className="text-right">Skills</th><th>Assessor</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>{rows.map(a => <tr key={a.id} className="click" onClick={() => router.push(`/assessments/${a.id}`)}><td><Link className="font-mono text-xs font-medium text-accent hover:underline" href={`/assessments/${a.id}`}>{a.id}</Link></td><td>{a.employee_name}<div className="text-xs text-ink-3">{a.role_title}</div></td><td>{a.method}</td><td className="num text-right">{a.items}</td><td>{a.assessor_name || "Manager"}</td><td className="num">{fmtDate(a.due_date)}</td><td><Pill>{a.status}</Pill>{a.notice && <div className="text-xs text-warn">{a.notice}</div>}</td></tr>)}</tbody></table></div>
        : <Empty>{tab === "open" ? "No open assessments." : "No assessments yet."}</Empty>}</Card>
    </>
  );
}
