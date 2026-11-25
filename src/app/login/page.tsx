"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, Button, ErrorBox, cx } from "@/components/ui";
import { Logo, Wordmark } from "@/components/brand";

const ROLE: Record<string, string> = { platform_admin: "Platform admin", hr_admin: "HR admin", dept_head: "Department head", manager: "Manager", employee: "Employee", expert: "Expert reviewer" };

/** Orbiting skill nodes around a glowing core. */
function Constellation() {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0; const start = performance.now();
    const tick = (now: number) => { setT((now - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, []);
  const rings = [{ r: 72, speed: 0.12, labels: ["SQL", "Python", "Leadership", "Cloud", "Design"] }, { r: 122, speed: -0.07, labels: ["Power BI", "Kubernetes", "Negotiation", "Risk", "Java", "Agile", "ML"] }, { r: 172, speed: 0.045, labels: [".NET", "Excel", "Security", "Product", "Data", "React"] }];
  return (
    <svg viewBox="-215 -215 430 430" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="core"><stop offset="0%" stopColor="#fff" /><stop offset="35%" stopColor="#C4B5FD" /><stop offset="100%" stopColor="#7C2FF7" stopOpacity="0" /></radialGradient>
        <linearGradient id="node" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#A78BFA" /></linearGradient>
      </defs>
      <circle r={58 + Math.sin(t * 1.5) * 4} fill="url(#core)" opacity=".6" />
      {rings.map((g, k) => <circle key={k} r={g.r} fill="none" stroke="#fff" strokeOpacity=".13" strokeDasharray="2 6" />)}
      {rings.map((g, k) => g.labels.map((l, i) => {
        const a = (i / g.labels.length) * Math.PI * 2 + k + t * g.speed; const x = Math.cos(a) * g.r, y = Math.sin(a) * g.r;
        return (
          <g key={l}>
            <line x1={x * 0.55} y1={y * 0.55} x2={x} y2={y} stroke="#fff" strokeOpacity=".1" />
            <circle cx={x} cy={y} r={k === 0 ? 5.5 : 4.2} fill="url(#node)" />
            <circle cx={x} cy={y} r={k === 0 ? 11 : 9} fill="#ffffff" opacity={0.12 + 0.1 * Math.sin(t * 2 + i)} />
            <text x={x} y={y - 12} textAnchor="middle" fontSize="10.5" fill="#fff" fillOpacity=".8" fontWeight="600">{l}</text>
          </g>);
      }))}
    </svg>
  );
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [show, setShow] = useState(false);
  const [err, setErr] = useState<{ message: string } | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<any[]>([]); const [org, setOrg] = useState<string>("");
  useEffect(() => { api("GET", "/auth/demo-accounts").then(r => { if (r.ok && Array.isArray(r.data)) { setDemo(r.data); setOrg(r.data.find((d: any) => d.organisation)?.organisation || ""); } }); }, []);
  const submit = async (e?: React.FormEvent, em = email, pw = password) => {
    e?.preventDefault(); setBusy(em); setErr(null);
    const r = await api("POST", "/auth/login", { email: em.trim(), password: pw });
    if (r.ok) router.push("/dashboard"); else { setBusy(null); setErr(r.error!); }
  };
  const orgs = [...new Set(demo.map(d => d.organisation).filter(Boolean))] as string[];
  const platform = demo.filter(d => !d.organisation);
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#1B1F30] text-white lg:flex lg:flex-col">
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#6D28D9]/45 blur-[120px]" />
        <div className="absolute inset-0 opacity-[.12] [background-image:radial-gradient(#A78BFA_1px,transparent_1.4px)] [background-size:26px_26px]" />
        <div className="absolute -bottom-40 -right-20 h-[460px] w-[460px] rounded-full bg-[#0D9488]/30 blur-[120px]" />
        
        <div className="relative flex items-center gap-3 p-10"><span className="rounded-xl bg-white p-1.5"><Logo size={34} /></span><span className="text-[26px] font-semibold tracking-[-.02em] text-[#8DB8FF]">skillprint</span></div>
        <div className="relative mx-auto flex w-full max-w-[520px] flex-1 items-center px-10"><Constellation /></div>
        <div className="relative p-10 pt-0">
          <h2 className="max-w-[18ch] text-[40px] font-extrabold leading-[1.05] tracking-[-.03em]">Know every skill.<br /><span className="bg-gradient-to-r from-[#B794FF] to-[#5EEAD4] bg-clip-text text-transparent">Grow every career.</span></h2>
          <div className="mt-6 flex flex-wrap gap-2 text-[12.5px] font-medium text-white/70">{["Skill frameworks", "Gap & learning", "Internal jobs", "Career moves", "Workforce planning"].map(x => <span key={x} className="rounded-full border border-white/25 bg-white/10 px-3 py-1">{x}</span>)}</div>
        </div>
      </aside>

      <main className="flex flex-col justify-center bg-paper px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><Logo size={36} /><Wordmark className="text-[24px]" /></div>
          <h1 className="text-[28px] font-bold">Sign in to Skillprint</h1>
          <p className="mt-1 text-[14px] text-ink-3">Sign in to your organisation's workspace.</p>
          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-semibold text-ink-2">Work email</span>
              <span className="relative"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input className="inp h-12 pl-10 text-[14.5px]" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} /></span></label>
            <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-semibold text-ink-2">Password</span>
              <span className="relative"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input className="inp h-12 pl-10 pr-11 text-[14.5px]" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-3 hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            <ErrorBox error={err} />
            <Button variant="primary" size="lg" className="h-12" loading={busy === email && !!email} type="submit">Sign in <ArrowRight className="h-4 w-4" /></Button>
            <p className="flex items-center justify-center gap-1.5 text-[12px] text-ink-3"><ShieldCheck className="h-3.5 w-3.5 text-good" />Each organisation's data is kept separate. Forgot your password? Ask your HR administrator.</p>
          </form>

          {demo.length > 0 && (
            <div className="mt-10">
              <div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-line" /><span className="text-[11.5px] font-bold uppercase tracking-[.12em] text-ink-3">Demo workspaces</span><span className="h-px flex-1 bg-line" /></div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {[...orgs, ...(platform.length ? [""] : [])].map(o => <button key={o || "platform"} onClick={() => setOrg(o)} className={cx("rounded-full px-3 py-1 text-[12.5px] font-semibold transition-all", org === o ? "bg-accent text-white" : "bg-sunken text-ink-2 hover:text-ink")}>{o || "Platform"}</button>)}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {demo.filter(d => (d.organisation || "") === org).map(d => (
                  <li key={d.email}><button disabled={!!busy} onClick={() => { setEmail(d.email); setPassword("demo1234"); submit(undefined, d.email, "demo1234"); }}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40 disabled:opacity-60">
                    <Avatar name={d.name} size={30} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{ROLE[d.role]}</span><span className="block truncate text-[11.5px] text-ink-3">{d.department || d.name}</span></span>
                    {busy === d.email ? <span className="text-[11px] font-semibold text-accent">…</span> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />}
                  </button></li>
                ))}
              </ul>
              <p className="mt-3 text-center text-[11.5px] text-ink-3">Password <b className="mono">demo1234</b> · sample people are synthetic</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
