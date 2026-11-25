import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="grad-text text-[88px] font-extrabold leading-none tracking-[-.04em]">404</div>
      <h1 className="text-[22px] font-extrabold">Page not found</h1>
      <p className="text-[14px] text-ink-3">The link may be old, or the page was moved.</p>
      <Link href="/dashboard" className="mt-2 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white">Go home</Link>
    </div>
  );
}
