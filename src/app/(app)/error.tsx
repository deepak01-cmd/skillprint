"use client";
import Link from "next/link";
import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";

/** Any page that fails while rendering shows this instead of a blank screen; the rest of the app keeps working. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warn-soft text-warn"><TriangleAlert className="h-8 w-8" /></span>
      <h1 className="text-[22px] font-extrabold">This page hit a problem</h1>
      <p className="text-[14px] text-ink-3">Your data is safe. Try again, or go back to the home page.</p>
      <div className="flex gap-2"><Button variant="primary" onClick={reset}><RefreshCw className="h-4 w-4" />Try again</Button><Link href="/dashboard"><Button>Home</Button></Link></div>
    </div>
  );
}
