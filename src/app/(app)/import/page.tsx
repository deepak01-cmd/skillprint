"use client";
/* Upload history: every file uploaded from any screen, with its row-by-row report. Uploads themselves start on the screen the data belongs to. */
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, BookOpen, Briefcase, Building2, Download, FileText, History, Layers, Users } from "lucide-react";
import { api, downloadText, useApi } from "@/lib/api";
import { Button, Card, Empty, Loading, PageHeader, Pagination, Pill, cx, fmtNum, usePaged } from "@/components/ui";

const ENT: Record<string, { label: string; icon: any; href: string }> = {
  skills: { label: "Skills", icon: BookOpen, href: "/skills" }, departments: { label: "Departments", icon: Building2, href: "/org" }, roles: { label: "Roles", icon: Briefcase, href: "/roles" },
  role_skills: { label: "Skill requirements", icon: Layers, href: "/roles" }, job_descriptions: { label: "Job descriptions", icon: FileText, href: "/roles" }, employees: { label: "Employees", icon: Users, href: "/employees" },
};
const ACTION: Record<string, string> = { create: "New", update: "Update", skip: "Skip", queue: "Role resolution", error: "Error", created: "Created", updated: "Updated", skipped: "Skipped", queued: "Queued" };

export default function UploadHistory() {
  const hist = useApi<any[]>("/imports");
  const [detail, setDetail] = useState<any>(null); const [f, setF] = useState("");
  const rows = (detail?.rows || []).filter((r: any) => !f || (r.action || r.outcome) === f);
  const paged = usePaged(rows, 25);
  const list = usePaged(hist.data || [], 25);
  const report = () => {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    downloadText(`${detail.id}-report.csv`, [["row", "result", "record", "details"], ...detail.rows.map((r: any) => [r.row, r.action || r.outcome, r.key, (r.messages || []).join(" | ")])].map(l => l.map(esc).join(",")).join("\r\n"));
  };
  if (detail) {
    const E = ENT[detail.entity]; const counts = (k: string) => detail.rows.filter((r: any) => (r.action || r.outcome) === k).length;
    return (
      <>
        <div className="mb-3"><Button variant="ghost" onClick={() => { setDetail(null); setF(""); }}><ArrowLeft className="h-4 w-4" />Upload history</Button></div>
        <PageHeader eyebrow={`${E.label} · ${detail.id}`} title={detail.file_name} sub={`${detail.created_by_name} · ${new Date(detail.created_at).toLocaleString()} · ${detail.mode === "publish" ? "published directly" : "saved as drafts"}`}
          actions={<><Link href={E.href}><Button><E.icon className="h-4 w-4" />Open {E.label.toLowerCase()}</Button></Link>{detail.rows.length > 0 && <Button onClick={report}><Download className="h-4 w-4" />Download report</Button>}</>} />
        <Card pad={false}>
          {!detail.rows.length ? <Empty>This upload was checked but not saved.</Empty> : <>
            <div className="flex flex-wrap gap-1.5 border-b border-line-2 px-4 py-3">
              <button onClick={() => setF("")} className={cx("rounded-full px-3 py-1 text-xs font-medium", !f ? "bg-ink text-white" : "bg-sunken text-ink-2")}>All {detail.rows.length}</button>
              {Object.keys(ACTION).filter(k => counts(k)).map(k => <button key={k} onClick={() => setF(k)} className={cx("rounded-full px-3 py-1 text-xs font-medium", f === k ? "bg-ink text-white" : "bg-sunken text-ink-2")}>{ACTION[k]} {counts(k)}</button>)}
            </div>
            <table className="t"><thead><tr><th style={{ width: 64 }}>Row</th><th style={{ width: 130 }}>Result</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>{paged.items.map((r: any) => <tr key={r.row + (r.key || "")}><td className="num text-ink-3">{r.row}</td><td><Pill tone={r.action || r.outcome}>{ACTION[r.action || r.outcome] || r.outcome}</Pill></td><td className="font-medium">{r.key || "—"}{r.target && <div className="font-mono text-[11px] font-normal text-ink-3">{r.target}</div>}</td><td className="text-[12.5px] text-ink-2">{(r.messages || []).join(" · ") || "—"}</td></tr>)}</tbody></table>
            <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} /></>}
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Upload history" />
      <Card pad={false}>
        {hist.loading ? <Loading rows={6} /> : !(hist.data || []).length ? <Empty icon={<History className="h-5 w-5" />}>No uploads yet. Use the Upload button on the Skills, Roles, Employees or Organisation screen.</Empty> : <>
          <table className="t"><thead><tr><th>File</th><th>Data</th><th>Result</th><th>Status</th><th>By</th><th>When</th></tr></thead>
            <tbody>{list.items.map(j => { const E = ENT[j.entity] || ENT.skills; const a = j.summary?.applied; const p = j.summary?.planned; return (
              <tr key={j.id} className="click" onClick={async () => { const r = await api("GET", `/imports/${j.id}`); if (r.ok) setDetail(r.data); }}>
                <td><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><E.icon className="h-4 w-4" /></span><div className="min-w-0"><div className="max-w-[260px] truncate font-medium">{j.file_name}</div><div className="font-mono text-[11px] text-ink-3">{j.id} · {fmtNum(j.total_rows)} rows</div></div></div></td>
                <td className="text-ink-2">{E.label}</td>
                <td className="text-[12.5px] text-ink-2">{a ? [a.created && `${a.created} new`, a.updated && `${a.updated} updated`, a.queued && `${a.queued} queued`, a.change_requests && `${a.change_requests} for approval`, a.errors && `${a.errors} errors`].filter(Boolean).join(" · ") || "No changes" : p ? `${p.create} new · ${p.update} updates (checked only)` : "—"}</td>
                <td><Pill tone={j.status}>{j.status === "Previewed" ? "Checked, not saved" : j.status}</Pill></td><td className="text-ink-2">{j.created_by_name}</td><td className="whitespace-nowrap text-ink-3">{new Date(j.created_at).toLocaleString()}</td></tr>); })}</tbody></table>
          <Pagination page={list.page} size={list.size} total={list.total} onPage={list.setPage} /></>}
      </Card>
    </>
  );
}
