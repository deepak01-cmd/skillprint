"use client";
/* Second-person approval of proposals for the shared skill library. */
import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pill, fmtDate, useToast } from "@/components/ui";

export default function LibraryApprovals() {
  const s = useSession(); const toast = useToast();
  const list = useApi<any[]>("/library/proposals");
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null); const [comment, setComment] = useState("");
  const decide = async (terms: string[], decision: "approve" | "reject", note?: string) => {
    setBusy(true); setErr(null);
    const r = await api("POST", "/library/proposals/decide", { terms, decision, comment: note }); setBusy(false);
    if (!r.ok) return setErr(r.error);
    const skipped = r.data.results.filter((x: any) => x.status === "skipped");
    toast(`${r.data.done} ${decision === "approve" ? "approved" : "rejected"}${skipped.length ? `, ${skipped.length} skipped (${skipped[0].reason})` : ""}`, skipped.length && !r.data.done ? "bad" : "ok");
    setSel(new Set()); setRejecting(null); setComment(""); list.reload();
  };
  const rows = list.data || [];
  const mine = rows.filter(r => !r.can_decide).length;
  return (
    <>
      <PageHeader eyebrow="Shared skill library" title={<>Library <span className="text-accent">approvals</span></>} />
      <ErrorBox error={list.error || err} />
      <Card pad={false} title={`${rows.length} proposal${rows.length === 1 ? "" : "s"}`} sub={mine ? `${mine} of them are yours and need someone else.` : undefined} icon={<ShieldCheck className="h-4 w-4" />}
        actions={sel.size > 0 && <><Button variant="primary" loading={busy} onClick={() => decide([...sel], "approve")}><Check className="h-4 w-4" />Approve {sel.size}</Button><Button onClick={() => setRejecting([...sel])}><X className="h-4 w-4" />Reject {sel.size}</Button></>}>
        {list.loading && !list.data ? <Loading rows={6} /> : !rows.length ? <Empty icon={<Check />}>Nothing waiting. Proposals appear here when the platform administrator proposes skills from job postings, or when automatic growth is on.</Empty> :
          <div className="overflow-x-auto"><table className="t"><thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select all" checked={rows.filter(r => r.can_decide).every(r => sel.has(r.term)) && rows.some(r => r.can_decide)} onChange={e => setSel(new Set(e.target.checked ? rows.filter(r => r.can_decide).map(r => r.term) : []))} /></th>
            <th>Term from postings</th><th>Proposal</th><th className="text-right">Employers posting</th><th>Proposed by</th><th></th></tr></thead>
            <tbody>{rows.map(r => { const p = r.proposal || {}; return (
              <tr key={r.term}>
                <td>{r.can_decide && <input type="checkbox" checked={sel.has(r.term)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(r.term) : n.delete(r.term); setSel(n); }} aria-label={`Select ${r.term}`} />}</td>
                <td><span className="font-medium">{r.term}</span><div className="text-[12px] text-ink-3">{(r.top_titles || []).slice(0, 2).map((t: any) => t.title).join(", ")}</div></td>
                <td className="max-w-[460px] text-[13px]">{p.action === "alias"
                  ? <>Another name for <b className="font-medium">{r.target_skill_name}</b><div className="text-[12px] text-ink-3">{r.target_skill_definition}</div></>
                  : <><Pill tone="Suggested">new skill</Pill> <b className="font-medium">{p.name || r.term}</b> <span className="text-ink-3">· {p.category}</span><div className="text-[12px] text-ink-2">{p.definition}</div></>}</td>
                <td className="num text-right">{r.companies}</td>
                <td className="text-[13px]">{r.proposed_by_name}<div className="text-[12px] text-ink-3">{fmtDate(r.proposed_at)}</div></td>
                <td className="whitespace-nowrap text-right">{r.can_decide ? <><Button size="sm" variant="ghost" onClick={() => decide([r.term], "approve")}><Check className="h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="ghost" aria-label={`Reject ${r.term}`} onClick={() => setRejecting([r.term])}><X className="h-3.5 w-3.5" /></Button></> : <span className="text-[12px] text-ink-3">your proposal</span>}</td>
              </tr>); })}</tbody></table></div>}
      </Card>
      <p className="mt-4 text-[12.5px] text-ink-3">Signed in as {s.user.name}. Approvals are recorded in the audit log with both names. Rejected terms go back to the candidate list.</p>
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.length} proposal${rejecting?.length === 1 ? "" : "s"}`}
        footer={<><Button onClick={() => setRejecting(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => decide(rejecting!, "reject", comment)}>Reject</Button></>}>
        <Field label="Reason (shown to the proposer)" htmlFor="rj"><textarea id="rj" className="inp" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="For example: too generic, or it is a product name, not a skill" /></Field>
      </Modal>
    </>
  );
}
