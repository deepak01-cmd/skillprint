/* Production start-up, used by Docker and by run-local scripts:
   1. wait for PostgreSQL   2. apply migrations   3. load the sample data if the database is empty
   4. import job-posting files from ./data if none are loaded yet   5. start the web server */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

// DB_MODE=embedded: run a private PostgreSQL from node_modules, stored in ./.pgdata (nothing to install).
const embedded = process.env.DB_MODE === "embedded";
let url = process.env.DATABASE_URL || "postgres://rsip:rsip@localhost:5432/rsip";
let embeddedPg: any = null;
const port = process.env.PORT || "3000";
const tsx = require.resolve("tsx/cli");
const nextBin = require.resolve("next/dist/bin/next");
// Asynchronous on purpose: in portable (wasm) mode the database server runs inside this process,
// so blocking here while a child script talks to it would deadlock.
const run = (script: string, args: string[] = []) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, [tsx, join("scripts", script), ...args], { stdio: "inherit", env: process.env });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${script} failed`)));
});

import { Socket } from "node:net";
const portOpen = (host: string, port: number) => new Promise<boolean>(res => {
  const s = new Socket(); s.setTimeout(800);
  s.once("connect", () => { s.destroy(); res(true); }).once("error", () => res(false)).once("timeout", () => { s.destroy(); res(false); });
  s.connect(port, host);
});
async function hint(): Promise<string> {
  let u: URL; try { u = new URL(url); } catch { return "DATABASE_URL is not a valid postgres:// address."; }
  const host = u.hostname || "localhost", port = Number(u.port || 5432);
  const open: number[] = [];
  for (const p of [5432, 5433, 5434, 5435]) if (p !== port && await portOpen(host, p)) open.push(p);
  return open.length ? `Nothing answers on port ${port}, but something is listening on port ${open.join(", ")}. Set that port in DATABASE_URL (in .env) and start again.`
    : `Nothing answers on ${host}:${port}. Check that the PostgreSQL service is running (Windows: Services > postgresql-x64-..) and that the port in DATABASE_URL is right.`;
}

async function waitForDb() {
  const tries = Number(process.env.DB_WAIT_TRIES || 30);
  for (let i = 1; i <= tries; i++) {
    const c = new Client({ connectionString: url });
    try { await c.connect(); await c.end(); return; }
    catch (e: any) {
      await c.end().catch(() => {});
      if (e.code === "28P01") throw new Error("PostgreSQL rejected the user name or password in DATABASE_URL. Fix it in .env (or delete .env and run start-windows.bat again).");
      if (e.code === "3D000") throw new Error(`The database in DATABASE_URL does not exist. Create it first (CREATE DATABASE rsip;) or run start-windows.bat, which creates it.`);
      if (i === 1 || i % 5 === 0) console.log(`Waiting for PostgreSQL at ${url.replace(/:[^:@/]+@/, ":***@")} (${e.code || e.message})`);
      if (i === 5) console.log("  Hint: " + await hint());
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error("PostgreSQL did not become reachable. " + await hint());
}

async function count(sql: string) {
  const c = new Client({ connectionString: url }); await c.connect();
  try { return Number((await c.query(sql)).rows[0].n); } catch { return 0; } finally { await c.end(); }
}

let localStop: (() => void) | null = null;
async function startEmbedded() {
  let port = Number(process.env.EMBEDDED_DB_PORT || 54329);
  // Windows (x64 and ARM) and non-root Unix: run the binaries directly with initdb/pg_ctl
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (process.platform === "win32" || (!isRoot && process.env.LOCAL_PG !== "package")) {
    const { startLocalPg } = await import("./local-pg");
    while (await portOpen("127.0.0.1", port)) {
      // a server left running by an earlier window is reused by startLocalPg; only skip ports used by something else
      if (existsSync(join(process.cwd(), ".pgdata", "postmaster.pid"))) break;
      port++;
    }
    const r = await startLocalPg(port);
    localStop = r.stop; url = r.url; process.env.DATABASE_URL = url;
    console.log(`Built-in database ready (data in .pgdata).`);
    return;
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = join(process.cwd(), ".pgdata");
  while (await portOpen("127.0.0.1", port)) port++;
  const make = () => new EmbeddedPostgres({ databaseDir: dir, user: "rsip", password: "rsip", port, persistent: true,
    onLog: () => {}, onError: (m: unknown) => { const t = String(m); if (/FATAL|PANIC|could not/i.test(t)) console.error("  database: " + t.trim()); },
    createPostgresUser: typeof process.getuid === "function" && process.getuid() === 0 });
  embeddedPg = make();
  if (!existsSync(join(dir, "PG_VERSION"))) { console.log("Creating the built-in database (first run only)…"); await embeddedPg.initialise(); }
  try { await embeddedPg.start(); }
  catch (e) {
    // a window closed while the database ran can leave a stale lock file behind
    const pid = join(dir, "postmaster.pid");
    if (!existsSync(pid)) throw e;
    console.log("Removing a stale database lock left by an earlier run…");
    rmSync(pid, { force: true });
    embeddedPg = make(); await embeddedPg.start();
  }
  try { await embeddedPg.createDatabase("rsip"); } catch { /* already exists */ }
  url = `postgres://rsip:rsip@127.0.0.1:${port}/rsip`;
  process.env.DATABASE_URL = url;
  console.log(`Built-in database running on port ${port} (data in .pgdata).`);
}
// DB_MODE=wasm: PostgreSQL compiled to WebAssembly (PGlite), served on a local socket.
// Runs on any processor with no native programs or system DLLs. One session, so the app uses one connection.
let wasmServer: any = null, wasmDb: any = null;
async function startWasm() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const dataDir = join(process.cwd(), ".pglite");
  // a folder left by an attempt that did not finish has no PG_VERSION: move it aside (never delete data) and start clean
  if (existsSync(dataDir) && !existsSync(join(dataDir, "PG_VERSION"))) {
    const aside = `${dataDir}-incomplete-${Date.now()}`;
    renameSync(dataDir, aside);
    console.log(`An unfinished database folder was moved to ${aside}.`);
  }
  const creating = !existsSync(dataDir);
  console.log(creating ? "Creating the built-in database (portable mode, first run only)…" : "Opening the built-in database (portable mode)…");
  // keep the process alive and show progress while the database engine works; give up with a clear message after 5 minutes
  const t0 = Date.now();
  const tick = setInterval(() => console.log(`  …still working on the database (${Math.round((Date.now() - t0) / 1000)} s)`), 15000);
  const limit = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The built-in database did not start within 5 minutes.")), 300000).unref());
  try {
    const base = join(process.cwd(), "db", "pglite-base.tar.gz");
    if (creating && existsSync(base)) {
      // unpack a ready-made empty database: no initialisation step runs on this PC
      try {
        wasmDb = await Promise.race([PGlite.create({ dataDir, loadDataDir: new Blob([readFileSync(base)]), extensions: { pg_trgm } }), limit]);
      } catch (e: any) {
        console.log(`  Unpacking the ready-made database did not work (${e?.message || e}); creating one instead…`);
        try { await wasmDb?.close(); } catch { /* not open */ }
        if (existsSync(dataDir)) renameSync(dataDir, `${dataDir}-incomplete-${Date.now()}`);
        wasmDb = await Promise.race([PGlite.create({ dataDir, extensions: { pg_trgm } }), limit]);
      }
    } else {
      wasmDb = await Promise.race([PGlite.create({ dataDir, extensions: { pg_trgm } }), limit]);
    }
    await Promise.race([wasmDb.query("select 1"), limit]);
  } catch (e: any) {
    throw new Error(`The built-in database could not ${creating ? "be created" : "be opened"}: ${e?.message || e}. ` +
      (creating ? "If you have the previous version's .pglite folder, copy it into this folder and start again." : "If you copied .pglite from another folder, make sure the copy is complete."));
  } finally { clearInterval(tick); }
  let port = Number(process.env.EMBEDDED_DB_PORT || 54329);
  while (await portOpen("127.0.0.1", port)) port++;
  // 2 slots: the app uses one connection (PG_POOL_MAX=1); the spare lets a replacement connect while a discarded one is still closing
  wasmServer = new PGLiteSocketServer({ db: wasmDb, port, host: "127.0.0.1", maxConnections: 2 });
  await wasmServer.start();
  url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.PG_POOL_MAX = "1";
  console.log(`Built-in database ready on port ${port} (portable mode, data in .pglite).`);
}

async function stopEmbedded() {
  if (wasmServer) { try { await wasmServer.stop(); } catch { /* stopped */ } wasmServer = null; }
  if (wasmDb) { try { await wasmDb.close(); } catch { /* closed */ } wasmDb = null; } if (localStop) { const f = localStop; localStop = null; f(); } if (embeddedPg) { try { await embeddedPg.stop(); } catch { /* already stopped */ } embeddedPg = null; } }

async function main() {
  if (process.env.DB_MODE === "wasm") await startWasm();
  else if (embedded) await startEmbedded();
  await waitForDb();
  console.log("Applying database migrations…");
  await run("migrate.ts");
  if ((await count("SELECT count(*) AS n FROM organisations")) === 0) {
    console.log("Empty database: loading the v3 sample workbook and demo accounts…");
    await run("seed.ts");
  } else console.log("Data already present: sample load skipped.");
  // the skills catalogue goes in before job postings are read, so they are scanned once with the full library
  if (process.env.GROW_DATA !== "false") { console.log("Checking the skills catalogue…"); await run("grow.ts"); }
  const dataDir = join(process.cwd(), "data"); let imported = false;
  if (process.env.IMPORT_JOBS !== "false" && existsSync(dataDir) && (await count("SELECT count(*) AS n FROM job_sources")) === 0) {
    for (const f of readdirSync(dataDir).filter(f => /\.(xlsx|csv)$/i.test(f) && !f.startsWith("~$"))) {
      console.log(`Importing job postings from data/${f}…`);
      try { await run("import-jobs.ts", [join(dataDir, f), "--name", f]); imported = true; } catch (e: any) { console.error(`Job import of ${f} failed: ${e.message}. The app still starts.`); }
    }
  }
  if (imported && process.env.GROW_DATA !== "false") { console.log("Building role templates from the job postings…"); await run("grow.ts"); }
  try { await run("demo-extras.ts"); } catch (e: any) { console.error(`Demo jobs were not added: ${e.message}`); }
  // reference data shipped with the app (O*NET files in data/reference/onet), loaded once
  try { await run("reference-load.ts", [join(process.cwd(), "data", "reference", "onet"), "--version", "31.0", "--publish", "--if-missing"]); } catch (e: any) { console.error(`Reference data was not loaded: ${e.message}. The app still starts; load it from Reference data.`); }
  console.log(`\nStarting the app on http://localhost:${port}  (demo password: demo1234)\n`);
  started = true;
  const child = spawn(process.execPath, [nextBin, "start", "-H", process.env.HOST || "0.0.0.0", "-p", port], { stdio: "inherit", env: process.env });
  // scheduled reports run in their own process so they never slow the app down
  const sched = spawn(process.execPath, [tsx, join("scripts", "scheduler.ts")], { stdio: "inherit", env: process.env });
  sched.on("error", () => { /* the app works without it */ });
  const stop = () => { sched.kill("SIGTERM"); child.kill("SIGTERM"); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  child.on("exit", async code => { sched.kill("SIGTERM"); await stopEmbedded(); process.exit(code ?? 0); });
}
// Node ends quietly when nothing is left to wait for (a stalled step): report it instead of closing without a word
let started = false;
process.on("beforeExit", () => { if (!started) { console.error("The app stopped during start-up without an error message. Please send the lines above to your developer."); process.exit(1); } });
main().catch(async e => { started = true; console.error(e?.message || e); if (e?.stack && process.env.DEBUG) console.error(e.stack); await stopEmbedded(); process.exit(1); });
