import { modelLabels } from "./model.ts";
import { RULES } from "./rules.ts";
import { splitClauses } from "./split.ts";
import type { Flag, Rule, Severity, UnfairTosLabel } from "./types.ts";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

// The rule that speaks for each clause type when the model finds one the rules missed.
const MAIN_RULE = new Map<UnfairTosLabel, Rule>();
for (const r of RULES) if (r.unfairTos && !MAIN_RULE.has(r.unfairTos)) MAIN_RULE.set(r.unfairTos, r);

// Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l", һ: "h", ԛ: "q", ԝ: "w",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S",
  α: "a", ο: "o", ρ: "p", ν: "v", ι: "i", κ: "k", τ: "t", υ: "u",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const LOOKS = Object.keys(LOOKALIKE).join("");
const LOOKALIKE_CHAR = new RegExp(`[${LOOKS}]`, "g");
/** A word spelt only with Latin letters and look-alikes, with at least one look-alike in it. */
const DISGUISED_WORD = new RegExp(String.raw`(?<![\p{L}\p{M}])[a-zA-Z${LOOKS}]*[${LOOKS}][a-zA-Z${LOOKS}]*(?![\p{L}\p{M}])`, "gu");

/**
 * The clause as the rules and the model read it. Hidden characters (soft hyphens, zero-width spaces) are
 * dropped, letter variants such as ligatures and full-width letters are made plain, and words spelt with
 * look-alike Cyrillic or Greek letters are spelt in Latin: "sell" with a soft hyphen inside it, or with a Cyrillic "е", still reads "sell".
 * Flags still quote the original text.
 */
export function readable(text: string): string {
  return text
    .replace(/\p{Cf}/gu, "")
    .normalize("NFKC")
    .replace(DISGUISED_WORD, (word) => word.replace(LOOKALIKE_CHAR, (c) => LOOKALIKE[c]))
    // Web pages write "don’t" with a curly apostrophe; the rules look for "don't".
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

/**
 * A heading such as "GitHub May Terminate", "AI Features, Training, and Your Data" or "BILLING; NO REFUNDS".
 * It says nothing by itself, and the sentences under it get their own flags. Title Case (every word of four
 * letters or more capitalised) or ALL CAPS without a full stop, and at most 12 words.
 */
export function isHeading(text: string): boolean {
  const s = text.trim();
  const words = s.match(/\p{L}[\p{L}\p{M}'-]*/gu) ?? [];
  if (words.length === 0 || words.length > 12) return false;
  if (!/\p{Ll}/u.test(s)) return !/[.!?:]$/.test(s);
  const long = words.filter((w) => w.replace(/['-]/g, "").length >= 4);
  return long.length > 0 && long.every((w) => /^\p{Lu}/u.test(w));
}

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
    const read = readable(clause.text);
    if (isHeading(read)) continue;
    let hits: Rule[] = [];
    const cancelled = new Set<UnfairTosLabel>(); // types a rule's `unless` explicitly ruled out here
    for (const rule of rules) {
      if (!rule.match.some((re) => re.test(read))) continue;
      if (rule.unless?.some((re) => re.test(read))) {
        if (rule.unfairTos) cancelled.add(rule.unfairTos);
      } else hits.push(rule);
    }

    if (useModel) {
      const labels = modelLabels(read, new Set(hits.map((r) => r.id)));
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
