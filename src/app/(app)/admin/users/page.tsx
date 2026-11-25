"use client";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Lock, ShieldCheck, Unlock, UserCog, UserX, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Avatar, Button, Card, Empty, Loading, Modal, PageHeader, Pagination, Pill, SearchInput, Stat, ago, useConfirm, usePaged, useToast } from "@/components/ui";

const ROLES: Record<string, string> = { hr_admin: "HR admin", dept_head: "Department head", manager: "Manager", employee: "Employee", expert: "Expert reviewer" };
function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

export default function UsersPage() {
  const s = useSession(); const toast = useToast(); const confirm = useConfirm();
  const [q, setQ] = useState(""); const dq = useDebounced(q);
  const users = useApi<any[]>(`/users?q=${encodeURIComponent(dq)}`);
  const paged = usePaged(users.data || [], 25);
  const [temp, setTemp] = useState<{ email: string; temporary_password: string } | null>(null);
  if (s.user.role !== "hr_admin") return <Empty icon={<Lock />}>Only HR administrators manage user accounts.</Empty>;
  const all = users.data || [];
  const act = async (u: any, path: string, body?: any, method = "POST") => {
    const what = body?.role ? `Change ${u.name}'s access to ${ROLES[body.role]}? They will be signed out.` : body?.active === false ? `Deactivate ${u.name}? They are signed out and cannot sign in.` : path.endsWith("reset-password") ? `Reset ${u.name}'s password?` : null;
    if (what && !(await confirm({ title: body?.active === false ? "Deactivate account" : body?.role ? "Change access" : "Reset password", message: what, danger: body?.active === false, confirmLabel: body?.active === false ? "Deactivate" : body?.role ? "Change access" : "Reset password" }))) { users.reload(); return; }
    const r = await api(method, path, body);
    if (!r.ok) return toast(r.error!.message, "bad");
    if (r.data?.temporary_password) setTemp(r.data); else toast("Saved");
    users.reload();
  };
  return (
    <>
      <PageHeader title="Users & access" />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Users />} label="Accounts" value={all.length} />
        <Stat icon={<ShieldCheck />} tone="good" label="Active" value={all.filter(u => u.active).length} />
        <Stat icon={<Lock />} tone={all.some(u => u.locked) ? "warn" : undefined} label="Locked" value={all.filter(u => u.locked).length} />
        <Stat icon={<UserX />} label="Never signed in" value={all.filter(u => !u.last_login_at).length} />
      </div>
      <SearchInput className="mb-4 max-w-sm" value={q} onChange={setQ} placeholder="Search name or email" />
      <Card pad={false}>
        {users.loading ? <Loading /> : paged.items.length ? <div className="overflow-x-auto"><table className="t"><thead><tr><th>Person</th><th>Access</th><th>Department</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>{paged.items.map(u => <tr key={u.id} className={u.active ? "" : "opacity-55"}>
            <td><div className="flex items-center gap-2.5"><Avatar name={u.name} size={32} /><div className="min-w-0"><div className="font-semibold">{u.name}{u.id === s.user.id && <span className="ml-1.5 text-[11px] text-ink-3">(you)</span>}</div><div className="text-[12px] text-ink-3">{u.email}</div></div></div></td>
            <td><select aria-label="Access" className="inp w-auto py-1 text-[12.5px]" value={u.role} disabled={u.id === s.user.id} onChange={e => act(u, `/users/${u.id}`, { role: e.target.value }, "PATCH")}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td className="text-ink-2">{u.department_name || "—"}</td>
            <td className="text-ink-2">{u.last_login_at ? ago(u.last_login_at) : <span className="text-ink-3">never</span>}</td>
            <td><div className="flex flex-wrap gap-1">{u.active ? <Pill tone="Active">Active</Pill> : <Pill tone="Inactive">Deactivated</Pill>}{u.locked && <Pill tone="Rejected">Locked</Pill>}{u.must_change_password && <Pill tone="Assigned">Temp password</Pill>}</div></td>
            <td className="whitespace-nowrap text-right">{u.id !== s.user.id && <span className="inline-flex gap-1">
              {u.locked && <Button size="sm" onClick={() => act(u, `/users/${u.id}/unlock`)} title="Unlock"><Unlock className="h-3.5 w-3.5" /></Button>}
              <Button size="sm" onClick={() => act(u, `/users/${u.id}/reset-password`)} title="Reset password"><KeyRound className="h-3.5 w-3.5" />Reset</Button>
              <Button size="sm" variant={u.active ? "danger" : "default"} onClick={() => act(u, `/users/${u.id}`, { active: !u.active }, "PATCH")}>{u.active ? "Deactivate" : "Reactivate"}</Button></span>}</td></tr>)}</tbody></table></div>
          : <Empty icon={<UserCog />}>No accounts match.</Empty>}
        <Pagination page={paged.page} size={paged.size} total={paged.total} onPage={paged.setPage} />
      </Card>
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporary password" footer={<Button variant="primary" onClick={() => setTemp(null)}>Done</Button>}>
        {temp && <>
          <p className="text-[13.5px] text-ink-2">Give this to <b>{temp.email}</b> privately. It works once: they must choose their own password when they sign in. All their sessions were signed out.</p>
          <div className="flex items-center gap-2 rounded-xl bg-sunken px-4 py-3"><code className="mono flex-1 text-[18px] font-bold tracking-wider">{temp.temporary_password}</code>
            <Button size="sm" onClick={() => { navigator.clipboard?.writeText(temp.temporary_password); toast("Copied"); }}><Copy className="h-3.5 w-3.5" />Copy</Button></div>
          <p className="text-[12px] text-ink-3">It is not shown again.</p>
        </>}
      </Modal>
    </>
  );
}
