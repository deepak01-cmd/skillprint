# How to run the Role & Skill Intelligence Platform

> To put Skillprint online for testers on a cloud server (HTTPS, always on), follow **DEPLOY.md**.

## Windows without Docker (easiest)

You don't need Docker or a separate PostgreSQL install. The app can use its own **built-in database**, downloaded automatically and stored in the app folder.

1. Unzip `role-skill-platform.zip` into a **new** folder, for example `C:\role-skill-platform`.
2. Double-click **`start-windows.bat`**.
3. If Node.js 20 or newer is missing, the script offers to install it. Type **Y**. If it then says Node.js "is not on PATH yet", close the window and double-click `start-windows.bat` again.
4. When it asks *Which database should the app use?*, press **Enter** to accept the recommended choice:
   * **1, built-in database:** the default on Intel/AMD PCs.
   * **3, portable built-in database:** the default on ARM laptops (Snapdragon / Windows on ARM). It is PostgreSQL compiled to run inside Node.js, so it works on any processor with nothing extra installed. Its data is kept in the `.pglite` folder.
   * **2, my own PostgreSQL:** choose it only if you have a PostgreSQL server installed and running. The script then detects its port and asks for its password.
5. The first run takes about 4–8 minutes: it installs packages, builds the app, creates the database, loads the sample data and the skills catalogue, and imports the job postings. Your browser then opens **http://127.0.0.1:3000**. The password for every demo account is **`demo1234`**.
6. Keep the black window open while you use the app. To stop, close it or press Ctrl+C. To start again, double-click `start-windows.bat` (about 20 seconds). Your data is kept in the `.pgdata` folder.

* **Start over with fresh sample data:** close the window, delete the `.pgdata` folder (option 1) or the `.pglite` folder (option 3), then run `start-windows.bat` again.
* **Switch database:** delete the `.env` file, then run `start-windows.bat` again. It asks the question again.
* **"Windows protected your PC" message:** click *More info*, then *Run anyway*. The scripts are plain text you can open in Notepad.
* **If Windows Firewall asks about Node.js:** you can click *Cancel*. The app only listens on this PC.

## Updating to a new version

The zip contains one folder, `role-skill-platform`. **Do not extract it into your current app folder**, or the new version ends up inside the old one and the build fails (the start script now stops and says so).

1. Close the app.
2. Extract the new zip somewhere new, for example `C:\Apps\new`. You get `C:\Apps\new\role-skill-platform`.
3. To keep your data and settings, copy these from the old app folder into the new one:
   - the `.pgdata` folder (or `.pglite`, if you use the portable database);
   - `.env`;
   - the `models` folder.
4. Run `start-windows.bat` in the new folder.
5. Once it works, delete the old folder.

## Optional: a local AI model for missing roles

When someone searches for a role that is not in the framework, the app always shows a draft profile and sends it to HR for review.
Without an AI model the draft is built from the app's own data (job postings, templates, similar roles). With a local model it is
also written up: summary, responsibilities, skills with levels. The model runs on your PC; nothing is sent to the internet.

**Simplest, nothing to install:** put the model file in the app's `models` folder.

1. Get a GGUF model file, for example **Qwen2.5 3B Instruct, Q4_K_M** (about 2 GB):
   https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF → `qwen2.5-3b-instruct-q4_k_m.gguf`.
   Already downloaded Qwen with Ollama? The model is the largest file in `%USERPROFILE%\.ollama\models\blobs`
   (named like `sha256-1a2b…`); copy it into `models` and rename it to `qwen2.5-3b.gguf`.
2. Put the file in `models` (next to `start-windows.bat`) and start the app. The start window says "AI model file found".
3. **Role resolution** shows the model as connected. The first draft takes longer while the model loads (it then stays in memory).

The model runs inside the app (through the bundled llama.cpp library, which includes Windows on ARM), so Ollama is not needed.
A 3B model needs about 3 GB of free memory; a 7B model writes better drafts but needs about 6 GB.

**Alternatively** use Ollama or LM Studio: set `AI_PROVIDER=ollama` (or `openai`) in `.env`, see `.env.example`.

A draft takes roughly 20 seconds to 2 minutes on a laptop without a graphics card. AI drafts can be wrong: HR checks every one before it becomes a role.

## Fixing "WSL" errors in Docker Desktop (optional)

Docker Desktop on Windows needs WSL 2, and needs virtualisation enabled on your PC. Try these steps in order:

1. Open **PowerShell as Administrator** (Start menu, type *PowerShell*, right-click, *Run as administrator*) and run:
   ```powershell
   wsl --update
   wsl --shutdown
   ```
   Then restart Docker Desktop.
2. If it still fails, turn on the two Windows features WSL needs, then **restart the PC**:
   ```powershell
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   ```
3. After restarting, run `wsl --install --no-distribution`, then `wsl --set-default-version 2`.
4. Check that virtualisation is on: open Task Manager, then *Performance*, then *CPU*. It should say **Virtualization: Enabled**. If it says Disabled, turn on *Intel VT-x* or *AMD-V / SVM* in the BIOS/UEFI settings, or ask your IT team.
5. On company laptops, virtualisation or WSL is often blocked by policy. If so, use the Windows-without-Docker option above.


## Option A: Docker Desktop

You need Docker Desktop, started, with its engine running. Nothing else: Node.js and the database run inside Docker.

1. Unzip `role-skill-platform.zip`, for example to `C:\role-skill-platform` or `~/role-skill-platform`.
2. Start the app:
   * **Windows:** double-click **`run.bat`**.
   * **Mac/Linux:** open a terminal in the folder and run `./run.sh`.
3. Wait. The first start takes about **3–6 minutes**: it builds the app, creates the database, loads the sample data and imports the job postings in `data/`. Your browser then opens **http://localhost:3000**.
4. On the login page, click any demo account. The password for every account is **`demo1234`**.

| To… | Windows | Mac/Linux |
|---|---|---|
| Stop (keeps your data) | `stop.bat` | `./stop.sh` |
| Start again (about 20 seconds) | `run.bat` | `./run.sh` |
| Wipe everything and reload the sample | `reset.bat`, then `run.bat` | `./reset.sh`, then `./run.sh` |
| See the app's log | `docker compose logs -f app` | same |

You can also start it manually from a terminal in the folder: `docker compose up -d --build`.

**Demo accounts** (the same set exists for `medicore.demo` and `cloudnova.demo`):

| Who | Email |
|---|---|
| Platform administrator | `admin@platform.demo` |
| HR administrator | `hr@finedge.demo` |
| Department head | `head.dataanalytics@finedge.demo` |
| Manager | `manager.dataanalytics@finedge.demo` |
| Employee | `employee@finedge.demo` |
| Expert reviewer | `expert@finedge.demo` |

**Looking at the database with your own psql or pgAdmin.** The Docker database is published on port **5433**, so it doesn't clash with a PostgreSQL already running on 5432:
`psql -h localhost -p 5433 -U rsip rsip` (password `rsip`).

**Loading more job postings.** Put `.xlsx` or `.csv` files in the `data` folder. They're imported automatically the first time the app starts. To import a file later, for example the full 1 lakh file:

```bash
docker compose exec app npm run import-jobs -- data/full_jobs.xlsx --name "Jobs full"
```

## Option B: without Docker on Mac/Linux, using your own PostgreSQL

You need Node.js 20 or newer (https://nodejs.org) and PostgreSQL 14 or newer.

1. Create a database. In psql, signed in as the `postgres` user:
   ```sql
   CREATE DATABASE rsip;
   ```
   The first start runs `CREATE EXTENSION pg_trgm`, which needs a superuser (for example `postgres`). If you connect as a normal user, ask an administrator to run `CREATE EXTENSION pg_trgm;` in the `rsip` database first.
2. Start the app:
   * **Windows:** double-click **`run-local.bat`**.
   * **Mac/Linux:** run `./run-local.sh`.

   The first time, it creates a `.env` file and stops. Set `DATABASE_URL` in it, for example `postgres://postgres:YOURPASSWORD@localhost:5432/rsip`, then run the script again.
3. The script installs packages, builds the app, creates the tables, loads the sample data and imports `data/`. Then open **http://localhost:3000**.

## If something goes wrong

| Problem | Fix |
|---|---|
| "Docker is not running" | Open Docker Desktop and wait until it shows *Engine running*. |
| Port 3000 is already in use | In `docker-compose.yml`, change `"3000:3000"` to `"3001:3000"`, then open http://localhost:3001. |
| Port 5433 is already in use | In `docker-compose.yml`, change `"5433:5432"` to another port, such as `"5434:5432"`. |
| The first start seems stuck | Run `docker compose logs -f app`. You should see the migrations, "Seeded…", the job import and then "Ready". |
| Login does nothing | The app is probably not running. Check the black window: it should end with "Ready". If it says "Waiting for PostgreSQL", the database settings are wrong. Delete `.env` and run `start-windows.bat` again, choosing the built-in database. |
| "Waiting for PostgreSQL ... ECONNREFUSED" | No database server answers on that port. Use the built-in database (delete `.env`, run again, press Enter), or start your PostgreSQL service. |
| Start again from scratch | `reset.bat` or `./reset.sh`, then run again. |
| Windows: "running scripts is disabled" | Use the `.bat` files. They don't need PowerShell script permissions. |

## Loading your own data

Sign in as the HR administrator. Each screen has an **Upload** button: Organisation (departments), Skill library (skills),
Job roles (roles or job descriptions), a role's page (its required skills), Employees (people). Download the template from
the dialog or paste rows straight from Excel, check the row-by-row result, then save. A good order: departments, skills,
roles or job descriptions, required skills, employees.

**Grow from job market** (HR) turns real job postings into draft roles with skill requirements in a few clicks.
The platform administrator can upload more job-posting files on the **Data growth** screen.

To try the app at a realistic size, add 5,000 synthetic employees (the app must be stopped, or use a second window):

```bash
npm run generate-demo -- --org C001 --employees 5000
```

(In portable mode, stop the app first: the portable database accepts one program at a time.)

## Before using it with real people

* Change `SESSION_SECRET` in `docker-compose.yml` to a long random value.
* Set `DEMO_MODE: "false"` to hide the demo account list.
* Serve the app over HTTPS and set `COOKIE_SECURE: "true"`.
* The sample employees are synthetic. Use `reset`, then load your own data with the Import centre.
