/* Import a job-postings file into the market intelligence tables.
   Usage: npx tsx scripts/import-jobs.ts <file.xlsx|file.csv> [--name "Source name"] [--licence "terms"] [--replace]
   Expected columns: company, job_title, location, department, description, additional_details (JSON). Header names are case-insensitive.
   Without --licence the data is used for title clustering, templates and profile checks only, never as trend evidence. */
import { basename } from "node:path";
import { pool, tx } from "../src/server/db";
import { createSource, ingestBatch, loadMatchers, RawPosting, refreshAggregates } from "../src/server/market/ingest";
import { COLS, readRows } from "../src/server/market/read";
import { rescanPostings } from "../src/server/market/catalogue";
import { AUTO_TEMPLATES, autoAddSkills, bulkTemplates } from "../src/server/modules/scale";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("Give a .xlsx or .csv file"); process.exit(1); }

async function main() {
  const t0 = Date.now();
  const licence = opt("licence") || null;
  const name = opt("name") || basename(file!);
  if (args.includes("--replace")) await pool().query(`DELETE FROM job_sources WHERE file_name = $1`, [basename(file!)]);
  const sourceId = await createSource(pool(), name, basename(file!), licence, "import-jobs script");
  const matchers = await loadMatchers(pool());
  let read = 0, imported = 0, batch: RawPosting[] = [];
  const flush = async () => { if (!batch.length) return; const b = batch; batch = []; imported += await tx(c => ingestBatch(c, sourceId, b, matchers)); };
  let checkedHeader = false;
  for await (const r of readRows(file!)) {
    if (!checkedHeader) { const missing = ["company", "job_title"].filter(k => !(k in r)); if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}. Expected ${COLS.join(", ")}`); checkedHeader = true; }
    read++; batch.push(r);
    if (batch.length >= 500) { await flush(); if (read % 5000 === 0) console.log(`  ${read} rows read, ${imported} imported`); }
  }
  await flush();
  console.log(`Read ${read} rows, imported ${imported} (duplicates skipped: ${read - imported}). Building clusters and statistics…`);
  await rescanPostings(pool(), (d, tot) => { if (d % 20000 < 5000) console.log(`  ${d.toLocaleString()} of ${tot.toLocaleString()} postings scanned`); });
  const agg = await tx(c => refreshAggregates(c));
  const tpl = await bulkTemplates(pool(), AUTO_TEMPLATES);
  console.log(`Role templates: ${tpl.created} new, ${tpl.updated} refreshed, ${tpl.removed} removed.`);
  const auto = await autoAddSkills(pool()); if (auto.added) console.log(`${auto.added} strongly demanded skills added automatically.`);
  await pool().query(`UPDATE job_sources SET rows_read = $2, rows_imported = $3, period_from = $4, period_to = $5 WHERE id = $1`, [sourceId, read, imported, agg.period?.f, agg.period?.t]);
  const s = (await pool().query(`SELECT (SELECT count(*) FROM job_title_clusters)::int AS clusters, (SELECT count(*) FROM job_skill_stats)::int AS skills, (SELECT count(*) FROM job_candidate_terms)::int AS candidates`)).rows[0];
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s: source ${sourceId}, ${s.clusters} title clusters, ${s.skills} library skills seen, ${s.candidates} candidate terms.${licence ? "" : " No licence given: not used as trend evidence."}`);
  await pool().end();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
