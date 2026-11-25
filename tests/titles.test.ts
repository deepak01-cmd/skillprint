/* Role titles: only the same role at the same level matches; everything else is offered as a new draft. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";
import { sameRole } from "../src/server/modules/roleFallback";
import { titleMatches } from "../src/lib/titleMatch";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("Variants of one title match; another level or another role does not", () => {
  for (const [a, b] of [[".net dev", ".NET Developer"], ["dot-net developer", "Dotnet Developer"], ["BI lead", "Business Intelligence Lead"], ["Sr. Data Engineer", "Senior Data Engineer"], ["Backend Engineer", "Backend Developer"], ["Backend Lead", "Lead Backend Developer"]])
    assert.ok(sameRole(a, b), `${a} = ${b}`);
  for (const [a, b] of [["Backend Lead", "Backend Developer"], ["Data Engineer", "Senior Data Engineer"], ["BI Analyst", "Data Analyst"], ["Associate Software Engineer", "Software Engineer"], ["Senior Backend Developer", "Backend Developer"]])
    assert.ok(!sameRole(a, b), `${a} ≠ ${b}`);
  assert.ok(!titleMatches("backend lead", "Backend Developer"));
  assert.ok(titleMatches("backend", "Senior Backend Developer"), "a single word still lists every level while typing");
  assert.ok(!titleMatches("backend developer", "Senior Backend Developer"));
});

test("A title that is not in the framework is offered as a draft, with close matches only at the same level", async () => {
  const hr = await T.as("hr@cloudnova.demo");
  const r = (await hr.get("/roles/resolve?title=Backend%20Lead")).body;
  assert.equal(r.status, "unresolved");
  assert.ok(!r.candidates.some((c: any) => c.title === "Backend Developer"), JSON.stringify(r.candidates));
  const s = (await hr.get("/search?q=backend%20lead")).body;
  assert.equal(s.roles.length, 0); assert.ok(s.role_fallback, "the search offers a draft");
  const bi = (await hr.get("/roles/resolve?title=BI%20Analyst")).body;
  assert.equal(bi.status, "unresolved");
  assert.equal((await hr.get("/roles/resolve?title=backend%20dev")).body.role.title, "Backend Developer");
  const d = (await hr.post("/ai/role-drafts", { title: "Backend Lead", wait: true })).body;
  assert.ok(d.draft && !d.matched, "a draft is made instead of opening Backend Developer");
});
