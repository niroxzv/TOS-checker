import { modelLabels } from "./model.ts";
import { RULES } from "./rules.ts";
import { splitClauses } from "./split.ts";
import type { Flag, Rule, Severity, UnfairTosLabel } from "./types.ts";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

// The rule that speaks for each clause type when the model finds one the rules missed.
const MAIN_RULE = new Map<UnfairTosLabel, Rule>();
for (const r of RULES) if (r.unfairTos && !MAIN_RULE.has(r.unfairTos)) MAIN_RULE.set(r.unfairTos, r);

export interface AnalyzeOptions {
  /** Let the trained model confirm or add the 8 benchmark clause types. On by default with the built-in rules. */
  model?: boolean;
}

/** Run every rule over every clause, then let the model check them. Returns flags, most severe first, then in document order. */
export function analyze(text: string, rules: Rule[] = RULES, opts: AnalyzeOptions = {}): Flag[] {
  // The model was trained on what the built-in rules fire, so it only makes sense with them.
  const useModel = (opts.model ?? true) && rules === RULES;
  const flags: Flag[] = [];

  for (const clause of splitClauses(text)) {
    let hits: Rule[] = [];
    const cancelled = new Set<UnfairTosLabel>(); // types a rule's `unless` explicitly ruled out here
    for (const rule of rules) {
      if (!rule.match.some((re) => re.test(clause.text))) continue;
      if (rule.unless?.some((re) => re.test(clause.text))) {
        if (rule.unfairTos) cancelled.add(rule.unfairTos);
      } else hits.push(rule);
    }

    if (useModel) {
      const labels = modelLabels(clause.text, new Set(hits.map((r) => r.id)));
      // Drop rule hits the model doesn't back up, and add the clause types it found that no rule caught
      // (unless a rule saw that type here and ruled it out, e.g. "you may terminate your account").
      hits = hits.filter((r) => !r.unfairTos || labels.has(r.unfairTos));
      for (const label of labels) {
        const main = MAIN_RULE.get(label);
        if (main && !cancelled.has(label) && !hits.some((r) => r.unfairTos === label)) hits.push(main);
      }
    }

    for (const rule of hits) {
      flags.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        say: rule.say,
        quote: clause.text,
        start: clause.start,
        end: clause.end,
      });
    }
  }

  return flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.start - b.start);
}
