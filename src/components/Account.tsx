"use client";
import { useState } from "react";
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { api, useApi } from "@/lib/api";
import type { Session } from "@/components/session";
import { Button, Card, ErrorBox, Field, Pill, ago, cx, useToast } from "@/components/ui";
import { Logo, Wordmark } from "@/components/brand";

/** Strength from length and variety; the server enforces the real rule (10+ characters, a letter and a number). */
export function strength(p: string) {
  let n = 0; if (p.length >= 10) n++; if (p.length >= 14) n++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++; if (/\d/.test(p)) n++; if (/[^A-Za-z0-9]/.test(p)) n++;
  return Math.min(4, n);
}
const LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const COLOR = ["bg-bad", "bg-bad", "bg-warn", "bg-good", "bg-good"];

export function PasswordForm({ onDone, requireNote }: { onDone?: () => void; requireNote?: boolean }) {
  const toast = useToast();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const sc = strength(next); const valid = next.length >= 10 && /[A-Za-z]/.test(next) && /\d/.test(next) && next === again;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (next !== again) return setErr({ message: "The new passwords do not match" });
    setBusy(true); const r = await api("POST", "/auth/password", { current: cur, next }); setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast("Password changed. Other devices were signed out."); setCur(""); setNext(""); setAgain(""); onDone?.();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label={requireNote ? "Temporary password" : "Current password"} htmlFor="pc"><input id="pc" type="password" autoComplete="current-password" className="inp" value={cur} onChange={e => setCur(e.target.value)} required /></Field>
      <Field label="New password" htmlFor="pn" hint="At least 10 characters, with a letter and a number">
        <input id="pn" type="password" autoComplete="new-password" className="inp" value={next} onChange={e => setNext(e.target.value)} required maxLength={200} />
        {next && <div className="mt-1 flex items-center gap-2"><div className="flex flex-1 gap-1">{[0, 1, 2, 3].map(i => <i key={i} className={cx("h-1.5 flex-1 rounded-full", i < sc ? COLOR[sc] : "bg-sunken")} />)}</div><span className="text-[11.5px] font-semibold text-ink-3">{LABEL[sc]}</span></div>}
      </Field>
      <Field label="Repeat new password" htmlFor="pa"><input id="pa" type="password" autoComplete="new-password" className="inp" value={again} onChange={e => setAgain(e.target.value)} required /></Field>
      <ErrorBox error={err} />
      <Button variant="primary" type="submit" loading={busy} disabled={!valid || !cur}>Change password</Button>
    </form>
  );
}

export function SessionsCard() {
  const toast = useToast();
  const s = useApi<any[]>("/auth/sessions");
  const others = (s.data || []).filter(x => !x.current).length;
  const device = (ua: string) => /mobile|android|iphone/i.test(ua || "") ? Smartphone : Monitor;
  const browser = (ua: string) => (ua || "").match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/)?.[1]?.replace("Edg", "Edge") || "Browser";
  const os = (ua: string) => /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return (
    <Card title="Where you're signed in" icon={<ShieldCheck />} actions={others > 0 && <Button size="sm" variant="danger" onClick={async () => { await api("POST", "/auth/sessions/revoke-others"); toast("Signed out everywhere else"); s.reload(); }}><LogOut className="h-3.5 w-3.5" />Sign out other devices</Button>}>
      <ul className="flex flex-col divide-y divide-line-2">
        {(s.data || []).map(x => { const D = device(x.user_agent); return (
          <li key={x.id} className="flex items-center gap-3 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-ink-2"><D className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{browser(x.user_agent)} {os(x.user_agent) && <span className="font-normal text-ink-3">on {os(x.user_agent)}</span>}</div>
              <div className="text-[12px] text-ink-3">{x.ip || "unknown address"} · active {ago(x.last_seen_at)}</div></div>
            {x.current && <Pill tone="Active">This device</Pill>}
          </li>); })}
      </ul>
    </Card>
  );
}

/** Shown instead of the app until a temporary password is replaced. */
export function ForcePasswordChange({ s }: { s: Session }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="anim-in w-full max-w-md rounded-3xl border border-line bg-card p-7 shadow-pop">
        <div className="mb-5 flex items-center gap-2.5"><Logo size={34} /><Wordmark className="text-[20px]" /></div>
        <div className="mb-1 flex items-center gap-2 text-[20px] font-extrabold"><KeyRound className="h-5 w-5 text-accent" />Choose a new password</div>
        <p className="mb-5 text-[13.5px] text-ink-3">Hi {s.user.name.split(" ")[0]}, your password was reset. Set your own to continue.</p>
        <PasswordForm requireNote onDone={() => window.location.reload()} />
        <button className="mt-4 w-full text-center text-[12.5px] text-ink-3 hover:text-ink" onClick={async () => { await api("POST", "/auth/logout"); window.location.href = "/login"; }}>Sign out</button>
      </div>
    </div>
  );
}
