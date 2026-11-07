import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyzeWithAi, CLAUSE_CHAR_CAP, findAiServer, isAiAvailable, OLLAMA_BASE_URL, pickModel } from "../src/ai/index.ts";
import { splitClauses } from "../src/split.ts";
import type { Flag } from "../src/types.ts";

interface Call {
  url: string;
  body: any;
}

/**
 * A fake server whose chat endpoint always answers with `content` (an object is sent as JSON).
 * GET /v1/models lists `models` like Ollama does, or is a 404 when `models` isn't given. Only chat calls are recorded.
 */
function fakeServer(content: unknown, calls: Call[] = [], models?: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== "POST") {
      if (!models || !String(url).endsWith("/v1/models")) return new Response("Not found", { status: 404 });
      return Response.json({ object: "list", data: models.map((id) => ({ id, object: "model" })) });
    }
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const TEXT =
  "Welcome to Acme. We collect your location and contacts when you use the app. " +
  "We may share   your\n  information with advertising partners. The sky is blue.";
const idOf = (needle: string) => `c${splitClauses(TEXT).findIndex((c) => c.text.includes(needle))}`;
const SHARE = idOf("advertising partners");
const point = (over: object) => ({
  clauseId: SHARE,
  category: "data-sharing",
  severity: "high",
  say: "They give your info to advertisers.",
  quote: "we may share your information",
  ...over,
});

describe("analyzeWithAi", () => {
  test("keeps a real quote and maps it to exact offsets (ignoring case and spacing)", async () => {
    const reply = { summary: " Acme tracks you. ", points: [point({ quote: "WE MAY share your information with advertising partners." })] };
    const res = await analyzeWithAi(TEXT, [], { fetch: fakeServer(reply) });

    assert.equal(res.summary, "Acme tracks you.");
    assert.equal(res.dropped, 0);
    assert.equal(res.points.length, 1);
    const p = res.points[0];
    const start = TEXT.indexOf("We may share");
    const end = TEXT.indexOf("partners.") + "partners.".length;
    assert.deepEqual([p.start, p.end], [start, end]);
    assert.equal(p.quote, TEXT.slice(start, end));
    assert.equal(p.category, "data-sharing");
    assert.equal(p.severity, "high");
  });

  test("drops and counts made-up quotes, quotes from another clause and bad ids", async () => {
    const reply = {
      summary: "s",
      points: [
        point({ quote: "we sell your kidneys" }),
        point({ quote: "we collect your location" }), // real text, wrong clause
        point({ clauseId: "c999" }),
        point({ category: "not-a-category" }),
        point({}), // the only good one
      ],
    };
    const res = await analyzeWithAi(TEXT, [], { fetch: fakeServer(reply) });
    assert.equal(res.dropped, 4);
    assert.equal(res.points.length, 1);
  });

  test("skips points that repeat a rule flag (same clause, same category) without counting them", async () => {
    const clause = splitClauses(TEXT).find((c) => c.text.includes("advertising partners"))!;
    const flag: Flag = { ruleId: "x", category: "data-sharing", severity: "high", say: "", quote: clause.text, start: clause.start, end: clause.end };
    const reply = { summary: "s", points: [point({}), point({ category: "action", severity: "info" })] };
    const res = await analyzeWithAi(TEXT, [flag], { fetch: fakeServer(reply) });
    assert.equal(res.dropped, 0);
    assert.deepEqual(res.points.map((p) => p.category), ["action"]);
  });

  test("strips <think> blocks before parsing", async () => {
    const json = JSON.stringify({ summary: "ok", points: [point({})] });
    for (const content of [`<think>\nhmm {not json}\n</think>\n\n${json}`, `still thinking </think>${json}`, "```json\n" + json + "\n```"]) {
      const res = await analyzeWithAi(TEXT, [], { fetch: fakeServer(content) });
      assert.equal(res.summary, "ok");
      assert.equal(res.points.length, 1);
    }
  });

  test("fails with a clear error on invalid JSON", async () => {
    await assert.rejects(analyzeWithAi(TEXT, [], { fetch: fakeServer("<think>x</think> sure! here you go") }), /valid JSON/);
    await assert.rejects(analyzeWithAi(TEXT, [], { fetch: fakeServer({ points: [] }) }), /summary/);
  });

  test("sends only flagged and keyword clauses, flagged first, within the cap", async () => {
    const filler = Array.from({ length: 120 }, (_, i) => `Clause ${i}: we keep your information for a long while, as described here.`);
    const text = ["The sky is blue.", ...filler, "Disputes go to a court on the moon."].join(" ");
    const clauses = splitClauses(text);
    const moon = clauses[clauses.length - 1];
    const flag: Flag = { ruleId: "x", category: "your-rights", severity: "high", say: "", quote: moon.text, start: moon.start, end: moon.end };

    const calls: Call[] = [];
    await analyzeWithAi(text, [flag], { fetch: fakeServer({ summary: "s", points: [] }, calls) });

    assert.equal(calls.length, 1);
    const { url, body } = calls[0];
    assert.equal(url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.equal(body.temperature, 0);
    assert.equal(body.response_format.type, "json_schema");
    assert.ok(body.response_format.json_schema.name);
    assert.ok(body.response_format.json_schema.schema);
    assert.equal(body.chat_template_kwargs.enable_thinking, false);

    const user: string = body.messages.find((m: any) => m.role === "user").content;
    const lines = user.split("\n").filter((l) => /^\[c\d+\] /.test(l));
    assert.ok(lines.some((l) => l.includes("court on the moon")), "flagged clause is sent even though it's last");
    assert.ok(!user.includes("The sky is blue"), "unflagged, keyword-free clause is not sent");
    assert.ok(lines.length < clauses.length - 1, "the cap cut some keyword clauses");
    assert.ok(lines.reduce((n, l) => n + l.length + 1, 0) <= CLAUSE_CHAR_CAP);
  });

  test("uses baseUrl and model when given", async () => {
    const calls: Call[] = [];
    await analyzeWithAi(TEXT, [], { baseUrl: "http://localhost:9000/", model: "bonsai", fetch: fakeServer({ summary: "s", points: [] }, calls) });
    assert.equal(calls[0].url, "http://localhost:9000/v1/chat/completions");
    assert.equal(calls[0].body.model, "bonsai");
  });

  test("turns thinking off for Ollama (reasoning_effort) and llama-server (chat_template_kwargs)", async () => {
    const calls: Call[] = [];
    await analyzeWithAi(TEXT, [], { fetch: fakeServer({ summary: "s", points: [] }, calls) });
    assert.equal(calls[0].body.reasoning_effort, "none");
    assert.equal(calls[0].body.chat_template_kwargs.enable_thinking, false);
  });

  test("with no model set, picks a Qwen model from /v1/models and reports it", async () => {
    const calls: Call[] = [];
    const models = ["nomic-embed-text:latest", "llama3.2:3b", "qwen3.5:9b", "qwen3.5:4b"];
    const res = await analyzeWithAi(TEXT, [], { baseUrl: OLLAMA_BASE_URL, fetch: fakeServer({ summary: "s", points: [] }, calls, models) });
    assert.equal(calls[0].url, `${OLLAMA_BASE_URL}/v1/chat/completions`);
    assert.equal(calls[0].body.model, "qwen3.5:9b");
    assert.equal(res.model, "qwen3.5:9b");
  });

  test("a set model wins over the list; no list means no model is sent (llama-server)", async () => {
    const calls: Call[] = [];
    const reply = { summary: "s", points: [] };
    await analyzeWithAi(TEXT, [], { model: " qwen3.5:4b ", fetch: fakeServer(reply, calls, ["qwen3.5:9b"]) });
    assert.equal(calls[0].body.model, "qwen3.5:4b");
    const res = await analyzeWithAi(TEXT, [], { fetch: fakeServer(reply, calls) });
    assert.equal("model" in calls[1].body, false);
    assert.equal(res.model, undefined);
  });

  test("passes on the server's own error message", async () => {
    const f = (async () =>
      Response.json({ error: { message: 'model "qwen9" not found' } }, { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    await assert.rejects(analyzeWithAi(TEXT, [], { model: "qwen9", fetch: f }), /HTTP 404 Not Found: model "qwen9" not found/);
  });
});

describe("pickModel", () => {
  test("prefers Qwen, skips embedding models, else takes the first", async () => {
    const pick = (models: string[]) => pickModel({ fetch: fakeServer({}, [], models) });
    assert.equal(await pick(["llama3.2:3b", "Qwen3-8B-Q4_K_M.gguf"]), "Qwen3-8B-Q4_K_M.gguf");
    assert.equal(await pick(["nomic-embed-text:latest", "llama3.2:3b"]), "llama3.2:3b");
    assert.equal(await pick(["nomic-embed-text:latest"]), undefined);
    assert.equal(await pick([]), undefined);
  });

  test("undefined when the list can't be read", async () => {
    const asyncThrow = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.equal(await pickModel({ fetch: fakeServer({}) }), undefined); // 404
    assert.equal(await pickModel({ fetch: asyncThrow }), undefined);
    assert.equal(await pickModel({ fetch: (async () => new Response("not json")) as unknown as typeof fetch }), undefined);
  });
});

describe("isAiAvailable", () => {
  const status = (code: number) => (async () => new Response("{}", { status: code })) as unknown as typeof fetch;

  test("true on 200 from /health", async () => {
    let url = "";
    const f = (async (u: string) => ((url = u), new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    assert.equal(await isAiAvailable({ fetch: f }), true);
    assert.equal(url, "http://127.0.0.1:8080/health");
  });

  test("false on non-200 (503 = model still loading)", async () => {
    assert.equal(await isAiAvailable({ fetch: status(503) }), false);
  });

  test("false when fetch throws", async () => {
    const asyncThrow = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const syncThrow = (() => {
      throw new TypeError("nope");
    }) as unknown as typeof fetch;
    assert.equal(await isAiAvailable({ fetch: asyncThrow }), false);
    assert.equal(await isAiAvailable({ fetch: syncThrow }), false);
  });

  test("false after about 2s when the server never answers", async () => {
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    const t0 = Date.now();
    assert.equal(await isAiAvailable({ fetch: hang }), false);
    assert.ok(Date.now() - t0 < 3000);
  });

  /** Answers each path with its own status; anything else is a 404. */
  const routes = (map: Record<string, number>, seen: string[] = []) =>
    (async (u: string) => {
      seen.push(u);
      return new Response("{}", { status: map[new URL(u).pathname] ?? 404 });
    }) as unknown as typeof fetch;

  test("no /health but /v1/models is 200 (Ollama): true", async () => {
    const seen: string[] = [];
    assert.equal(await isAiAvailable({ baseUrl: OLLAMA_BASE_URL, fetch: routes({ "/v1/models": 200 }, seen) }), true);
    assert.deepEqual(seen, [`${OLLAMA_BASE_URL}/health`, `${OLLAMA_BASE_URL}/v1/models`]);
  });

  test("/health 503 stays false even if /v1/models answers (llama-server still loading)", async () => {
    assert.equal(await isAiAvailable({ fetch: routes({ "/health": 503, "/v1/models": 200 }) }), false);
  });

  test("false when neither /health nor /v1/models is 200", async () => {
    assert.equal(await isAiAvailable({ fetch: routes({ "/v1/models": 500 }) }), false);
  });
});

describe("findAiServer", () => {
  /** Servers that are up, by origin. Everything else refuses the connection. */
  const up = (origins: string[], seen: string[] = []) =>
    (async (u: string) => {
      seen.push(u);
      const url = new URL(u);
      if (!origins.includes(url.origin)) throw new TypeError("fetch failed");
      return new Response("{}", { status: url.pathname === "/v1/models" ? 200 : 404 });
    }) as unknown as typeof fetch;

  test("uses the configured server when it answers, without trying Ollama", async () => {
    const seen: string[] = [];
    assert.equal(await findAiServer({ baseUrl: "http://127.0.0.1:8080/", fetch: up(["http://127.0.0.1:8080"], seen) }), "http://127.0.0.1:8080");
    assert.ok(seen.every((u) => u.startsWith("http://127.0.0.1:8080/")));
  });

  test("falls back to Ollama on 11434 when the configured server is down", async () => {
    assert.equal(await findAiServer({ fetch: up([OLLAMA_BASE_URL]) }), OLLAMA_BASE_URL);
  });

  test("null when nothing answers", async () => {
    assert.equal(await findAiServer({ baseUrl: "http://127.0.0.1:9", fetch: up([]) }), null);
  });
});
