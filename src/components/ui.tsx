"use client";
/* Shared UI: soft cards, gradient accents, animated figures and charts drawn in plain SVG. */
import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, Loader2, Search, UploadCloud, X, XCircle } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, actions, pad = true, sub, icon, tint }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean; sub?: ReactNode; icon?: ReactNode; tint?: "blue" | "yellow" | "pink" | "green" }) {
  return (
    <section className={cx("anim-in min-w-0 rounded-xl border border-line/70 bg-card shadow-card", tint && `tint-${tint}`, className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-1 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {typeof title === "string" ? <h2 className="flex items-center gap-2.5 text-[16.5px] font-semibold leading-tight text-ink">{icon && <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]", tint === "yellow" ? "bg-warn-soft text-warn" : tint === "pink" ? "bg-bad-soft text-bad" : tint === "green" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>{icon}</span>}{title}</h2> : title}
            {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-4 pt-3 sm:p-6 sm:pt-4" : "pt-3"}>{children}</div>
    </section>
  );
}

export function IconBadge({ children, tone = "acc", size = 32 }: { children: ReactNode; tone?: "acc" | "good" | "warn" | "bad" | "em"; size?: number }) {
  const t = { acc: "bg-accent-soft text-accent", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", em: "bg-em-soft text-em" }[tone];
  return <span className={cx("inline-flex shrink-0 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]", t)} style={{ width: size, height: size }}>{children}</span>;
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="anim-in mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (typeof eyebrow === "string"
          ? <div className="mb-1 text-[13px] font-medium text-ink-3">{eyebrow}</div>
          : <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1.5 text-[13px] text-ink-3 [&_a:hover]:text-accent [&_a]:text-ink-2">{eyebrow}</nav>)}
        <h1 className="text-[22px] font-bold leading-tight text-ink sm:text-[24px]">{title}</h1>
        {sub && <div className="mt-1 max-w-[70ch] text-[14px] text-ink-3">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type BtnVariant = "primary" | "default" | "danger" | "ghost" | "soft";
export function Button({ children, variant = "default", size = "md", className, loading, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: "border-transparent bg-accent text-white shadow-glow hover:bg-accent-600 focus-visible:ring-4 focus-visible:ring-accent/30 dark:text-white",
    default: "border-line bg-card text-ink hover:bg-sunken hover:text-accent",
    danger: "border-transparent bg-bad text-white hover:opacity-90",
    ghost: "border-transparent bg-transparent text-accent hover:bg-accent-soft",
    soft: "border-transparent bg-accent-soft text-accent hover:bg-accent/15",
  };
  const s = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-[14px]", lg: "h-11 px-5 text-[15px]" }[size];
  return <button {...rest} disabled={rest.disabled || loading} className={cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", s, v[variant], className)}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}</button>;
}

/* soft chips: colour carries the meaning */
const T = { good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", acc: "bg-accent-soft text-accent", bad: "bg-bad-soft text-bad", em: "bg-em-soft text-em", ink: "bg-sunken text-ink-2", mute: "bg-sunken text-ink-3" };
const PILL: Record<string, string> = {
  Current: T.good, Emerging: T.em, Declining: T.warn, Archived: T.mute, Growing: T.em, Stable: T.good, "No evidence": T.mute,
  Published: T.good, Approved: T.good, Active: T.good, Reviewed: T.good, Done: T.good, Met: T.good, Committed: T.good, created: T.good, create: T.good, Open: T.good, Hired: T.good,
  Draft: T.ink, "Not started": T.ink, Withdrawn: T.mute, Closed: T.mute, Inactive: T.mute, Discarded: T.mute, skip: T.mute, skipped: T.mute, "On hold": T.warn, Retired: T.mute,
  "In Review": T.warn, Assigned: T.warn, Submitted: T.em, "In progress": T.em, Previewed: T.em, update: T.em, updated: T.em, queue: T.warn, queued: T.warn,
  Applied: T.acc, Screening: T.em, Interview: T.warn, Offered: T.good, "Not selected": T.mute,
  "Changes Requested": T.warn, Rejected: T.bad, Gap: T.bad, error: T.bad, Failed: T.bad,
  High: T.bad, Medium: T.warn, Low: T.good, None: T.mute, Critical: T.bad,
  "No assessment data": T.mute, Suggested: T.em, "In expert review": T.warn, Accepted: T.good, Deferred: T.ink, "Needs review": T.bad,
  Mandatory: T.acc, Preferred: T.em, Optional: T.mute, Developmental: T.mute,
  "Ready now": T.good, "Ready in 6-12 months": T.em, "Ready in 12-24 months": T.warn, "Long-term / stretch": T.mute,
  Free: T.good, Paid: T.warn, "Company paid": T.acc,
};
export function Pill({ children, tone, className }: { children: ReactNode; tone?: string; className?: string }) {
  const key = tone ?? (typeof children === "string" ? children : "");
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-0.5 text-[12px] font-medium leading-[1.5]", PILL[key] || T.ink, className)}>{children}</span>;
}

export const LEVEL_NAMES: Record<number, string> = { 0: "None", 1: "Awareness", 2: "Foundational", 3: "Competent", 4: "Advanced", 5: "Expert" };
/** Five rounded segments, filled up to the level. tone "acc" marks a required level. */
export function Level({ n, muted, short, tone }: { n: number | null | undefined; muted?: boolean; short?: boolean; tone?: "acc" }) {
  if (n === null || n === undefined) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={LEVEL_NAMES[n]}>
      <span className="inline-flex gap-[3px]" aria-hidden>{[1, 2, 3, 4, 5].map(i => <i key={i} className={cx("h-2 w-3.5 rounded-sm", i <= n ? (tone === "acc" ? "bg-accent-3" : muted ? "bg-ink-3/60" : "bg-accent") : "bg-sunken")} />)}</span>
      <span className="num text-[12.5px] font-semibold">{n}{!short && <span className="font-normal text-ink-3"> {LEVEL_NAMES[n]}</span>}</span>
    </span>
  );
}

/** Animated number. */
export function CountUp({ value, duration = 900, suffix = "" }: { value: number; duration?: number; suffix?: string }) {
  const [v, setV] = useState(0); const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / duration); const e = 1 - Math.pow(1 - p, 3); setV(a + (value - a) * e); if (p < 1) raf = requestAnimationFrame(tick); else from.current = value; };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{Math.round(v).toLocaleString()}{suffix}</>;
}

const TILE = ["#7C2FF7", "#14B8A6", "#3B82F6", "#0EA5C7"];
function tileColor(label: string, tone?: string) {
  if (tone === "bad") return "#E62E5A"; if (tone === "warn") return "#F59E0B"; if (tone === "good") return "#14B8A6";
  let h = 0; for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TILE[h % 4];
}
/** Metric tile: label, big figure, a line explaining it. */
export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "bad" | "good"; icon?: ReactNode }) {
  const n = typeof value === "number" ? value : typeof value === "string" && /^[\d,]+$/.test(value) ? Number(value.replace(/,/g, "")) : null;
  return (
    <div className="anim-in rounded-xl border border-line/70 bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink-3">{label}</div>
          <div className={cx("num mt-1 text-[26px] font-semibold leading-tight text-ink", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-good")}>{n !== null ? <CountUp value={n} /> : value}</div>
        </div>
        {icon && <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm [&>svg]:h-[22px] [&>svg]:w-[22px]" style={{ background: tileColor(label, tone) }}>{icon}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ink-2">{label}</label>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-ink-3">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-3 [&>svg]:h-5 [&>svg]:w-5">{icon ?? <Inbox />}</span>
      <div className="max-w-md text-[14px]">{children}</div>
      {action}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) { return <div className={cx("skeleton", className || "h-4 w-full")} />; }
export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cx("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />)}</div>;
}
export function ErrorBox({ error }: { error: { status?: number; message: string } | null | undefined }) {
  if (!error) return null;
  return <div role="alert" className="anim-in flex items-start gap-2 rounded-lg bg-bad-soft px-4 py-3 text-[14px] text-ink"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /><span>{error.message}</span></div>;
}
export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "bad" | "muted" | "good" }) {
  const t = { info: ["bg-em-soft", <Info key="i" className="mt-0.5 h-4 w-4 shrink-0 text-em" />], warn: ["bg-warn-soft", <AlertTriangle key="w" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />],
    bad: ["bg-bad-soft", <XCircle key="b" className="mt-0.5 h-4 w-4 shrink-0 text-bad" />], muted: ["bg-sunken text-ink-2", <Info key="m" className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />],
    good: ["bg-good-soft", <CheckCircle2 key="g" className="mt-0.5 h-4 w-4 shrink-0 text-good" />] }[tone] as [string, ReactNode];
  return <div className={cx("flex items-start gap-2 rounded-lg px-4 py-3 text-[14px]", t[0])}>{t[1]}<div className="min-w-0">{children}</div></div>;
}

export function Modal({ open, onClose, title, children, footer, wide, xl }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; xl?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([aria-label=Close])")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // rendered at the top of the page so no parent layer can cover it
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/50 dark:bg-gray-900/80 sm:items-start sm:overflow-auto sm:px-4 sm:py-12" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx("sheet-in flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-card shadow-pop sm:max-h-none sm:rounded-lg", xl ? "sm:max-w-6xl" : wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 rounded-t-lg border-b border-line px-5 py-4">
          <h2 className="text-[18px] font-semibold leading-tight">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-sunken hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-lg sm:pb-4 [&>button]:flex-1 sm:[&>button]:flex-none">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: ReactNode; count?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="scroll-thin mb-5 flex max-w-full gap-1 overflow-x-auto border-b border-line">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-[14px] font-medium transition-colors", value === t.id ? "border-accent text-accent" : "border-transparent text-ink-3 hover:border-line hover:text-ink")}>
          {t.label}{t.count !== undefined && <span className={cx("num rounded-full px-2 py-px text-[11.5px]", value === t.id ? "bg-accent-soft text-accent" : "bg-sunken text-ink-3")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* confirm: a styled pop-up instead of the browser's confirm box. const ok = await confirm({ title, message, danger }) */
type ConfirmOpts = { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setSt({ ...o, resolve })), []);
  const done = (v: boolean) => { st?.resolve(v); setSt(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!st} onClose={() => done(false)} title={st?.title || ""} footer={<><Button onClick={() => done(false)}>Cancel</Button><Button variant={st?.danger ? "danger" : "primary"} onClick={() => done(true)}>{st?.confirmLabel || "Confirm"}</Button></>}>
        <div className="flex items-start gap-3">
          <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", st?.danger ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent")}>{st?.danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}</span>
          <div className="pt-2 text-[14px] text-ink-2">{st?.message}</div>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* toast */
const ToastCtx = createContext<(msg: string, tone?: "ok" | "bad") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: "ok" | "bad" } | null>(null);
  const timer = useRef<any>(null);
  const show = useCallback((msg: string, tone: "ok" | "bad" = "ok") => { setT({ msg, tone }); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), 4000); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className={cx("fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-2.5 rounded-lg border border-line bg-card px-4 py-3 text-[14px] text-ink shadow-pop transition-all", t ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0")}>
        {t?.tone === "bad" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />}{t?.msg}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "bad" | "warn" | "good" | "ink" }) {
  const c = { accent: "bg-accent", ink: "bg-ink-2", bad: "bg-bad", warn: "bg-warn", good: "bg-good" }[tone];
  return <div className="h-2.5 w-full overflow-hidden rounded-full bg-sunken"><div className={cx("grow-x h-full rounded-full transition-[width] duration-700", c)} style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>;
}

export const pct = (x: number | null | undefined) => x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
export const fmtDate = (d: string | null | undefined) => d ? String(d).slice(0, 10) : "—";
export const fmtNum = (n: number | null | undefined) => n === null || n === undefined ? "—" : Number(n).toLocaleString();
export const ago = (d: string | null | undefined) => {
  if (!d) return "—"; const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400); return days < 30 ? `${days} d ago` : fmtDate(d);
};

/* ---------- avatars: initials on a soft colour picked from the name ---------- */
const AV = ["bg-blue-100 text-blue-800", "bg-green-100 text-green-800", "bg-purple-100 text-purple-800", "bg-yellow-100 text-yellow-800", "bg-pink-100 text-pink-800", "bg-indigo-100 text-indigo-800", "bg-teal-100 text-teal-800"];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const ini = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  let h = 0; for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", AV[h % AV.length])} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>{ini}</span>;
}

/* ---------- search + pagination ---------- */
export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <input className="inp pl-9" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}
export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <div className="px-5 py-3 text-xs text-ink-3">{fmtNum(total)} {total === 1 ? "record" : "records"}</div> : null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3 text-[13px]">
      <span className="num text-ink-3">{fmtNum((page - 1) * size + 1)}–{fmtNum(Math.min(total, page * size))} of {fmtNum(total)}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <span className="num px-2 text-ink-3">{page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
/** Client-side paging for lists already in memory. */
export function usePaged<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length]);
  return { page, setPage, size, total: rows.length, items: rows.slice((page - 1) * size, page * size) };
}

/* ---------- charts (plain SVG and HTML): every chart has a legend, value labels and a hover tooltip ---------- */
export const CHART = ["#7C2FF7", "#14B8A6", "#3B82F6", "#F59E0B", "#E62E5A", "#0EA5C7", "#9CA3AF"];
export const TREND_COLORS: Record<string, string> = { Current: "#14B8A6", Emerging: "#7C2FF7", Declining: "#F59E0B", Archived: "#9CA3AF" };
const share = (v: number, t: number) => t ? Math.round(v / t * 1000) / 10 : 0;

/** Small floating tooltip that follows the pointer inside its parent (parent must be relative). */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const on = (body: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).closest("[data-chart]")!.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body }); },
    onMouseLeave: () => setTip(null),
  });
  const el = tip && <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] shadow-pop" style={{ left: tip.x, top: tip.y }}>{tip.body}</div>;
  return { on, el };
}
const TipRow = ({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) =>
  <div className="flex items-center gap-2">{color && <i className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}<span className="text-ink-3">{label}</span><b className="num ml-auto pl-3 font-semibold text-ink">{value}</b></div>;

export function Legend({ items, className }: { items: { label: string; color: string; value?: ReactNode }[]; className?: string }) {
  return <ul className={cx("flex flex-wrap gap-x-4 gap-y-1 text-[13px]", className)}>{items.map(i => <li key={i.label} className="inline-flex items-center gap-1.5 text-ink-2"><i className="h-3 w-3 rounded-sm" style={{ background: i.color }} />{i.label}{i.value !== undefined && <b className="num font-semibold text-ink">{i.value}</b>}</li>)}</ul>;
}

/** Progress ring: one colour, the figure in the middle and what it means underneath. */
export function Ring({ value, size = 120, stroke = 10, label, sub, tone, track }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" | "acc"; track?: string }) {
  const r = (100 - stroke) / 2; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, value || 0));
  const color = tone === "good" ? "rgb(var(--good))" : tone === "warn" ? "rgb(var(--warn))" : tone === "bad" ? "rgb(var(--bad))" : "rgb(var(--accent))";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${Math.round(v)}%`}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${Math.round(v)}%`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke={track && !track.includes("255 255 255") ? track : "rgb(var(--sunken))"} strokeWidth={stroke} />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)"
          style={{ ["--len" as any]: c, animation: "draw 1s cubic-bezier(.2,.7,.2,1) both" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num font-bold leading-none text-ink" style={{ fontSize: Math.max(11, size * 0.21) }}>{label ?? <CountUp value={Math.round(v)} suffix="%" />}</span>
        {sub && <span className="mt-1 px-1 text-[11px] font-medium leading-tight text-ink-3">{sub}</span>}
      </div>
    </div>
  );
}

/** Radar: current level (filled) against the required level (dashed), rings labelled 1–5, with a legend. */
export function Radar({ axes, size = 320 }: { axes: { label: string; current: number | null; required: number }[]; size?: number }) {
  const t = useTip();
  const n = axes.length; if (n < 3) return null;
  const R = 34;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [50 + Math.cos(a) * R * (v / 5), 50 + Math.sin(a) * R * (v / 5)]; };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <div className="relative" data-chart style={{ maxWidth: size }}>
      <svg viewBox="-26 -4 152 108" width="100%" style={{ overflow: "visible" }} role="img" aria-label="Skill levels: current against required">
        {[1, 2, 3, 4, 5].map(l => <polygon key={l} points={poly(axes.map(() => l))} fill="none" stroke="rgb(var(--line))" strokeWidth=".35" />)}
        {[1, 2, 3, 4, 5].map(l => <text key={l} x={50.8} y={50 - R * l / 5 + 1} fontSize="2.4" fill="rgb(var(--ink-3))">{l}</text>)}
        {axes.map((_, i) => { const [x, y] = pt(i, 5); return <line key={i} x1={50} y1={50} x2={x} y2={y} stroke="rgb(var(--line))" strokeWidth=".35" />; })}
        <polygon points={poly(axes.map(a => a.required))} fill="rgb(255 138 76 / .08)" stroke="#FF8A4C" strokeWidth=".8" strokeDasharray="1.6 1.2" />
        <polygon points={poly(axes.map(a => a.current ?? 0))} fill="rgb(var(--accent) / .2)" stroke="rgb(var(--accent))" strokeWidth=".9" />
        {axes.map((a, i) => { const [x, y] = pt(i, a.current ?? 0); return <circle key={i} cx={x} cy={y} r="1.6" fill="#7C2FF7" {...t.on(<><div className="mb-1 font-semibold">{a.label}</div><TipRow color="#7C2FF7" label="Current" value={a.current ?? "not assessed"} /><TipRow color="#FF8A4C" label="Required" value={a.required} /></>)} style={{ cursor: "pointer" }} />; })}
        {axes.map((a, i) => { const [x, y] = pt(i, 6.2); const anchor = Math.abs(x - 50) < 4 ? "middle" : x > 50 ? "start" : "end";
          return <text key={i} x={x} y={y} fontSize="3.1" fill="rgb(var(--ink-2))" textAnchor={anchor} dominantBaseline="middle" fontWeight="500">{a.label.length > 20 ? a.label.slice(0, 19) + "…" : a.label}</text>; })}
      </svg>
      {t.el}
      <Legend className="mt-1 justify-center" items={[{ label: "Current level", color: "#7C2FF7" }, { label: "Required level", color: "#FF8A4C" }]} />
    </div>
  );
}

export function Sparkline({ data, width = 120, height = 36 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><path d={`${d} L${width},${height} L0,${height} Z`} fill="rgb(var(--accent) / .12)" /><path d={d} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" /></svg>;
}

/** Donut with a legend that gives each part's count and share; hover a slice for details. */
export function Donut({ data, size = 160, label, sub }: { data: { label: string; value: number; color?: string }[]; size?: number; label?: ReactNode; sub?: ReactNode }) {
  const t = useTip(); const [hi, setHi] = useState<string | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0); const r = 40, c = 2 * Math.PI * r; let off = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:flex-wrap">
      <div className="relative shrink-0" data-chart style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={data.map(d => `${d.label} ${d.value}`).join(", ")}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--sunken))" strokeWidth="14" />
          {total > 0 && data.map((d, i) => { const len = (d.value / total) * c; const col = d.color || CHART[i % CHART.length];
            const el = len > 0 && <circle key={d.label} cx="50" cy="50" r={r} fill="none" stroke={col} strokeWidth={hi === d.label ? 17 : 14} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 50 50)"
              onMouseEnter={() => setHi(d.label)} {...t.on(<TipRow color={col} label={d.label} value={`${fmtNum(d.value)} · ${share(d.value, total)}%`} />)} onMouseOut={() => setHi(null)} style={{ transition: "stroke-width .15s", cursor: "pointer" }} />;
            off += len; return el; })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="num text-[24px] font-bold text-ink">{label ?? <CountUp value={total} />}</span>{sub && <span className="text-[12px] text-ink-3">{sub}</span>}</div>
        {t.el}
      </div>
      <ul className="flex w-full min-w-[170px] flex-1 flex-col gap-2 text-[13.5px]">
        {data.map((d, i) => <li key={d.label} className={cx("flex items-center gap-2 rounded-md px-1.5 py-0.5", hi === d.label && "bg-sunken")}><i className="h-3 w-3 rounded-sm" style={{ background: d.color || CHART[i % CHART.length] }} /><span className="text-ink-2">{d.label}</span>
          <span className="num ml-auto pl-3 font-semibold text-ink">{fmtNum(d.value)}</span><span className="num w-12 text-right text-ink-3">{share(d.value, total)}%</span></li>)}
      </ul>
    </div>
  );
}

/** Horizontal bars with the value on each bar and an optional caption saying what the numbers count. */
export function HBars({ data, max, tone = "accent", unit, caption }: { data: { label: ReactNode; value: number; sub?: ReactNode; key?: string }[]; max?: number; tone?: "accent" | "bad" | "warn" | "good"; unit?: string; caption?: ReactNode }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value));
  return (
    <div>
      <ul className="flex flex-col gap-3">
        {data.map((d, i) => (
          <li key={d.key ?? i} className="text-[14px]">
            <div className="mb-1 flex items-baseline justify-between gap-3"><span className="truncate text-ink-2">{d.label}</span><span className="num shrink-0 font-semibold text-ink">{fmtNum(d.value)}{unit}{d.sub && <span className="ml-1 font-normal text-ink-3">{d.sub}</span>}</span></div>
            <Bar value={d.value} max={m} tone={tone} />
          </li>
        ))}
      </ul>
      {caption && <p className="mt-3 border-t border-line pt-2 text-[12.5px] text-ink-3">{caption}</p>}
    </div>
  );
}

/** One stacked bar: each part labelled with its share inside the bar, and a legend with counts and shares. */
export function StackBar({ parts, unit = "" }: { parts: { label: string; value: number; color: string }[]; unit?: string }) {
  const t = useTip(); const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="relative" data-chart>
      <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md bg-sunken">{parts.map(p => p.value > 0 && (
        <div key={p.label} className="grow-x flex items-center justify-center text-[11.5px] font-semibold text-white" style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          {...t.on(<TipRow color={p.color} label={p.label} value={`${fmtNum(p.value)}${unit} · ${share(p.value, total)}%`} />)}>{p.value / total >= 0.08 ? `${Math.round(p.value / total * 100)}%` : ""}</div>))}</div>
      {t.el}
      <Legend className="mt-3" items={parts.map(p => ({ label: p.label, color: p.color, value: `${fmtNum(p.value)} (${share(p.value, total)}%)` }))} />
    </div>
  );
}

/** Several stacked bars, one per row, all to 100%: shares inside the segments, totals on the right, one legend. */
export function StackedRows({ rows, series, unit = "" }: { rows: { label: ReactNode; key: string; values: Record<string, number> }[]; series: { key: string; label: string; color: string }[]; unit?: string }) {
  const t = useTip();
  return (
    <div className="relative" data-chart>
      <Legend className="mb-3" items={series.map(s => ({ label: s.label, color: s.color }))} />
      <ul className="flex flex-col gap-2.5">
        {rows.map(r => { const total = series.reduce((a, s) => a + (r.values[s.key] || 0), 0); return (
          <li key={r.key} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-3 text-[13.5px]">
            <span className="truncate text-ink-2">{r.label}</span>
            <div className="flex h-6 gap-[2px] overflow-hidden rounded-md bg-sunken">
              {series.map(s => { const v = r.values[s.key] || 0; return v > 0 && (
                <div key={s.key} className="grow-x flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${(v / (total || 1)) * 100}%`, background: s.color }}
                  {...t.on(<><div className="mb-1 font-semibold">{r.label}</div><TipRow color={s.color} label={s.label} value={`${fmtNum(v)}${unit} · ${share(v, total)}%`} /></>)}>{v / (total || 1) >= 0.12 ? `${Math.round(v / total * 100)}%` : ""}</div>); })}
            </div>
            <span className="num w-14 text-right font-semibold text-ink">{fmtNum(total)}</span>
          </li>); })}
      </ul>
      {t.el}
    </div>
  );
}

/** Vertical columns with a value axis, gridlines and the value on top of each column. */
export function Columns({ data, height = 200, color = CHART[0], caption }: { data: { label: string; value: number; color?: string }[]; height?: number; color?: string; caption?: ReactNode }) {
  const t = useTip();
  const max = Math.max(1, ...data.map(d => d.value)); const step = Math.max(1, Math.ceil(max / 4)); const top = step * 4;
  return (
    <div className="relative" data-chart>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between pb-6 text-right text-[11px] text-ink-3" style={{ height }}>{[4, 3, 2, 1, 0].map(k => <span key={k} className="num leading-none">{k * step}</span>)}</div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: height - 24 }}>{[0, 1, 2, 3, 4].map(k => <div key={k} className="border-t border-dashed border-line" />)}</div>
          <div className="relative flex items-end gap-2" style={{ height: height - 24 }}>
            {data.map(d => <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end" {...t.on(<TipRow color={d.color || color} label={d.label} value={fmtNum(d.value)} />)}>
              <span className="num mb-1 text-[11.5px] font-semibold text-ink">{d.value}</span>
              <div className="w-full max-w-[44px] rounded-t-md" style={{ height: `${(d.value / top) * 100}%`, background: d.color || color, minHeight: d.value ? 3 : 0 }} /></div>)}
          </div>
          <div className="flex gap-2 pt-1.5">{data.map(d => <span key={d.label} className="flex-1 truncate text-center text-[11.5px] text-ink-3" title={d.label}>{d.label}</span>)}</div>
        </div>
      </div>
      {t.el}
      {caption && <p className="mt-2 text-[12.5px] text-ink-3">{caption}</p>}
    </div>
  );
}

/* ---------- file drop zone ---------- */
export function DropZone({ onFile, accept = ".csv,.xlsx", hint, file }: { onFile: (f: File) => void; accept?: string; hint?: ReactNode; file?: File | null }) {
  const [over, setOver] = useState(false); const input = useRef<HTMLInputElement>(null);
  return (
    <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      className={cx("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors", over ? "border-accent bg-accent-soft" : "border-line bg-side-2 hover:bg-sunken")}>
      <IconBadge size={40}><UploadCloud /></IconBadge>
      {file ? <div className="text-[13.5px]"><b className="font-semibold">{file.name}</b> <span className="text-ink-3">· {(file.size / 1024).toFixed(0)} KB · click to change</span></div>
        : <div className="text-[13.5px]"><b className="font-semibold text-accent">Choose a file</b> or drag it here</div>}
      <div className="text-xs text-ink-3">{hint ?? "CSV or Excel (.xlsx), up to 25 MB"}</div>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

/** Gradient banner for the top of a key page. */
export function Hero({ children, art, className }: { children: ReactNode; art?: ReactNode; className?: string }) {
  return (
    <section className={cx("hero anim-in mb-5 p-5 sm:p-6", className)}>
      <div className="relative z-[1] flex flex-wrap items-center justify-between gap-6">{children}{art && <div className="mx-auto sm:mx-0">{art}</div>}</div>
    </section>
  );
}
