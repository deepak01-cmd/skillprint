/* Browser walk-through of the UI-visible parts of the UAT sheet. Run against a freshly seeded app:
   npm run db:reset && npm run build && npm start   (then)   node scripts/uat-browser.js
   Requires Playwright (npm i -D playwright) or a global install. */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); };

async function login(b, email) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => check("JS", false, `${email}: ${e.message}`));
  await p.goto(BASE + "/login"); await p.fill("#email", email); await p.fill("#pw", "demo1234"); await p.click("button[type=submit]");
  await p.waitForURL("**/dashboard"); return p;
}
const settle = async p => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); };
const text = p => p.locator("main").innerText();

(async () => {
  const b = await chromium.launch();
  const fe = await login(b, "hr@finedge.demo");
  await fe.goto(BASE + "/org"); await settle(fe);
  const org = await text(fe);
  check("TC02", ["Data & Analytics", "Technology & Engineering", "Risk & Compliance", "Product & Operations"].every(d => org.includes(d)) && !/MediCore|CloudNova/.test(org), "4 FinEdge departments, no other tenant");
  await fe.goto(BASE + "/roles/R013"); await settle(fe);
  const r13 = await text(fe);
  check("TC03", /404|not found/i.test(r13) && !/Clinical Data Analyst/.test(r13), "MediCore role not shown");
  await fe.goto(BASE + "/roles/R001"); await settle(fe);
  const r1 = await text(fe);
  check("TC07", /12 active/.test(r1) && r1.includes("PX-R001-S001") && !/Role Skill ID|Framework ID|RS0001|FWR001/.test(r1) && !r1.includes("LIBOR") && /1 archived skill: view/.test(r1), "12 active, Pixel IDs only, LIBOR hidden, quiet link");
  await fe.click("text=PX-R001-S001"); await fe.waitForTimeout(300);
  check("TC12", /Level 4 Advanced.*(complex|Optimises)/is.test(await text(fe)), "level definition shown with the mapping");
  await fe.goto(BASE + "/skills"); await settle(fe);
  await fe.click("text=New company skill"); await fe.fill("#sn", "SQL Querying"); await fe.fill("#sd", "Query relational data"); await fe.fill("#sc", "Technical Methods");
  await fe.click("div[role=dialog] >> button:has-text('Create')"); await fe.waitForTimeout(600);
  const dlg = await fe.locator("div[role=dialog]").innerText();
  check("TC06", /Use existing/.test(dlg) && /as alias/.test(dlg) && /Create a different skill/.test(dlg) && /Request library update/.test(dlg), "four options offered");
  await fe.keyboard.press("Escape");
  await fe.goto(BASE + "/search"); await fe.fill("input[aria-label=Search]", "RS0001"); await fe.waitForTimeout(1200);
  check("TC17", /RS0001.*PX-R001-S001/s.test(await text(fe)), "old ID resolves in search");
  await fe.goto(BASE + "/framework"); await settle(fe);
  await fe.selectOption("select[aria-label=Trend]", "Declining"); await settle(fe);
  check("Q2", /active mappings/.test(await text(fe)) && /Declining/.test(await text(fe)), "framework-wide trend filter");
  await fe.goto(BASE + "/employees"); await settle(fe);
  await fe.click("text=Add employee"); await fe.waitForTimeout(300);
  const form = await fe.locator("div[role=dialog]").innerText();
  check("TC14/fallback", /or (type the )?role title/.test(form) && /Login password/.test(form), "role-title fallback and login fields");

  const cn = await login(b, "hr@cloudnova.demo");
  await cn.goto(BASE + "/roles/R031"); await settle(cn);
  await cn.click("button:text-is('view')"); await cn.waitForTimeout(600);
  const r31 = await text(cn);
  check("TC08", /Archived skills for Data Engineer/.test(r31) && r31.includes("PX-R031-S053") && r31.includes("PX-R031-S055") && /2026-10-31/.test(r31), "separate archived panel");
  await cn.click("button:text-is('Close')"); await cn.waitForTimeout(300);
  check("TC08b", !/Archived skills for Data Engineer/.test(await text(cn)) && /10 active/.test(await text(cn)), "closing returns to active-only list");

  const ad = await login(b, "admin@platform.demo");
  await ad.goto(BASE + "/dashboard"); await settle(ad);
  const pd = await text(ad);
  check("TC16", /FinEdge Technologies[\s\S]*93/.test(pd) && /MediCore Health Systems[\s\S]*78/.test(pd) && /CloudNova Solutions[\s\S]*97/.test(pd) && /217/.test(pd) && /268/.test(pd) && /\+10/.test(pd), "platform totals by company and trend");

  console.log(results.map(r => `${r.ok ? "PASS" : "FAIL"} ${r.id}  ${r.detail}`).join("\n"));
  await b.close();
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
