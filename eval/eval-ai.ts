// Scores a local model (Ollama or llama-server) on UNFAIR-ToS the same way eval-unfair-tos.ts scores
// the rules: precision, recall and F1 for each of the 8 clause types, micro-F1, and fair sentences flagged.
// Sentences go in batches; the model tags each with zero or more labels, as JSON forced by a schema.
// Usage: npm run eval:ai -- [test|validation|train] [--model qwen3.5:9b] [--url http://127.0.0.1:11434]
//                           [--batch 20] [--limit N] [--stratified] [--errors]
//   --errors  also prints up to 4 wrongly flagged and 4 missed sentences per type.
import { findAiServer, pickModel } from "../src/ai/index.ts";
import { analyze } from "../src/engine.ts";
import { RULES } from "../src/rules.ts";
import type { UnfairTosLabel } from "../src/types.ts";
import { detokenize, readSplit } from "./unfair-tos.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const VALUE_FLAGS = ["--model", "--url", "--batch", "--limit"];
const split = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1])) ?? "test";
const batchSize = Number(flag("--batch") ?? 20);
const limit = Number(flag("--limit") ?? Infinity);

const LABELS: UnfairTosLabel[] = [
  "Limitation of liability",
  "Unilateral termination",
  "Unilateral change",
  "Content removal",
  "Contract by using",
  "Choice of law",
  "Jurisdiction",
  "Arbitration",
];

// Short definitions after the CLAUDETTE paper (Lippi et al., 2019), which UNFAIR-ToS comes from.
const SYSTEM = `You label sentences from online terms of service with the 8 types of potentially unfair clause in the CLAUDETTE / UNFAIR-ToS dataset:
- Limitation of liability: the provider excludes or limits its liability for damage, loss or harm (including "as is" disclaimers and caps on damages).
- Unilateral termination: the provider may suspend or terminate the service or the user's account on its own, e.g. at any time or for any reason.
- Unilateral change: the provider may change the terms or the service on its own, without the user's consent.
- Content removal: the provider may remove or delete the user's content, at its discretion or without notice.
- Contract by using: the user is bound by the terms just by using or accessing the service.
- Choice of law: the sentence says which country's or state's law governs the contract.
- Jurisdiction: the sentence says which courts will hear disputes.
- Arbitration: disputes are settled by arbitration instead of in court.
Most sentences are none of these: give them an empty list. A sentence can have more than one label. Judge each sentence on its own.
Reply with JSON that maps every sentence id to its list of labels.`;

// --stratified: every unfair sentence plus as many fair ones, spread evenly over the split (a quicker run).
const allRows = readSplit(split);
const unfairRows = allRows.filter((r) => r.labels.length > 0);
const fairRows = allRows.filter((r) => r.labels.length === 0);
const stratified = args.includes("--stratified");
const rows = stratified
  ? [...unfairRows, ...fairRows.filter((_, i) => i % Math.floor(fairRows.length / unfairRows.length) === 0).slice(0, unfairRows.length)]
  : allRows.slice(0, limit);
const texts = rows.map((r) => detokenize(r.text));

const baseUrl = await findAiServer({ baseUrl: flag("--url") });
if (!baseUrl) {
  console.error("No AI server answered. Start Ollama (or llama-server) first.");
  process.exit(1);
}
const model = flag("--model") ?? (await pickModel({ baseUrl }));

// ---------- ask the model ----------
const predicted: Set<UnfairTosLabel>[] = texts.map(() => new Set());
let failedBatches = 0;
let missing = 0;
let tokensIn = 0;
let tokensOut = 0;
const t0 = performance.now();

for (let from = 0; from < texts.length; from += batchSize) {
  const ids = texts.slice(from, from + batchSize).map((_, k) => `s${k + 1}`);
  const user = ids.map((id, k) => `[${id}] ${texts[from + k]}`).join("\n");
  let answer: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
    try {
      answer = await ask(user, ids);
    } catch (err) {
      console.error(`batch at ${from}, try ${attempt}: ${(err as Error).message}`);
    }
  }
  if (!answer) {
    failedBatches++;
    continue; // counted as "no label" for every sentence in it
  }
  ids.forEach((id, k) => {
    const got = answer[id];
    if (!Array.isArray(got)) missing++;
    else for (const l of got) if (LABELS.includes(l)) predicted[from + k].add(l);
  });
  process.stderr.write(`\r${Math.min(from + batchSize, texts.length)} / ${texts.length}`);
}
process.stderr.write("\n");
const seconds = (performance.now() - t0) / 1000;

async function ask(user: string, ids: string[]): Promise<Record<string, unknown>> {
  const labelList = { type: "array", items: { type: "string", enum: LABELS }, maxItems: LABELS.length };
  const schema = {
    type: "object",
    properties: Object.fromEntries(ids.map((id) => [id, labelList])),
    required: ids,
    additionalProperties: false,
  };
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Same settings as AI mode in src/ai/index.ts.
    body: JSON.stringify({
      ...(model ? { model } : {}),
      temperature: 0,
      presence_penalty: 0,
      max_tokens: 1024,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Sentences:\n${user}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "unfair_tos_labels", schema } },
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  tokensIn += data.usage?.prompt_tokens ?? 0;
  tokensOut += data.usage?.completion_tokens ?? 0;
  return JSON.parse(data.choices[0].message.content);
}

// ---------- score: same counting as eval-unfair-tos.ts ----------
type Counts = { tp: number; fp: number; fn: number };
function score(pred: Set<string>[]) {
  const per = new Map<UnfairTosLabel, Counts>(LABELS.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
  let fair = 0;
  let fairFlagged = 0;
  rows.forEach((row, i) => {
    for (const [label, s] of per) {
      const isGold = row.labels.includes(label);
      const isPredicted = pred[i].has(label);
      if (isGold && isPredicted) s.tp++;
      else if (isPredicted) s.fp++;
      else if (isGold) s.fn++;
    }
    if (row.labels.length === 0) {
      fair++;
      if (pred[i].size > 0) fairFlagged++;
    }
  });
  const all = [...per.values()].reduce((a, s) => ({ tp: a.tp + s.tp, fp: a.fp + s.fp, fn: a.fn + s.fn }), { tp: 0, fp: 0, fn: 0 });
  return { per, all, fair, fairFlagged };
}

const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "  -  ");
const prf = ({ tp, fp, fn }: Counts) => {
  const p = tp / (tp + fp);
  const r = tp / (tp + fn);
  return [p, r, (2 * p * r) / (p + r)];
};

const ai = score(predicted);
console.log(`UNFAIR-ToS ${split}: ${rows.length} sentences${stratified ? ` (stratified: all ${unfairRows.length} unfair + ${rows.length - unfairRows.length} of ${fairRows.length} fair)` : ""}, model ${model ?? "(server default)"} at ${baseUrl}`);
console.log(
  `${Math.ceil(texts.length / batchSize)} requests of up to ${batchSize} sentences, ${seconds.toFixed(0)} s ` +
    `(${(texts.length / seconds).toFixed(1)} sentences/s), ${tokensIn} prompt + ${tokensOut} output tokens\n`,
);
console.log("Clause type".padEnd(26) + "Precision".padStart(10) + "Recall".padStart(10) + "F1".padStart(10) + "Count".padStart(8));
for (const [label, s] of ai.per) {
  console.log(label.padEnd(26) + prf(s).map((x) => pct(x).padStart(10)).join("") + String(s.tp + s.fn).padStart(8));
}
console.log("All (micro)".padEnd(26) + prf(ai.all).map((x) => pct(x).padStart(10)).join(""));
console.log(`\nFair sentences wrongly flagged: ${ai.fairFlagged} / ${ai.fair} (${pct(ai.fairFlagged / ai.fair)})`);
if (failedBatches || missing) console.log(`Failed batches: ${failedBatches}. Sentences with no answer: ${missing}.`);

if (args.includes("--errors")) {
  for (const label of LABELS) {
    const fp = texts.filter((_, i) => predicted[i].has(label) && !rows[i].labels.includes(label));
    const fn = texts.filter((_, i) => !predicted[i].has(label) && rows[i].labels.includes(label));
    if (fp.length + fn.length === 0) continue;
    console.log(`\n"${label}": ${fp.length} wrongly flagged, ${fn.length} missed`);
    for (const t of fp.slice(0, 4)) console.log(`  + ${t.length > 160 ? t.slice(0, 157) + "..." : t}`);
    for (const t of fn.slice(0, 4)) console.log(`  - ${t.length > 160 ? t.slice(0, 157) + "..." : t}`);
  }
}

// The rules (as they are now) on the same sentences, and rules + AI together, for comparison.
const labelOf = new Map(RULES.flatMap((r) => (r.unfairTos ? [[r.id, r.unfairTos] as const] : [])));
const byRules = texts.map((t) => new Set(analyze(t).flatMap((f) => labelOf.get(f.ruleId) ?? [])));
const rules = score(byRules);
const both = score(byRules.map((s, i) => new Set([...s, ...predicted[i]])));
console.log("\nMicro-F1 on the same sentences".padEnd(34) + "Precision".padStart(10) + "Recall".padStart(10) + "F1".padStart(10) + "  Fair flagged");
for (const [name, s] of [["Rules only (no AI)", rules], [`AI only (${model})`, ai], ["Rules or AI", both]] as const) {
  console.log(name.padEnd(34) + prf(s.all).map((x) => pct(x).padStart(10)).join("") + `  ${pct(s.fairFlagged / s.fair)}`);
}
