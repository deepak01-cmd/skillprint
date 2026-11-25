/* Long data jobs, run as a separate process so the web app keeps answering while they work.
   Started by the server (src/server/modules/scale.ts). Reports "PROGRESS <text>" lines and one final "RESULT <json>" line.
   Usage: tsx scripts/job.ts '<json>'   with {kind: "rescan"|"catalogue"|"upload", user: {id,name}, ...} */
import { rmSync } from "node:fs";
import { pool, tx, q, one } from "../src/server/db";
import { audit } from "../src/server/audit";
import { globalSkillCount, loadCatalogue, rescanPostings } from "../src/server/market/catalogue";
import { canonicalizeTitles, createSource, ingestBatch, loadMatchers, RawPosting, refreshAggregates } from "../src/server/market/ingest";
import { refreshOrgAggregates } from "../src/server/market/company";
import { readRows } from "../src/server/market/read";
import { AUTO_TEMPLATES, autoAddSkills, bulkTemplates } from "../src/server/modules/scale";

const spec = JSON.parse(process.argv[2] || "{}");
const progress = (s: string) => process.stdout.write(`PROGRESS ${s}\n`);
const user = { id: spec.user?.id ?? null, name: spec.user?.name ?? "Data job", org_id: spec.user?.org_id ?? null };

async function rescanAndRefresh(companies?: string[]) {
  const r = await rescanPostings(pool(), (n, total) => progress(`${n.toLocaleString()} of ${total.toLocaleString()} postings scanned`), companies);
  progress("grouping titles and counting skills");
  const agg = await refreshAggregates(pool());
  progress("rebuilding role templates");
  const templates = await bulkTemplates(pool(), AUTO_TEMPLATES);
  progress("checking automatic skill growth");
  const auto_added = await autoAddSkills(pool());
  return { ...r, postings: agg.total, period: agg.period, templates, auto_added };
}

async function main() {
  if (spec.kind === "rescan") return rescanAndRefresh();
  if (spec.kind === "company-refresh") {
    const r = await rescanPostings(pool(), (n, total) => progress(`${n.toLocaleString()} of ${total.toLocaleString()} postings scanned`), undefined, spec.org_id);
    progress("grouping titles"); await canonicalizeTitles(pool());
    progress("summarising your postings"); await refreshOrgAggregates(pool(), spec.org_id);
    return { ...r, company: true };
  }
  if (spec.kind === "catalogue") {
    progress("adding skills");
    const added = await tx(c => loadCatalogue(c));
    await audit(pool(), user as any, { entity_type: "skill", entity_id: "catalogue", action: "catalogue_loaded", after: added });
    const rescan = added.added ? await rescanAndRefresh() : null;
    return { ...added, rescan, global_skills: await globalSkillCount(pool()) };
  }
  if (spec.kind === "upload") {
    try {
      const org: string | null = spec.org_id || null;
      const sourceId = await createSource(pool(), spec.name, spec.file_name, spec.licence || null, user.name);
      if (org) await q(pool(), `UPDATE job_sources SET org_id = $2 WHERE id = $1`, [sourceId, org]);
      const matchers = await loadMatchers(pool());
      let read = 0, imported = 0, batch: RawPosting[] = [];
      const flush = async () => { if (!batch.length) return; const b = batch; batch = []; imported += await tx(c => ingestBatch(c, sourceId, b, matchers)); progress(`${read.toLocaleString()} rows read, ${imported.toLocaleString()} imported`); };
      for await (const r of readRows(spec.path)) { read++; batch.push(r); if (batch.length >= 1000) await flush(); }
      await flush();
      if (org) {
        // a company's own postings: private to it, matched against global and company skills, summarised for that company only
        await q(pool(), `UPDATE job_postings SET org_id = $2 WHERE source_id = $1`, [sourceId, org]);
        const r = await rescanPostings(pool(), (n, total) => progress(`${n.toLocaleString()} of ${total.toLocaleString()} postings scanned`), undefined, org);
        progress("grouping titles"); await canonicalizeTitles(pool());
        progress("summarising your postings"); await refreshOrgAggregates(pool(), org);
        await q(pool(), `UPDATE job_sources SET rows_read = $2, rows_imported = $3 WHERE id = $1`, [sourceId, read, imported]);
        await audit(pool(), { ...user, org_id: org } as any, { org_id: org, entity_type: "job_source", entity_id: sourceId, action: "uploaded", after: { file: spec.file_name, read, imported } });
        return { source_id: sourceId, read, imported, duplicates: read - imported, scanned: r.scanned, company: true };
      }
      const companies = (await q(pool(), `SELECT DISTINCT company FROM job_postings WHERE source_id = $1`, [sourceId])).map(r => r.company);
      const res = await rescanAndRefresh(companies);
      await q(pool(), `UPDATE job_sources SET rows_read = $2, rows_imported = $3, period_from = $4, period_to = $5 WHERE id = $1`, [sourceId, read, imported, res.period?.f, res.period?.t]);
      await audit(pool(), user as any, { entity_type: "job_source", entity_id: sourceId, action: "uploaded", after: { file: spec.file_name, read, imported } });
      return { source_id: sourceId, read, imported, duplicates: read - imported, templates: res.templates, auto_added: res.auto_added, scanned: res.scanned };
    } finally { if (spec.dir) rmSync(spec.dir, { recursive: true, force: true }); }
  }
  throw new Error(`Unknown job ${spec.kind}`);
}

main().then(async r => { process.stdout.write(`RESULT ${JSON.stringify(r)}\n`); await pool().end(); process.exit(0); })
  .catch(async e => { process.stdout.write(`ERROR ${(e && e.message) || e}\n`); await pool().end().catch(() => {}); process.exit(1); });
void one;
