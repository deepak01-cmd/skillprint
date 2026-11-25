"use client";
/* Upload a file → check every row → apply. Nothing is saved until "Apply" is pressed. */
import { ReactNode, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { api, downloadText, upload } from "@/lib/api";
import { Button, DropZone, ErrorBox, Modal } from "@/components/ui";

export function UploadFlow({ open, onClose, title, templatePath, previewPath, commitPath, discardPath, renderPreview, canCommit, onDone, hint }: {
  open: boolean; onClose: () => void; title: string; templatePath: string; previewPath: string; commitPath: (id: string) => string; discardPath?: (id: string) => string;
  renderPreview: (p: any) => ReactNode; canCommit: (p: any) => boolean; onDone: (result: any) => ReactNode; hint?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null); const [p, setP] = useState<any>(null); const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const reset = () => { setFile(null); setP(null); setDone(null); setErr(null); };
  const close = () => { if (p && !done && discardPath) api("POST", discardPath(p.id)); reset(); onClose(); };
  const check = async (f: File) => { setFile(f); setP(null); setErr(null); setBusy(true); const r = await upload(previewPath, { file: f }); setBusy(false); r.ok ? setP(r.data) : setErr(r.error); };
  const commit = async () => { setBusy(true); setErr(null); const r = await api("POST", commitPath(p.id)); setBusy(false); r.ok ? setDone(r.data) : setErr(r.error); };
  const template = async () => { const r = await api("GET", templatePath); if (r.ok) downloadText(r.data.file, r.data.content); };
  return (
    <Modal wide open={open} onClose={close} title={title} footer={done ? <Button variant="primary" onClick={close}>Done</Button> : <>
      <Button onClick={template}><Download className="h-4 w-4" />Template</Button><span className="flex-1" />
      <Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy && !!p} disabled={!p || !canCommit(p)} onClick={commit}>Apply</Button></>}>
      {done ? <div className="flex flex-col items-center gap-3 py-6 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good"><CheckCircle2 className="h-7 w-7" /></span>{onDone(done)}</div> : <>
        {!p && <DropZone file={file} onFile={check} hint={hint ?? "CSV or Excel (.xlsx)"} />}
        {busy && !p && <div className="skeleton h-24" />}
        {p && <>{renderPreview(p)}<button className="self-start text-[12.5px] font-semibold text-accent hover:underline" onClick={reset}>Choose another file</button></>}
        <ErrorBox error={err} />
      </>}
    </Modal>
  );
}
