"use client";
import { useApi } from "@/lib/api";
import { Button, Empty, ErrorBox, Loading, Modal, Pill } from "@/components/ui";

const fmt = (o: any) => o ? Object.entries(o).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") : "—";

/** Change history of one mapping: old and new values, requester, approver and times (PRD 10.4). */
export function MappingHistory({ pid, onClose }: { pid: string | null; onClose: () => void }) {
  const { data, error, loading } = useApi<any>(pid ? `/pixels/${pid}/history` : null);
  return (
    <Modal wide open={!!pid} onClose={onClose} title={`History of ${pid}`} footer={<Button onClick={onClose}>Close</Button>}>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : data && <>
        <p className="text-[13px] text-ink-2">Now: {fmt(data.current)}</p>
        <h3 className="text-[13px] font-semibold">Change requests</h3>
        {data.changes.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Change</th><th>Old value</th><th>New value</th><th>Reason</th><th>Requested</th><th>Decided</th><th>Status</th></tr></thead>
          <tbody>{data.changes.map((c: any) => <tr key={c.id}><td className="whitespace-nowrap"><span className="font-mono text-xs">{c.id}</span><div className="text-xs">{c.change_type}{c.origin !== "user" ? ` (${c.origin})` : ""}</div></td>
            <td className="text-xs">{fmt(c.before)}</td><td className="text-xs">{fmt(c.after)}</td><td className="text-xs">{c.reason || "—"}</td>
            <td className="text-xs">{c.requested_by_name}<div className="text-ink-3">{new Date(c.requested_at).toLocaleString()}</div></td>
            <td className="text-xs">{c.decided_by || "—"}<div className="text-ink-3">{c.decided_at ? new Date(c.decided_at).toLocaleString() : ""}</div>{c.comment && <div>{c.comment}</div>}</td><td><Pill>{c.status}</Pill></td></tr>)}</tbody></table></div> : <Empty>No change requests. The mapping is as imported.</Empty>}
        {data.lifecycle.length > 0 && <><h3 className="text-[13px] font-semibold">Archive and restore events</h3>
          <ul className="text-xs">{data.lifecycle.map((e: any, i: number) => <li key={i}>{new Date(e.at).toLocaleString()} · {e.action.replace("_", " ")} by {e.actor}{e.reason_category ? ` · ${e.reason_category}` : ""}{e.reason ? `: ${e.reason}` : ""}</li>)}</ul></>}
        {data.audit.length > 0 && <><h3 className="text-[13px] font-semibold">Applied changes (audit log)</h3>
          <ul className="text-xs">{data.audit.map((e: any, i: number) => <li key={i}>{new Date(e.at).toLocaleString()} · {e.action.replace(/_/g, " ")} by {e.actor_name}{e.before ? ` · from ${fmt(e.before)}` : ""}{e.after ? ` · to ${fmt(e.after)}` : ""}</li>)}</ul></>}
      </>}
    </Modal>
  );
}
