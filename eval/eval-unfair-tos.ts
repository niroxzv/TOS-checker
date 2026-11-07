// Scores the rule engine against UNFAIR-ToS: precision, recall and F1 for each of its 8 clause types.
// Usage: npm run eval -- [test|validation|train] [--misses] [--rules-only]
//   --misses      also prints up to 5 sentences per type that were missed, to help write new rules.
//   --rules-only  scores the hand-written rules without the trained model (src/model.ts).
// The model was trained on train + validation, so only the test split is a fair score for it.
import { readFileSync } from "node:fs";
import { analyze } from "../src/engine.ts";
import { RULES } from "../src/rules.ts";
import { detokenize } from "./detokenize.ts";

const args = process.argv.slice(2);
const split = args.find((a) => !a.startsWith("--")) ?? "test";
const showMisses = args.includes("--misses");
const rulesOnly = args.includes("--rules-only");

let lines: string[];
try {
  lines = readFileSync(new URL(`./data/unfair-tos-${split}.jsonl`, import.meta.url), "utf8").trim().split("\n");
} catch {
  console.error(`No data for "${split}". Run first: npm run eval:fetch -- ${split}`);
  process.exit(1);
}

// rule id -> UNFAIR-ToS label, for the rules that cover one
const labelOf = new Map(RULES.flatMap((r) => (r.unfairTos ? [[r.id, r.unfairTos] as const] : [])));
const labels = [...new Set(labelOf.values())];
const stats = new Map(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0, missed: [] as string[] }]));
let fair = 0;
let noneTp = 0, noneFp = 0, noneFn = 0; // LexGLUE also scores "no unfair clause" as a ninth label
let fairFlagged = 0;

for (const line of lines) {
  const { text: raw, labels: gold } = JSON.parse(line) as { text: string; labels: string[] };
  const text = detokenize(raw);
  const predicted = new Set(analyze(text, RULES, { model: !rulesOnly }).flatMap((f) => labelOf.get(f.ruleId) ?? []));

  for (const [label, s] of stats) {
    const isGold = gold.includes(label);
    const isPredicted = predicted.has(label);
    if (isGold && isPredicted) s.tp++;
    else if (isPredicted) s.fp++;
    else if (isGold) {
      s.fn++;
      s.missed.push(text);
    }
  }
  const goldNone = !gold.some((g) => stats.has(g));
  const predNone = predicted.size === 0;
  if (goldNone && predNone) noneTp++;
  else if (predNone) noneFp++;
  else if (goldNone) noneFn++;
  if (gold.length === 0) {
    fair++;
    if (predicted.size > 0) fairFlagged++;
  }
}

const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "  -  ");
const scores = (tp: number, fp: number, fn: number) => {
  const p = tp / (tp + fp);
  const r = tp / (tp + fn);
  return [pct(p), pct(r), pct((2 * p * r) / (p + r))];
};

console.log(`UNFAIR-ToS ${split}: ${lines.length} sentences, ${rulesOnly ? "rules only" : "rules + trained model"}\n`);
console.log("Clause type".padEnd(26) + "Precision".padStart(10) + "Recall".padStart(10) + "F1".padStart(10) + "Count".padStart(8));
let all = { tp: 0, fp: 0, fn: 0 };
for (const [label, s] of stats) {
  console.log(label.padEnd(26) + scores(s.tp, s.fp, s.fn).map((x) => x.padStart(10)).join("") + String(s.tp + s.fn).padStart(8));
  all = { tp: all.tp + s.tp, fp: all.fp + s.fp, fn: all.fn + s.fn };
}
console.log("All (micro)".padEnd(26) + scores(all.tp, all.fp, all.fn).map((x) => x.padStart(10)).join(""));
const f1 = (tp: number, fp: number, fn: number) => (2 * tp) / (2 * tp + fp + fn || 1);
const typeF1 = [...stats.values()].map((s) => f1(s.tp, s.fp, s.fn));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
console.log("Average of the 8 (macro)".padEnd(26) + pct(sum(typeF1) / typeF1.length).padStart(30));
// LexGLUE, whose published results we compare with, also scores "no unfair clause" as a 9th label.
const lgMicro = f1(all.tp + noneTp, all.fp + noneFp, all.fn + noneFn);
const lgMacro = (sum(typeF1) + f1(noneTp, noneFp, noneFn)) / (typeF1.length + 1);
console.log(`\nLexGLUE scoring (9 labels): micro-F1 ${pct(lgMicro)}, macro-F1 ${pct(lgMacro)}`);
console.log(`\nFair sentences wrongly flagged: ${fairFlagged} / ${fair} (${pct(fairFlagged / fair)})`);

if (showMisses) {
  for (const [label, s] of stats) {
    if (s.missed.length === 0) continue;
    console.log(`\nMissed "${label}":`);
    for (const t of s.missed.slice(0, 5)) console.log(`  - ${t.length > 160 ? t.slice(0, 157) + "..." : t}`);
  }
}
