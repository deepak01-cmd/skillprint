"use client";
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileUp, Layers, Sparkles, Wand2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, Level, Loading, PageHeader, Pill, ago, cx } from "@/components/ui";
import { UploadFlow } from "@/components/UploadFlow";

function FilledTag({ from }: { from: string }) {
  return from === "file" ? null : <span title={`Filled in: ${from}`} className="ml-1 inline-flex items-center gap-0.5 rounded bg-accent-soft px-1 text-[10.5px] font-bold text-accent"><Wand2 className="h-2.5 w-2.5" />auto</span>;
}

function Preview({ p }: { p: any }) {
  const [open, setOpen] = useState<string | null>(p.templates[0]?.title ?? null);
  const S = p.summary;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {[["Roles", S.templates, `${S.create} new · ${S.update} updated`], ["Skill requirements", S.requirements, ""], ["New skills", S.new_skills, S.two_step ? "go to library approval" : "added to the library"], ["Filled in", S.filled.levels + S.filled.types + S.filled.family + S.filled.categories + S.filled.definitions, "values completed"]].map(([l, v, sub]) =>
          <div key={l as string} className="rounded-xl bg-sunken/60 p-3"><div className="num text-[22px] font-extrabold">{v as any}</div><div className="text-[12px] font-semibold">{l}</div>{sub && <div className="text-[11px] text-ink-3">{sub}</div>}</div>)}
      </div>
      {p.errors.length > 0 && <details className="rounded-xl bg-bad-soft px-3 py-2 text-[12.5px]"><summary className="cursor-pointer font-semibold">{p.errors.length} row(s) skipped</summary><ul className="mt-1">{p.errors.map((e: any, i: number) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></details>}
      <div className="scroll-thin max-h-[48vh] overflow-auto rounded-xl border border-line">
        {p.templates.map((t: any) => (
          <div key={t.title + t.industry} className="border-b border-line last:border-0">
            <button onClick={() => setOpen(open === t.title ? null : t.title)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-sunken/50">
              <span className="font-bold">{t.title}</span><span className="text-[12px] text-ink-3">{t.industry} · {t.job_family}<FilledTag from={t.family_from} /></span>
              <span className="ml-auto flex items-center gap-2"><Pill tone={t.action === "create" ? "Open" : "In progress"}>{t.action === "create" ? "new" : "update"}</Pill><span className="num text-[12px] text-ink-3">{t.lines.length} skills</span></span>
            </button>
            {open === t.title && <table className="t"><tbody>{t.lines.map((l: any) => <tr key={l.skill}>
              <td><span className="font-semibold">{l.skill}</span>{l.status === "new" && <Pill tone="Suggested" className="ml-1.5">new skill</Pill>}{l.matched_as && <div className="text-[11px] text-ink-3">written as “{l.matched_as}”</div>}</td>
              <td title={l.level_from}><Level n={l.level} short /><FilledTag from={l.level_from} /></td>
              <td><Pill tone={l.type}>{l.type}</Pill><FilledTag from={l.type_from} /></td><td><Pill tone={l.importance}>{l.importance}</Pill></td><td><Pill tone={l.trend}>{l.trend}</Pill></td></tr>)}</tbody></table>}
          </div>))}
      </div>
      {p.new_skills.length > 0 && <div className="rounded-xl border border-dashed border-accent/40 p-3"><div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-3">New skills</div>
        <ul className="grid gap-1.5 md:grid-cols-2">{p.new_skills.map((n: any) => <li key={n.name} className="text-[12.5px]"><b>{n.name}</b> · {n.category}{n.category_from !== "file" && <FilledTag from={n.category_from} />}<div className="truncate text-ink-3">{n.definition}</div></li>)}</ul></div>}
    </div>
  );
}

export default function FrameworkUpload() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const hist = useApi<any[]>(s.user.role === "platform_admin" ? "/framework-upload" : null);
  if (s.user.role !== "platform_admin") return <Empty>Only the platform administrator loads frameworks into the shared library.</Empty>;
  return (
    <>
      <PageHeader title="Framework upload" actions={<Button variant="primary" onClick={() => setOpen(true)}><FileUp className="h-4 w-4" />Upload framework</Button>} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {[[FileSpreadsheet, "Bring your file", "Role and skill are enough. Levels, types and the rest are optional."], [Wand2, "Gaps filled in", "Matched to the library, levelled from similar frameworks and seniority."], [CheckCircle2, "You approve", "Check every row first. New skills follow library approval."]].map(([I, t, d]: any, i) => (
          <div key={t} className="anim-in flex gap-3 rounded-2xl border border-line bg-card p-4 shadow-card" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-3 text-white"><I className="h-5 w-5" /></span>
            <div><div className="text-[14px] font-bold">{t}</div><div className="text-[12.5px] text-ink-3">{d}</div></div></div>))}
      </div>
      <Card title="Uploads" icon={<Layers />} pad={false}>
        {hist.loading ? <Loading /> : (hist.data || []).length ? <table className="t"><thead><tr><th>File</th><th>Roles</th><th>Requirements</th><th>New skills</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{(hist.data || []).map(h => <tr key={h.id}><td className="font-semibold">{h.file_name}</td><td className="num">{h.summary?.templates ?? "—"}</td><td className="num">{h.summary?.requirements ?? "—"}</td><td className="num">{h.summary?.new_skills ?? "—"}</td>
            <td><Pill tone={h.status === "Committed" ? "Done" : h.status === "Discarded" ? "Closed" : "In progress"}>{h.status}</Pill></td><td className="text-ink-3">{ago(h.committed_at || h.created_at)} · {h.created_by_name}</td></tr>)}</tbody></table>
          : <Empty icon={<Sparkles />} action={<Button variant="primary" size="sm" onClick={() => setOpen(true)}>Upload the first one</Button>}>No frameworks uploaded yet.</Empty>}
      </Card>
      <UploadFlow open={open} onClose={() => { setOpen(false); hist.reload(); }} title="Upload a role–skill framework" templatePath="/framework-upload/template" previewPath="/framework-upload/preview"
        commitPath={id => `/framework-upload/${id}/commit`} discardPath={id => `/framework-upload/${id}/discard`}
        hint="CSV or Excel: one row per role and skill (or a “skills” list per role)" canCommit={p => p.summary.templates > 0}
        renderPreview={p => <Preview p={p} />}
        onDone={r => <><div className="text-[18px] font-extrabold">Framework loaded</div>
          <div className={cx("text-[13px] text-ink-3")}>{r.applied.templates_created} role templates created, {r.applied.templates_updated} updated · {r.applied.skills_added} skills added{r.applied.skills_proposed ? `, ${r.applied.skills_proposed} waiting for library approval` : ""}</div></>} />
    </>
  );
}
