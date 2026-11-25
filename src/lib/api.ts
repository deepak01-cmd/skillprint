"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiResult<T = any> { ok: boolean; status: number; data: T; error?: { error: string; message: string; details?: any } }

const OFFLINE = { error: "network", message: "Can't reach the server. Check your connection and try again." };
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try { res = await fetch(`/api/v1${path}`, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { return { ok: false, status: 0, data: null as any, error: OFFLINE }; }
  if (res.status === 401 && !path.startsWith("/auth/login")) { window.location.href = "/login"; }
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, data, error: data || { error: "network", message: "The request failed" } };
}

/** Loads a GET endpoint. `loading` is true only until the first data arrives, so pages keep showing their
    content while they refresh after an action; a different page path (not just new filters) starts fresh. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(!!path);
  const base = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    const b = path.split("?")[0];
    if (base.current !== b) { base.current = b; setData(null); setLoading(true); }
    const r = await api<T>("GET", path);
    if (base.current !== b) return; // a newer page path took over while this was loading
    if (r.ok) { setData(r.data); setError(null); } else setError({ status: r.status, message: r.error?.message || "Failed to load" });
    setLoading(false);
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  // cells a spreadsheet would run as a formula get an apostrophe in front
  const esc = (v: unknown) => { let s = String(v ?? ""); if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && isNaN(Number(s)))) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/** Multipart upload (files + fields). */
export async function upload<T = any>(path: string, fields: Record<string, string | Blob | Blob[] | undefined>): Promise<ApiResult<T>> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x as any);
  let res: Response;
  try { res = await fetch(`/api/v1${path}`, { method: "POST", body: fd, cache: "no-store" }); }
  catch { return { ok: false, status: 0, data: null as any, error: OFFLINE }; }
  if (res.status === 401) { window.location.href = "/login"; }
  let data: any = null; try { data = await res.json(); } catch { data = null; }
  return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, data, error: data || { error: "network", message: "The upload failed" } };
}
export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
