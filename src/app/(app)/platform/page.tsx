"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { Button, Card, ErrorBox, Field, Loading, Modal, PageHeader, Pill, useToast } from "@/components/ui";

export default function Platform() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<any[]>("/platform/organisations");
  const [open, setOpen] = useState(false); const [v, setV] = useState<any>({}); const [err, setErr] = useState<any>(null);
  const reqs = useApi<any[]>("/library-requests");
  if (loading) return <Loading />;
  return (
    <>
      <PageHeader title="Organisations"
        actions={<Button variant="primary" onClick={() => { setV({ name: "", industry: "", domain: "", hr_admin_name: "", hr_admin_email: "", hr_admin_password: "" }); setErr(null); setOpen(true); }}>New organisation</Button>} />
      <ErrorBox error={error} />
      <Card pad={false}><table className="t"><thead><tr><th>ID</th><th>Organisation</th><th>Industry</th><th className="text-right">Users</th><th className="text-right">Roles</th><th className="text-right">Employees</th><th className="text-right">Active mappings</th><th>Status</th><th></th></tr></thead>
        <tbody>{(data || []).map(o => <tr key={o.id}><td className="font-mono text-xs">{o.id}</td><td className="font-medium">{o.name}</td><td>{o.industry}<div className="text-xs text-ink-3">{o.domain}</div></td><td className="num text-right">{o.users}</td><td className="num text-right">{o.roles}</td><td className="num text-right">{o.employees}</td><td className="num text-right">{o.active_mappings}</td><td><Pill tone={o.status === "Active" ? "Active" : "Rejected"}>{o.status}</Pill></td>
          <td><Button size="sm" onClick={async () => { const r = await api("PATCH", `/platform/organisations/${o.id}`, { status: o.status === "Active" ? "Suspended" : "Active" }); r.ok ? toast("Status updated") : toast(r.error!.message, "bad"); reload(); }}>{o.status === "Active" ? "Suspend" : "Reactivate"}</Button></td></tr>)}</tbody></table></Card>
      <Card className="mt-4" pad={false} title="Master library requests from organisations">
        {(reqs.data || []).length ? <table className="t"><thead><tr><th>Request</th><th>Organisation</th><th>Skill</th><th>Type</th><th>Text</th><th>Status</th><th></th></tr></thead>
          <tbody>{reqs.data!.map(r => <tr key={r.id}><td className="font-mono text-xs">{r.id}</td><td>{r.organisation}<div className="text-xs text-ink-3">{r.requested_by}</div></td><td>{r.skill_name || "—"}</td><td>{r.type.replace("_", " ")}</td><td className="max-w-md">{r.text}</td><td><Pill tone={r.status === "Open" ? "Assigned" : r.status === "Approved" ? "Met" : "Rejected"}>{r.status}</Pill></td>
            <td className="whitespace-nowrap">{r.status === "Open" && ["approve", "reject"].map(dc => <Button key={dc} size="sm" className="mr-1" variant={dc === "approve" ? "primary" : "default"} onClick={async () => { const x = await api("POST", `/library-requests/${r.id}/decide`, { decision: dc }); x.ok ? toast(x.data.note || x.data.status) : toast(x.error!.message, "bad"); reqs.reload(); }}>{dc === "approve" ? "Approve" : "Reject"}</Button>)}</td></tr>)}</tbody></table>
          : <p className="px-4 py-6 text-center text-ink-3">No requests.</p>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New organisation" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/platform/organisations", v); if (!r.ok) return setErr(r.error); setOpen(false); toast(`${r.data.name} created`); reload(); }}>Create</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          {[["name", "Organisation name"], ["industry", "Industry"], ["domain", "Industry domain"], ["hr_admin_name", "First HR administrator: name"], ["hr_admin_email", "HR administrator email"], ["hr_admin_password", "Temporary password (8+ characters)"]].map(([k, l]) =>
            <Field key={k} label={l} htmlFor={k}><input id={k} className="inp" type={k.includes("password") ? "password" : "text"} value={v[k] || ""} onChange={e => setV({ ...v, [k]: e.target.value })} /></Field>)}
        </div>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
