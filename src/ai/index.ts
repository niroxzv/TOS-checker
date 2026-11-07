// AI mode: asks a small local model (Ollama, e.g. qwen3.5:9b, or llama.cpp `llama-server`) for a
// summary and extra points, but only about the clauses the rules or broad keywords picked out, and
// only keeps points whose quote really is in the clause they name. Both servers speak the OpenAI
// API under /v1. No Node APIs: this also runs in the browser.
import { splitClauses } from "../split.ts";
import type { Category, Clause, Flag, Severity } from "../types.ts";

export interface AiOptions {
  /** Server address. Default "http://127.0.0.1:8080" (llama-server); Ollama is "http://127.0.0.1:11434". */
  baseUrl?: string;
  /** Sent as `model`. When unset, one is picked from GET /v1/models (a Qwen model if there is one). */
  model?: string;
  /** Swap in a fake for tests. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface AiPoint {
  category: Category;
  severity: Severity;
  say: string;
  /** Always equals text.slice(start, end). */
  quote: string;
  start: number;
  end: number;
}

export interface AiResult {
  summary: string;
  points: AiPoint[];
  /** AI points thrown away because their quote isn't in the clause they named (or they were malformed). */
  dropped: number;
  /** The model name that was sent, if any. */
  model?: string;
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
/** Most characters of clause lines sent to the model. It runs on a CPU, so keep the prompt small. */
export const CLAUSE_CHAR_CAP = 8000;
const HEALTH_TIMEOUT_MS = 2000;

const CATEGORIES: Category[] = ["data-collection", "data-sharing", "your-content", "your-rights", "money", "action"];
const SEVERITIES: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

// Clauses worth sending even when no rule fired on them.
const KEYWORDS: RegExp[] = [
  /data|information|personal|privacy|collect|share|sell|third[\s-]*part|partner|advertis|cookie|track|locat|biometric/i,
  /licen|your content|royalt|intellectual property/i,
  /arbitrat|class action|waive|jury|governing law|jurisdiction|terminat|suspend|liab|indemn|warrant/i,
  /renew|subscription|cancel|refund|\bfees?\b|charge|payment|billing/i,
  /\bAI\b|artificial intelligence|machine learning|\btrain/i,
  /delet|retain|retention|consent|opt[\s-]*out|\b(?:chang|modif|amend)/i,
];

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    points: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          clauseId: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: SEVERITIES },
          say: { type: "string" },
          quote: { type: "string" },
        },
        required: ["clauseId", "category", "severity", "say", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "points"],
  additionalProperties: false,
};

// Constant, so llama-server can reuse its cached prefix between requests.
const SYSTEM = `You help ordinary people understand a terms of service before they accept it.
You get numbered clauses, each tagged with an id like [c12]. Use only those clauses.
Reply with JSON: {"summary": string, "points": [{"clauseId", "category", "severity", "say", "quote"}]}
- summary: 2 to 4 plain-English sentences on what the user is agreeing to.
- points: up to 12 things the user should know.
- clauseId: the id of the clause the point comes from, e.g. "c12".
- category: data-collection (what they collect), data-sharing (who gets it), your-content (rights over what you post or upload), your-rights (rights you give up: arbitration, liability, account termination, changes to the terms), money (fees, auto-renewal, refunds), action (something you can do: opt out, delete, cancel).
- severity: high, medium, low or info.
- say: one short plain-English sentence for the user.
- quote: words copied exactly from that clause, a few words up to one sentence. One unbroken run of words: never use "..." or skip words.`;

/**
 * True when the server is ready, within about 2 seconds: GET /health is 200 (llama-server with its
 * model loaded), or the server has no /health but GET /v1/models is 200 (Ollama). A 503 from /health
 * means llama-server is still loading, so that stays false.
 */
export async function isAiAvailable(opts: AiOptions = {}): Promise<boolean> {
  if (opts.signal?.aborted) return false;
  const f = opts.fetch ?? globalThis.fetch;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const status = (path: string) =>
    Promise.resolve()
      .then(() => f(`${baseUrl(opts)}${path}`, { signal: ctrl.signal }))
      .then((res) => res.status, () => 0);
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(false);
      }, HEALTH_TIMEOUT_MS);
    });
    const check = status("/health").then(async (code) =>
      code === 200 || (code !== 503 && (await status("/v1/models")) === 200),
    );
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** The first server that is ready: opts.baseUrl (default llama-server's), then Ollama's. Null if neither is. */
export async function findAiServer(opts: AiOptions = {}): Promise<string | null> {
  for (const url of new Set([baseUrl(opts), OLLAMA_BASE_URL])) {
    if (await isAiAvailable({ ...opts, baseUrl: url })) return url;
    if (opts.signal?.aborted) return null;
  }
  return null;
}

/**
 * A model name from GET /v1/models, for servers like Ollama that need one: the first Qwen model,
 * else the first one that isn't an embedding model. Undefined when the list can't be read.
 */
export async function pickModel(opts: AiOptions = {}): Promise<string | undefined> {
  const f = opts.fetch ?? globalThis.fetch;
  try {
    const res = await f(`${baseUrl(opts)}/v1/models`, { signal: opts.signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (Array.isArray(data?.data) ? data.data : [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string" && !/embed/i.test(id));
    return ids.find((id) => /qwen/i.test(id)) ?? ids[0];
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return undefined;
  }
}

/** Ask the local model about the clauses that matter, then keep only points it can back with a real quote. */
export async function analyzeWithAi(text: string, ruleFlags: Flag[], opts: AiOptions = {}): Promise<AiResult> {
  const picked = pickClauses(splitClauses(text), ruleFlags);
  if (picked.length === 0) return { summary: "", points: [], dropped: 0 };

  const model = opts.model?.trim() || (await pickModel(opts));
  const reply = await chat(
    picked.map((p) => clauseLine(p.id, p.clause)).join("\n"),
    { ...opts, model },
  );
  const json = parseReply(reply);

  const byId = new Map(picked.map((p) => [p.id, p.clause]));
  const seen = new Set<string>();
  const points: AiPoint[] = [];
  let dropped = 0;

  for (const raw of json.points) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const id = clauseIdOf(p.clauseId);
    const clause = byId.get(id);
    const category = p.category as Category;
    const severity = p.severity as Severity;
    const say = typeof p.say === "string" ? p.say.trim() : "";
    const at = clause && typeof p.quote === "string" ? locate(clause, p.quote) : null;
    if (!clause || !at || !say || !CATEGORIES.includes(category) || !SEVERITIES.includes(severity)) {
      dropped++;
      continue;
    }
    // Same clause and category as a rule flag, or as an earlier AI point: nothing new to show.
    const key = `${id}|${category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ruleFlags.some((f) => f.category === category && f.start < clause.end && f.end > clause.start)) continue;
    points.push({ category, severity, say, quote: text.slice(at.start, at.end), start: at.start, end: at.end });
  }

  points.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.start - b.start);
  return { summary: json.summary.trim(), points, dropped, ...(model ? { model } : {}) };
}

// ---------- picking clauses ----------

interface Picked {
  id: string;
  clause: Clause;
}

const clauseLine = (id: string, c: Clause) => `[${id}] ${c.text.replace(/\s+/g, " ")}`;

/** Rule-flagged clauses first, then keyword clauses, up to the cap; returned in document order. */
function pickClauses(clauses: Clause[], ruleFlags: Flag[], cap = CLAUSE_CHAR_CAP): Picked[] {
  const tier = clauses.map((c) =>
    ruleFlags.some((f) => f.start < c.end && f.end > c.start) ? 0 : KEYWORDS.some((re) => re.test(c.text)) ? 1 : 2,
  );
  // Nothing stands out: send the start of the text so the model can still summarise it.
  const maxTier = tier.some((t) => t < 2) ? 1 : 2;
  const order = clauses
    .map((_, i) => i)
    .filter((i) => tier[i] <= maxTier)
    .sort((a, b) => tier[a] - tier[b] || a - b);

  const keep: number[] = [];
  let used = 0;
  for (const i of order) {
    const size = clauseLine(`c${i}`, clauses[i]).length + 1; // + newline
    if (used + size > cap) continue; // a shorter one later may still fit
    used += size;
    keep.push(i);
  }
  return keep.sort((a, b) => a - b).map((i) => ({ id: `c${i}`, clause: clauses[i] }));
}

// ---------- talking to the server ----------

function baseUrl(opts: AiOptions): string {
  return (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function chat(clauseLines: string, opts: AiOptions): Promise<string> {
  const f = opts.fetch ?? globalThis.fetch;
  const url = `${baseUrl(opts)}/v1/chat/completions`;
  const body = {
    ...(opts.model ? { model: opts.model } : {}),
    temperature: 0,
    // Quotes must repeat the clause word for word. Ollama's qwen3.5 defaults to presence_penalty 1.5,
    // which pushes the model to reword them (and so get them dropped).
    presence_penalty: 0,
    max_tokens: 2048,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Clauses:\n${clauseLines}` },
    ],
    response_format: { type: "json_schema", json_schema: { name: "tos_review", schema: SCHEMA } },
    // Qwen3-based models think by default, and the thinking eats the token budget. Ollama turns it
    // off with reasoning_effort "none" (it ignores chat_template_kwargs); llama-server reads chat_template_kwargs.
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
  };

  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new Error(`Couldn't reach the AI server at ${baseUrl(opts)}: ${(err as Error)?.message ?? err}`);
  }
  if (!res.ok) {
    // Ollama and llama-server explain themselves, e.g. {"error": {"message": "model \"x\" not found"}}.
    const why = await res.json().then((d) => d?.error?.message ?? d?.error, () => undefined);
    throw new Error(`AI server returned HTTP ${res.status} ${res.statusText}`.trim() + (typeof why === "string" ? `: ${why}` : ""));
  }

  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI server reply had no message content");
  return content;
}

/** Strip <think> blocks (and code fences) and parse. Throws a clear error on anything that isn't our JSON. */
export function parseReply(content: string): { summary: string; points: unknown[] } {
  let s = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = s.toLowerCase().lastIndexOf("</think>"); // the opening tag may be in the prompt template
  if (close !== -1) s = s.slice(close + "</think>".length);
  s = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let json: unknown;
  try {
    json = JSON.parse(s);
  } catch {
    throw new Error(`AI reply wasn't valid JSON: ${s.slice(0, 200) || "(empty)"}`);
  }
  const obj = json as { summary?: unknown; points?: unknown };
  if (!obj || typeof obj !== "object" || typeof obj.summary !== "string" || !Array.isArray(obj.points)) {
    throw new Error("AI reply JSON is missing `summary` (string) or `points` (array)");
  }
  return { summary: obj.summary, points: obj.points };
}

// ---------- checking quotes ----------

function clauseIdOf(v: unknown): string {
  const id = String(v ?? "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  return /^\d+$/.test(id) ? `c${id}` : id;
}

function fold(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (/[‘’‛′`]/.test(ch)) return "'";
  if (/[“”„″]/.test(ch)) return '"';
  if (/[‐-―−]/.test(ch)) return "-";
  return ch.toLowerCase();
}

/** Lowercased, whitespace-collapsed text, with where each of its characters came from in the original. */
function normalise(s: string): { text: string; from: number[]; to: number[] } {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    const next = i + ch.length;
    const n = fold(ch);
    if (!(n === " " && (text === "" || text.endsWith(" ")))) {
      for (const unit of n) {
        text += unit;
        from.push(i);
        to.push(next);
      }
    }
    i = next;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    from.pop();
    to.pop();
  }
  return { text, from, to };
}

/** Exact offsets of the quote in the source text, or null if it isn't in the clause. */
function locate(clause: Clause, quote: string): { start: number; end: number } | null {
  const trimmed = quote
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, "");
  const q = normalise(trimmed).text;
  if (!q) return null;
  const c = normalise(clause.text);
  // Models like to add a full stop the clause doesn't have.
  for (const cand of [q, q.replace(/[.,;:!?]+$/, "")]) {
    const at = cand ? c.text.indexOf(cand) : -1;
    if (at !== -1) return { start: clause.start + c.from[at], end: clause.start + c.to[at + cand.length - 1] };
  }
  return null;
}
