/* Runs scheduled reports. Started by start.ts next to the web server; checks every five minutes. */
import { pool } from "../src/server/db";
import { runDueSchedules } from "../src/server/modules/reports";

async function tick() {
  try { const n = await runDueSchedules(pool()); if (n) console.log(`Scheduled reports: ${n} run`); }
  catch (e: any) { console.error(`Report scheduler: ${e.message}`); }
}
tick(); setInterval(tick, 5 * 60_000);
