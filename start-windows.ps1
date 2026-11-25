# Role & Skill Intelligence Platform - run on Windows WITHOUT Docker. Started by start-windows.bat.
# Database: the built-in one (nothing to install, stored in .pgdata) or your own PostgreSQL.
# Continue, not Stop: in Windows PowerShell 5.1 "Stop" turns any stderr line from psql/npm into a crash; exit codes are checked instead.
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say ""; Say "  PROBLEM: $msg" Red; Say ""; Read-Host "Press Enter to close"; exit 1 }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

# A newer version unzipped INTO this folder ends up in a sub-folder; the build would then mix the two versions
$nested = Get-ChildItem -Path $PSScriptRoot -Directory -ErrorAction SilentlyContinue | Where-Object { (Test-Path (Join-Path $_.FullName "package.json")) -and (Test-Path (Join-Path $_.FullName "start-windows.ps1")) } | Select-Object -First 1
if ($nested) {
  Say ""
  Say "  A copy of the app is inside the folder '$($nested.Name)' here." Yellow
  Say "  This usually happens when a new version's zip is extracted into the old app folder." Yellow
  Say "  Use the new version: open the folder '$($nested.FullName)' and run start-windows.bat from there." Yellow
  Say "  (Your data stays in this folder's .pgdata / .pglite; copy that folder and your .env and models folder across to keep them.)" Yellow
  Fail "Two versions of the app are mixed in one folder. Run the new one from its own folder."
}

Say ""
Say "  Role & Skill Intelligence Platform (no Docker)" Cyan
Say "  ----------------------------------------------" Cyan

# ---------- 1. Node.js 20 or newer ----------
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) { $v = (& node -v) -replace "v", ""; $nodeOk = ([int]($v.Split(".")[0]) -ge 20) }
if (-not $nodeOk) {
  Say "  Node.js 20 or newer is needed and was not found." Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $ans = Read-Host "  Install Node.js LTS now with winget? (Y/N)"
    if ($ans -match "^[Yy]") {
      winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
      Refresh-Path
      if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js was installed but is not on PATH yet. Close this window and double-click start-windows.bat again." }
    } else { Start-Process "https://nodejs.org/en/download"; Fail "Install Node.js LTS from nodejs.org, then run start-windows.bat again." }
  } else { Start-Process "https://nodejs.org/en/download"; Fail "Install Node.js LTS from nodejs.org, then run start-windows.bat again." }
}
Say ("  Node.js " + (& node -v) + " found.") Green

# ---------- helpers ----------
function Read-EnvFile {
  $h = @{}
  if (Test-Path ".env") { Get-Content ".env" | Where-Object { $_ -match "^\s*[A-Za-z_][A-Za-z0-9_]*\s*=" } | ForEach-Object { $k, $val = $_ -split "=", 2; $h[$k.Trim()] = $val.Trim() } }
  return $h
}
function New-Secret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ }) }
function Write-EnvFile($lines) {
  @("# Created by start-windows.ps1. Delete this file to choose the database again.") + $lines + @("SESSION_SECRET=$(New-Secret)", "COOKIE_SECURE=false", "DEMO_MODE=true", "PORT=3000") | Set-Content -Path ".env" -Encoding ASCII
}
function Find-Psql {
  $p = Get-Command psql -ErrorAction SilentlyContinue
  if ($p) { return $p.Source }
  $c = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object { [int]("0" + ($_.Directory.Parent.Name -replace "[^0-9].*", "")) } -Descending | Select-Object -First 1
  if ($c) { return $c.FullName }
  return $null
}
function Find-PgPorts {
  $ids = @(Get-Process -Name postgres -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $ids.Count) { return @() }
  return @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | ForEach-Object { $_.LocalPort } | Sort-Object -Unique)
}
function Test-SavedConnection($url) {
  try { $u = [uri]$url } catch { return "the saved DATABASE_URL is not valid" }
  $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  $listening = @(Find-PgPorts | Where-Object { $_ -ne 54329 })
  if (-not $listening.Count) { return "no PostgreSQL server is running on this PC" }
  if (-not ($listening -contains $port)) { return "PostgreSQL is listening on port $($listening -join ', '), but .env uses port $port" }
  $psql = Find-Psql
  if (-not $psql) { return $null }
  $user, $pass = $u.UserInfo -split ":", 2
  $env:PGPASSWORD = [uri]::UnescapeDataString("$pass")
  & $psql -h $u.Host -p $port -U ([uri]::UnescapeDataString($user)) -d ($u.AbsolutePath.TrimStart("/")) -tAc "select 1" *> $null
  $ok = ($LASTEXITCODE -eq 0); Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($ok) { return $null }
  return "could not sign in with the saved user and password"
}
function Use-Builtin {
  Write-EnvFile @("DB_MODE=embedded")
  Say "  Using the built-in database (stored in the .pgdata folder)." Green
}
function Use-Portable {
  Write-EnvFile @("DB_MODE=wasm")
  Say "  Using the portable built-in database (stored in the .pglite folder)." Green
}
$isArmPc = ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") -or ($env:PROCESSOR_ARCHITEW6432 -eq "ARM64")
function Use-OwnPostgres {
  $psql = Find-Psql
  if (-not $psql) { Say "  PostgreSQL (psql.exe) was not found on this PC." Yellow; return $false }
  $found = @(Find-PgPorts)
  if (-not $found.Count) { Say "  PostgreSQL is installed but its server is not running. Start the 'postgresql-x64-..' service (Windows key, type Services), or use the built-in database." Yellow; return $false }
  Say "  PostgreSQL is running on port $($found -join ', ')." Green
  $pgPort = Read-Host "  Port [$($found[0])]"; if (-not $pgPort) { $pgPort = "$($found[0])" }
  $pgUser = Read-Host "  User [postgres]"; if (-not $pgUser) { $pgUser = "postgres" }
  $sec = Read-Host "  Password for $pgUser (the one you chose when installing PostgreSQL)" -AsSecureString
  $pgPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $env:PGPASSWORD = $pgPass
  & $psql -h localhost -p $pgPort -U $pgUser -d postgres -tAc "select 1" *> $null
  if ($LASTEXITCODE -ne 0) { Remove-Item Env:PGPASSWORD; Say "  Could not sign in to PostgreSQL on port $pgPort as $pgUser (wrong password?)." Yellow; return $false }
  $exists = ((& $psql -h localhost -p $pgPort -U $pgUser -d postgres -tAc "select 1 from pg_database where datname='rsip'") -join "").Trim()
  if ($exists -ne "1") { & $psql -h localhost -p $pgPort -U $pgUser -d postgres -c "CREATE DATABASE rsip" | Out-Null }
  & $psql -h localhost -p $pgPort -U $pgUser -d rsip -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" | Out-Null
  $ok = ($LASTEXITCODE -eq 0); Remove-Item Env:PGPASSWORD
  if (-not $ok) { Say "  Could not prepare the database 'rsip' (the user needs rights to create databases and extensions)." Yellow; return $false }
  Write-EnvFile @("DATABASE_URL=postgres://" + [uri]::EscapeDataString($pgUser) + ":" + [uri]::EscapeDataString($pgPass) + "@localhost:" + $pgPort + "/rsip")
  Say "  Saved the connection to your PostgreSQL in .env" Green
  return $true
}

# ---------- 2. Database ----------
$envVars = Read-EnvFile
$ready = $false
if ($envVars["DB_MODE"] -eq "wasm") { $ready = $true; Say "  Using the portable built-in database." Green }
elseif ($envVars["DB_MODE"] -eq "embedded" -and $isArmPc -and -not (Test-Path ".pgdata\PG_VERSION")) {
  Say "  Last time the built-in database could not be set up on this ARM PC." Yellow
  $sw = Read-Host "  Switch to the portable built-in database, which works on ARM? (Y/N) [Y]"
  if ($sw -notmatch "^[Nn]") { if (Test-Path ".pgdata") { Remove-Item -Recurse -Force ".pgdata" -ErrorAction SilentlyContinue }; Use-Portable } else { Say "  Keeping the built-in database." }
  $ready = $true
}
elseif ($envVars["DB_MODE"] -eq "embedded") { $ready = $true; Say "  Using the built-in database." Green }
elseif ($envVars["DATABASE_URL"] -and $envVars["DATABASE_URL"] -notmatch "YOUR_PASSWORD") {
  $problem = Test-SavedConnection $envVars["DATABASE_URL"]
  if ($problem) { Say "  The saved database connection does not work: $problem." Yellow; Move-Item -Force ".env" ".env.old" }
  else { $ready = $true; Say "  Your PostgreSQL connection works." Green }
}
while (-not $ready) {
  $default = if ($isArmPc) { "3" } else { "1" }
  Say ""
  Say "  Which database should the app use?" Cyan
  Say "    1  Built-in database - nothing to install (Intel/AMD PCs)"
  Say "    2  My own PostgreSQL server (already installed and running)"
  Say "    3  Portable built-in database - works on every PC, including ARM laptops"
  if ($isArmPc) { Say "  This PC has an ARM processor, so 3 is recommended." Yellow }
  $choice = Read-Host "  Choose 1, 2 or 3 [$default]"
  if (-not $choice) { $choice = $default }
  if ($choice -eq "2") { $ready = Use-OwnPostgres } elseif ($choice -eq "3") { Use-Portable; $ready = $true } else { Use-Builtin; $ready = $true }
}
$envVars = Read-EnvFile
foreach ($k in $envVars.Keys) { Set-Item -Path "Env:$k" -Value $envVars[$k] }
$env:NODE_ENV = "production"; $env:NEXT_TELEMETRY_DISABLED = "1"; $env:HOST = "127.0.0.1"

# ---------- 3. Install and build when this version is new ----------
$version = if (Test-Path "app-version.txt") { (Get-Content "app-version.txt" -Raw).Trim() } else { "dev" }
$builtVersion = if (Test-Path ".next\app-version.txt") { (Get-Content ".next\app-version.txt" -Raw).Trim() } else { "" }
$needInstall = (-not (Test-Path "node_modules\@electric-sql\pglite")) -or (-not (Test-Path "node_modules\typescript")) -or (-not (Test-Path "node_modules\embedded-postgres")) -or (-not (Test-Path "node_modules\next")) -or ($builtVersion -ne $version)
if ($needInstall) {
  Say ""; Say "  Installing packages (first run of this version, 1-3 minutes)..." Cyan
  & npm.cmd ci --include=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "Package installation failed. Check your internet connection and run again." }
}
if ((-not (Test-Path ".next\BUILD_ID")) -or ($builtVersion -ne $version)) {
  Say ""; Say "  Building the app (1-3 minutes)..." Cyan
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { Fail "The build failed. Send the messages above to your developer." }
  Set-Content -Path ".next\app-version.txt" -Value $version -Encoding ASCII
}

# ---------- 3b. Built-in database files and runtime ----------
if ($env:DB_MODE -eq "embedded") {
  $isArm = ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") -or ($env:PROCESSOR_ARCHITEW6432 -eq "ARM64")
  $pgBin = "node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe"
  if (-not (Test-Path $pgBin)) {
    if ($isArm) { Say "  This PC has an ARM processor. Fetching the x64 database files (Windows 11 runs them through its built-in x64 emulation)..." Cyan }
    else { Say "  Fetching the database files..." Cyan }
    $ver = (Get-Content "package.json" -Raw | ConvertFrom-Json).dependencies."embedded-postgres"
    $tmp = Join-Path $env:TEMP "rsip-pg"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Get-ChildItem $tmp -Filter "*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force
    Push-Location $tmp; & npm.cmd pack "@embedded-postgres/windows-x64@$ver" --silent | Out-Null; Pop-Location
    $tgz = Get-ChildItem $tmp -Filter "embedded-postgres-windows-x64-*.tgz" | Select-Object -First 1
    if (-not $tgz) { Fail "Could not download the database files. Check your internet connection, or choose your own PostgreSQL (delete .env and run again)." }
    $dest = "node_modules\@embedded-postgres\windows-x64"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    & tar.exe -xzf $tgz.FullName -C $dest --strip-components=1
    if (-not (Test-Path $pgBin)) { Fail "Could not unpack the database files ($($tgz.Name))." }
    Say "  Database files ready." Green
  }
  # The database programs need the x64 Microsoft Visual C++ runtime (on ARM PCs too, because they run emulated)
  $vc = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" -ErrorAction SilentlyContinue
  $vcOk = ($vc -and $vc.Installed -eq 1) -or ((-not $isArm) -and (Test-Path "$env:WINDIR\System32\vcruntime140.dll") -and (Test-Path "$env:WINDIR\System32\msvcp140.dll"))
  if (-not $vcOk) {
    Say "  Installing the Microsoft Visual C++ runtime (x64) needed by the database. Windows may ask for permission." Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) { winget install --id Microsoft.VCRedist.2015+.x64 -e --accept-package-agreements --accept-source-agreements }
    else { Start-Process "https://aka.ms/vs/17/release/vc_redist.x64.exe"; Fail "Run the downloaded vc_redist.x64.exe, then start-windows.bat again." }
  }
}

# ---------- 4. Free port ----------
$port = [int]$env:PORT
while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $port++ }
$env:PORT = "$port"
$appUrl = "http://127.0.0.1:$port"

# ---------- 5. Open the browser when ready, then run ----------
Start-Job -ArgumentList $appUrl -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 300; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$u/api/v1/health" | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 3 }
  }
} | Out-Null
# ---------- optional: local AI model for drafting missing roles ----------
$gguf = Get-ChildItem -Path (Join-Path $PSScriptRoot "models") -Filter *.gguf -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
$prov = "$($envVars["AI_PROVIDER"])".ToLower()
if ($envVars["OPENROUTER_API_KEY"] -and ($prov -eq "" -or $prov -eq "auto" -or $prov -eq "openrouter")) { Say "  AI: OpenRouter (online service). Draft requests are sent to OpenRouter; the models folder is not used." Green }
elseif ($prov -eq "openrouter") { Say "  AI_PROVIDER=openrouter but OPENROUTER_API_KEY is missing in .env: drafts are made from the app's own data." Yellow }
elseif ($gguf) { Say ("  AI model file found: " + $gguf.Name + " (" + [math]::Round($gguf.Length / 1GB, 1) + " GB). Missing roles get an AI-written draft.") Green }
else { Say "  Optional: put a .gguf model file (for example qwen2.5-3b-instruct-q4_k_m.gguf) in the models folder for AI-written drafts. See models\README.txt." DarkGray }
Say ""
Say "  Starting. The first start loads the sample data and the job postings (about 1-2 minutes)." Cyan
Say "  Your browser opens $appUrl when it is ready. Demo password: demo1234" Cyan
Say "  Keep this window open while you use the app. To stop: press Ctrl+C, or close the window." Yellow
Say ""
& npm.cmd run start:prod
Read-Host "The app stopped. Press Enter to close"
