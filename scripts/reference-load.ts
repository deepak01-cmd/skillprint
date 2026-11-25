/* Load a folder of reference files (for example the O*NET files in data/reference/onet) as one release.
   npm run reference:load -- <folder> [--publisher "O*NET"] [--name "O*NET Database"] [--version 30.1] [--publish] [--if-missing]
   --if-missing skips loading when a release of the same dataset already exists (used on first start). */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { one, pool, q } from "../src/server/db";
import { loadIntoSource, ONET_ATTRIBUTION } from "../src/server/modules/reference";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
async function main() {
  const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "data/reference/onet");
  const publisher = arg("--publisher", "O*NET")!, name = arg("--name", "O*NET Database")!, version = arg("--version", "");
  const db = pool();
  // a load interrupted earlier (app closed while loading) is removed and done again
  await q(db, `DELETE FROM reference_sources WHERE status = 'Loading' AND created_by = 'setup'`);
  if (process.argv.includes("--if-missing") && await one(db, `SELECT 1 FROM reference_sources WHERE lower(publisher) = lower($1) AND lower(name) = lower($2)`, [publisher, name])) {
    console.log(`${publisher} ${name} is already loaded`); await db.end(); return;
  }
  let files: { name: string; path: string }[] = [];
  try { files = readdirSync(dir).filter(f => /\.(xlsx|csv|txt|tsv)$/i.test(f) && !/^readme/i.test(f)).map(f => ({ name: f, path: join(dir, f) })).filter(f => statSync(f.path).isFile()); } catch { /* none */ }
  if (!files.length) { console.log(`No reference files in ${dir}`); await db.end(); return; }
  const isOnet = /o\*?net/i.test(publisher);
  const s = await one(db, `INSERT INTO reference_sources (publisher, name, version, licence, attribution, url, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,'setup','Loading') RETURNING id`,
    [publisher, name, version || null, isOnet ? "CC BY 4.0 (Creative Commons Attribution 4.0 International)" : null, isOnet ? ONET_ATTRIBUTION(version || "") : null, isOnet ? "https://www.onetcenter.org/database.html" : null]);
  const t0 = Date.now();
  const r = await loadIntoSource(db, s!.id, files, p => console.log(`  ${p}`));
  for (const f of r.results) console.log(`${f.file}: ${f.label || "not recognised"}, ${f.rows} rows${f.warnings.length ? ` (${f.warnings.join(" ")})` : ""}`);
  console.log(`Loaded into ${s!.id} in ${Math.round((Date.now() - t0) / 1000)}s:`, r.counts);
  if (process.argv.includes("--publish")) {
    await q(db, `UPDATE reference_sources SET status = 'Retired' WHERE status = 'Active' AND lower(publisher) = lower($1) AND lower(name) = lower($2)`, [publisher, name]);
    const p = await one(db, `UPDATE reference_sources SET status = 'Active', published_by = 'setup', published_at = now() WHERE id = $1 AND licence IS NOT NULL AND attribution IS NOT NULL RETURNING id`, [s!.id]);
    console.log(p ? "Published" : "Not published: record a licence and attribution first (Reference data page)");
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
