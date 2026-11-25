"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Clock, Lightbulb, Target } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/components/session";
import { Empty, Hero, Loading, Ring } from "@/components/ui";
import { LearningPanel } from "@/components/Learning";

function Page() {
  const s = useSession(); const sp = useSearchParams();
  const id = sp.get("employee") || s.user.employee_id;
  const d = useApi<any>(id ? `/employees/${id}/learning` : null);
  if (!id) return <Empty icon={<Lightbulb />}>Your account is not linked to an employee record.</Empty>;
  if (d.loading) return <Loading rows={6} />;
  const items: any[] = d.data?.items || [];
  const gaps = items.filter(g => !g.unassessed).length; const planned = items.filter(g => g.in_plan > 0).length;
  const self = id === s.user.employee_id;
  return (
    <>
      <Hero art={<Ring value={items.length ? Math.round(planned / items.length * 100) : 100} size={120} stroke={10} tone="good" track="rgb(255 255 255 / .18)" label={<span className="text-white">{planned}/{items.length}</span>} sub={<span className="text-white/70">planned</span>} />}>
        <div>
          <div className="text-[13px] font-semibold text-white/70">{self ? "My learning" : d.data?.employee?.name}</div>
          <h1 className="mt-1 text-[30px] font-extrabold tracking-[-.02em]">{gaps ? `${gaps} skill${gaps > 1 ? "s" : ""} to grow` : "On track"}</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
            <span className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2"><Target className="h-4 w-4" />{items.length - gaps} not assessed yet</span>
            <span className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2"><Clock className="h-4 w-4" />~{d.data?.total_hours || 0} hours of learning</span>
            {self && <Link href="/me" className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-white/20">My plan →</Link>}
          </div>
        </div>
      </Hero>
      <LearningPanel employeeId={id} />
    </>
  );
}
export default function LearningPage() { return <Suspense fallback={<Loading />}><Page /></Suspense>; }
