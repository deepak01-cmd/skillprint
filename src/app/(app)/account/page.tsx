"use client";
import { Eye, KeyRound } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Avatar, Card, Empty, PageHeader, Pill, ago } from "@/components/ui";
import { PasswordForm, SessionsCard } from "@/components/Account";

export default function AccountPage() {
  const s = useSession();
  return (
    <>
      <PageHeader title="Account & security" />
      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-card">
        <Avatar name={s.user.name} size={56} />
        <div className="min-w-0"><div className="text-[18px] font-bold">{s.user.name}</div><div className="text-[13px] text-ink-3">{s.user.email}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5"><Pill tone="Mandatory">{s.role_label}</Pill>{s.organisation && <Pill tone="Draft">{s.organisation.name}</Pill>}</div></div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card title="Password" icon={<KeyRound />}><PasswordForm /></Card>
        <SessionsCard />
      </div>
      {s.user.employee_id && <WhoViewed />}
    </>
  );
}

function WhoViewed() {
  const v = useApi<any[]>("/me/access-log");
  const ROLE: Record<string, string> = { hr_admin: "HR", dept_head: "Department head", manager: "Manager", employee: "Colleague", expert: "Expert" };
  return (
    <Card className="mt-5" title="Who opened your data" icon={<Eye />}>
      {(v.data || []).length ? <ul className="divide-y divide-line-2">{(v.data || []).slice(0, 30).map((x, i) => (
        <li key={i} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]"><Avatar name={x.actor_name} size={30} /><span className="font-semibold">{x.actor_name}</span><Pill tone="Draft">{ROLE[x.actor_role] || x.actor_role}</Pill>
          <span className="text-ink-3">viewed your {x.resource}</span><span className="ml-auto text-[12px] text-ink-3">{ago(x.at)}</span></li>))}</ul>
        : <Empty icon={<Eye />}>Nobody has opened your profile yet.</Empty>}
    </Card>
  );
}
