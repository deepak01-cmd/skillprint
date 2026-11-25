"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pill, Tabs, useToast } from "@/components/ui";

function Summary({ c }: { c: any }) {
  if (c.entity_type === "mapping") {
    const p = c.payload || {};
    return <div className="text-[13px]"><div><span className="font-mono text-xs">{c.entity_id}</span> · {c.role_name}, <b>{c.skill_name}</b></div>
      {c.change_type === "archive" && <div className="text-ink-2"><b>{p.reason_category}.</b> {p.reason}{p.confirm ? " (last active mapping, confirmed)" : ""}</div>}
      {c.change_type === "restore" && <div className="text-ink-2">Restore as Declining, Optional, with a review flag. {p.note}</div>}
      {c.change_type === "update" && <div className="text-ink-2">{Object.entries(p.fields || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${(p.before || {})[k] ?? "—"} → ${v}`).join(" · ")}{p.reason ? ` — ${p.reason}` : ""}</div>}
      {c.change_type === "publish" && <div className="text-ink-2">New mapping at level {c.required_level}, {c.requirement_type}. {p.reason}</div>}</div>;
  }
  if (c.entity_type === "role") return <div className="text-[13px]">Publish role <Link className="font-medium text-accent hover:underline" href={`/roles/${c.entity_id}`}>{c.payload.title || c.role_name}</Link> (v{c.payload.version}) with {(c.payload.pixel_ids || []).length} skill mapping(s)</div>;
  if (c.entity_type === "career_path") return <div className="text-[13px]">Publish career path {c.role_name} → {c.to_role_name} ({c.payload.movement_type})</div>;
  return <span>{c.entity_type} {c.entity_id}</span>;
}

export default function Approvals() {
  const s = useSession(); const toast = useToast();
  const [tab, setTab] = useState("open");
  const { data, error, loading, reload } = useApi<any[]>(tab === "open" ? "/changes?status=In Review" : "/changes");
  const [back, setBack] = useState<any>(null); const [comment, setComment] = useState(""); const [err, setErr] = useState<any>(null);
  const approver = can(s, "approve");
  const decide = async (id: string, decision: string, c = "") => { const r = await api("POST", `/changes/${id}/decide`, { decision, comment: c }); if (!r.ok) { setErr(r.error); toast(r.error!.message, "bad"); return false; } toast(`${id} ${decision === "approve" ? "approved and applied" : decision === "reject" ? "rejected" : "sent back"}`); reload(); return true; };
  return (
    <>
      <PageHeader title="Approvals" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "open", label: "Waiting" }, { id: "all", label: "All changes" }]} />
      <ErrorBox error={error} />
      <Card pad={false}>{loading ? <Loading /> : (data || []).length ? (
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Change requested</th><th>Item type</th><th>What</th><th>Raised from</th><th>Requested by</th><th>Status</th><th></th></tr></thead>
          <tbody>{data!.map(c => <tr key={c.id}><td className="font-mono text-xs">{c.id}<div className="text-ink-3">{new Date(c.requested_at).toLocaleDateString()}</div></td><td className="capitalize">{c.change_type} {c.entity_type.replace("_", " ")}</td><td className="min-w-[320px]"><Summary c={c} /></td>
            <td>{c.origin}</td><td>{c.requested_by_name}</td><td><Pill>{c.status}</Pill>{c.decided_by && <div className="text-xs text-ink-3">{c.decided_by}{c.comment ? `: ${c.comment}` : ""}</div>}</td>
            <td className="whitespace-nowrap">{c.status === "In Review" && (approver ? <><Button size="sm" variant="primary" onClick={() => decide(c.id, "approve")}>Approve</Button>{" "}<Button size="sm" onClick={() => { setBack(c); setComment(""); setErr(null); }}>Send back</Button></>
              : c.requested_by === s.user.id && <Button size="sm" onClick={async () => { const r = await api("POST", `/changes/${c.id}/withdraw`); r.ok ? toast("Withdrawn") : toast(r.error!.message, "bad"); reload(); }}>Withdraw</Button>)}</td></tr>)}</tbody></table></div>
      ) : <Empty>{tab === "open" ? "Nothing is waiting." : "No changes yet."}</Empty>}</Card>
      <Modal open={!!back} onClose={() => setBack(null)} title={`Send back ${back?.id}`} footer={<><Button onClick={() => setBack(null)}>Cancel</Button><Button variant="danger" onClick={async () => { if (await decide(back.id, "reject", comment)) setBack(null); }}>Reject</Button><Button variant="primary" onClick={async () => { if (await decide(back.id, "request_changes", comment)) setBack(null); }}>Request changes</Button></>}>
        <Field label="What needs to change" htmlFor="cm"><textarea id="cm" className="inp" rows={3} value={comment} onChange={e => setComment(e.target.value)} /></Field>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
