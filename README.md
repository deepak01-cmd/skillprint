# Skillprint · Role & Skill Intelligence Platform

> **To run it, see [RUN.md](RUN.md).** Windows without Docker: double-click `start-windows.bat` (built-in database, nothing else to install). With Docker Desktop: `run.bat`, or `./run.sh` on Mac/Linux.


Multi-tenant B2B web application built from the consolidated PRD (v3.0) and the *Developer Guide – Role Skill Framework v3*.
It covers job architecture, a reusable skill library, role-skill mapping with **Pixel IDs** and archived-skill lifecycle,
proficiency, governance, employees, assessments, gap analysis, development plans, career mobility, workforce planning,
a lean evolution module, search, dashboards and audit, with a different experience for each user type.

> To put Skillprint online for testers on a cloud server (HTTPS, always on), follow **DEPLOY.md**.

## Run it

Requirements: Node 22, PostgreSQL 16.

```bash
cp .env.example .env              # set DATABASE_URL and SESSION_SECRET
npm install
npm run db:reset                  # create schema + load the v3 sample workbook and synthetic people
npm run build && npm start        # http://localhost:3000  (or: npm run dev)
```

Sign in with any demo account listed on the login page. **Every demo password is `demo1234`.**

| Persona | Example account | What they can do |
|---|---|---|
| Platform administrator | `admin@platform.demo` | Create and suspend organisations (tenants), manage the global skill library, platform-wide data checks |
| HR administrator (framework curator) | `hr@finedge.demo` | Everything in their organisation: structure, roles, skills, mappings, archive/restore, approvals, employees, assessments, plans, paths, workforce plans, evolution, audit |
| Department head | `head.dataanalytics@finedge.demo` | Draft roles and mappings for their department, propose archive/restore, see archived skills for their department, aggregated gaps and readiness, plan their department's headcount |
| Manager | `manager.dataanalytics@finedge.demo` | Team skill matrix, assign and review assessments, team gaps, development plans, aspirations only when shared |
| Employee | `employee@finedge.demo` | Own profile and gaps, self-assessment (shown as self-reported), evidence, development plan, career aspirations and readiness, future-ready skills |
| Expert reviewer | `expert@finedge.demo` | Review assigned assessments (records validated levels), review evolution suggestions for assigned job families |

The same set exists for `medicore.demo` and `cloudnova.demo`.

## Tests

```bash
npm test        # resets and seeds the rsip_test database, then runs 109 tests
node scripts/uat-browser.js   # browser walk-through of the UI parts of the UAT sheet (app running on :3000)
```

* `tests/calc.test.ts` – PRD 33.1 and 33.2 worked examples (gaps, path comparison, readiness, role plan, skill outlook) and trend scoring.
* `tests/framework.test.ts` – Developer Guide 9.1 reconciliation, every 9.2 test case, PRD scenarios V3-01 to V3-08, constraints, tenancy.
* `tests/workflows.test.ts` – end-to-end flows per persona (role publishing, assessments, privacy of aspirations, plans, evolution drafts, imports).
* `tests/smoke.test.ts` – 59 read endpoints for six personas: no server errors, only 200/403/404/422.
* `tests/uat.test.ts` – the User Acceptance Test sheet: TC01–TC18 and questions Q1–Q11 (Q7 is covered by the workflow tests).
* `tests/market.test.ts` – job-postings import: title normalisation, skill extraction, grouping, role market check, fallback, templates, candidate skills.
* `tests/fallback.test.ts` – the role fallback (matching, queue, learning aliases, templates, release on publish).
* `tests/imports.test.ts` – the import centre: CSV and Excel parsing, templates and export round trip, every entity, draft vs publish mode, permissions.
* `tests/variants.test.ts` – spelling variants (.NET, dotnet, Dot Net…), title grouping, skill discovery, candidate review.
* `tests/library.test.ts` – two-step approval, reviewers, retire/reinstate/merge, undo of automatic runs, company job postings (privacy, roles, frameworks, company skills).
* `tests/moves.test.ts` – the move planner: metrics match the role comparison, fingerprint, nearest moves, Mandatory-only, archive rules, tenancy.
* `tests/scale.test.ts` – skills catalogue, employer-boilerplate removal, bulk templates, draft roles from market titles.

## Look and feel

The theme is light, with violet and teal accents. The navy-violet welcome banner on key pages is the only dark surface, and dark mode is available from the moon/sun button. The Skillprint mark is public/brand/mark.svg, in the two-tone style of the Pixeltre logo; replace that file to change it everywhere.


Layout follows the open-source Flowbite Admin Dashboard (MIT licence) with a soft blue–lavender colour scheme, Lexend type, solid coloured icon tiles and tinted cards: a two-row top bar that stays fixed while scrolling (search and account above, the main menu with a drop-down per section below), flat bordered cards, underline tabs, grey-header tables, Inter type and a blue primary colour. Charts are drawn in plain SVG with legends, value labels and hover tooltips. Ctrl/⌘ K opens quick find. Fonts are bundled (no internet needed). Dark mode follows the
computer's setting; the switch at the bottom of the menu cycles automatic, light and dark. Colours are CSS variables in
`src/app/globals.css`; the product name appears in `src/app/(app)/layout.tsx` and `src/app/login/page.tsx`.

## Move planner

**Move planner** (employees, managers, department heads, HR) compares any two published roles in the organisation:
skill overlap, new skills, skills needing a higher level, level points to close and the difficulty band with its reason;
the **future-proof shift** (share of the role's skills by trend: Emerging 1, Current 0.75, Declining 0.25); every target skill
with its Pixel ID, current and needed level and trend; skills left behind; a **skill fingerprint** radar (highest required
level per skill category); and the seven **nearest moves** by overlap. "Count Mandatory skills only" narrows every figure.
Archived mappings are never counted and are listed separately only for users with archive access. API: `GET /api/v1/mobility/move?from=&to=&mandatory_only=`.

## Uploading your own data

Every screen that holds data has an **Upload** button next to its "New" button:

| Screen | Upload | Notes |
|---|---|---|
| Skill library | Skills | Matched by name and alias; look-alikes are flagged instead of duplicated |
| Job roles | Roles, or job descriptions as free text | Department heads' uploads go into their own department |
| A role's page | That role's required skills | No role column needed |
| Framework explorer | Required skills for many roles | One row per role and skill |
| Employees | People | Unrecognised job titles wait in Role resolution; nobody is dropped |
| Organisation | Departments | With parent departments |

The dialog works in three steps: **add** a CSV or Excel file, or paste rows copied from a spreadsheet; **check**, where
every row is shown as new, update, skip, role resolution or error with the reason, and nothing is saved yet; then **save**,
where rows are written in one transaction and error rows are left out. Each screen offers its own template. Save as drafts
(changes to published items go to Approvals) or publish directly (HR administrators, recorded in the audit log).
Every upload and its row-by-row report is kept in **Past uploads** (`/import`). Up to 100,000 rows / 25 MB per file.
API: `POST /api/v1/imports/preview` (multipart `file`, `entity`, `mode`, `options`), then `POST /api/v1/imports/:id/commit`.

## How variations of titles and skills are handled

**General rules for every skill**: names match with or without spaces, hyphens and dots and in any capitalisation
(TensorFlow = Tensor Flow, Spring Boot = SpringBoot, decision-making = decision making), singular or plural, and in UK or US
spelling (visualisation = visualization, modelling = modeling). Names with very short parts (InDesign, MongoDB) stay whole so
everyday phrases ("in design") are not mistaken for tools.

**General rules for every title**: spaces and hyphens are ignored when titles are compared (E-commerce = Ecommerce), and
about 70 common title abbreviations are expanded across industries (Sr, Dev, Engg, Mgr, SDE, SRE, SDET, RN, LPN, CNA, CSR,
Rep, SDR, BDR, HRBP, Acct, VP, AVP, GM, Dir, Exec, Coord, Mktg…). Different job nouns (engineer vs developer) are not merged
automatically; when HR maps such a title once, it is learned as an alternative title.

**Spelling variants** (`src/server/terms.ts`): one list of spellings treated as the same: .NET / dotnet / Dot Net,
Node.js / NodeJS / Node JS, C# / C sharp, Kubernetes / k8s, Salesforce / SFDC, SAP S/4HANA / S4HANA, Dynamics 365 / D365,
T-SQL / TSQL, Six Sigma / 6 Sigma, Generative AI / GenAI and about 55 groups in total.
It is used by role search, role resolution, uploads, the duplicate check, market title grouping, skill detection and
candidate discovery. Add a spelling to the list to teach the system a new variant. Each skill's own aliases add to it.

**Job titles**: seniority words are recorded separately (Senior, Sr., Lead, II…); variants become one word; numbers, years,
brackets, locations, shifts, "fresher", "co-op" and plurals are removed; finally words that fewer than 2–3 employers use in
titles (team codes, product names) are dropped. "Senior .NET Developer", "Sr Dot Net Developer" and ".NET Developer II"
are one market title and resolve to the same role in an organisation.

**New skills from postings**: besides a list of known tools, the system reads phrases such as "experience with",
"knowledge of", "tools such as" and collects the named items. Terms that several employers use become candidates.
Terms the library already covers (under any spelling) close by themselves. For the rest the platform administrator,
on **Data growth**, adds them in bulk as alternative names of a suggested existing skill, as new skills (category
suggested, definition to confirm), or ignores them. Nothing enters the library without that decision.

**Growing the skill library**: by default every new skill is a decision. On Data growth, "Used by at least N employers"
selects all strong candidates for bulk adding, and the switch "Add them to the library automatically after each upload"
adds such terms by itself (marked *Review due* in the Skill library, with a drafted definition to confirm). Terms that look
like an existing skill always wait for a person, because they are usually another name for it.

**Who decides what in the skill library**

| Who | Shared (global) library | Company skills |
|---|---|---|
| Platform administrator | Proposes or decides candidates; retires, merges, reinstates; undoes automatic runs; sets the approval rule; names library reviewers | — |
| Library reviewer (expert or HR named by the platform administrator) | Approves or rejects proposals on **Library approvals**; never their own | as their role allows |
| HR administrator | Requests changes (library requests) | Adds from their own postings, retires, merges |
| Others | Read only | Read only |

With **two-step approval** on (the default), new global skills and "same as" links, including automatic ones, are
proposals until a second person approves them. Every decision is in the audit log with both names. **Retire** keeps a skill's
history but stops detection, offers and upload matching; skills that roles still require cannot be retired. **Merge** moves a
duplicate's names and people's recorded levels to the kept skill and retires the duplicate (not for skills with role mappings,
because Pixel IDs never change). **Additions by run** lists every automatic or approved batch with one-click undo.

**Company job postings** (HR, Grow from job market > Your company's postings): uploads are private to the company. They are
matched against global and company skills and never feed shared market figures or other companies. From them HR:
creates **draft roles** for new titles; adds the skills an existing role's postings ask for and its framework lacks, as
**draft requirements for approval**; and turns new skill terms into **company skills** (or "same as" an existing skill;
for a shared skill this becomes a library request to the platform).

**Long jobs** (re-scan, catalogue load, posting upload) run as a separate process (`scripts/job.ts`) with live progress, so
the app stays responsive. Measured on the portable database: 1.14 lakh postings from 34,000 employers re-processed in about
2 minutes while pages kept answering in 0.03 s.

**After every upload or re-scan** title grouping, skill statistics, candidates and role templates are rebuilt automatically.
Databases from earlier versions are re-processed once at the next start.

## Growing the data

* **Skills catalogue** (`db/catalog/skills-catalogue.csv`): 257 curated skills across software, data, cloud, security, hardware, manufacturing,
  healthcare, sales, finance, HR, operations and interpersonal skills. Loaded automatically at start-up; the global library grows from 65 to 320+.
* **Re-scan**: when the library grows, every stored posting is scanned again. Sentences that repeat across an employer's postings
  (company description, benefits, equal-opportunity text) are ignored, so "commercial real estate" in a company blurb is not a skill.
* **Role templates** are built for every market title with enough postings (166 from the sample file), feeding the role fallback.
* **Data growth** screen: the platform administrator uploads more job postings from the browser, loads the catalogue, re-scans and
  rebuilds templates; HR picks market job titles and creates draft roles with skill requirements in bulk.
* **Large demo organisation**: `npm run generate-demo -- --org C001 --employees 5000` adds synthetic people with skill ratings.

Measured with 5,000 employees: HR dashboard 0.16 s, organisation-wide gap analysis 0.14 s, employee list paged at 20 ms.

## Role titles: same role, same level

A typed title finds an existing role only when it is the same role at the same level, written differently. This works for any job title in any industry, not a fixed list:
- abbreviations and spellings are expanded (".net dev" = ".NET Developer", "BI lead" = "Business Intelligence Lead", "Sr." = "Senior");
- "engineer" counts the same as "developer";
- the level must match: junior, associate, mid (no level word), senior or staff, lead or principal. So "Backend Lead" never finds "Backend Developer", and "Data Engineer" never finds "Senior Data Engineer".

Anything else is "not in your framework yet", with **Generate framework with AI**. Similar roles are only suggested at the same level. The same rule applies on Job roles, the Framework explorer, the global search, AI drafts and imports.

## Role fallback: no role is missed

When a role title is not in the system (employee import, add-employee form, job-description import, search):

1. **Exact match** on the title or an alternative title is used automatically.
2. **Normalised match**: seniority words (Sr, Junior, Lead, II…), abbreviations (Dev, Engr, Mgr…) and punctuation are ignored. `Sr. Backend Dev` becomes Backend Developer automatically, with a note to check the career level.
3. Anything else goes to **Role resolution** (`/roles/queue`) together with the people waiting for it. Nothing is rejected or dropped. Each item shows similar existing roles, matching **role templates** (a platform library, seeded from the sample's 34 distinct role profiles plus common alternative titles) and skills named in the title.
4. HR (or the department head for their own department) chooses one of these: map the title to an existing role, which learns it as an alternative title so the next import matches it; draft a role from a template; create a new draft role; or dismiss it with a reason.
5. People waiting for a drafted role are created automatically when that role is published.

The dashboard shows how many titles are unresolved.

## Local AI model from a folder (nothing to install)

Put a GGUF model file (for example `qwen2.5-3b-instruct-q4_k_m.gguf`, about 2 GB) in the `models` folder. With the default
`AI_PROVIDER=auto` the app finds it, loads it on the first draft and keeps it in memory; it runs inside the app through the bundled
llama.cpp library (prebuilt for Windows x64 and ARM, macOS and Linux), so Ollama is not needed. Answers are constrained to the
expected JSON shape and still validated. Without a model file the app tries Ollama, then drafts from its own data. See `models/README.txt`.

## AI through OpenRouter

The app can use OpenRouter instead of a model file. Put these in `.env` and restart:

```
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
```

Notes:
- `AI_MODEL` is optional. The default is a free Gemma model; if it's withdrawn, the best available free model with JSON output is used.
- A couple of free fallback models are passed along for busy moments.
- If a model doesn't support JSON mode, the request is sent again without it.
- If the key is rejected or the free limit is reached, drafts are made from the app's own data, with the reason shown.
- The screen says that draft requests go to an online service.

## Search never comes back empty: drafted role profiles

When a searched role title is not in the framework (and does not match one through the title variations above):

1. The search page shows the closest roles at once and, a moment later, a **draft profile** for that title: summary, responsibilities,
   6–12 skills with levels and requirement types, alternative titles, and the evidence it is based on. It is clearly marked *not reviewed*.
2. The draft is built from the app's own data: market postings for that title, the organisation's own job postings, role templates,
   similar roles and skills named in the title. If a **local AI model** is running (Ollama or any OpenAI-compatible local server,
   see `.env.example`), it writes the profile from that evidence. Its answer is validated: skills are mapped to the library through
   the spelling variations, levels are clamped to 1–5, unknown skills are listed separately as *new skills*. If the model is missing,
   slow or gives a broken answer, the data-only draft is used. So a search always gets a profile.
3. Each title is drafted once per organisation; the next person who searches for it sees the same draft. It also appears in
   **Role resolution** for HR, who can edit the title, pick the department, decide what to do with each new skill (company skill,
   request for the shared library, or leave out), and approve it into a **draft role**, which then goes through the normal approval.
   Rejected drafts can be drafted again later.

This is how the framework grows from what people actually look for, with a person approving every addition.

## Future outlook: current, emerging and declining skills

Every skill gets a trend (Emerging, Current or Declining) with the reasons behind it. Every role gets an outlook for the next 2–3 years: Growing, Stable, Transforming or At risk.

The trend is a weighted mix of the signals that are available. Each reason is shown when you hover the trend tag.

| Signal | Weight | Where it comes from |
|---|---|---|
| Job-market momentum | 0.45 | Share of postings naming the skill in the last 6 months vs the 18 months before. Used only when both windows have at least 300 dated postings |
| Company evidence | 0.35 | Skill evolution evidence your experts record |
| Industry knowledge | 0.30 | A built-in, labelled list of rising and falling skills (src/server/outlook/knowledge.ts) |
| Automation exposure | 0.25 | Tasks that AI and automation are taking over |
| AI view | 0.15 | The local model's opinion, only when a model is connected |

- **Skill trend:** a score of 0.3 or more is Emerging; -0.25 or less is Declining.
- **Role outlook:** uses the same weights as matching (Mandatory 3, Preferred 2, Optional 1, Developmental 0.5).
- **Where it appears:**
  - **Future outlook** in the menu: roles ranked, rising skills with people who have them vs need them (hire or train), and declining skills with people to reskill.
  - The **Future outlook** tab on each role.
  - Every drafted role profile.
- **Drafting a profile:** "Draft a profile" on Job roles or the Framework explorer opens the draft at once, with a progress bar. The draft then shows its skills, trends and outlook.

## Reference data: O*NET and other publishers

The platform administrator loads outside occupation and skill data under **Data > Reference**. This data is kept next to each company's framework and is never merged into it.

- **Releases.** Each release is stored as delivered, with its version, licence and attribution. You create a release, upload its files in any order (.xlsx, .csv, tab-separated .txt, or a .zip of them), check what was recognised, then publish. Nothing is published without a licence and an attribution line. Publishing retires the previous release of the same dataset, and a retired release can be put back.
- **Formats recognised from the column headers.** The O*NET 31.0 database files are recognised, along with older O*NET text and Excel exports:
  - occupations, alternate and reported job titles;
  - ratings files: essential and transferable skills, knowledge, abilities, work styles, work context, work activities;
  - scale categories, descriptor links, software/technology skills, emerging tasks, job zones, related occupations;
  - the O*NET OnLine Bright Outlook list.
  
  Other sites' data loads as a plain **skill list** (a Skill or Name column, optional ID, description, category) or an **occupation list** (an Occupation or Job title column, optional code, description, alternate titles).
- **Skill matching.** Descriptor names and technology examples are matched to the shared skill library by name, alias and spelling. Unmatched ones can be downloaded as a CSV to propose for the library.
- **Linking roles to occupations.** Each job role is linked to the closest occupation automatically:
  - matching uses about 60,000 O*NET job titles;
  - when one title belongs to several occupations, the role's skills are compared with each occupation's technologies and rated skills;
  - HR confirms the link or picks another on the role's **Occupation data** tab;
  - drafts find their closest occupation the same way.
- **Feeding the forecast.**
  - Bright Outlook flags (Rapid Growth, Numerous Job Openings, New & Emerging) and newly emerging tasks raise the outlook of linked roles.
  - In Demand and Hot Technology flags are a supporting "strong current demand" signal for skills. They measure demand now, not growth, so on their own they never make a skill Emerging.
  - Every use shows its reason and the publisher's attribution.
- **Bundled data.** The app ships with O*NET 31.0 (CC BY 4.0) in data/reference/onet. It is loaded once on first start, which takes about 15 seconds.

## Career ladders in the demo data

The v3 sample workbook has only mid-level roles, so every move between them is lateral. To show promotions, the demo organisations also get roles at other levels. These are added when the app starts (scripts/demo-extras.ts, src/server/demo/ladders.ts) and are left out of the sample workbook checks.

- **FinEdge:**
  - Junior Data Analyst → Financial Data Analyst → Senior Financial Data Analyst → Analytics Lead → Head of Data & Analytics
  - Associate Software Engineer → Backend Developer → Senior Backend Developer → Engineering Lead or Engineering Manager
  - Credit Risk Analyst → Senior → Credit Risk Manager
- **MediCore:**
  - a clinical analytics ladder up to Clinical Analytics Lead
  - Healthcare Software Engineer → Senior → Principal Engineer → Head of Engineering
- **CloudNova:**
  - Associate Software Engineer → Backend Developer → Senior Backend Developer → Engineering Lead or Engineering Manager → Director of Engineering
  - Senior and lead steps for Data Engineer and DevOps Engineer

How each step's requirements change:
- **Senior:** core skills go up a level; adds Stakeholder Management and Coaching & Mentoring, plus a deeper domain skill such as Software Architecture or Machine Learning.
- **Lead:** goes deeper in the core skills; Leadership becomes required.
- **Management track:** hands-on skills are no longer mandatory, while Leadership, Strategic Planning and Budgeting are required.

Paths are Vertical (+1), Vertical (skip-level, +2: the target role needs the skills of both levels below it plus its own), Vertical (track change, +1 into management), Lateral or Cross-functional. No path goes up more than two levels, and a +2 path must be marked skip-level.

On **Career mobility**, a card for each type of move shows what it means, how many paths there are, the usual time and an example. **View track** shows the steps (a skip-level move includes the role in between), the time, and every skill at every step: new skills, skills to deepen, and skills already at the needed level. Employees see the same view from Career options, with their own levels.

Each company also gets two roles whose skills are shifting, so the Future outlook shows Transforming and At risk examples. The engine works out these labels from the skills themselves:
- **FinEdge:** MIS Reporting Analyst (VBA, Crystal Reports, QlikView); Regulatory Reporting Analyst (LIBOR giving way to ISO 20022)
- **MediCore:** Medical Coding Specialist (ICD-9 giving way to AI-assisted documentation review); Clinical Report Developer
- **CloudNova:** Configuration Management Engineer (Puppet giving way to Kubernetes); Legacy Integration Developer (SOAP, jQuery, AngularJS)

## Phones, tablets and installing as an app

Every screen adapts from phone to desktop. On phones the menu becomes a bottom tab bar (four main places for each role plus *More*),
pop-up windows slide up from the bottom with their buttons always in reach, and wide tables scroll sideways inside their card.
On a phone, *Add to Home screen* (iOS Safari) or *Install app* (Android Chrome) installs Skillprint like an app; this needs the site to be
served over HTTPS. The small service worker that makes this possible caches nothing, so no personal data is stored on the device.
Destructive actions (deactivate, withdraw, remove, delete) ask for confirmation in a pop-up first.

## IDs and data integrity

Every record gets a system-generated ID (E1084, R101, IJ00012…), whatever is uploaded; IDs in an uploaded file are never used as keys.
The company's own employee number is stored separately (*Employee number*, unique within the organisation) and shown next to the name.
ID counters are kept ahead of the highest stored ID on every start, so generated IDs never clash with loaded data. The same posting,
course, schedule, open request or successor cannot be entered twice, and actions on the same item at the same moment cannot both win.
One match calculation is used everywhere a percentage is shown (dashboard, profile, internal jobs, succession), and an automated test
checks that totals agree across the dashboard, lists, reports and pages.

## Level updates with evidence

On *My profile*, **Update level** next to a skill opens a request: the new level, what changed, and **at least one piece of evidence**
(up to 5 files of 5 MB — PDF, Word, Excel, PowerPoint, PNG, JPG, text — and links). Files are checked on the server: the content must
match the extension, and they are always downloaded, never opened inside the app. The request goes to the person's manager (HR if they
have none). The manager opens it under **Level requests**, reads the note, downloads the evidence, and then **approves** (at the asked
level or another), **rejects** (with a reason) or **asks for more evidence**; the employee adds it and sends it back. Only an approval
changes the trusted level, and the evidence is kept in the person's portfolio as validated. Nobody decides their own request.

## Mentoring

From *My learning*, the **Mentors** tab of a skill lists colleagues whose level a manager or assessment confirmed. **Ask** sends a request
with a message. The colleague accepts or declines in *Mentoring*; an accepted pairing becomes a mentoring activity in the mentee's plan.
Both log sessions (date, minutes, notes) and mark it complete. Limits: five open asks per person, four mentees per mentor.

## Succession planning

HR (any department) and department heads (their own) mark **critical roles**. Each plan shows who holds the role, the best internal
candidates ranked by skill match (with "aspires" and "applied" markers from career aspirations and internal applications), and the
named successors with readiness: *Ready now*, *1–2 years*, *3+ years*. The overview flags roles with no successor or no one ready now.

## Reports

*Reports* exports Skill gaps, Skills inventory, Learning & development, Internal mobility, Succession bench and (HR only) Personal-data
access as Excel (summary + detail sheets) or CSV, for the whole organisation or one department (department heads: their own only).
**Schedules** run weekly (Mondays) or monthly (1st) in a separate process started with the app; each run is kept in the history for
180 days and emailed when `SMTP_URL` is set in `.env`. Because reports hold personal data, they can be emailed only to HR administrators
or the head of the department concerned, checked again at every send.

## Who saw whom

Opening another person's profile, gaps, learning, readiness, job application, level request or evidence file, and every report export,
is written to an append-only access log (repeat views within 10 minutes count once; nobody's own views are logged). HR sees it under
*Who saw whom* with filters and an export; every employee sees who opened their data on *Account & security*.

## Internal jobs (IJP)

* **HR** (any department) and **department heads** (their own) post openings for published roles: one at a time with a form,
  or many from a CSV/Excel file (*Upload CSV* → every row is checked and shown before anything is created; titles match roles
  through the same variations as search; dates like 15/06/2027 and Excel dates are read). Postings can be Draft, Open, On hold or Closed,
  with an optional minimum match.
* **Employees** see open jobs ranked by their match: a weighted share of each required level they reach (Mandatory counts 3×,
  Preferred 2×, Optional 1×), the gaps, and learning for those gaps. They apply with a note, follow the status, and can withdraw.
  Limits: one active application per job, five at a time, not for their own role, not below the minimum match.
* **Pipeline**: Applied → Screening → Interview → Offered → Hired (or Not selected). Filling the last opening closes the posting.
  A hire never changes anyone's role by itself; HR records the move in Employees.

## Learning suggestions

Every gap gets: the company's own courses first, then a starter catalogue of official free resources (Python docs, Microsoft Learn,
AWS Skill Builder, Kubernetes tutorials, certifications…), colleagues whose level in that skill was confirmed by a manager or an
assessment (as mentors), searches on Coursera, LinkedIn Learning, Udemy and YouTube, and a knowledge → practice → validation path.
One click adds a suggestion to the person's development plan; duplicates are skipped. HR keeps the company catalogue in *Learning catalogue*.
Course completion never raises a validated level on its own: an assessor still confirms it.

## Framework upload (platform administrator)

*Framework upload* takes an existing role–skill framework as CSV or Excel. **Only role and skill are required**; everything else is filled
in and marked *auto* in the preview:
* skills are matched to the library through spelling variants (`k8s` → Kubernetes); unknown skills become library additions with a
  category from the most similar library skill and a definition to review (with two-step approval on, they wait for a second person);
* missing levels come from how the same skill is levelled in other frameworks and templates, ±1 for seniority words in the title
  (Junior / Senior, Lead…); requirement type, importance and trend follow; job family comes from the title.
Each role becomes a platform role template that every organisation can draft roles from. Uploading the same role again updates it.

## Sign-in and data security

* Server-side sessions (12 hours) in an httpOnly, SameSite cookie; sign-out, password change and deactivation end sessions at once.
  *Account & security* lists where you are signed in and signs out other devices.
* Five wrong passwords lock the account for 15 minutes (plus a per-network limit). HR unlocks, resets (one-time temporary password
  that must be changed first), changes access or deactivates accounts in *Users & access*; the last HR administrator cannot be removed.
* Passwords: at least 10 characters with a letter and a number, stored with bcrypt.
* Every query is scoped to the caller's organisation; another tenant's records read as "not found". Requests that change data must come
  from the app's own origin; bodies are size-limited and validated; bad input gets a clear 4xx message, never a crash.
  Exports guard against spreadsheet formula injection. Security headers (CSP, frame denial, no-sniff) are set on every page.
* In production a missing or short `SESSION_SECRET` is never used: a random one is generated for that run.

## Market intelligence from job postings

```bash
npx tsx scripts/import-jobs.ts jobs.xlsx --name "Jobs Nov 2026" [--licence "usage terms"] [--replace]
# or in the app: Data growth > Upload job postings (platform administrator)
```

The importer accepts `.xlsx`, read as a stream so files with 1 lakh rows or more work, or `.csv`. It expects these columns: `company, job_title, location, department, description, additional_details` (the last one is JSON). Each run:

* tidies titles by removing qualifiers, brackets, seniority words and team suffixes. "JANITORIAL CLEANER (H)" becomes "janitorial cleaner".
* finds library skills in each posting using their names, aliases and extraction synonyms. Ambiguous terms are excluded; for example "EMR" also means Amazon Elastic MapReduce.
* finds candidate new skills from a curated list of tools, standards and certifications that appear at 2 or more employers.
* rebuilds the title groups, the demand figures for each skill, and the candidate list.

What it feeds:

* **Role fallback.** Unknown titles show matching market titles, and HR can draft a role from those postings.
* **Market check tab on each role.** How often postings for the same title mention each framework skill, plus frequent skills that are missing from the framework.
* **Skill pages.** The share of postings that mention the skill.
* **Platform admin.** Turn a candidate term into a global skill; turn a market title into a role template; record usage rights.

The data is used for structure only (matching, templates, profile checks) until its usage rights are recorded (PRD 18.2). A single snapshot shows current demand, not trends.

## Architecture

Modular monolith (PRD 28): one Next.js 14 + TypeScript app, PostgreSQL, REST API under `/api/v1`.

```
db/migrations/001_schema.sql   schema, constraints, v_framework view, append-only triggers
db/seed/sample.json            the v3 workbook, extracted
scripts/                       migrate and seed (seed runs the Developer Guide migration checks and stops on failure)
src/server/
  http/router.ts               route table + dispatcher (used by the HTTP adapter and by tests)
  permissions.ts, scope.ts     role permissions with scopes (org / dept / team / self / assigned) and tenant checks
  calc/                        pure calculations: gaps, comparison, readiness, planning, trend score
  modules/                     mapping (Pixel ID, lifecycle), governance, structure, skills, people, mobility, insights
src/app/                       screens per persona; no business logic in the frontend
```

### How the v3.0 rules are enforced

| Rule | Where |
|---|---|
| One Pixel ID per mapping, `PX-<role>-<skill>` | `ck_pixel_format`, `ck_pixel_matches`, unique `(org, role, skill)`; trigger forbids changing it |
| Archived ⇔ trend Archived; archived rows need reason, date, Legacy only | `ck_archived_consistent`, `ck_archived_fields`, `ck_legacy_only_archived` |
| Every default read is active only | `v_framework` view + `listActive()`; counts, search, exports, gaps, planning, mobility and evolution all read it |
| Archived is opt-in, read-only, separate | `?include_archived=true` returns a separate `archived` array; needs `archive:read`; 403 otherwise |
| Retire, never delete; everything logged | archive/restore + audit row in one transaction; `archive_audit_log` and `audit_log` reject UPDATE/DELETE |
| Last active mapping | `409 confirm_required`; resend with `confirm: true` |
| Approval policy (10.6) | per organisation: Mandatory, open assessments, or all; department heads always propose |
| Old IDs | `pixel_id_crosswalk` (278 rows); `GET /pixels/legacy/{RS…|FWR…}` |

Key endpoints follow Developer Guide 7: `GET /roles/{id}/skills[?include_archived=true]`, `GET /pixels/{pid}`,
`GET /pixels/legacy/{old_id}`, `POST /pixels/{pid}/archive`, `POST /pixels/{pid}/restore`.

## What is in scope, and what is not

Built: Modules 1–13, 16, 17, a lean 18 (evidence, trend scoring, suggestions with expert review, accept → Draft change only),
and the v3.0 requirements PX-01 to PX-07, AR-01 to AR-16 and SA-01 to SA-05.

Not built in this version:
* **AI layer (Module 15).** No AI provider is configured. Job-description import and skill suggestions are rule-based, and
  every flow works without AI, as Principle 11 requires. The suggestion records are where an AI provider would plug in.
* **External intelligence (Module 14) and HRMS/LMS integrations.** These depend on licensed data sources and partner
  agreements (PRD 18.2).
* **Scenario modelling (WP-07).** You can compare scenarios by copying a plan.
* Projected role profiles and Split/Merge classification (RE-08 to RE-11). Evolution suggestions work per mapping only.

Stack note: the PRD suggests Prisma. This build uses `pg` with SQL migrations so that the Developer Guide's CHECK constraints,
view and append-only triggers live in the database exactly as specified.

## Findings in the source material

* `PX-R022-S065` is an active mapping at level 1 (Awareness), but the PRD and the workbook say level 1 is used only by
  archived mappings. The Data checks screen flags it.
* Developer Guide 7 shows R031 with `active_count: 11`. The sample data has 10 active mappings for R031, plus 2 archived.
* V3-03 asks for a Declining Mandatory mapping, and the sample has none (every Declining mapping is Optional). The test
  uses a Mandatory one instead.
* Proposed defaults are used where the PRD leaves decisions open (restore → Declining/Optional, approval policy,
  `archive:read` for HR and own-department heads). They are listed in PRD Section 37.

## Data notes

Skill trends and confidence scores come from the workbook. They are knowledge-based and unverified, and are imported
with evidence status *Unverified*. The 84 employees, their skill levels, assessments and plans are **synthetic** and are
flagged in the data and the UI.
