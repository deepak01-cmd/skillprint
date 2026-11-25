"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { can, useSession } from "@/components/session";
import { Button, Card, ErrorBox, Level, Loading, PageHeader, useToast } from "@/components/ui";

export default function Proficiency() {
  const s = useSession(); const toast = useToast();
  const { data, error, loading, reload } = useApi<any>("/proficiency");
  const [edit, setEdit] = useState<Record<number, { name: string; descriptor: string }>>({});
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const w = can(s, "proficiency:write");
  const bySkill = new Map<string, any[]>(); data.descriptors.forEach((d: any) => bySkill.set(d.skill_name, [...(bySkill.get(d.skill_name) || []), d]));
  return (
    <>
      <PageHeader title="Proficiency framework" />
      <Card pad={false} title="Levels">
        <table className="t"><thead><tr><th>Level</th><th>Name</th><th>Descriptor</th><th className="text-right">In framework</th><th className="text-right">In archived</th>{w && <th></th>}</tr></thead>
          <tbody>{data.levels.map((l: any) => { const e = edit[l.level]; return (
            <tr key={l.level}><td><Level n={l.level} short /></td>
              <td>{e ? <input aria-label="Level name" className="inp" value={e.name} onChange={x => setEdit({ ...edit, [l.level]: { ...e, name: x.target.value } })} /> : <b>{l.name}</b>}</td>
              <td className="min-w-[360px]">{e ? <textarea aria-label="Descriptor" className="inp" rows={2} value={e.descriptor} onChange={x => setEdit({ ...edit, [l.level]: { ...e, descriptor: x.target.value } })} /> : l.descriptor}</td>
              <td className="num text-right">{l.used_in_framework}</td><td className="num text-right">{l.used_in_archived}</td>
              {w && <td className="whitespace-nowrap">{e ? <><Button size="sm" variant="primary" onClick={async () => { const r = await api("PATCH", `/proficiency/${l.level}`, e); if (r.ok) { toast("Level saved"); const n = { ...edit }; delete n[l.level]; setEdit(n); reload(); } else toast(r.error!.message, "bad"); }}>Save</Button>{" "}<Button size="sm" onClick={() => { const n = { ...edit }; delete n[l.level]; setEdit(n); }}>Cancel</Button></>
                : <Button size="sm" onClick={() => setEdit({ ...edit, [l.level]: { name: l.name, descriptor: l.descriptor } })}>Edit</Button>}</td>}</tr>); })}</tbody></table>
      </Card>
      <Card className="mt-4" title="Skill-specific descriptors">
        {[...bySkill.entries()].map(([name, ds]) => <div key={name} className="mb-3"><Link className="font-semibold font-medium text-accent hover:underline" href={`/skills/${ds[0].skill_id}`}>{name}</Link>
          <ul className="mt-1 grid gap-1 text-[13px]">{ds.map((d: any) => <li key={d.level} className="grid grid-cols-[120px_1fr] gap-2"><Level n={d.level} short /><span>{d.descriptor}</span></li>)}</ul></div>)}
        <p className="text-xs text-ink-3">Add descriptors from any skill's page.</p>
      </Card>
    </>
  );
}
