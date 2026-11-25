"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pill, fmtDate, useToast } from "@/components/ui";

export default function Planning() {
  const s = useSession(); const toast = useToast();
  const plans = useApi<any[]>("/planning/plans"); const as = useApi<any[]>("/planning/assumptions");
  const [open, setOpen] = useState(false); const [v, setV] = useState<any>({ name: "", horizon_months: 12, copy_from: "" }); const [err, setErr] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const cur = (as.data || []).find(a => a.status === "Published");
  const manage = can(s, "org:manage");
  return (
    <>
      <PageHeader title="Workforce planning"
        actions={manage && <Button variant="primary" onClick={() => { setErr(null); setV({ name: "", horizon_months: 12, copy_from: "" }); setOpen(true); }}>New plan</Button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Card pad={false} title="Plans">{plans.loading ? <Loading /> : (plans.data || []).length ? <table className="t"><thead><tr><th>Plan</th><th>Horizon</th><th className="text-right">Roles</th><th>Assumptions</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{plans.data!.map(p => <tr key={p.id}><td><Link className="font-medium text-accent hover:underline" href={`/planning/${p.id}`}>{p.name}</Link><div className="font-mono text-xs text-ink-3">{p.id}</div></td><td>{p.horizon_months} months</td><td className="num text-right">{p.roles}</td><td>v{p.assumption_version}</td><td><Pill>{p.status}</Pill></td><td className="num">{fmtDate(p.created_at)}</td></tr>)}</tbody></table> : <Empty>No plans yet.</Empty>}</Card>
        <Card title={`Assumption set${cur ? ` v${cur.version}` : ""}`} actions={manage && cur && <Button size="sm" onClick={() => setEdit(JSON.stringify(cur.data, null, 2))}>Publish a new version</Button>}>
          {cur ? <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
            <dt>Competent level threshold</dt><dd className="num">L{cur.data.competent_level}</dd>
            <dt>Self-assessed levels count</dt><dd>{cur.data.count_self_assessed ? "Yes" : "No"}</dd>
            <dt>Minimum group size</dt><dd className="num">{cur.data.min_group_size}</dd>
            <dt>Difficulty: Low</dt><dd className="num">≤{cur.data.difficulty.low.new_skills} new, ≤{cur.data.difficulty.low.level_points} pts</dd>
            <dt>Difficulty: Medium</dt><dd className="num">≤{cur.data.difficulty.medium.new_skills} new, ≤{cur.data.difficulty.medium.level_points} pts</dd>
            {cur.data.readiness.map((b: any) => <Fragment key={b.band}><dt>{b.band}</dt><dd className="num">≥{Math.round(b.min * 100)}%</dd></Fragment>)}
            <dt>Risk High below</dt><dd className="num">{Math.round(cur.data.risk.high_below * 100)}%</dd><dt>Risk Medium below</dt><dd className="num">{Math.round(cur.data.risk.medium_below * 100)}%</dd>
          </dl> : <Empty>No assumption set.</Empty>}
        </Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New workforce plan" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await api("POST", "/planning/plans", { ...v, copy_from: v.copy_from || undefined }); if (!r.ok) return setErr(r.error); setOpen(false); toast("Plan created"); plans.reload(); }}>Create</Button></>}>
        <Field label="Name" htmlFor="pn"><input id="pn" className="inp" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Horizon (months)" htmlFor="ph"><input id="ph" type="number" className="inp" value={v.horizon_months} onChange={e => setV({ ...v, horizon_months: +e.target.value })} /></Field>
        <Field label="Copy inputs from (to compare scenarios)" htmlFor="pc"><select id="pc" className="inp" value={v.copy_from} onChange={e => setV({ ...v, copy_from: e.target.value })}><option value="">Start empty</option>{(plans.data || []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></Field>
        <ErrorBox error={err} />
      </Modal>
      <Modal wide open={edit !== null} onClose={() => setEdit(null)} title="Publish a new assumption set version" footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { let data; try { data = JSON.parse(edit); } catch { return setErr({ message: "The JSON is not valid" }); } const r = await api("POST", "/planning/assumptions", { data }); if (!r.ok) return setErr(r.error); setEdit(null); toast(`Assumption set v${r.data.version} published`); as.reload(); }}>Publish</Button></>}>
        <p className="text-[13px] text-ink-2">Edit thresholds and weights. Publishing creates a new version; earlier plans and readiness snapshots keep the version they used.</p>
        <textarea className="inp min-h-[360px] font-mono text-xs" value={edit || ""} onChange={e => setEdit(e.target.value)} aria-label="Assumptions JSON" />
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
