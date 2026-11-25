"use client";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Button, Card, Empty, ErrorBox, Level, Loading, PageHeader, Pill, useToast } from "@/components/ui";

export default function Future() {
  const s = useSession(); const toast = useToast();
  const { data, error, loading } = useApi<any>("/me/future");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title="My future skills" />
      <Card pad={false} title="Skills expected to grow or emerge in your role" actions={data.skills.length > 0 && <Button variant="primary" onClick={async () => {
        const r = await api("POST", `/employees/${s.user.employee_id}/plans/generate`, { title: "Future-ready skills", skills: data.skills.filter((x: any) => x.status !== "Met").map((x: any) => ({ skill_id: x.skill_id, target: x.required_level, source: "future" })) });
        r.ok ? toast(`Plan created with ${r.data.activities} activities, including mentoring and projects`) : toast(r.error!.message, "bad"); }}>Add to my development plan</Button>}>
        {data.skills.length ? <table className="t"><thead><tr><th>Skill</th><th>In your framework</th><th title="Is demand for this skill rising (Emerging), steady (Current) or falling (Declining)? Hover a tag for the reasons.">Demand trend</th><th title="Proficiency level the role needs: 1 Awareness, 2 Foundational, 3 Competent, 4 Advanced, 5 Expert">Level needed</th><th>Your level</th></tr></thead>
          <tbody>{data.skills.map((x: any) => <tr key={x.skill_id}><td className="font-medium">{x.skill_name}</td><td><Pill>{x.skill_trend}</Pill></td><td>{x.evidence_trend ? <><Pill>{x.evidence_trend}</Pill> <span className="text-xs text-ink-3">{x.confidence} confidence</span></> : "—"}</td><td><Level n={x.required_level} /></td><td><Level n={x.current_level} /></td></tr>)}</tbody></table>
          : <Empty>No growing or emerging skills are recorded for your role yet.</Empty>}
      </Card>
    </>
  );
}
