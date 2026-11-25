/* Streaming reader for job-postings files (.xlsx or .csv), shared by the import script and the upload screen. */
import { createReadStream } from "node:fs";
import ExcelJS from "exceljs";
import { RawPosting } from "./ingest";

export const COLS = ["company", "job_title", "location", "department", "description", "additional_details"];

export async function* readRows(path: string): AsyncGenerator<RawPosting> {
  if (path.toLowerCase().endsWith(".csv")) {
    // minimal RFC 4180 parser (quoted fields, embedded newlines)
    let header: string[] | null = null; let field = ""; let row: string[] = []; let quoted = false;
    for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (quoted) { if (ch === '"') { if (chunk[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; continue; }
        if (ch === '"') quoted = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field.replace(/\r$/, "")); field = ""; if (!header) header = row.map(h => h.trim().toLowerCase()); else yield Object.fromEntries(header.map((h, j) => [h, row[j]])) as any; row = []; }
        else field += ch;
      }
    }
    if (header && (field || row.length)) { row.push(field); yield Object.fromEntries(header.map((h, j) => [h, row[j]])) as any; }
    return;
  }
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, { sharedStrings: "cache", hyperlinks: "ignore", worksheets: "emit", styles: "ignore" });
  for await (const ws of reader) {
    let header: string[] | null = null;
    for await (const r of ws) {
      const vals = (r.values as any[]).slice(1).map(v => v && typeof v === "object" ? (v.text ?? v.richText?.map((t: any) => t.text).join("") ?? v.result ?? "") : v);
      if (!header) { header = vals.map(v => String(v ?? "").trim().toLowerCase()); continue; }
      yield Object.fromEntries(header.map((h, j) => [h, vals[j] ?? ""])) as any;
    }
    break; // first worksheet only
  }
}

