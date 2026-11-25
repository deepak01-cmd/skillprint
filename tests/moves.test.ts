/* Move planner: role-to-role comparison with future-proof shift, fingerprint, nearest moves and archive rules. */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>;
before(async () => { T = await setup(); });

test("Move planner returns the same metrics as the role comparison, plus fingerprint and nearest moves", async () => {
  const hr = await T.as("hr@finedge.demo");
  const m = (await hr.get("/mobility/move?from=R001&to=R003")).body;
  const c = (await hr.get("/roles/R001/compare/R003")).body;
  for (const k of ["skill_overlap", "new_skills", "level_points_to_close", "move_difficulty", "skills_needing_higher_level"]) assert.equal(m[k], c[k], k);
  assert.equal(m.lines.length, c.skills_in_target);
  assert.ok(m.lines.every((l: any) => /^PX-R003-S\d{3}$/.test(l.pixel_id) && l.trend), "lines carry Pixel IDs and trends of the target role");
  assert.equal(m.fingerprint.categories.length, m.fingerprint.from.length);
  assert.ok(m.fingerprint.to.every((v: number) => v >= 0 && v <= 5));
  assert.ok(m.fpi.from > 0 && m.fpi.from <= 100);
  assert.ok(m.nearest.length > 0 && m.nearest.length <= 7 && !m.nearest.some((n: any) => n.id === "R001"));
  for (let i = 1; i < m.nearest.length; i++) assert.ok(m.nearest[i - 1].overlap >= m.nearest[i].overlap, "sorted by overlap");
  assert.ok(m.roles.every((r: any) => r.id >= "R001" && r.id <= "R012"), "only this organisation's roles");
});

test("Mandatory-only counting narrows the comparison; archived skills are never counted and shown only with archive access", async () => {
  const hr = await T.as("hr@finedge.demo");
  const all = (await hr.get("/mobility/move?from=R001&to=R003")).body;
  const mand = (await hr.get("/mobility/move?from=R001&to=R003&mandatory_only=true")).body;
  assert.ok(mand.lines.length < all.lines.length);
  assert.ok(mand.lines.every((l: any) => l.requirement_type === "Mandatory"));
  assert.ok(!all.lines.some((l: any) => l.skill_name === "LIBOR Rate Reporting"), "archived LIBOR is not a target skill");
  assert.ok(Array.isArray(all.archived) && all.archived.some((a: any) => a.pixel_id === "PX-R001-S057"), "HR sees archived mappings separately");
  const emp = await T.as("employee@finedge.demo");
  const e = (await emp.get("/mobility/move")).body;
  assert.equal(e.from.id, "R001", "employees start from their own role");
  assert.equal(e.archived, null); assert.ok(e.archived_hidden >= 1);
});

test("Tenancy: a role from another organisation cannot be planned", async () => {
  const hr = await T.as("hr@finedge.demo");
  assert.equal((await hr.get("/mobility/move?from=R001&to=R013")).status, 404);
});
