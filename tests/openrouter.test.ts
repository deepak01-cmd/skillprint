/* OpenRouter (online) as the AI for drafts, against a stand-in server: key check, model choice, JSON-mode retry, errors. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { setup } from "./helpers";

let T: Awaited<ReturnType<typeof setup>>; let server: Server;
let seen: any[] = []; let mode: "ok" | "nojson" | "badkey" | "limit" = "ok";
const answer = JSON.stringify({ title: "Backend Lead", summary: "Leads the backend team and its services.", responsibilities: ["Lead backend design", "Coach developers", "Own service reliability"],
  skills: [{ name: "Java", required_level: 5, requirement_type: "Mandatory", importance: "High", trend: "Current" }, { name: "Kubernetes", required_level: 4, requirement_type: "Preferred", importance: "High", trend: "Emerging" }] });
before(async () => {
  T = await setup();
  server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const auth = req.headers.authorization;
      if (req.url === "/models") return res.end(JSON.stringify({ data: [{ id: "google/gemma-4-31b-it:free", context_length: 262144, supported_parameters: ["response_format"] }, { id: "other/model:free", context_length: 131072, supported_parameters: ["structured_outputs"] }] }));
      if (mode === "badkey" || auth !== "Bearer sk-or-test") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "No auth credentials found" } })); }
      if (req.url === "/key") return res.end(JSON.stringify({ data: { label: "test", is_free_tier: true } }));
      if (req.url === "/chat/completions") {
        const b = JSON.parse(body); seen.push(b);
        if (mode === "limit") { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day" } })); }
        if (mode === "nojson" && b.response_format) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "response_format is not supported by this model" } })); }
        return res.end(JSON.stringify({ model: b.model, choices: [{ message: { content: "Here it is:\n" + answer } }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  process.env.AI_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "sk-or-test"; delete process.env.AI_MODEL;
  process.env.AI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => { server.close(); delete process.env.OPENROUTER_API_KEY; process.env.AI_PROVIDER = "off"; });
const reset = async () => (await import("../src/server/ai/llm")).resetAiStatus();

test("The key is checked and the app says plainly that drafts go to an online service", async () => {
  await reset();
  const st = (await (await T.as("hr@finedge.demo")).get("/ai/status")).body;
  assert.equal(st.connected, true); assert.equal(st.provider, "openrouter"); assert.equal(st.online, true);
  assert.equal(st.model, "google/gemma-4-31b-it:free");
});

test("A draft is written by the OpenRouter model, with free fallbacks; JSON mode is dropped if a model rejects it", async () => {
  await reset(); mode = "nojson"; seen = [];
  const r = (await (await T.as("hr@finedge.demo")).post("/ai/role-drafts", { title: "Backend Lead", wait: true })).body;
  assert.equal(r.draft.status, "Ready"); assert.equal(r.draft.method, "ai", JSON.stringify(r.draft.payload.notes));
  assert.ok(r.draft.payload.skills.some((s: any) => s.name === "Java"));
  assert.equal(seen.length, 2, "asked again without JSON mode"); assert.ok(seen[0].response_format && !seen[1].response_format);
  assert.deepEqual(seen[0].models, ["google/gemma-4-31b-it:free", "other/model:free"]);
});

test("A rejected key or the free limit still gives a draft from the app's own data, with the reason", async () => {
  for (const [m, title, re] of [["badkey", "Platform Reliability Lead", /did not accept the API key/], ["limit", "Data Platform Lead", /free limit/]] as const) {
    await reset(); mode = m as any;
    const r = (await (await T.as("hr@finedge.demo")).post("/ai/role-drafts", { title, wait: true })).body;
    assert.equal(r.draft.status, "Ready"); assert.equal(r.draft.method, "rules");
    assert.ok(r.draft.payload.notes.some((n: string) => re.test(n)), JSON.stringify(r.draft.payload.notes));
  }
  mode = "ok";
});
