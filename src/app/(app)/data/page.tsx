"use client";
import { useState } from "react";
import { api, downloadCsv, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, ErrorBox, Loading, Note, PageHeader } from "@/components/ui";

const ROWS: [string, string, number | undefined][] = [
  ["Mappings shown in framework (active)", "active_mappings", 268], ["Archived mappings stored", "archived_mappings", 10], ["Total stored (published)", "total_stored", 278],
  ["Drafts and pending changes", "drafts", undefined], ["Duplicate Pixel IDs", "duplicate_pixel_ids", 0], ["Archived rows inside the framework view", "archived_in_framework_view", 0],
  ["Invalid trend values in the framework view", "invalid_trends_in_view", 0], ["Pixel IDs not equal to PX-role-skill", "pixel_id_mismatches", 0],
  ["Skills shown in framework", "skills_active", 60], ["Skills archived in every role", "skills_archived_all_roles", 5], ["Old IDs in the crosswalk", "crosswalk_rows", 278], ["Old IDs that do not resolve", "crosswalk_unresolved", 0],
];

export default function DataChecks() {
  const s = useSession();
  const { data, error, loading } = useApi<any>("/reconciliation");
  const [old, setOld] = useState(""); const [res, setRes] = useState<string>("");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const org = data.organisation, plat = data.platform;
  return (
    <>
      <PageHeader title="Data checks" />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card pad={false} title="Reconciliation">
          <table className="t"><thead><tr><th>Data check</th>{org && <th className="text-right">{s.organisation?.name}</th>}{plat && <th className="text-right">All organisations</th>}<th className="text-right">Sample expected</th></tr></thead>
            <tbody>{ROWS.map(([l, k, exp]) => <tr key={k}><td>{l}</td>{org && <td className="num text-right">{org[k]}</td>}{plat && <td className={`num text-right font-semibold ${exp === undefined ? "" : plat[k] === exp ? "text-good" : "text-warn"}`}>{plat[k]}</td>}<td className="num text-right text-ink-3">{exp ?? "—"}</td></tr>)}
              <tr><td>Roles with no active skills</td>{org && <td className="num text-right">{org.roles_without_active_skills.length}</td>}{plat && <td className="num text-right">{plat.roles_without_active_skills.length}</td>}<td className="num text-right text-ink-3">0</td></tr>
            </tbody></table>
        </Card>
        <div className="flex flex-col gap-4">
          {(plat || org).awareness_level_in_framework.length > 0 && <Note tone="bad"><b>Data conflict to resolve.</b> PRD 8.8 and the workbook say level 1 Awareness is used only by archived mappings, but {(plat || org).awareness_level_in_framework.join(", ")} is active at level 1. Raise it to 2 or relax the rule.</Note>}
          {s.user.org_id && <Card title="Resolve an old ID">
            <p className="mb-2 text-xs text-ink-3">Role Skill IDs (RS…) and Framework IDs (FWR…) resolve to Pixel IDs for one release cycle.</p>
            <div className="flex gap-2"><input className="inp" value={old} onChange={e => setOld(e.target.value)} placeholder="RS0257 or FWR001" aria-label="Old ID" onKeyDown={e => e.key === "Enter" && (document.getElementById("rsv") as HTMLButtonElement)?.click()} />
              <Button id="rsv" onClick={async () => { const r = await api("GET", `/pixels/legacy/${encodeURIComponent(old)}`); setRes(JSON.stringify(r.ok ? r.data : { status: r.status, ...r.error }, null, 2)); }}>Resolve</Button></div>
            {res && <pre className="mt-2 max-h-64 overflow-auto rounded border border-line bg-paper p-2 font-mono text-xs">{res}</pre>}
          </Card>}
          {s.user.org_id && <Card title="Exports"><p className="mb-2 text-xs text-ink-3">The standard export holds active mappings only, with the Pixel ID first.</p>
            <Button onClick={async () => { const r = await api("GET", "/framework/export"); if (r.ok) downloadCsv("role-skill-framework.csv", r.data.header, r.data.rows); }}>Download active framework (CSV)</Button></Card>}
        </div>
      </div>
    </>
  );
}
