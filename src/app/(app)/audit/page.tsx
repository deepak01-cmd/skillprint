"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, PageHeader, Tabs } from "@/components/ui";

export default function Audit() {
  const { data, error, loading } = useApi<any>("/audit");
  const [tab, setTab] = useState("lifecycle"); const [q, setQ] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const f = (x: any) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <PageHeader title="Audit log" actions={<input className="inp w-64" placeholder="Filter by Pixel ID, user, action" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter" />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "lifecycle", label: `Archive and restore (${data.lifecycle.length})` }, { id: "all", label: `All changes (${data.events.length})` }]} />
      <Card pad={false}>
        {tab === "lifecycle" ? (data.lifecycle.filter(f).length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>#</th><th>When</th><th title="Unique ID of one role-skill requirement: role ID plus skill ID">Pixel ID</th><th>Role and skill</th><th>Action</th><th>By</th><th>Reason</th><th>Previous</th></tr></thead>
          <tbody>{data.lifecycle.filter(f).map((e: any) => <tr key={e.id}><td className="num">{e.id}</td><td className="num whitespace-nowrap">{new Date(e.at).toLocaleString()}</td><td className="font-mono text-xs">{e.pixel_id}</td><td>{e.role_name}<div className="text-xs text-ink-3">{e.skill_name}</div></td>
            <td>{e.action.replace("_", " ")}{e.change_id && <div className="font-mono text-xs text-ink-3">{e.change_id}</div>}</td><td>{e.actor}</td><td>{e.reason_category && <b>{e.reason_category}. </b>}{e.reason}</td>
            <td className="text-xs">{e.prior_values ? Object.entries(e.prior_values).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</td></tr>)}</tbody></table></div> : <Empty>No lifecycle events.</Empty>)
          : (data.events.filter(f).length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>#</th><th>When</th><th>Entity</th><th>Action</th><th>By</th><th>Reason</th><th>Change</th></tr></thead>
            <tbody>{data.events.filter(f).map((e: any) => <tr key={e.id}><td className="num">{e.id}</td><td className="num whitespace-nowrap">{new Date(e.at).toLocaleString()}</td><td>{e.entity_type}<div className="font-mono text-xs text-ink-3">{e.entity_id}</div></td><td>{e.action.replace(/_/g, " ")}</td><td>{e.actor_name}</td><td>{e.reason}</td>
              <td className="max-w-md truncate font-mono text-[11px] text-ink-3" title={JSON.stringify(e.after)}>{e.after ? JSON.stringify(e.after).slice(0, 140) : ""}</td></tr>)}</tbody></table></div> : <Empty>No events.</Empty>)}
      </Card>
    </>
  );
}
