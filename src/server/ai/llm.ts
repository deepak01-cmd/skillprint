/* Connection to a local language model. Nothing leaves the machine: the model runs on the user's own computer.
   Supported:
   - a model file in the app's "models" folder (GGUF, for example qwen2.5-3b-instruct-q4_k_m.gguf): runs inside the app,
     nothing to install. Used automatically when a .gguf file is there, or set AI_PROVIDER=local and AI_MODEL_PATH=...
   - Ollama (https://ollama.com):      AI_PROVIDER=ollama  AI_BASE_URL=http://127.0.0.1:11434  AI_MODEL=qwen2.5:7b
   - any OpenAI-compatible local server (LM Studio, llama.cpp server, vLLM):  AI_PROVIDER=openai  AI_BASE_URL=http://127.0.0.1:1234/v1
   - OpenRouter (online service, https://openrouter.ai): AI_PROVIDER=openrouter  OPENROUTER_API_KEY=sk-or-...  AI_MODEL=<model id, optional>
     This one is NOT local: the draft request (role title, similar roles, skill names, sample job-posting text) is sent to OpenRouter
     and the model provider it routes to. Free models may be rate-limited and some providers log prompts.
   AI_PROVIDER=off disables the model; the app then drafts from its own data only. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

export interface AiConfig { provider: "local" | "ollama" | "openai" | "openrouter" | "off"; baseUrl: string; model: string; modelPath: string | null; timeoutMs: number; apiKey?: string }

/** The model file to use: AI_MODEL_PATH, or the largest .gguf file in the models folder. */
export function findModelFile(): string | null {
  const given = process.env.AI_MODEL_PATH;
  if (given) { const p = isAbsolute(given) ? given : join(process.cwd(), given); return existsSync(p) ? p : null; }
  const dir = join(process.cwd(), process.env.AI_MODELS_DIR || "models");
  try {
    const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith(".gguf")).map(f => ({ p: join(dir, f), size: statSync(join(dir, f)).size }));
    return files.sort((a, b) => b.size - a.size)[0]?.p ?? null;
  } catch { return null; }
}

export function aiConfig(): AiConfig {
  let provider = (process.env.AI_PROVIDER || "auto").toLowerCase() as AiConfig["provider"] | "auto";
  const orKey = process.env.OPENROUTER_API_KEY || (provider === "openrouter" ? process.env.AI_API_KEY : undefined);
  // auto: an OpenRouter key wins (it was set on purpose), then a model file, then a local Ollama
  if (provider === "auto" && orKey) provider = "openrouter";
  const modelPath = provider === "auto" || provider === "local" ? findModelFile() : null;
  if (provider === "auto") provider = modelPath ? "local" : "ollama";
  const baseUrl = (process.env.AI_BASE_URL || (provider === "openrouter" ? OPENROUTER_URL : provider === "openai" ? "http://127.0.0.1:1234/v1" : "http://127.0.0.1:11434")).replace(/\/+$/, "");
  const model = provider === "local" ? (modelPath ? basename(modelPath) : "no model file") : process.env.AI_MODEL || (provider === "openrouter" ? OPENROUTER_DEFAULT : "qwen2.5:7b");
  return { provider, baseUrl, model, modelPath, timeoutMs: Number(process.env.AI_TIMEOUT_MS || 180000), apiKey: provider === "openrouter" ? orKey : process.env.AI_API_KEY };
}

/* ---------- OpenRouter (online) ---------- */
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT = "google/gemma-4-31b-it:free";
let orModels: { at: number; free: string[]; all: Set<string> } | null = null;
/** OpenRouter's model list (public, cached for an hour): which free models exist and can answer in JSON. */
async function openRouterModels(c: AiConfig) {
  if (orModels && Date.now() - orModels.at < 3600000) return orModels;
  const r = await fetchJson(`${c.baseUrl}/models`, {}, 8000);
  const data: any[] = r.data || [];
  const json = (m: any) => (m.supported_parameters || []).some((p: string) => p === "response_format" || p === "structured_outputs");
  const free = data.filter(m => String(m.id).endsWith(":free") && json(m) && (m.context_length || 0) >= 16000).sort((a, b) => (b.context_length || 0) - (a.context_length || 0)).map(m => m.id);
  orModels = { at: Date.now(), free, all: new Set(data.map(m => m.id)) };
  return orModels;
}
/** The configured model if OpenRouter still offers it, else the best free one; plus up to two free fallbacks. */
async function openRouterPlan(c: AiConfig) {
  const m = await openRouterModels(c).catch(() => null);
  const main = !m || m.all.has(c.model) ? c.model : (m.free[0] || c.model);
  const fallbacks = (m?.free || []).filter(x => x !== main).slice(0, 2);
  return { main, models: [main, ...fallbacks] };
}
const orHeaders = (c: AiConfig) => ({ "content-type": "application/json", authorization: `Bearer ${c.apiKey}`, "X-Title": "Skillprint" });
function orError(e: Error) {
  const m = e.message;
  if (/^401|^403/.test(m)) return new Error("OpenRouter did not accept the API key (check OPENROUTER_API_KEY in .env)");
  if (/^402/.test(m)) return new Error("OpenRouter asks for credit for this model; choose a free model (AI_MODEL=...:free)");
  if (/^429/.test(m)) return new Error("OpenRouter's free limit was reached for now; the draft was made from the app's own data. Try again later");
  return e;
}

/* ---------- model file run inside the app (node-llama-cpp) ---------- */
type Local = { path: string; llama: any; model: any; lib: any };
let local: Local | null = null;
let loading: Promise<Local> | null = null;
async function loadLocal(path: string): Promise<Local> {
  if (local && local.path === path) return local;
  if (loading) return loading;
  loading = (async () => {
    const lib: any = await import("node-llama-cpp");
    const llama = await lib.getLlama({ gpu: process.env.AI_GPU === "true" ? "auto" : false });
    const model = await llama.loadModel({ modelPath: path });
    const l: Local = { path, llama, model, lib }; local = l;
    return l;
  })();
  try { return await loading; } finally { loading = null; }
}
async function chatLocal(path: string, system: string, user: string, schema: object | undefined, timeoutMs: number, onProgress?: (f: number) => void) {
  const m = await loadLocal(path);
  const context = await m.model.createContext({ contextSize: Math.min(8192, Number(process.env.AI_CONTEXT || 6144)) });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const session = new m.lib.LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });
    let grammar: any;
    if (schema) { try { grammar = await m.llama.createGrammarForJsonSchema(schema); } catch { grammar = await m.llama.getGrammarFor("json").catch(() => undefined); } }
    // progress: a full profile is roughly 3,000 characters of JSON
    let chars = 0;
    const text = await session.prompt(user, { grammar, temperature: 0.2, maxTokens: 2500, signal: ctrl.signal, onTextChunk: (t: string) => { chars += t.length; onProgress?.(Math.min(0.97, chars / 3000)); } });
    return parseLoose(text);
  } catch (e: any) {
    throw new Error(ctrl.signal.aborted ? `the model did not answer within ${Math.round(timeoutMs / 1000)} seconds` : `the model file could not run (${String(e.message || e).slice(0, 160)})`);
  } finally { clearTimeout(t); await context.dispose().catch(() => {}); }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (e: any) { throw new Error(e.name === "AbortError" ? `the model did not answer within ${Math.round(timeoutMs / 1000)} seconds` : e.message); }
  finally { clearTimeout(t); }
}

/** Is a model reachable, and is the configured model installed? Cached for 30 seconds. */
let statusCache: { at: number; value: any } | null = null;
export function resetAiStatus() { statusCache = null; }
export async function aiStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCache.at < 30000) return statusCache.value;
  const c = aiConfig();
  let value: any;
  if (c.provider === "off") value = { connected: false, provider: "off", model: null, reason: "AI is switched off (AI_PROVIDER=off)." };
  else if (c.provider === "local") {
    value = c.modelPath ? { connected: true, provider: "local", model: c.model, size_mb: Math.round(statSync(c.modelPath).size / 1048576), loaded: !!local }
      : { connected: false, provider: "local", model: null, reason: "No model file found. Put a .gguf file (for example qwen2.5-3b-instruct-q4_k_m.gguf) in the app's models folder." };
  } else if (c.provider === "openrouter") {
    if (!c.apiKey) value = { connected: false, provider: "openrouter", model: c.model, reason: "AI_PROVIDER=openrouter needs OPENROUTER_API_KEY in the .env file." };
    else try {
      const k = await fetchJson(`${c.baseUrl}/key`, { headers: orHeaders(c) }, 8000);
      const plan = await openRouterPlan(c);
      value = { connected: true, provider: "openrouter", online: true, model: plan.main, fallbacks: plan.models.slice(1), free_tier: k?.data?.is_free_tier ?? null,
        note: "Online service: draft requests are sent to OpenRouter." };
    } catch (e: any) { value = { connected: false, provider: "openrouter", model: c.model, reason: orError(e).message }; }
  } else {
    try {
      if (c.provider === "ollama") {
        const tags = await fetchJson(`${c.baseUrl}/api/tags`, {}, 4000);
        const models: string[] = (tags.models || []).map((m: any) => m.name);
        const has = models.some(m => m === c.model || m === `${c.model}:latest` || m.split(":")[0] === c.model);
        value = has ? { connected: true, provider: "ollama", model: c.model, models }
          : { connected: false, provider: "ollama", model: c.model, models, reason: `Ollama is running but the model "${c.model}" is not installed. Run: ollama pull ${c.model}` };
      } else {
        const r = await fetchJson(`${c.baseUrl}/models`, { headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {} }, 4000);
        value = { connected: true, provider: "openai", model: c.model, models: (r.data || []).map((m: any) => m.id) };
      }
    } catch (e: any) {
      value = { connected: false, provider: c.provider, model: c.model, reason: `No local model answers at ${c.baseUrl} (${e.message}).` };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

/** Ask the model for one JSON object. The answer is untrusted text: callers validate every field. */
export async function chatJson(system: string, user: string, schema?: object, onProgress?: (fraction: number) => void): Promise<{ data: any; model: string; provider: string }> {
  const c = aiConfig();
  if (c.provider === "off") throw new Error("AI is switched off");
  if (c.provider === "local") {
    if (!c.modelPath) throw new Error("no model file in the models folder");
    return { data: await chatLocal(c.modelPath, system, user, schema, c.timeoutMs, onProgress), model: c.model, provider: "local" };
  }
  // servers answer in one go: estimate progress from elapsed time (a draft takes about a minute on a laptop)
  const started = Date.now(); const tick = onProgress ? setInterval(() => onProgress(Math.min(0.9, (Date.now() - started) / 70000)), 2000) : null;
  try { return await chatServer(c, system, user, schema); } finally { if (tick) clearInterval(tick); }
}
async function chatServer(c: AiConfig, system: string, user: string, schema?: object): Promise<{ data: any; model: string; provider: string }> {
  if (c.provider === "ollama") {
    const r = await fetchJson(`${c.baseUrl}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: c.model, stream: false, format: schema || "json", options: { temperature: 0.2, num_ctx: 8192 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    }, c.timeoutMs);
    return { data: parseLoose(r.message?.content), model: r.model || c.model, provider: "ollama" };
  }
  if (c.provider === "openrouter") {
    if (!c.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const plan = await openRouterPlan(c);
    const body = (json: boolean) => JSON.stringify({ model: plan.main, models: plan.models, temperature: 0.2, ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }] });
    let r: any;
    try { r = await fetchJson(`${c.baseUrl}/chat/completions`, { method: "POST", headers: orHeaders(c), body: body(true) }, c.timeoutMs); }
    catch (e: any) {
      // some free models reject JSON mode: ask again without it (the answer is still parsed and validated)
      if (!/^400/.test(e.message)) throw orError(e);
      try { r = await fetchJson(`${c.baseUrl}/chat/completions`, { method: "POST", headers: orHeaders(c), body: body(false) }, c.timeoutMs); } catch (e2: any) { throw orError(e2); }
    }
    if (r?.error) throw orError(new Error(`${r.error.code || ""} ${r.error.message || "OpenRouter error"}`.trim()));
    return { data: parseLoose(r.choices?.[0]?.message?.content), model: r.model || plan.main, provider: "openrouter" };
  }
  const r = await fetchJson(`${c.baseUrl}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, temperature: 0.2, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  }, c.timeoutMs);
  return { data: parseLoose(r.choices?.[0]?.message?.content), model: r.model || c.model, provider: "openai" };
}

/** Small models sometimes wrap JSON in prose or code fences: take the outermost object. */
export function parseLoose(text: unknown): any {
  const s = String(text ?? "").trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new Error("the model's answer was not valid JSON");
}
