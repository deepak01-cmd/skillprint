"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Wand2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, ErrorBox, Loading, Note, PageHeader } from "@/components/ui";
import { RoleDraftCard, useRoleDraft } from "@/components/RoleDraftCard";
import { ApproveForm } from "@/components/AiDraftReview";

/** Opened from "Draft a profile": starts at once, shows progress, then the drafted profile with its outlook. */
function DraftPage() {
  const s = useSession(); const sp = useSearchParams(); const router = useRouter();
  const initial = (sp.get("title") || "").trim();
  const [title, setTitle] = useState(initial); const [go, setGo] = useState(initial.length >= 3 ? initial : null);
  useEffect(() => { const t = (sp.get("title") || "").trim(); setTitle(t); setGo(t.length >= 3 ? t : null); }, [sp]);
  const d = useRoleDraft(go);
  const org = useApi<any>(can(s, "roles:write") ? "/org" : null);
  const [done, setDone] = useState(false);
  const depts = (org.data?.departments || []).filter((x: any) => x.status === "Active" && (s.permissions["roles:write"] === "org" || x.id === s.user.department_id));
  useEffect(() => { if (d?.matched) router.replace(`/roles/${d.matched.id}`); }, [d?.matched, router]);
  return (
    <>
      <Link href="/roles" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-accent"><ArrowLeft className="h-4 w-4" />Job roles</Link>
      <PageHeader title="Generate role framework with AI" />
      {!go && <Card><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (title.trim().length >= 3) router.replace(`/roles/draft?title=${encodeURIComponent(title.trim())}`); }}>
        <input className="inp max-w-md" placeholder="Role title, for example Senior .NET Lead" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} autoFocus />
        <Button variant="primary" disabled={title.trim().length < 3}><Wand2 className="h-4 w-4" />Draft</Button></form></Card>}
      {go && !d && <Loading rows={3} />}
      {d?.error && <ErrorBox error={{ message: d.error }} />}
      {d?.matched && <Note>“{go}” is already in your framework as {d.matched.title}. Opening it…</Note>}
      {d?.draft && <div className="flex flex-col gap-4">
        <RoleDraftCard draft={d.draft} footer={d.draft.status === "Ready" && (done ? <div className="flex items-center gap-2 text-[14px] text-good"><CheckCircle2 className="h-5 w-5" />Draft role created. It goes through the normal approval before publishing.</div>
          : can(s, "roles:write") ? <ApproveForm d={d.draft} depts={depts} onDone={() => setDone(true)} />
          : <div className="text-[13px] text-ink-3">Sent to HR for review. Nothing enters the framework until they approve it.</div>)} />
      </div>}
    </>
  );
}
export default function Page() { return <Suspense fallback={<Loading />}><DraftPage /></Suspense>; }
