/* Reads uploaded CSV or Excel files into rows of strings. Column names are matched loosely
   (case, spaces, underscores and common synonyms), so files exported from other systems work. */
import ExcelJS from "exceljs";
import { unprocessable } from "./errors";

export const MAX_ROWS = 100_000;

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const counts: [string, number][] = [[",", (first.match(/,/g) || []).length], [";", (first.match(/;/g) || []).length], ["\t", (first.match(/\t/g) || []).length]];
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; if (rows.length > MAX_ROWS + 1) break; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets.find(w => w.actualRowCount > 0);
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, r => {
    const vals = (r.values as any[]).slice(1).map(v => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object") return String(v.text ?? v.richText?.map((t: any) => t.text).join("") ?? v.result ?? v.hyperlink ?? "");
      return String(v);
    });
    out.push(vals);
  });
  return out.slice(0, MAX_ROWS + 1);
}

export const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "");

/** Parse a file and map its columns onto the expected fields. */
export async function readTable(input: { buf?: Buffer; text?: string; filename: string }, fields: Record<string, string[]>, required: string[]) {
  const isXlsx = /\.xlsx$/i.test(input.filename);
  if (/\.xls$/i.test(input.filename)) throw unprocessable("old_excel", "Save the file as .xlsx or .csv (the old .xls format is not supported)");
  const grid = isXlsx ? await parseXlsx(input.buf!) : parseCsv(input.text ?? input.buf!.toString("utf8"));
  if (grid.length < 2) throw unprocessable("empty_file", "The file needs a header row and at least one data row");
  if (grid.length - 1 > MAX_ROWS) throw unprocessable("too_many_rows", `Up to ${MAX_ROWS.toLocaleString()} rows per file. Split the file and import in parts.`);
  const header = grid[0].map(h => norm(String(h)));
  const index: Record<string, number> = {};
  for (const [field, synonyms] of Object.entries(fields)) {
    const i = header.findIndex(h => [field, ...synonyms].map(norm).includes(h));
    if (i >= 0) index[field] = i;
  }
  const missing = required.filter(f => !(f in index));
  if (missing.length) throw unprocessable("missing_columns", `Missing column(s): ${missing.join(", ")}. Download the template to see the expected columns.`, );
  const unknown = grid[0].filter((_, i) => !Object.values(index).includes(i)).map(String).filter(Boolean);
  const rows = grid.slice(1).map((r, n) => {
    const o: Record<string, string> = { __row: String(n + 2) };
    for (const [f, i] of Object.entries(index)) o[f] = String(r[i] ?? "").trim();
    return o;
  });
  return { rows, unknown_columns: unknown, columns: Object.keys(index) };
}

/** Split a multi-value cell: semicolons, pipes or new lines. */
export const splitList = (v: string | undefined) => (v || "").split(/\r?\n|;|\|/).map(s => s.trim()).filter(Boolean);

export function toCsv(header: string[], rows: unknown[][]) {
  // cells that a spreadsheet would run as a formula are prefixed with an apostrophe
  const esc = (v: unknown) => { let s = String(v ?? ""); if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && isNaN(Number(s)))) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
}
