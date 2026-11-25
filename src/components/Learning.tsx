"use client";
/* Learning suggestions for skill gaps: courses (company first), colleagues who can mentor, platform searches and steps. */
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, ChevronDown, Clock, ExternalLink, FileText, GraduationCap, Hammer, Lightbulb, Plus, Search, Sparkles, Users, Video, Award, Presentation, Building2, HeartHandshake } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Avatar, Button, Empty, ErrorBox, IconBadge, Legend, Level, Loading, Modal, Pill, cx, useToast } from "@/components/ui";

const TYPE_ICON: Record<string, any> = { Course: GraduationCap, Video, Book: BookOpen, Article: FileText, Certification: Award, Project: Hammer, Mentoring: Users, Workshop: Presentation, Internal: Building2 };

function LevelJump({ from, to }: { from: number | null; to: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={`Level ${from ?? 0} to ${to}`}>
      {[1, 2, 3, 4, 5].map(i => <i key={i} className={cx("h-2 w-6 rounded-sm", from !== null && i <= from ? "bg-accent" : i <= to ? "bg-accent-3/45" : "bg-sunken")} />)}
      <span className="num ml-1.5 text-[12px] font-bold">{from ?? "?"}<ArrowRight className="mx-0.5 inline h-3 w-3 text-ink-3" />{to}</span>
    </div>
  );
}

function GapCard({ g, employeeId, canPlan, onAdded, open: open0 }: { g: any; employeeId: string; canPlan: boolean; onAdded: () => void; open?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(!!open0); const [tab, setTab] = useState<"courses" | "people" | "web" | "steps">(g.resources.length ? "courses" : g.mentors.length ? "people" : "web");
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<any>(null); const [askMsg, setAskMsg] = useState("");
  const ask = async () => {
    setBusy("ask"); const r = await api("POST", "/mentoring", { mentor_id: asking.employee_id, skill_id: g.skill_id, message: askMsg }); setBusy(null);
    if (!r.ok) return toast(r.error!.message, "bad");
    toast(`Request sent to ${asking.name}`); setAsking(null); onAdded();
  };
  const add = async (key: string, item: any) => {
    setBusy(key);
    const r = await api("POST", `/employees/${employeeId}/learning/plan`, { items: [{ skill_id: g.skill_id, target_level: g.target, ...item }] });
    setBusy(null);
    if (!r.ok) return toast(r.error!.message, "bad");
    toast(r.data.added ? "Added to the development plan" : "Already in the plan"); onAdded();
  };
  const tabs = [{ id: "courses", label: "Courses", n: g.resources.length }, { id: "people", label: "Mentors", n: g.mentors.length }, { id: "web", label: "Find more", n: g.search.length }, { id: "steps", label: "Path", n: g.steps.length }] as const;
  return (
    <div className={cx("anim-in overflow-hidden rounded-lg border bg-card shadow-card transition-colors", open ? "border-accent/40" : "border-line")}>
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left" aria-expanded={open}>
        <IconBadge tone={g.unassessed ? "em" : g.priority === "High" ? "bad" : g.priority === "Medium" ? "warn" : "acc"}><Lightbulb /></IconBadge>
        <div className="min-w-[180px] flex-1">
          <div className="text-[15px] font-bold">{g.skill_name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
            {g.unassessed ? <Pill tone="No assessment data">Not assessed yet</Pill> : g.priority && <Pill tone={g.priority}>{g.priority} priority</Pill>}
            {g.requirement_type && <Pill tone={g.requirement_type}>{g.requirement_type}</Pill>}
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />~{g.est_hours} h</span>
            {g.in_plan > 0 && <span className="inline-flex items-center gap-1 font-semibold text-good"><Check className="h-3 w-3" />{g.in_plan} in plan</span>}
          </div>
        </div>
        <LevelJump from={g.current} to={g.target} />
        <ChevronDown className={cx("h-5 w-5 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      <Modal open={!!asking} onClose={() => setAsking(null)} title={asking ? `Ask ${asking.name} to mentor you` : ""} footer={<><Button onClick={() => setAsking(null)}>Cancel</Button><Button variant="primary" loading={busy === "ask"} onClick={ask}><HeartHandshake className="h-4 w-4" />Send request</Button></>}>
        <textarea className="inp" rows={4} maxLength={1000} value={askMsg} onChange={e => setAskMsg(e.target.value)} aria-label="Message" />
      </Modal>
      {open && (
        <div className="border-t border-line px-5 pb-5 pt-3">
          <div className="mb-3 flex flex-wrap gap-1">
            {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={cx("rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors", tab === t.id ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-sunken hover:text-ink")}>{t.label} <span className="num opacity-70">{t.n}</span></button>)}
          </div>
          {tab === "courses" && (g.resources.length ? <div className="grid gap-2.5 md:grid-cols-2">{g.resources.map((r: any) => { const Ic = TYPE_ICON[r.type] || GraduationCap; return (
            <div key={r.id} className="flex gap-3 rounded-xl border border-line p-3">
              <IconBadge tone={r.company ? "good" : "acc"} size={38}><Ic /></IconBadge>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold leading-snug">{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{r.title} <ExternalLink className="inline h-3 w-3" /></a> : r.title}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">{r.provider}{r.hours ? ` · ${r.hours} h` : ""} · levels {r.level_from}–{r.level_to}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{r.company && <Pill tone="Company paid">Your company</Pill>}<Pill tone={r.cost}>{r.cost}</Pill><Pill tone="Draft">{r.type}</Pill></div>
              </div>
              {canPlan && <div className="self-center">{r.in_plan ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-good"><Check className="h-3.5 w-3.5" />In plan</span> : <Button size="sm" variant="soft" loading={busy === r.id} onClick={() => add(r.id, { resource_id: r.id })}><Plus className="h-3.5 w-3.5" />Plan</Button>}</div>}
            </div>); })}</div>
            : <Empty icon={<GraduationCap />}>No course in the catalogue for this skill yet. Try “Find more”.</Empty>)}
          {tab === "people" && (g.mentors.length ? <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{g.mentors.map((m: any) => (
            <div key={m.employee_id} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <Avatar name={m.name} size={38} />
              <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold">{m.name}</div><div className="truncate text-[12px] text-ink-3">{m.role_title}</div><Level n={m.level} short /></div>
              {canPlan && (m.asked ? <Pill tone={m.asked === "Accepted" ? "Active" : "In Review"}>{m.asked === "Accepted" ? "Mentoring" : "Asked"}</Pill>
                : m.can_ask ? <Button size="sm" variant="soft" onClick={() => { setAskMsg(`Hi ${m.name.split(" ")[0]}, would you mentor me in ${g.skill_name}?`); setAsking(m); }}><HeartHandshake className="h-3.5 w-3.5" />Ask</Button>
                : <Button size="sm" variant="soft" loading={busy === m.employee_id} title="Add to my plan" onClick={() => add(m.employee_id, { title: `Mentoring in ${g.skill_name} with ${m.name}`, type: "Mentoring", mentor: m.name })}><Plus className="h-3.5 w-3.5" /></Button>)}
            </div>))}</div>
            : <Empty icon={<Users />}>Nobody with a confirmed level in this skill yet.</Empty>)}
          {tab === "web" && <div className="flex flex-wrap gap-2">{g.search.map((x: any) => <a key={x.provider} href={x.url} target="_blank" rel="noopener noreferrer" className="lift inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold"><Search className="h-3.5 w-3.5 text-accent" />{x.provider}<ExternalLink className="h-3 w-3 text-ink-3" /></a>)}</div>}
          {tab === "steps" && <ol className="relative ml-3 border-l-2 border-dashed border-line pl-5">{g.steps.map((st: any, i: number) => (
            <li key={i} className="relative mb-3 last:mb-0"><span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10.5px] font-bold text-white">{i + 1}</span>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px] font-semibold">{st.title}</span>{canPlan && <Button size="sm" variant="ghost" loading={busy === `s${i}`} onClick={() => add(`s${i}`, { title: st.title, type: st.type })}><Plus className="h-3.5 w-3.5" />Plan</Button>}</div></li>))}</ol>}
        </div>
      )}
    </div>
  );
}

/** All gap suggestions for one employee (their own role, or ?role= a target role). */
export function LearningPanel({ employeeId, roleId, canPlan = true, limit }: { employeeId: string; roleId?: string; canPlan?: boolean; limit?: number }) {
  const toast = useToast();
  const d = useApi<any>(`/employees/${employeeId}/learning${roleId ? `?role=${roleId}` : ""}`);
  const [busy, setBusy] = useState(false);
  if (d.loading) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} />;
  const items: any[] = d.data.items;
  if (!items.length) return <Empty icon={<Sparkles />}>No gaps to close. Nicely done.</Empty>;
  const picks = items.filter(g => !g.unassessed && g.resources.length && !g.resources[0].in_plan).slice(0, 5);
  const addTop = async () => {
    setBusy(true);
    const r = await api("POST", `/employees/${employeeId}/learning/plan`, { items: picks.map(g => ({ skill_id: g.skill_id, target_level: g.target, resource_id: g.resources[0].id })) });
    setBusy(false); r.ok ? toast(`${r.data.added} added to the plan`) : toast(r.error!.message, "bad"); d.reload();
  };
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <div className="flex flex-col gap-3">
      <Legend className="justify-end text-[12.5px]" items={[{ label: "Your level now", color: "rgb(var(--accent))" }, { label: "Levels to reach", color: "rgb(var(--accent-3) / .45)" }]} />
      {canPlan && picks.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-accent/40 bg-accent-soft/50 px-4 py-3">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold"><Sparkles className="h-4 w-4 text-accent" />Top pick for {picks.length} skill{picks.length > 1 ? "s" : ""} ready</span>
        <Button variant="primary" size="sm" loading={busy} onClick={addTop}><Plus className="h-3.5 w-3.5" />Add all to my plan</Button></div>}
      {shown.map((g, i) => <GapCard key={g.skill_id} g={g} employeeId={employeeId} canPlan={canPlan} onAdded={d.reload} open={i === 0} />)}
      {limit && items.length > limit && <Link href="/learning" className="text-center text-[13px] font-semibold text-accent hover:underline">{items.length - limit} more →</Link>}
    </div>
  );
}
