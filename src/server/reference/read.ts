/* Row reader for reference files: .xlsx (streamed), .csv and tab-separated .txt/.tsv (the O*NET database download format).
   Yields raw cell arrays; the header row is found by the adapter, because some files carry a title block above it. */
import { createReadStream } from "node:fs";
import ExcelJS from "exceljs";

const cell = (v: any): string => v == null ? "" : typeof v === "object" ? String(v.text ?? v.richText?.map((t: any) => t.text).join("") ?? v.result ?? (v instanceof Date ? v.toISOString().slice(0, 10) : "")) : String(v);

export async function* readCells(path: string): AsyncGenerator<string[]> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const toCells = (values: any) => { const vals = (values as any[]).slice(1); return Array.from({ length: vals.length }, (_, i) => cell(vals[i]).trim()); };
    let yielded = 0;
    try {
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, { sharedStrings: "cache", hyperlinks: "ignore", worksheets: "emit", styles: "ignore" });
      for await (const ws of reader) {
        for await (const r of ws) { yielded++; yield toCells(r.values); }
        break; // first worksheet only
      }
      return;
    } catch (e: any) {
      // some tools write .xlsx files the streaming reader cannot open ("invalid signature"); read those whole instead
      if (yielded || !/signature|zip|end of central/i.test(String(e?.message))) throw e;
    }
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
    const ws = wb.worksheets[0]; if (!ws) return;
    for (let i = 1; i <= ws.rowCount; i++) yield toCells(ws.getRow(i).values);
    return;
  }
  const tab = lower.endsWith(".txt") || lower.endsWith(".tsv");
  if (tab) {
    let rest = "";
    for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
      const lines = (rest + chunk).split("\n"); rest = lines.pop() ?? "";
      for (const l of lines) yield l.replace(/\r$/, "").split("\t").map(s => s.trim());
    }
    if (rest.trim()) yield rest.replace(/\r$/, "").split("\t").map(s => s.trim());
    return;
  }
  // CSV (RFC 4180: quoted fields, embedded newlines); a byte-order mark is dropped
  let field = ""; let row: string[] = []; let quoted = false; let first = true;
  for await (let chunk of createReadStream(path, { encoding: "utf8" })) {
    if (first) { chunk = chunk.replace(/^﻿/, ""); first = false; }
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (quoted) { if (ch === '"') { if (chunk[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; continue; }
      if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field.trim()); field = ""; }
      else if (ch === "\n") { row.push(field.replace(/\r$/, "").trim()); field = ""; yield row; row = []; }
      else field += ch;
    }
  }
  if (field || row.length) { row.push(field.trim()); yield row; }
}
