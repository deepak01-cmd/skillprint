/* Private PostgreSQL run directly from the @embedded-postgres binary packages with initdb and pg_ctl.
   Used on Windows for every processor: Windows on ARM runs the x64 build through Windows 11's x64 emulation,
   so no native ARM64 build is needed. Data lives in ./.pgdata, the server listens on 127.0.0.1 only. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";

const USER = "rsip", PASSWORD = "rsip";

export function binDir(): string {
  const pkgs = process.platform === "win32" ? ["windows-x64"]
    : process.platform === "darwin" ? (process.arch === "arm64" ? ["darwin-arm64", "darwin-x64"] : ["darwin-x64"])
    : [`linux-${process.arch}`];
  for (const p of pkgs) {
    const d = join(process.cwd(), "node_modules", "@embedded-postgres", p, "native", "bin");
    if (existsSync(join(d, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl"))) return d;
  }
  throw new Error(`The built-in database files for ${process.platform}/${process.arch} are missing (looked for @embedded-postgres/${pkgs.join(" or ")}). Run start-windows.bat again, or use your own PostgreSQL.`);
}

function exe(dir: string, name: string) { return join(dir, process.platform === "win32" ? `${name}.exe` : name); }
const ARM_HINT = process.platform === "win32" && process.arch === "arm64"
  ? " This PC has an ARM processor: the database runs through Windows 11's x64 emulation and needs the x64 Microsoft Visual C++ runtime. If a Windows error window appeared, note its text. You can also choose the portable database instead (delete .env, run start-windows.bat, choose 3)." : "";
function run(cmd: string, args: string[], what: string, opts: { visible?: boolean; timeoutSec?: number } = {}) {
  // visible: show the program's own progress lines and any Windows error dialog instead of hiding them
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: !opts.visible, stdio: opts.visible ? "inherit" : "pipe", timeout: (opts.timeoutSec ?? 120) * 1000 });
  if (r.error && (r.error as any).code === "ETIMEDOUT") throw new Error(`${what} did not finish within ${opts.timeoutSec ?? 120} seconds and was stopped.${ARM_HINT}`);
  if (r.error) throw new Error(`${what} could not run: ${r.error.message}.${ARM_HINT}`);
  return r;
}

/** Port of a running server, read from postmaster.pid (line 4), or null if none is running. */
function runningPort(dir: string, pgData: string): number | null {
  const st = run(exe(dir, "pg_ctl"), ["status", "-D", pgData], "pg_ctl status");
  if (st.status !== 0) return null;
  try { return Number(readFileSync(join(pgData, "postmaster.pid"), "utf8").split(/\r?\n/)[3]) || null; } catch { return null; }
}

export async function startLocalPg(port: number): Promise<{ url: string; stop: () => void }> {
  const dir = binDir();
  const pgData = join(process.cwd(), ".pgdata");
  const log = join(process.cwd(), ".pgdata.log");
  if (!existsSync(join(pgData, "PG_VERSION"))) {
    console.log("Creating the built-in database (first run only)…");
    if (existsSync(pgData)) rmSync(pgData, { recursive: true, force: true });   // half-created folder from a failed first run
    mkdirSync(pgData, { recursive: true });
    const pw = join(tmpdir(), `rsip-pw-${process.pid}.txt`);
    writeFileSync(pw, PASSWORD);
    console.log("  (the database tool prints its own steps below; this normally takes under a minute)");
    let r;
    try { r = run(exe(dir, "initdb"), ["-D", pgData, "-U", USER, `--pwfile=${pw}`, "-A", "scram-sha-256", "-E", "UTF8", "--no-locale"], "Creating the database (initdb)", { visible: true, timeoutSec: 300 }); }
    finally { rmSync(pw, { force: true }); }
    if (r.status !== 0) { rmSync(pgData, { recursive: true, force: true }); throw new Error(`Creating the database failed (exit code ${r.status}). See the lines above.${ARM_HINT}`); }
  }
  let active = runningPort(dir, pgData);
  if (active) console.log(`Built-in database already running on port ${active}.`);
  else {
    const r = run(exe(dir, "pg_ctl"), ["start", "-D", pgData, "-w", "-t", "120", "-l", log, "-o", `-p ${port} -c listen_addresses=127.0.0.1`], "Starting the database (pg_ctl)", { timeoutSec: 150 });
    if (r.status !== 0) {
      let tail = ""; try { tail = readFileSync(log, "utf8").split(/\r?\n/).slice(-12).join("\n"); } catch { /* no log */ }
      throw new Error(`The built-in database did not start.\n${(r.stderr || r.stdout || "").trim()}\n${tail}`);
    }
    active = port;
  }
  const admin = new Client({ host: "127.0.0.1", port: active, user: USER, password: PASSWORD, database: "postgres" });
  await admin.connect();
  const has = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'rsip'");
  if (!has.rowCount) await admin.query("CREATE DATABASE rsip");
  await admin.end();
  const p = active;
  return {
    url: `postgres://${USER}:${PASSWORD}@127.0.0.1:${p}/rsip`,
    stop: () => { spawnSync(exe(dir, "pg_ctl"), ["stop", "-D", pgData, "-m", "fast", "-w"], { windowsHide: true }); },
  };
}
