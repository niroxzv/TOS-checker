export type Severity = "high" | "medium" | "low" | "info";

export type Category =
  | "data-collection"
  | "data-sharing"
  | "your-content"
  | "your-rights"
  | "money"
  | "action";

/** The 8 clause types labelled in the UNFAIR-ToS dataset (LexGLUE). Only the eval uses these. */
export type UnfairTosLabel =
  | "Limitation of liability"
  | "Unilateral termination"
  | "Unilateral change"
  | "Content removal"
  | "Contract by using"
  | "Choice of law"
  | "Jurisdiction"
  | "Arbitration";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  /** The plain-English point shown to the user. */
  say: string;
  /** Flag a clause when ANY of these match it. */
  match: RegExp[];
  /** ...unless ANY of these also match it (negations like "we do not sell"). */
  unless?: RegExp[];
  /** The UNFAIR-ToS label this rule covers, if any. */
  unfairTos?: UnfairTosLabel;
}

/** Roughly one sentence of the source text. */
export interface Clause {
  text: string;
  start: number;
  end: number;
}

export interface Flag {
  ruleId: string;
  category: Category;
  severity: Severity;
  say: string;
  /** The clause that triggered the flag. Always equals source.slice(start, end). */
  quote: string;
  start: number;
  end: number;
}
