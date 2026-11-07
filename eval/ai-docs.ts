// Runs AI mode end to end, exactly as the app does, against a real local server (Ollama or llama-server)
// on the app's sample and on two full ToS rebuilt from the UNFAIR-ToS test split.
// Reports time per document and how many AI points were kept, dropped (invented quote) or repeated a rule flag.
// Usage: npm run eval:ai-docs -- [model ...] [--url http://127.0.0.1:11434]   (default: qwen3.5:4b qwen3.5:9b)
import { SAMPLE_TOS } from "../app/sample.ts";
import { analyzeWithAi, findAiServer } from "../src/ai/index.ts";
import { analyze } from "../src/engine.ts";
import { detokenize, readSplit } from "./unfair-tos.ts";

const args = process.argv.slice(2);
const urlAt = args.indexOf("--url");
const wantUrl = urlAt === -1 ? undefined : args[urlAt + 1];
const models = args.filter((a, i) => !a.startsWith("--") && (urlAt === -1 || i !== urlAt + 1));
if (models.length === 0) models.push("qwen3.5:4b", "qwen3.5:9b");

const baseUrl = await findAiServer({ baseUrl: wantUrl });
if (!baseUrl) {
  console.error("No AI server answered. Start Ollama (or llama-server) first.");
  process.exit(1);
}

// Two whole documents from the test split. The sentences are in document order; these line ranges
// are where each company's terms start and end (found by the company name in the text).
const rows = readSplit("test");
const fromSplit = (from: number, to: number) =>
  rows.slice(from, to).map((r) => {
    const s = detokenize(r.text);
    return s.charAt(0).toUpperCase() + s.slice(1); // the dataset is lowercased
  }).join("\n");
const DOCS = [
  { name: "App sample (BrightBoard)", text: SAMPLE_TOS },
  { name: "Netflix terms (test split, lines 325-410)", text: fromSplit(325, 411) },
  { name: "Snap terms (test split, lines 411-578)", text: fromSplit(411, 579) },
];

console.log(`AI mode end to end: ${baseUrl}, ${new Date().toISOString().slice(0, 10)}\n`);

for (const model of models) {
  // Load the model first, so the timings below are per document and not model loading.
  const t0 = performance.now();
  await analyzeWithAi("We may share your data with partners.", [], { baseUrl, model });
  console.log(`=== ${model} (first call, including model load: ${secs(performance.now() - t0)})\n`);

  for (const doc of DOCS) {
    const flags = analyze(doc.text);
    let raw = 0;
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    // Count what the model actually returned, before any checking.
    const spy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (init?.method === "POST") {
        const data = await res.clone().json();
        usage = data.usage ?? usage;
        try {
          raw = JSON.parse(data.choices[0].message.content).points.length;
        } catch {}
      }
      return res;
    };
    const t = performance.now();
    const res = await analyzeWithAi(doc.text, flags, { baseUrl, model, fetch: spy });
    const ms = performance.now() - t;
    const repeats = raw - res.points.length - res.dropped;

    console.log(`--- ${doc.name}: ${doc.text.length} chars, ${flags.length} rule flags`);
    console.log(`time ${secs(ms)}, ${usage.prompt_tokens} prompt + ${usage.completion_tokens} output tokens`);
    console.log(`AI points: ${raw} returned, ${res.points.length} kept, ${res.dropped} dropped (quote not in the clause), ${repeats} repeated a rule flag or another AI point`);
    console.log(`summary: ${res.summary}`);
    for (const p of res.points) console.log(`  [${p.severity} ${p.category}] ${p.say}\n      "${p.quote}"`);
    console.log("");
  }
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
