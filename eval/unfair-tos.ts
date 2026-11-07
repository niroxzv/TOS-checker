// Shared by the AI evals: read a UNFAIR-ToS split and undo its tokenization.
import { readFileSync } from "node:fs";

export interface Row {
  text: string;
  labels: string[];
}

export function readSplit(split: string): Row[] {
  let raw: string;
  try {
    raw = readFileSync(new URL(`./data/unfair-tos-${split}.jsonl`, import.meta.url), "utf8");
  } catch {
    console.error(`No data for "${split}". Run first: npm run eval:fetch -- ${split}`);
    process.exit(1);
  }
  return raw.trim().split("\n").map((line) => JSON.parse(line) as Row);
}

/** The dataset is tokenized ("may , from time to time ."). Same clean-up as eval-unfair-tos.ts. */
export function detokenize(raw: string): string {
  return raw
    .replace(/\s+([,.;:!?)\]'])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/``\s*|\s*''/g, '"')
    .replace(/\s+n't\b/g, "n't")
    .trim();
}
