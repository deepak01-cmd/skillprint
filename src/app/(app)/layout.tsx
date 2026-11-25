"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Briefcase, Building2, ClipboardCheck, Compass, Database, FileClock, GitPullRequestArrow, Globe2, GraduationCap, KeyRound,
  LayoutDashboard, LineChart, ArrowLeftRight, ShieldCheck, Moon, Sun, Monitor, LogOut, Menu, Network, Route, Search, Sparkles, Target, TrendingUp, User, Users, Workflow, X, Layers, ChevronDown, Telescope,
  BriefcaseBusiness, Lightbulb, Library, FileSpreadsheet, UserCog, CornerDownLeft, Command, HeartHandshake, Crown, FileBarChart, Eye,
} from "lucide-react";
import { SessionProvider, Session } from "@/components/session";
import { Avatar, ConfirmProvider, ToastProvider, cx } from "@/components/ui";
import { Logo, Wordmark } from "@/components/brand";
import { ForcePasswordChange } from "@/components/Account";
import { api } from "@/lib/api";

type Item = { href: string; label: string; icon: any };
const I = (href: string, label: string, icon: any): Item => ({ href, label, icon });
function nav(s: Session): { group: string; items: Item[] }[] {
  const groups = navFor(s);
  if (s.user.library_reviewer && s.user.role !== "platform_admin") groups.push({ group: "Shared library", items: [I("/library/approvals", "Library approvals", ShieldCheck)] });
  return groups;
}
function navFor(s: Session): { group: string; items: Item[] }[] {
  const r = s.user.role;
  if (r === "platform_admin") return [
    { group: "Platform", items: [I("/dashboard", "Overview", LayoutDashboard), I("/platform", "Organisations", Building2), I("/skills", "Skill library", BookOpen)] },
    { group: "Data", items: [I("/data/framework", "Framework", FileSpreadsheet), I("/data/reference", "Reference", Library), I("/data/growth", "Growth", Sparkles), I("/library/approvals", "Approvals", ShieldCheck), I("/market", "Market", Globe2), I("/data", "Checks", Database)] }];
  const me: Item[] = s.user.employee_id ? [I("/me", "My profile", User), I("/learning", "My learning", Lightbulb), I("/mentoring", "Mentoring", HeartHandshake), I("/jobs", "Internal jobs", BriefcaseBusiness), I("/moves", "Move planner", ArrowLeftRight), I("/me/career", "Career options", Compass), I("/me/future", "Future skills", Telescope)] : [];
  const moves = I("/moves", "Move planner", ArrowLeftRight);
  if (r === "employee") return [{ group: "Me", items: [I("/dashboard", "Home", LayoutDashboard), ...me, I("/assessments", "Assessments", ClipboardCheck)] }];
  if (r === "expert") return [{ group: "Reviews", items: [I("/dashboard", "Home", LayoutDashboard), I("/assessments", "Assessments", ClipboardCheck), I("/evolution", "Skill evolution", TrendingUp), I("/roles", "Job roles", Briefcase)] }];
  if (r === "manager") return [
    { group: "Team", items: [I("/dashboard", "Home", LayoutDashboard), I("/team", "My team", Users), I("/requests", "Level requests", TrendingUp), I("/assessments", "Assessments", ClipboardCheck), I("/gaps", "Team gaps", Target), I("/career", "Career paths", Route), I("/roles", "Job roles", Briefcase), I("/outlook", "Future outlook", Telescope)] },
    { group: "Me", items: me }];
  const framework = [I("/roles", "Job roles", Briefcase), I("/framework", "Framework", Layers), I("/skills", "Skill library", BookOpen), I("/roles/queue", "Role resolution", Workflow), I("/approvals", "Approvals", GitPullRequestArrow)];
  const talent = [I("/jobs/manage", "Internal jobs", BriefcaseBusiness), I("/succession", "Succession", Crown), I("/learning/catalogue", "Learning catalogue", Library)];
  if (r === "dept_head") return [
    { group: "Department", items: [I("/dashboard", "Home", LayoutDashboard), I("/employees", "Employees", Users), I("/gaps", "Skill gaps", Target), I("/jobs/manage", "Internal jobs", BriefcaseBusiness), I("/succession", "Succession", Crown), I("/requests", "Level requests", TrendingUp), I("/reports", "Reports", FileBarChart)] },
    { group: "Framework", items: [...framework, I("/data/growth", "Job market", Sparkles)] },
    { group: "Planning", items: [I("/outlook", "Future outlook", Telescope), moves, I("/career", "Career mobility", Route), I("/planning", "Workforce plan", LineChart), I("/evolution", "Skill evolution", TrendingUp), I("/market", "Market", Globe2)] },
    { group: "Records", items: [I("/audit", "Audit log", FileClock)] }];
  return [
    { group: "Overview", items: [I("/dashboard", "Home", LayoutDashboard), I("/org", "Organisation", Network)] },
    { group: "Talent", items: talent },
    { group: "People", items: [I("/employees", "Employees", Users), I("/requests", "Level requests", TrendingUp), I("/admin/users", "Users & access", UserCog), I("/assessments", "Assessments", ClipboardCheck), I("/gaps", "Skill gaps", Target)] },
    { group: "Framework", items: [...framework, I("/proficiency", "Proficiency levels", GraduationCap)] },
    { group: "Planning", items: [moves, I("/career", "Career mobility", Route), I("/planning", "Workforce plan", LineChart), I("/evolution", "Skill evolution", TrendingUp), I("/market", "Market", Globe2)] },
    { group: "Insights", items: [I("/outlook", "Future outlook", Telescope), I("/reports", "Reports", FileBarChart), I("/audit/access", "Who saw whom", Eye)] },
    { group: "Data", items: [I("/data/growth", "Job market data", Sparkles), I("/data", "Data checks", Database), I("/audit", "Audit log", FileClock)] },
  ];
}

/** Bottom tab bar on phones: the four places each role uses most, plus "More" for the full menu. */
function tabsFor(s: Session): Item[] {
  const r = s.user.role;
  if (r === "platform_admin") return [I("/dashboard", "Home", LayoutDashboard), I("/platform", "Orgs", Building2), I("/skills", "Skills", BookOpen), I("/data/framework", "Upload", FileSpreadsheet)];
  if (r === "employee") return [I("/dashboard", "Home", LayoutDashboard), I("/me", "Profile", User), I("/learning", "Learn", Lightbulb), I("/jobs", "Jobs", BriefcaseBusiness)];
  if (r === "manager") return [I("/dashboard", "Home", LayoutDashboard), I("/team", "Team", Users), I("/requests", "Requests", TrendingUp), I("/me", "Me", User)];
  if (r === "expert") return [I("/dashboard", "Home", LayoutDashboard), I("/assessments", "Reviews", ClipboardCheck), I("/evolution", "Evolution", TrendingUp), I("/roles", "Roles", Briefcase)];
  return [I("/dashboard", "Home", LayoutDashboard), I("/employees", "People", Users), I("/jobs/manage", "Jobs", BriefcaseBusiness), I(r === "hr_admin" ? "/reports" : "/succession", r === "hr_admin" ? "Reports" : "Succession", r === "hr_admin" ? FileBarChart : Crown)];
}

/** Top menu: a role with one group (employees, experts) gets its pages straight in the bar; others get a drop-down per group. */
function menuGroups(groups: { group: string; items: Item[] }[]) {
  const all = groups.flatMap(g => g.items);
  const home = all.filter(i => i.href === "/dashboard");
  const rest = groups.map(g => ({ ...g, items: g.items.filter(i => i.href !== "/dashboard") })).filter(g => g.items.length);
  // few pages: show them all in the bar; otherwise Home plus one drop-down per group
  if (all.length <= 10 || rest.length === 1) return [{ group: "All", items: [...home, ...rest.flatMap(g => g.items)], flat: true }];
  return [{ group: "Home", items: home, flat: true }, ...rest.map(g => ({ ...g, flat: false }))];
}

const isActive = (path: string, href: string, all: string[]) => {
  if (path === href) return true;
  if (href === "/dashboard" || href === "/me" || href === "/data") return false;
  if (!path.startsWith(href + "/")) return false;
  return !all.some(o => o !== href && o.startsWith(href + "/") && (path === o || path.startsWith(o + "/")));
};

type Theme = "auto" | "light" | "dark";
function useTheme(): [Theme, () => void] {
  const [t, setT] = useState<Theme>("auto");
  useEffect(() => { const v = (localStorage.getItem("theme") as Theme) || "light"; setT(v); }, []);
  useEffect(() => { const el = document.documentElement; if (t === "auto") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", t); }, [t]);
  return [t, () => { const n: Theme = t === "light" ? "dark" : t === "dark" ? "auto" : "light"; localStorage.setItem("theme", n); setT(n); }];
}

/** Ctrl/⌘ K: jump to any page, or search everything. */
function CommandPalette({ items, open, onClose, canSearch }: { items: Item[]; open: boolean; onClose: () => void; canSearch: boolean }) {
  const router = useRouter(); const [q, setQ] = useState(""); const [i, setI] = useState(0); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const list = useMemo(() => {
    const f = items.filter(x => x.label.toLowerCase().includes(q.toLowerCase().trim()));
    return q.trim() && canSearch ? [...f, { href: `/search?q=${encodeURIComponent(q.trim())}`, label: `Search for “${q.trim()}”`, icon: Search }] : f;
  }, [items, q, canSearch]);
  if (!open) return null;
  const go = (x?: Item) => { if (!x) return; onClose(); router.push(x.href); };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-gray-900/50 px-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="anim-in w-full max-w-xl overflow-hidden rounded-lg border border-line bg-card shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Search className="h-5 w-5 text-accent" />
          <input ref={input} value={q} onChange={e => { setQ(e.target.value); setI(0); }} placeholder={canSearch ? "Go to a page, or search roles, skills, people…" : "Go to a page…"}
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(list.length - 1, i + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(0, i - 1)); } if (e.key === "Enter") go(list[i]); if (e.key === "Escape") onClose(); }}
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3" aria-label="Command" />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
          {list.map((x, n) => { const Ic = x.icon; return (
            <li key={x.href + n}><button onMouseEnter={() => setI(n)} onClick={() => go(x)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px]", n === i ? "bg-sunken text-accent" : "text-ink-2")}>
              <Ic className="h-4 w-4" /><span className="flex-1 font-medium">{x.label}</span>{n === i && <CornerDownLeft className="h-3.5 w-3.5" />}</button></li>); })}
          {!list.length && <li className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing matches</li>}
        </ul>
      </div>
    </div>
  );
}

function Shell({ s, children }: { s: Session; children: React.ReactNode }) {
  const path = usePathname(); const router = useRouter();
  const [open, setOpen] = useState(false); const [menu, setMenu] = useState(false); const [palette, setPalette] = useState(false);
  const [drop, setDrop] = useState<string | null>(null); const [scrolled, setScrolled] = useState(false);
  const barRef = useRef<HTMLDivElement>(null); const hoverT = useRef<any>(null); const hoveredAt = useRef(0);
  const [theme, cycleTheme] = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = nav(s); const all = groups.flatMap(g => g.items.map(i => i.href));
  const extra: Item[] = [I("/account", "Account & security", KeyRound)];
  const logout = async () => { await api("POST", "/auth/logout"); router.push("/login"); };
  useEffect(() => { setOpen(false); setMenu(false); setDrop(null); }, [path]);
  useEffect(() => { const f = () => setScrolled(window.scrollY > 4); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  useEffect(() => { const f = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setDrop(null); }; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setDrop(null); };
    document.addEventListener("mousedown", f); window.addEventListener("keydown", k); return () => { document.removeEventListener("mousedown", f); window.removeEventListener("keydown", k); }; }, []);
  useEffect(() => { const f = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  useEffect(() => { const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(p => !p); } }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const canSearch = s.user.role !== "employee";
  return (
    <div className="min-h-full">
      <header className={cx("fixed inset-x-0 top-0 z-40 border-b border-white/60 bg-card/80 backdrop-blur-xl transition-shadow dark:border-line", scrolled && "shadow-[0_6px_20px_-10px_rgb(28_52_120/.25)]")}>
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-3 lg:px-6">
          <button onClick={() => setOpen(!open)} className="rounded-lg p-2 text-ink-2 hover:bg-sunken lg:hidden" aria-label="Toggle navigation">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 lg:mr-4"><Logo size={32} /><Wordmark className="hidden text-[20px] text-ink sm:inline" /></Link>
          <button onClick={() => setPalette(true)} className="hidden h-10 w-full max-w-md items-center gap-2 rounded-lg border border-[rgb(209_213_219)] bg-side-2 px-3 text-left text-[14px] text-ink-3 hover:border-accent/60 dark:border-[rgb(75_85_99)] md:flex">
            <Search className="h-4 w-4" /><span className="flex-1">{canSearch ? "Search roles, skills, people…" : "Find a page…"}</span><kbd className="rounded border border-line bg-card px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {s.organisation && <span className="mr-2 hidden rounded-md bg-sunken px-2.5 py-1 text-[12.5px] font-medium text-ink-2 xl:inline">{s.organisation.name}</span>}
            <button onClick={() => setPalette(true)} className="rounded-lg p-2 text-ink-3 hover:bg-sunken hover:text-ink md:hidden" aria-label="Search"><Search className="h-5 w-5" /></button>
            <button onClick={cycleTheme} className="rounded-lg p-2 text-ink-3 hover:bg-sunken hover:text-ink" title={`Theme: ${theme}`} aria-label={`Theme: ${theme}`}><ThemeIcon className="h-5 w-5" /></button>
            <div ref={menuRef} className="relative ml-1">
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-full focus:ring-4 focus:ring-sunken" aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu"><Avatar name={s.user.name} size={34} /></button>
              {menu && (
                <div role="menu" className="anim-in absolute right-0 top-12 w-60 divide-y divide-line rounded-lg border border-line bg-card shadow-pop">
                  <div className="px-4 py-3"><div className="text-[14px] font-semibold text-ink">{s.user.name}</div><div className="truncate text-[13px] text-ink-3">{s.user.email}</div><div className="mt-1 text-[12px] text-ink-3">{s.role_label}</div></div>
                  <div className="py-1">
                    {s.user.employee_id && <Link role="menuitem" href="/me" className="flex items-center gap-2.5 px-4 py-2 text-[14px] text-ink-2 hover:bg-sunken"><User className="h-4 w-4" />My profile</Link>}
                    <Link role="menuitem" href="/account" className="flex items-center gap-2.5 px-4 py-2 text-[14px] text-ink-2 hover:bg-sunken"><KeyRound className="h-4 w-4" />Account & security</Link>
                    <button role="menuitem" onClick={cycleTheme} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-ink-2 hover:bg-sunken"><ThemeIcon className="h-4 w-4" />Theme: {theme === "auto" ? "automatic" : theme}</button>
                  </div>
                  <div className="py-1"><button role="menuitem" onClick={logout} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-bad hover:bg-sunken"><LogOut className="h-4 w-4" />Sign out</button></div>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* second row: the main menu, fixed with the header while the page scrolls */}
        <nav ref={barRef} className="hidden lg:block" aria-label="Main">
          <ul className="mx-auto flex h-14 max-w-[1400px] items-center gap-1 px-6 pb-2">
            {menuGroups(groups).map(g => {
              const activeGroup = g.items.some(i => isActive(path, i.href, all));
              if (g.items.length === 1 || g.flat) return g.items.map(i => { const Icon = i.icon; const active = isActive(path, i.href, all); return (
                <li key={i.href} className="flex"><Link href={i.href} aria-current={active ? "page" : undefined} className={cx("flex h-10 items-center gap-2 rounded-xl px-3.5 text-[14px] font-medium transition-colors", active ? "bg-accent text-white shadow-glow" : "text-ink-2 hover:bg-accent-soft hover:text-accent")}><Icon className="h-4 w-4" />{i.label}</Link></li>); });
              const isOpen = drop === g.group;
              return (
                <li key={g.group} className="relative flex" onMouseEnter={() => { clearTimeout(hoverT.current); if (drop !== g.group) hoveredAt.current = Date.now(); setDrop(g.group); }} onMouseLeave={() => { hoverT.current = setTimeout(() => setDrop(d => d === g.group ? null : d), 150); }}>
                  <button onClick={() => setDrop(isOpen && Date.now() - hoveredAt.current > 400 ? null : g.group)} aria-expanded={isOpen} aria-haspopup="menu"
                    className={cx("flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-medium transition-colors", activeGroup ? "bg-accent text-white shadow-glow" : isOpen ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-accent-soft hover:text-accent")}>
                    {g.group}<ChevronDown className={cx("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div role="menu" className="anim-in absolute left-0 top-full z-50 mt-1.5 w-max min-w-[250px] rounded-xl border border-line/70 bg-card p-2 shadow-pop">
                      <div className={cx("grid gap-0.5", g.items.length > 5 && "grid-cols-2")}>
                        {g.items.map(i => { const Icon = i.icon; const active = isActive(path, i.href, all); return (
                          <Link key={i.href} role="menuitem" href={i.href} className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-[14px]", active ? "bg-accent font-medium text-white" : "text-ink hover:bg-accent-soft")}>
                            <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg", active ? "bg-white/20 text-white" : "bg-accent-soft text-accent")}><Icon className="h-4 w-4" /></span>{i.label}</Link>); })}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      {open && <div className="fixed inset-0 z-[35] bg-gray-900/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cx("fixed bottom-0 left-0 top-16 z-40 w-[min(18rem,85vw)] flex-col border-r border-line bg-card lg:hidden", open ? "flex" : "hidden")} aria-label="Menu">
        <nav className="scroll-thin flex-1 divide-y divide-line overflow-y-auto px-3 py-3" aria-label="All pages">
          {groups.map(g => g.items.length > 0 && (
            <div key={g.group} className="py-3 first:pt-1">
              <div className="px-2 pb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">{g.group}</div>
              <ul className="space-y-0.5">{g.items.map(i => {
                const active = isActive(path, i.href, all); const Icon = i.icon;
                return (
                  <li key={i.href}><Link href={i.href} aria-current={active ? "page" : undefined}
                    className={cx("group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] transition-colors", active ? "bg-accent font-medium text-white shadow-glow" : "text-ink hover:bg-accent-soft")}>
                    <Icon className={cx("h-5 w-5 shrink-0", active ? "text-white" : "text-ink-3 group-hover:text-accent")} />{i.label}
                  </Link></li>
                );
              })}</ul>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <Avatar name={s.user.name} size={32} />
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[13.5px] font-semibold text-ink">{s.user.name}</div><div className="truncate text-[12px] text-ink-3">{s.role_label}</div></div>
        </div>
      </aside>
      <div className="pt-16 lg:pt-[120px]">
        <main key={path} className="anim-in mx-auto w-full max-w-[1400px] px-4 pb-24 pt-5 sm:pt-6 lg:px-6 lg:pb-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick">
        {tabsFor(s).map(t => { const active = isActive(path, t.href, all) || path === t.href; const Icon = t.icon; return (
          <Link key={t.href} href={t.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-accent" : "text-ink-3")}><Icon className="h-5 w-5" />{t.label}</Link>); })}
        <button onClick={() => setOpen(!open)} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", open ? "text-accent" : "text-ink-3")}><Menu className="h-5 w-5" />More</button>
      </nav>
      <CommandPalette items={[...groups.flatMap(g => g.items), ...extra]} open={palette} onClose={() => setPalette(false)} canSearch={canSearch} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><ConfirmProvider><SessionProvider>{s => s.user.must_change_password ? <ForcePasswordChange s={s} /> : <Shell s={s}>{children}</Shell>}</SessionProvider></ConfirmProvider></ToastProvider>;
}
