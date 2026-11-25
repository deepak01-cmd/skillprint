"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, Briefcase, BriefcaseBusiness, Building2, CheckCircle2, ClipboardCheck, FileSpreadsheet, GitPullRequestArrow, Layers, Lightbulb, Sparkles, Target, TrendingUp, Upload, Users, Workflow } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Card, Columns, CountUp, Donut, Empty, ErrorBox, HBars, Hero, IconBadge, Level, Pill, Ring, Skeleton, StackBar, StackedRows, Stat, TREND_COLORS, fmtNum } from "@/components/ui";

const TREND = { Current: TREND_COLORS.Current, Emerging: TREND_COLORS.Emerging, Declining: TREND_COLORS.Declining };
const SERIES = (Object.keys(TREND) as (keyof typeof TREND)[]).map(k => ({ key: k, label: k, color: TREND[k] }));

function QuickLink({ href, icon: I, title, sub }: { href: string; icon: any; title: string; sub: string }) {
  return (
    <Link href={href} className="lift group flex items-center gap-3 rounded-2xl border border-line bg-card p-4 shadow-card">
      <IconBadge size={40}><I /></IconBadge>
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold">{title}</span><span className="block truncate text-[12px] text-ink-3">{sub}</span></span>
      <ArrowRight className="h-4 w-4 text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-accent" />
    </Link>
  );
}
function HeroStat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = <><div className="num text-[26px] font-extrabold leading-none">{typeof value === "number" ? <CountUp value={value} /> : value}</div><div className="mt-1 text-[12px] font-medium text-white/70">{label}</div></>;
  return href ? <Link href={href} className="glass rounded-2xl px-4 py-3 transition-colors hover:bg-white/20">{body}</Link> : <div className="glass rounded-2xl px-4 py-3">{body}</div>;
}
function DashSkeleton() {
  return <><Skeleton className="mb-6 h-40 rounded-3xl" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div></>;
}

function JobsForMe() {
  const jobs = useApi<any[]>("/ijp/jobs");
  const top = (jobs.data || []).filter(j => !j.current_role).slice(0, 3);
  return (
    <Card tint="yellow" title="Internal jobs for you" icon={<BriefcaseBusiness />} actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/jobs">All jobs →</Link>}>
      {top.length ? <ul className="flex flex-col gap-2.5">{top.map(j => (
        <li key={j.id}><Link href={`/jobs/${j.id}`} className="lift flex items-center gap-3 rounded-xl border border-line p-3">
          <Ring value={j.match_pct} size={48} stroke={12} tone={j.match_pct >= 75 ? "good" : j.match_pct >= 50 ? "acc" : "warn"} label={<span className="text-[12px]">{j.match_pct}%</span>} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold">{j.title}</div><div className="truncate text-[12px] text-ink-3">{j.department_name} · {j.location || j.work_mode}</div></div>
          {j.application ? <Pill>{j.application.status}</Pill> : <ArrowRight className="h-4 w-4 text-ink-3" />}
        </Link></li>))}</ul>
        : <Empty icon={<BriefcaseBusiness />}>No open internal jobs right now.</Empty>}
    </Card>
  );
}

function IjpSummary() {
  const jobs = useApi<any[]>("/ijp/jobs?view=manage");
  const open = (jobs.data || []).filter(j => j.status === "Open");
  const applicants = open.reduce((a, j) => a + (j.applicants || 0), 0);
  return (
    <Card tint="yellow" title="Internal jobs" icon={<BriefcaseBusiness />} actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/jobs/manage">Manage →</Link>}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-sunken/60 p-3"><div className="num text-[24px] font-extrabold"><CountUp value={open.length} /></div><div className="text-[12px] text-ink-3">open postings</div></div>
        <div className="rounded-xl bg-sunken/60 p-3"><div className="num text-[24px] font-extrabold"><CountUp value={applicants} /></div><div className="text-[12px] text-ink-3">applicants on open postings</div></div>
      </div>
      {open.length ? <HBars data={open.slice(0, 5).map(j => ({ key: j.id, label: <Link className="hover:text-accent" href={`/jobs/manage/${j.id}`}>{j.title}</Link>, value: j.applicants || 0, sub: (j.applicants || 0) === 1 ? "applicant" : "applicants" }))} caption="Active applications per open posting (withdrawn ones not counted)" /> : <Empty icon={<BriefcaseBusiness />} action={<Link href="/jobs/manage" className="text-[13px] font-semibold text-accent">Post a job →</Link>}>Nothing posted yet.</Empty>}
    </Card>
  );
}

export default function Dashboard() {
  const s = useSession();
  const { data: d, error, loading } = useApi<any>("/dashboard");
  const [ind, setInd] = useState("");
  if (loading) return <DashSkeleton />;
  if (error) return <ErrorBox error={error} />;
  const hour = new Date().getHours(); const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = s.user.name.split(" ")[0];

  if (d.kind === "Platform") {
    const totals = ["Current", "Emerging", "Declining"].map(t => ({ label: t, value: d.by_company.reduce((a: number, c: any) => a + (c.trends[t] || 0), 0), color: (TREND as any)[t] }));
    return (
      <>
        <Hero>
          <div><div className="text-[13px] font-semibold text-white/70">Platform</div><h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">{hello}, <span className="grad-text">{first}</span></h1></div>
          <div className="flex flex-wrap gap-3"><HeroStat label="Organisations" value={d.organisations} href="/platform" /><HeroStat label="Global skills" value={d.skills_global} href="/skills" /><HeroStat label="Library requests" value={d.open_library_requests || 0} href="/library/approvals" /></div>
        </Hero>
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={<Building2 />} label="Departments" value={d.departments} sub={`${d.roles} roles`} />
          <Stat icon={<BookOpen />} label="Global skills" value={d.skills_global} />
          <Stat icon={<Layers />} label="Active mappings" value={d.reconciliation.active_mappings} sub={`+${d.reconciliation.archived_mappings} archived`} />
          <Stat icon={d.reconciliation.duplicate_pixel_ids ? <AlertTriangle /> : <CheckCircle2 />} tone={d.reconciliation.duplicate_pixel_ids ? "bad" : "good"} label="Duplicate Pixel IDs" value={d.reconciliation.duplicate_pixel_ids} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card title="Skill trends, all organisations" sub="Active role–skill requirements by trend"><Donut data={totals} sub="requirements" /></Card>
          <Card tint="blue" title="Trend mix by organisation" sub="Share of each organisation's active skill requirements; the number on the right is the total">
            <StackedRows series={SERIES} rows={d.by_company.map((c: any) => ({ key: c.name, label: c.name, values: c.trends }))} />
          </Card>
        </div>
        <Card className="mt-5" pad={false} title="By industry" icon={<Layers />} actions={<select className="inp w-56" value={ind} onChange={e => setInd(e.target.value)} aria-label="Industry"><option value="">All industries</option>{d.trends_by_industry.map((i: any) => <option key={i.industry}>{i.industry}</option>)}</select>}>
          <div className="px-4 pb-4 sm:px-6"><StackedRows series={SERIES} rows={d.trends_by_industry.filter((i: any) => !ind || i.industry === ind).map((i: any) => ({ key: i.industry, label: i.industry, values: { Current: i.current, Emerging: i.emerging, Declining: i.declining } }))} /></div>
          <table className="t"><thead><tr><th>Industry</th><th className="text-right" title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Current skills</th><th className="text-right" title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Emerging skills</th><th className="text-right" title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Declining skills</th><th className="text-right" title="Role-skill requirements in use">Active requirements</th></tr></thead>
            <tbody>{d.trends_by_industry.filter((i: any) => !ind || i.industry === ind).map((i: any) => <tr key={i.industry}><td className="font-semibold">{i.industry}</td><td className="num text-right">{i.current}</td><td className="num text-right text-em">{i.emerging}</td><td className="num text-right text-warn">{i.declining}</td><td className="num text-right font-bold">{i.active}</td></tr>)}</tbody></table>
        </Card>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <QuickLink href="/data/framework" icon={FileSpreadsheet} title="Upload a framework" sub="Role–skill file, auto-completed" />
          <QuickLink href="/data/growth" icon={Sparkles} title="Grow from job postings" sub="Skills, titles, templates" />
          <QuickLink href="/platform" icon={Building2} title="Organisations" sub="Tenants and status" />
        </div>
      </>
    );
  }

  const me = d.me;
  const trendBy: Record<string, Record<string, number>> = {};
  (d.trends_by_industry || []).forEach((t: any) => { trendBy[t.industry] = { ...(trendBy[t.industry] || {}), [t.skill_trend]: t.n }; });
  const trendTotals = Object.keys(TREND).map(t => ({ label: t, value: Object.values(trendBy).reduce((a, x) => a + (x[t] || 0), 0), color: (TREND as any)[t] }));
  const hr = s.user.role === "hr_admin" || s.user.role === "dept_head";
  const fit = me ? me.match_pct : 0;   // the same match as on the profile, internal jobs and succession
  return (
    <>
      <Hero art={me ? <Ring value={fit} size={128} tone={fit >= 75 ? "good" : fit >= 50 ? "acc" : "warn"} sub="role match" /> : undefined}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-white/70">{s.organisation?.name} · {s.role_label}</div>
          <h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">{hello}, <span className="grad-text">{first}</span></h1>
          <div className="mt-4 flex flex-wrap gap-3">
            {d.employees !== undefined && !hr && <HeroStat label="People in your team" value={d.employees} href="/team" />}
            {d.approvals_pending ? <HeroStat label="To approve" value={d.approvals_pending} href="/approvals" /> : null}
            {d.unresolved_roles ? <HeroStat label="Titles to resolve" value={d.unresolved_roles} href="/roles/queue" /> : null}
            {me && <><HeroStat label="Skills met" value={`${me.met}/${me.required}`} href="/me" /><HeroStat label="Gaps to close" value={me.gaps} href="/learning" /></>}
          </div>
        </div>
      </Hero>

      {d.employees !== undefined && (
        <>
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<Users />} label="Employees" value={d.employees} sub={`${fmtNum(d.employees_assessed)} assessed`} />
            <Stat icon={<Briefcase />} label="Published roles" value={d.roles_published} sub={`${d.roles_draft} in draft`} />
            <Stat icon={<Target />} tone={d.high_priority_gaps ? "warn" : "good"} label="Skill gaps" value={d.open_gaps} sub={`${fmtNum(d.high_priority_gaps)} high priority · one per person and skill below the required level`} />
            {d.approvals_pending !== null
              ? <Stat icon={<GitPullRequestArrow />} tone={d.approvals_pending ? "warn" : "good"} label="In review" value={d.approvals_pending} sub={<Link className="font-semibold text-accent hover:underline" href="/approvals">Open approvals →</Link>} />
              : <Stat icon={<ClipboardCheck />} label="Missing assessments" value={d.missing_assessments} />}
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Top skill shortages" icon={<Target />} actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/gaps">All gaps →</Link>}>
              {d.shortage_skills.length ? <HBars tone="bad" data={d.shortage_skills.map((x: any) => ({ label: x.name, value: x.n, sub: x.n === 1 ? "person" : "people" }))} caption="Number of people whose level is below what their role needs, where the gap is high priority" /> : <Empty icon={<CheckCircle2 />}>No high-priority gaps.</Empty>}
            </Card>
            <div className="flex flex-col gap-5">
              <Card tint="green" title="Coverage" icon={<Layers />}>
                <div className="flex items-center gap-5">
                  <div className="flex flex-col items-center gap-1"><Ring value={d.employees ? Math.round(d.employees_assessed / d.employees * 100) : 0} size={104} tone="good" sub="assessed" /><span className="text-[12px] text-ink-3">{d.employees_assessed} of {d.employees} people</span></div>
                  <div className="grid flex-1 grid-cols-2 gap-3 text-[12.5px]">
                    <div><div className="text-ink-3">Mappings</div><div className="num text-[20px] font-extrabold">{fmtNum(d.mappings_active)}</div></div>
                    <div><div className="text-ink-3">With plans</div><div className="num text-[20px] font-extrabold">{fmtNum(d.employees_with_plans)}</div></div>
                    <div><div className="text-ink-3">Roles with skills</div><div className="num text-[20px] font-extrabold">{fmtNum(d.roles_complete)}</div></div>
                    <div><div className="text-ink-3">Archived</div><div className="num text-[20px] font-extrabold text-ink-3">{d.mappings_archived ?? "—"}</div></div>
                  </div>
                </div>
              </Card>
              <Card tint="pink" title="Skill trends" sub="Active skill requirements in your scope, by trend"><StackBar parts={trendTotals} unit=" requirements" /></Card>
            </div>
          </div>
          {hr && (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
              <IjpSummary />
              <div className="grid content-start gap-4 sm:grid-cols-2">
                <QuickLink href="/jobs/manage" icon={BriefcaseBusiness} title="Post internal jobs" sub="Form or CSV upload" />
                <QuickLink href="/learning/catalogue" icon={Lightbulb} title="Learning catalogue" sub="Courses for skill gaps" />
                <QuickLink href="/roles?upload=1" icon={Upload} title="Upload roles" sub="Roles or job descriptions" />
                <QuickLink href="/roles/queue" icon={Workflow} title="Role resolution" sub="Titles to match" />
              </div>
            </div>
          )}
        </>
      )}
      {d.reviews && (
        <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat icon={<ClipboardCheck />} label="Assessments to review" value={d.reviews.assessments} sub={<Link className="font-semibold text-accent hover:underline" href="/assessments">Open →</Link>} />
          <Stat icon={<TrendingUp />} label="Evolution suggestions" value={d.reviews.suggestions} sub={<Link className="font-semibold text-accent hover:underline" href="/evolution">Review →</Link>} />
        </div>
      )}
      {me && (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Card tint="blue" title="Close your gaps" icon={<Target />} actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/learning">Learn →</Link>}>
            <Donut size={130} label={`${me.met}/${me.required}`} sub="skills met" data={[{ label: "Met", value: me.met, color: "#31C48D" }, { label: "Below required level", value: me.gaps, color: "#F05252" }, { label: "Not assessed yet", value: me.no_data, color: "#9CA3AF" }]} />
            {me.top_gaps.length > 0 && <ul className="mt-4 flex flex-col gap-2 border-t border-line-2 pt-3">{me.top_gaps.map((g: any) => <li key={g.skill_id} className="flex items-center justify-between gap-2 text-[13px]"><span className="truncate font-medium">{g.skill_name}</span><span className="flex shrink-0 items-center gap-1.5"><Level n={g.current_level} short /><ArrowRight className="h-3 w-3 text-ink-3" /><Level n={g.required_level} short tone="acc" /></span></li>)}</ul>}
          </Card>
          {s.user.employee_id && <JobsForMe />}
          <Card tint="green" title="To do" icon={<ClipboardCheck />}>
            {[...me.open_assessments.map((a: any) => ({ id: a.id, href: `/assessments/${a.id}`, title: a.method, sub: "Assessment", status: a.status })), ...me.activities.map((a: any) => ({ id: a.id, href: "/me", title: a.title, sub: a.skill_name, status: a.status }))].slice(0, 6).map(x =>
              <Link key={x.id} href={x.href} className="flex items-center justify-between gap-2 border-b border-line-2 py-2.5 text-[13px] last:border-0 hover:text-accent"><span className="min-w-0"><span className="block truncate font-semibold">{x.title}</span><span className="block truncate text-[11.5px] text-ink-3">{x.sub}</span></span><Pill>{x.status}</Pill></Link>)}
            {!me.open_assessments.length && !me.activities.length && <Empty icon={<Sparkles />} action={<Link href="/learning" className="text-[13px] font-semibold text-accent hover:underline">Build a learning plan →</Link>}>All clear.</Empty>}
          </Card>
        </div>
      )}
    </>
  );
}
