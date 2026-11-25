/* Start-up data growth (idempotent): add missing catalogue skills, re-scan stored job postings when the library grew,
   and build role templates from the larger market title groups. Safe to run on every start. */
import { pool, tx } from "../src/server/db";
import { loadCatalogue, rescanPostings } from "../src/server/market/catalogue";
import { refreshAggregates, suggestForCandidates } from "../src/server/market/ingest";
import { AUTO_TEMPLATES, autoAddSkills, bulkTemplates } from "../src/server/modules/scale";

async function main() {
  const t0 = Date.now();
  const r = await tx(c => loadCatalogue(c));
  if (r.added) console.log(`  Skills catalogue: ${r.added} skills added to the global library.`);
  const n = Number((await pool().query(`SELECT count(*)::int AS n FROM job_postings`)).rows[0].n);
  // databases from before title families and skill discovery: process the stored postings once with the new rules
  const upgrade = n > 0 && Number((await pool().query(`SELECT count(*)::int AS n FROM job_title_vocab`)).rows[0].n) === 0;
  if (upgrade) console.log(`  Grouping job titles into market titles and discovering skill terms in ${n.toLocaleString()} postings (one time, a few minutes)…`);
  const force = process.argv.includes("--rescan") || upgrade;
  if (n && (r.added || force)) {
    console.log(`  Re-scanning ${n.toLocaleString()} job postings for the new skills…`);
    const c = await pool().connect();
    try {
      const s = await rescanPostings(pool(), (d, tot) => console.log(`    ${d.toLocaleString()} of ${tot.toLocaleString()} scanned`));
      await c.query("BEGIN"); await refreshAggregates(c as any); await c.query("COMMIT");
      console.log(`  ${s.changed.toLocaleString()} postings gained skills.`);
    } finally { c.release(); }
  }
  const market = Number((await pool().query(`SELECT count(*)::int AS n FROM role_templates WHERE source = 'Job-postings analysis'`)).rows[0].n);
  if (n && (market === 0 || r.added || force)) {
    const t = await bulkTemplates(pool(), AUTO_TEMPLATES);
    console.log(`  Role templates from job postings: ${t.created} new, ${t.updated} refreshed, ${t.removed} removed.`);
  }
  // candidate terms that a library skill now covers are closed (cheap; runs every start)
  if (n) { await suggestForCandidates(pool()); const a = await autoAddSkills(pool()); if (a.added) console.log(`  ${a.added} strongly demanded skills added automatically (marked for review).`); }
  if (r.added || force) console.log(`  Data growth done in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await pool().end();
}
main().catch(e => { console.error("Data growth step failed (the app still starts): " + (e.message || e)); process.exit(0); });
