"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface Session {
  user: { id: string; org_id: string | null; email: string; name: string; role: string; department_id: string | null; employee_id: string | null; library_reviewer?: boolean; must_change_password?: boolean };
  role_label: string;
  organisation: { id: string; name: string; industry: string; domain: string } | null;
  permissions: Record<string, string>;
}
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: (s: Session) => ReactNode }) {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => { api<Session>("GET", "/auth/me").then(r => { if (r.ok) setS(r.data); }); }, []);
  if (!s) return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <span className="relative flex h-14 w-14 items-center justify-center"><span className="absolute inset-0 animate-ping rounded-2xl bg-accent/25" /><span className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-accent via-accent-3 to-accent-2" /></span>
      <span className="text-[13px] font-medium text-ink-3">Loading your workspace…</span>
    </div>);
  return <Ctx.Provider value={s}>{children(s)}</Ctx.Provider>;
}
export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("No session");
  return s;
}
export const can = (s: Session, perm: string) => !!s.permissions[perm];
export const scope = (s: Session, perm: string) => s.permissions[perm] || null;
