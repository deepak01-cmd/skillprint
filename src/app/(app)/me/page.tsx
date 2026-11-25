"use client";
import { EmployeeProfile } from "@/components/EmployeeProfile";
import { useSession } from "@/components/session";
import { Empty } from "@/components/ui";
export default function Me() {
  const s = useSession();
  if (!s.user.employee_id) return <Empty>Your account is not linked to an employee record.</Empty>;
  return <EmployeeProfile id={s.user.employee_id} self />;
}
