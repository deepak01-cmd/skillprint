"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Briefcase, CalendarClock, Check, CircleDashed, Lightbulb, MapPin, Send, Users, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, ErrorBox, Legend, Loading, Modal, Note, Pill, Ring, ago, cx, useConfirm, useToast } from "@/components/ui";
import { LearningPanel } from "@/components/Learning";
import { Tracker, daysLeft, toneFor } from "@/components/Jobs";

function SkillLine({ l }: { l: any }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
      <span className={cx("flex h-6 w-6 items-center justify-center rounded-full", l.met ? "bg-good-soft text-good" : l.current_level === null ? "bg-sunken text-ink-3" : "bg-bad-soft text-bad")}>{l.met ? <Check className="h-3.5 w-3.5" /> : l.current_level === null ? <CircleDashed className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span>
      <div className="min-w-[160px] flex-1"><div className="text-[13.5px] font-semibold">{l.skill_name}</div><div className="mt-0.5 flex gap-1.5"><Pill tone={l.requirement_type}>{l.requirement_type}</Pill></div></div>
      <div className="flex items-center gap-1" aria-label={`${l.current_level ?? "not assessed"} of ${l.required_level}`}>
        {[1, 2, 3, 4, 5].map(i => <i key={i} className={cx("h-2 w-5 rounded-full", l.current_level !== null && i <= l.current_level ? (l.met ? "bg-good" : "bg-accent") : i <= l.required_level ? "bg-bad-soft ring-1 ring-inset ring-bad/30" : "bg-sunken")} />)}
        <span className="num ml-1.5 w-10 text-right text-[12px] font-bold">{l.current_level ?? "?"}/{l.required_level}</span>
      </div>
    </li>
  );
}

export default function JobDetail({ params }: { params: { id: string } }) {
  const s = useSession(); const toast = useToast(); const confirm = useConfirm();
  const j = useApi<any>(`/ijp/jobs/${params.id}`);
  const [applying, setApplying] = useState(false); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  if (j.loading) return <Loading rows={8} />;
  if (j.error) return <ErrorBox error={j.error} />;
  const d = j.data; const m = d.match; const left = daysLeft(d.closes_on);
  const apply = async () => {
    setBusy(true); setErr(null); const r = await api("POST", `/ijp/jobs/${d.id}/apply`, { note }); setBusy(false);
    if (!r.ok) return setErr(r.error);
    setApplying(false); toast("Application sent. Good luck!"); j.reload();
  };
  const withdraw = async () => { if (!(await confirm({ title: "Withdraw application", message: `Withdraw your application for ${d.title}? You can apply again while the posting is open.`, danger: true, confirmLabel: "Withdraw" }))) return; const r = await api("POST", `/ijp/applications/${d.application.id}/withdraw`); r.ok ? toast("Application withdrawn") : toast(r.error!.message, "bad"); j.reload(); };
  const why = !s.user.employee_id ? null : d.current_role ? "This is your current role." : !d.open ? "This opening is closed." : m && m.match_pct < d.min_match ? `This opening needs a ${d.min_match}% match; you're at ${m.match_pct}%. Close the gaps below to qualify.` : null;
  const gaps = m ? m.lines.filter((l: any) => !l.met) : []; const met = m ? m.lines.filter((l: any) => l.met) : [];
  return (
    <>
      <Link href={d.can_manage && !s.user.employee_id ? "/jobs/manage" : "/jobs"} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-accent"><ArrowLeft className="h-4 w-4" />Internal jobs</Link>
      <section className="hero anim-in mb-6 px-6 py-7 md:px-8">
        <div className="relative z-[1] flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-white/75"><span>{d.department_name}</span>{d.status !== "Open" && <span className="rounded-full bg-white/20 px-2 py-0.5">{d.status}</span>}</div>
            <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-[-.02em]">{d.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-[12.5px] font-medium">
              <span className="glass inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1"><MapPin className="h-3.5 w-3.5" />{d.location || "—"} · {d.work_mode}</span>
              <span className="glass inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1"><Users className="h-3.5 w-3.5" />{d.openings} opening{d.openings > 1 ? "s" : ""}</span>
              <span className="glass inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1"><Briefcase className="h-3.5 w-3.5" />{d.role_title}{d.career_level ? ` · ${d.career_level}` : ""}</span>
              <span className="glass inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1"><CalendarClock className="h-3.5 w-3.5" />{left === null ? "Open until filled" : left <= 0 ? "Closes today" : `${left} days left`}</span>
            </div>
          </div>
          {m && <div className="flex items-center gap-4"><Ring value={m.match_pct} size={124} stroke={10} tone="good" track="rgb(255 255 255 / .18)" label={<span className="text-white">{m.match_pct}%</span>} sub={<span className="text-white/75">your match</span>} />
            <div className="text-[13px]"><div className="text-[20px] font-extrabold">{m.skills_met}/{m.skills_required}</div><div className="text-white/70">skills met</div><div className="mt-2 rounded-lg bg-white/15 px-2 py-1 text-[12px] font-semibold">{m.band}</div></div></div>}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          {d.description && <Card title="About the role"><p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{d.description}</p></Card>}
          {m ? <Card title="How you match" sub={`${m.match_pct}% match: must-have skills count three times, preferred twice, optional once`} actions={<span className="text-[12px] text-ink-3">{m.unassessed ? `${m.unassessed} not assessed yet` : ""}</span>}>
            <Legend className="mb-2 text-[12.5px]" items={[{ label: "Met level", color: "rgb(var(--good))" }, { label: "Your level (below)", color: "rgb(var(--accent))" }, { label: "Missing levels", color: "rgb(var(--bad-soft))" }]} />
            {gaps.length > 0 && <><div className="text-[12px] font-bold uppercase tracking-wider text-bad">To grow · {gaps.length}</div><ul className="divide-y divide-line-2">{gaps.map((l: any) => <SkillLine key={l.skill_id} l={l} />)}</ul></>}
            {met.length > 0 && <><div className="mt-3 text-[12px] font-bold uppercase tracking-wider text-good">You have · {met.length}</div><ul className="divide-y divide-line-2">{met.map((l: any) => <SkillLine key={l.skill_id} l={l} />)}</ul></>}
          </Card>
            : d.requirements && <Card title="Skills needed"><ul className="divide-y divide-line-2">{d.requirements.map((r: any) => <li key={r.skill_id} className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"><span className="font-semibold">{r.skill_name}</span><span className="flex items-center gap-2"><Pill tone={r.requirement_type}>{r.requirement_type}</Pill><span className="num font-bold">L{r.required_level}</span></span></li>)}</ul></Card>}
          {s.user.employee_id && gaps.length > 0 && <div><h2 className="mb-3 flex items-center gap-2 text-[18px] font-extrabold"><Lightbulb className="h-5 w-5 text-accent" />Close the gaps for this job</h2><LearningPanel employeeId={s.user.employee_id} roleId={d.role_id} limit={4} /></div>}
        </div>

        <div className="flex flex-col gap-5">
          {s.user.employee_id && <Card title={d.application ? "Your application" : "Apply"}>
            {d.application ? <div className="flex flex-col gap-4">
              <Tracker status={d.application.status} />
              <div className="text-[13px] text-ink-3">Applied {ago(d.application.created_at)} at a {d.application.match_pct}% match.</div>
              <ul className="flex flex-col gap-2 border-l-2 border-line pl-4">{[...(d.application.history || [])].reverse().map((h: any, i: number) => <li key={i} className="text-[12.5px]"><b>{h.status}</b> <span className="text-ink-3">· {ago(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ul>
              {!["Hired", "Not selected", "Withdrawn"].includes(d.application.status) && <Button variant="danger" onClick={withdraw}>Withdraw</Button>}
            </div> : <div className="flex flex-col gap-3">
              {why ? <Note tone="warn">{why}</Note> : <p className="text-[13.5px] text-ink-2">Your current skill levels are shared with HR when you apply.</p>}
              <Button variant="primary" size="lg" disabled={!d.can_apply} onClick={() => { setErr(null); setApplying(true); }}><Send className="h-4 w-4" />Apply now</Button>
            </div>}
          </Card>}
          {d.can_manage && <Card title="Applicants" actions={<Link href={`/jobs/manage/${d.id}`} className="text-[13px] font-semibold text-accent hover:underline">Open pipeline →</Link>}>
            <div className="flex flex-wrap gap-2">{(d.counts || []).length ? d.counts.map((c: any) => <span key={c.status} className="inline-flex items-center gap-1.5"><Pill>{c.status}</Pill><b className="num">{c.n}</b></span>) : <span className="text-[13px] text-ink-3">No applicants yet.</span>}</div>
          </Card>}
          <Card title="Posted"><div className="text-[13px] text-ink-2">{d.posted_by_name || "HR"} · {ago(d.created_at)}{d.min_match ? <> · needs a <b>{d.min_match}%</b> match</> : ""}</div></Card>
        </div>
      </div>

      <Modal open={applying} onClose={() => setApplying(false)} title={`Apply for ${d.title}`} footer={<><Button onClick={() => setApplying(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={apply}><Send className="h-4 w-4" />Send application</Button></>}>
        {m && <div className="flex items-center gap-4 rounded-2xl bg-sunken/60 p-4"><Ring value={m.match_pct} size={64} stroke={11} tone={toneFor(m.match_pct)} label={<span className="text-[13px]">{m.match_pct}%</span>} /><div className="text-[13px]"><b>{m.skills_met} of {m.skills_required}</b> skills met · {m.band}</div></div>}
        <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-2">Why this role? (optional)<textarea className="inp font-normal" rows={5} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="What you'd bring, and what you want to learn" /><span className="text-right text-[11px] font-normal text-ink-3">{note.length}/2000</span></label>
        <ErrorBox error={err} />
      </Modal>
    </>
  );
}
