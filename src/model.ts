// A small trained model that double-checks the 8 clause types the UNFAIR-ToS benchmark labels.
// It is logistic regression over word and word-pair TF-IDF features plus which rules fired on the clause.
// It was trained offline by eval/train-model.py on UNFAIR-ToS train + validation (the test split is held out).
// The weights live in model-weights.ts. It runs on the device: no AI, no server, no network.
import { MODEL } from "./model-weights.ts";
import type { UnfairTosLabel } from "./types.ts";

export interface ModelData {
  labels: UnfairTosLabel[];
  /** Rule ids, in the order of each label's ruleWeights. */
  ruleIds: string[];
  /** What a fired rule's feature is worth before its weight. */
  ruleWeight: number;
  vocab: string[];
  idf: number[];
  bias: number[];
  /** weights[label][feature], same order as vocab. */
  weights: number[][];
  ruleWeights: number[][];
  /** A label counts when its probability reaches this. */
  thresholds: number[];
}

const DATA = MODEL as ModelData;
const FEATURE = new Map(DATA.vocab.map((term, i) => [term, i]));

/** Same tokens as scikit-learn's `(?u)\b\w+\b` on lowercased text, as words and word pairs. */
function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Probability of each clause type, given the clause text and the ids of the rules that fired on it. */
export function scoreClause(text: string, firedRules: ReadonlySet<string>): Map<UnfairTosLabel, number> {
  // Sublinear TF-IDF, L2-normalised: what TfidfVectorizer(sublinear_tf=True) does.
  const counts = new Map<number, number>();
  for (const t of terms(text)) {
    const f = FEATURE.get(t);
    if (f !== undefined) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const x = new Map<number, number>();
  let norm = 0;
  for (const [f, n] of counts) {
    const v = (1 + Math.log(n)) * DATA.idf[f];
    x.set(f, v);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;

  const out = new Map<UnfairTosLabel, number>();
  DATA.labels.forEach((label, j) => {
    let z = DATA.bias[j];
    for (const [f, v] of x) z += (v / norm) * DATA.weights[j][f];
    DATA.ruleIds.forEach((id, r) => {
      if (firedRules.has(id)) z += DATA.ruleWeight * DATA.ruleWeights[j][r];
    });
    out.set(label, 1 / (1 + Math.exp(-z)));
  });
  return out;
}

/** The clause types the model is confident about. */
export function modelLabels(text: string, firedRules: ReadonlySet<string>): Set<UnfairTosLabel> {
  const p = scoreClause(text, firedRules);
  return new Set(DATA.labels.filter((label, j) => (p.get(label) ?? 0) >= DATA.thresholds[j]));
}
