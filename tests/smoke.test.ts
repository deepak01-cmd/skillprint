/* Every read endpoint, for every persona: no server errors, and permission answers are 200/403/404 only. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

const PERSONAS = ["admin@platform.demo", "hr@finedge.demo", "head.dataanalytics@finedge.demo", "manager.dataanalytics@finedge.demo", "employee@finedge.demo", "expert@finedge.demo"];

test("GET endpoints never return 5xx for any persona", async () => {
  const emp = (await T.q(T.db, `SELECT e.id, e.role_id FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = 'employee@finedge.demo'`))[0];
  const plan = (await T.q(T.db, `SELECT id FROM workforce_plans WHERE org_id = 'C001' LIMIT 1`))[0].id;
  const asmt = (await T.q(T.db, `SELECT id FROM assessments WHERE org_id = 'C001' LIMIT 1`))[0].id;
  const paths = ["/auth/me", "/dashboard", "/reconciliation", "/org", "/roles", "/roles/R001", `/roles/R001/skills`, "/roles/R001/skills?include_archived=true", "/roles/R001/similar",
    "/roles/R001/compare/R002", "/roles/R001/skills/archived/export", "/framework/export", "/pixels/PX-R001-S001", "/pixels/PX-R001-S057", "/pixels/PX-R001-S002/archive-check", "/pixels/legacy/RS0001",
    "/skills", "/skills?include_archived=true", "/skills/S001", "/skills/categories", "/skills/duplicates?name=SQL", "/proficiency", "/changes", "/audit",
    "/employees", `/employees/${emp.id}`, `/employees/${emp.id}/gaps`, `/employees/${emp.id}/plans`, `/employees/${emp.id}/aspirations`, `/employees/${emp.id}/readiness/R002`, "/me", "/me/future",
    "/assessments", `/assessments/${asmt}`, "/gaps", "/team/matrix", "/career-paths", "/career-paths/suggestions?from=R001", "/mobility/team", "/mobility/distribution",
    "/planning/assumptions", "/planning/plans", `/planning/plans/${plan}`, "/evolution/skills", "/evolution/sources", "/evolution/evidence", "/evolution/suggestions", "/search?q=python", "/search?q=PX-R001-S057&include_archived=true",
    "/platform/organisations", "/framework", "/framework?trend=Declining&include_archived=true", "/pixels/PX-R001-S001/history", "/library-requests", "/role-queue", "/role-templates", "/roles/resolve?title=Data Analyst", "/search?q=RS0001", "/market/summary", "/market/titles?q=data engineer", "/market/roles/R001", "/market/skills/S001", "/market/candidates"];
  const failures: string[] = [];
  for (const email of PERSONAS) {
    const u = await T.as(email);
    for (const p of paths) {
      const r = await u.get(p);
      if (r.status >= 500 || ![200, 403, 404, 422].includes(r.status)) failures.push(`${email} GET ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Archive check reports approval need, last-active state and affected records", async () => {
  const hr = await T.as("hr@finedge.demo");
  const r = await hr.get("/pixels/PX-R001-S001/archive-check");
  assert.equal(r.status, 200); assert.equal(r.body.needs_approval, true); assert.equal(r.body.last_active, false);
  assert.ok(typeof r.body.affected.profiles === "number");
});
