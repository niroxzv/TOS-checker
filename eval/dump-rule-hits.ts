// Writes eval/data/hits-<split>.json: each UNFAIR-ToS sentence (detokenized), its gold labels and the
// rules that fire on it with the model off. eval/train-model.py trains the model from these files.
import { readFileSync, writeFileSync } from "node:fs";
import { analyze } from "../src/engine.ts";
import { RULES } from "../src/rules.ts";
import { detokenize } from "./detokenize.ts";

for (const split of ["train", "validation", "test"]) {
  const lines = readFileSync(new URL(`./data/unfair-tos-${split}.jsonl`, import.meta.url), "utf8").trim().split("\n");
  const rows = lines.map((line) => {
    const { text: raw, labels } = JSON.parse(line) as { text: string; labels: string[] };
    const text = detokenize(raw);
    return { text, labels, rules: [...new Set(analyze(text, RULES, { model: false }).map((f) => f.ruleId))] };
  });
  writeFileSync(new URL(`./data/hits-${split}.json`, import.meta.url), JSON.stringify(rows));
  console.log(`eval/data/hits-${split}.json: ${rows.length} sentences`);
}
