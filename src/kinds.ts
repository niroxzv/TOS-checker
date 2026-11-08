// Rules that make the same point to a reader get one card. Arbitration and the class-action / jury waiver
// usually sit in the same clause and quote the same sentence, so they show as one "disputes" card.
// Scoring still counts each rule; only the report groups them.

const SAME_AS: Record<string, string> = { class_action_waiver: "arbitration" };

/** The card a rule's flags go on. */
export function kindOf(ruleId: string): string {
  return SAME_AS[ruleId] ?? ruleId;
}

/** Every rule shown on the same card as this one (OK / Not OK applies to all of them). */
export function rulesOfKind(ruleId: string): string[] {
  const kind = kindOf(ruleId);
  return [kind, ...Object.keys(SAME_AS).filter((id) => SAME_AS[id] === kind)];
}

/** The summary for a card that holds more than one rule. */
const MERGED_SAY: Record<string, string> = {
  arbitration: "Disputes go to private arbitration, and you give up jury trials and group lawsuits.",
};

/** The card's summary: the merged one when the card holds several rules, else the rule's own. */
export function kindSay(ruleIds: Iterable<string>, fallback: string): string {
  const ids = new Set(ruleIds);
  const kind = kindOf([...ids][0] ?? "");
  return ids.size > 1 && MERGED_SAY[kind] ? MERGED_SAY[kind] : fallback;
}
