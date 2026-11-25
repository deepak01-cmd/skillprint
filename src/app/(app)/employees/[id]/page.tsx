"use client";
import { EmployeeProfile } from "@/components/EmployeeProfile";
export default function EmployeePage({ params }: { params: { id: string } }) { return <EmployeeProfile id={params.id} />; }
