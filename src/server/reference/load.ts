/* Loads reference files into a source release. Each file's format is recognised from its header row (which may sit
   below a title block), so files can be dropped in any order and from any of the supported publishers' layouts:
   O*NET database download (.txt) or Excel exports (.xlsx) of occupations, alternate / reported titles, ratings files
   (Skills, Knowledge, Abilities, Work Activities, Work Styles, Work Context, Interests), Work Context categories,
   descriptor links, Bright Outlook, Technology Skills and the descriptor catalogue; plus plain skill lists and
   occupation lists from other sites. Nothing is written outside the release's own rows. */
import { basename } from "node:path";
import { Db, q } from "../db";
import { readCells } from "./read";

type Row = Record<string, string>;
type Kind = "skill" | "knowledge" | "ability" | "work_style" | "work_context" | "work_activity" | "interest" | "technology" | "other";
export interface FileResult { file: string; format: string | null; label?: string; rows: number; loaded: number; skipped: number; warnings: string[] }

const KEEP_SCALES = new Set(["IM", "LV", "WI", "DR", "CX", "CT", "OI"]);
/** O*NET content-model prefix -> kind of descriptor. */
export function kindOf(elementId: string): Kind {
  const e = elementId.toUpperCase();
  if (e.startsWith("1.A")) return "ability";
  if (e.startsWith("1.B")) return "interest";
  if (e.startsWith("1.C") || e.startsWith("1.D")) return "work_style";
  if (e.startsWith("2.A") || e.startsWith("2.B")) return "skill";
  if (e.startsWith("2.C")) return "knowledge";
  if (e.startsWith("4.A")) return "work_activity";
  if (e.startsWith("4.C")) return "work_context";
  return "other";
}
const clean = (s: string) => s.replace(/Folder \(closedopen\)/gi, "").replace(/\s+/g, " ").trim();
const firstKey = (r: Row, re: RegExp) => Object.keys(r).find(k => re.test(k));
const val = (r: Row, re: RegExp) => { const k = firstKey(r, re); return k ? (r[k] ?? "").trim() : ""; };
const has = (h: string[], re: RegExp) => h.some(x => re.test(x));
const CODE = /^(o\*net-soc( \d{4})? code|code|soc code|occupation code)$/;

interface Adapter { id: string; label: string; detect: (h: string[]) => boolean }
export const ADAPTERS: Adapter[] = [
  { id: "ratings", label: "Occupation ratings (skills, knowledge, abilities, work styles, work context, activities)", detect: h => has(h, CODE) && h.includes("element id") && h.includes("scale id") && h.includes("data value") },
  { id: "categories", label: "Scale categories", detect: h => h.includes("element id") && h.includes("scale id") && h.includes("category") && h.includes("category description") },
  { id: "links", label: "Descriptor links", detect: h => h.filter(x => /element id$/.test(x)).length === 2 && !has(h, CODE) },
  { id: "alternate", label: "Alternate job titles", detect: h => has(h, CODE) && (h.includes("alternate title") || h.includes("job title")) && !h.includes("element id") },
  { id: "reported", label: "Reported job titles", detect: h => has(h, CODE) && h.includes("reported job title") },
  { id: "technology", label: "Technology / software skills", detect: h => has(h, CODE) && (h.includes("example") || h.includes("workplace example")) && (h.includes("hot technology") || h.includes("commodity title")) },
  { id: "tasks", label: "Emerging tasks", detect: h => has(h, CODE) && h.includes("task") && h.includes("category") && !h.includes("task id") },
  { id: "job_zones", label: "Job zones (preparation needed)", detect: h => has(h, CODE) && h.includes("job zone") },
  { id: "related", label: "Related occupations", detect: h => has(h, CODE) && h.includes("related o*net-soc code") },
  { id: "bright", label: "Bright Outlook occupations", detect: h => has(h, CODE) && h.includes("occupation") && h.includes("categories") },
  { id: "catalogue", label: "Descriptor catalogue", detect: h => (h.includes("subskills") && h.includes("subskillslink")) || (h.includes("element id") && h.includes("element name") && h.includes("description") && !h.includes("scale id")) },
  { id: "occupations", label: "Occupations", detect: h => has(h, CODE) && has(h, /title$/) && !h.includes("element id") },
  { id: "occupation_list", label: "Occupation list", detect: h => has(h, /^(occupation|occupation title|job title|job role|role|role title)$/) && !h.includes("element id") },
  { id: "skill_list", label: "Skill list", detect: h => has(h, /^(skill|skills|skill name|skill title|name)$/) && !has(h, CODE) && !h.includes("element id") },
];

/** Reads the header (within the first 15 rows) and names the format, without loading anything. */
export async function detectFile(path: string): Promise<{ adapter: Adapter | null; header: string[]; headerRow: number }> {
  let i = 0;
  for await (const cells of readCells(path)) {
    const h = cells.map(c => c.toLowerCase().replace(/\s+/g, " ").trim());
    const a = ADAPTERS.find(x => x.detect(h));
    if (a) return { adapter: a, header: h, headerRow: i };
    if (++i >= 15) break;
  }
  return { adapter: null, header: [], headerRow: -1 };
}

/** Batched writer: rows are collected per table and inserted 1,000 at a time with ON CONFLICT DO NOTHING. */
class Writer {
  private buf = new Map<string, any[][]>(); private n = 0;
  constructor(private db: Db, private src: string) {}
  private static COLS: Record<string, string[]> = {
    ref_occupations: ["code", "title", "description"], ref_titles: ["code", "title", "kind"], ref_elements: ["element_id", "kind", "name", "description", "category"],
    ref_ratings: ["code", "element_id", "scale", "value", "n", "rated_on", "domain"], ref_categories: ["element_id", "scale", "category", "label"],
    ref_element_links: ["from_id", "to_id"], ref_outlook_flags: ["code", "flag"], ref_technologies: ["code", "example", "commodity", "hot", "in_demand"],
    ref_tasks: ["code", "task", "category", "reported"], ref_related: ["code", "related_code", "tier", "rank"],
  };
  private static TYPES: Record<string, string[]> = {
    ref_occupations: ["text", "text", "text"], ref_titles: ["text", "text", "text"], ref_elements: ["text", "text", "text", "text", "text"],
    ref_ratings: ["text", "text", "text", "numeric", "int", "text", "text"], ref_categories: ["text", "text", "int", "text"],
    ref_element_links: ["text", "text"], ref_outlook_flags: ["text", "text"], ref_technologies: ["text", "text", "text", "boolean", "boolean"],
    ref_tasks: ["text", "text", "text", "text"], ref_related: ["text", "text", "text", "int"],
  };
  async add(table: string, row: any[]) { const b = this.buf.get(table) || []; b.push(row); this.buf.set(table, b); this.n++; if (b.length >= 1000) await this.flush(table); }
  async flush(only?: string) {
    for (const [t, rows] of this.buf) {
      if (only && t !== only) continue; if (!rows.length) continue;
      if (t === "ref_occupations" || t === "ref_elements") {
        // the same key twice in one batch: keep one row, preferring the one with a description (and a category)
        const m = new Map<string, any[]>();
        for (const r of rows) { const k = r[0]; const p = m.get(k); m.set(k, !p ? r : r.map((v, j) => v ?? p[j]).map((v, j) => (j >= 2 && p[j] && !r[j]) ? p[j] : v)); }
        rows.splice(0, rows.length, ...m.values());
      }
      const cols = Writer.COLS[t], types = Writer.TYPES[t];
      const arrays = cols.map((_, j) => rows.map(r => r[j] ?? null));
      // occupations met again (title from a ratings file, description from the occupations file) keep the fuller text
      const conflict = t === "ref_occupations" ? `ON CONFLICT (source_id, code) DO UPDATE SET description = coalesce(EXCLUDED.description, ref_occupations.description), title = CASE WHEN EXCLUDED.description IS NOT NULL THEN EXCLUDED.title ELSE ref_occupations.title END`
        : t === "ref_elements" ? `ON CONFLICT (source_id, element_id) DO UPDATE SET description = coalesce(EXCLUDED.description, ref_elements.description), category = coalesce(EXCLUDED.category, ref_elements.category)`
        : "ON CONFLICT DO NOTHING";
      await q(this.db, `INSERT INTO ${t} (source_id, ${cols.join(", ")}) SELECT $1, * FROM unnest(${cols.map((_, j) => `$${j + 2}::${types[j]}[]`).join(", ")}) ${conflict}`, [this.src, ...arrays]);
      this.buf.set(t, []);
    }
  }
  get count() { return this.n; }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const num = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };

export async function loadFile(db: Db, sourceId: string, path: string, displayName = basename(path), progress: (s: string) => void = () => {}): Promise<FileResult> {
  const det = await detectFile(path);
  const res: FileResult = { file: displayName, format: det.adapter?.id ?? null, label: det.adapter?.label, rows: 0, loaded: 0, skipped: 0, warnings: [] };
  if (!det.adapter) { res.warnings.push("Format not recognised. Expected an O*NET file (occupations, titles, ratings, categories, links, Bright Outlook, technology skills), a skill list (a Skill or Name column) or an occupation list (an Occupation or Job title column)."); return res; }
  const w = new Writer(db, sourceId); const seenOcc = new Set<string>(); const seenEl = new Set<string>();
  const occ = async (code: string, title: string, description: string | null = null) => {
    if (!code || !title) return;
    if (description || !seenOcc.has(code)) { await w.add("ref_occupations", [code, title, description]); await w.add("ref_titles", [code, title, "title"]); seenOcc.add(code); }
  };
  const el = async (id: string, kind: Kind, name: string, description: string | null = null, category: string | null = null) => {
    if (!id || !name) return; if (!description && !category && seenEl.has(id)) return; seenEl.add(id);
    await w.add("ref_elements", [id, kind, name, description, category]);
  };
  const id = det.adapter.id; let i = 0; let hdr: string[] = [];
  for await (const cells of readCells(path)) {
    if (i++ < det.headerRow) continue;
    if (i === det.headerRow + 1) { hdr = cells.map(c => c.toLowerCase().replace(/\s+/g, " ").trim()); continue; }
    if (!cells.some(c => c)) continue;
    const r: Row = Object.fromEntries(hdr.map((h, j) => [h, cells[j] ?? ""])); res.rows++;
    const code = val(r, CODE); const before = w.count;
    if (id === "ratings") {
      const scale = (r["scale id"] || "").toUpperCase(); const eid = r["element id"]; const v = num(r["data value"]);
      await occ(code, val(r, /^title$/)); await el(eid, kindOf(eid), r["element name"]);
      if (!KEEP_SCALES.has(scale) || v == null || /^y/i.test(r["recommend suppress"] || "") || /^y/i.test(r["not relevant"] || "")) { res.skipped++; continue; }
      await w.add("ref_ratings", [code, eid, scale, v, num(r["n"] || ""), r["date"] || null, r["domain source"] || null]);
    } else if (id === "categories") {
      const c = num(r["category"]); if (c == null) { res.skipped++; continue; }
      await el(r["element id"], kindOf(r["element id"]), r["element name"]);
      await w.add("ref_categories", [r["element id"], (r["scale id"] || "").toUpperCase(), c, r["category description"]]);
    } else if (id === "links") {
      const [a, b] = hdr.filter(h => /element id$/.test(h)); const [an, bn] = hdr.filter(h => /element name$/.test(h));
      if (an) await el(r[a], kindOf(r[a]), r[an]); if (bn) await el(r[b], kindOf(r[b]), r[bn]);
      await w.add("ref_element_links", [r[a], r[b]]);
    } else if (id === "alternate" || id === "reported") {
      await occ(code, val(r, /^title$/));
      const t = id === "alternate" ? (r["alternate title"] || r["job title"]) : r["reported job title"]; if (!t) { res.skipped++; continue; }
      await w.add("ref_titles", [code, t, id]);
      if (id === "alternate" && r["short title"]) await w.add("ref_titles", [code, r["short title"], "alternate"]);
    } else if (id === "technology") {
      await occ(code, val(r, /^title$/)); const ex = r["example"] || r["workplace example"]; if (!ex) { res.skipped++; continue; }
      await w.add("ref_technologies", [code, ex, r["commodity title"] || r["element name"] || null, /^y/i.test(r["hot technology"] || ""), /^y/i.test(r["in demand"] || "")]);
    } else if (id === "tasks") {
      await occ(code, val(r, /^title$/)); if (!r["task"]) { res.skipped++; continue; }
      await w.add("ref_tasks", [code, r["task"], r["category"] || null, r["date"] || null]);
    } else if (id === "job_zones") {
      await occ(code, val(r, /^title$/)); const z = num(r["job zone"]); if (z == null) { res.skipped++; continue; }
      await w.add("ref_ratings", [code, "JZ", "JZ", z, null, r["date"] || null, r["domain source"] || null]);
    } else if (id === "related") {
      await occ(code, val(r, /^title$/)); const rc = r["related o*net-soc code"]; if (!rc) { res.skipped++; continue; }
      await occ(rc, r["related title"]);
      await w.add("ref_related", [code, rc, r["relatedness tier"] || null, num(r["index"] || "")]);
    } else if (id === "bright") {
      await occ(code, r["occupation"]);
      const flags = (r["categories"] || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
      if (!flags.length) { res.skipped++; continue; }
      for (const f of flags) await w.add("ref_outlook_flags", [code, f]);
    } else if (id === "catalogue") {
      if (r["element id"]) await el(r["element id"], kindOf(r["element id"]), r["element name"], r["description"] || null);
      else {
        const link = r["subskillslink"] || ""; const eid = (link.match(/\/result\/([\w.]+)/) || [])[1];
        if (!eid || !r["subskills"]) { res.skipped++; continue; }
        const desc = (r["subskillsdescription"] || "").split(/Level examples:/i)[0].replace(/\s+/g, " ").trim() || null;
        await el(eid, kindOf(eid), clean(r["subskills"]), desc, clean(r["skills"] || r["subcategory"] || "") || null);
      }
    } else if (id === "occupations") {
      await occ(code, val(r, /title$/), val(r, /description$/) || null);
    } else if (id === "occupation_list") {
      const t = val(r, /^(occupation|occupation title|job title|job role|role|role title)$/); if (!t) { res.skipped++; continue; }
      const c = code || val(r, /^(id|code)$/) || slug(t);
      await occ(c, t, val(r, /^(description|summary|definition)$/) || null);
      for (const a of val(r, /^(alternate titles|alternative titles|aliases|also known as|other titles)$/).split(/[;|]/).map(s => s.trim()).filter(Boolean)) await w.add("ref_titles", [c, a, "alternate"]);
    } else if (id === "skill_list") {
      const name = val(r, /^(skill|skills|skill name|skill title|name)$/); if (!name) { res.skipped++; continue; }
      const sid = val(r, /^(skill ?id|id|code|element id)$/) || slug(name);
      await el(`${sid}`, "skill", name, val(r, /^(description|definition|skill description)$/) || null, val(r, /^(category|type|group|skill category|skill type)$/) || null);
    }
    if (w.count > before) res.loaded++;
    if (res.rows % 20000 === 0) progress(`${displayName}: ${res.rows.toLocaleString()} rows read`);
  }
  await w.flush();
  if (!res.rows) res.warnings.push("No data rows under the header.");
  if (id === "ratings" && res.skipped) res.warnings.push(`${res.skipped} rows left out: suppressed, not relevant, or a per-category percentage (only the mean values are kept).`);
  return res;
}
