import type { Clause } from "./types.ts";

// A period after these doesn't end a sentence.
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|inc|ltd|llc|co|corp|u\.s|u\.k|vs|mr|mrs|ms|dr|st)\.$/i;

// Sentence ends: . ! ? followed by whitespace.
// Line breaks also end a clause, unless the next line starts with a lowercase letter, in any alphabet and
// after any hidden characters (that's a hard-wrapped sentence, e.g. text copied out of a PDF), even with
// one blank line in between.
// The lookahead stops at the next line break but one: looking past every blank line is slow on long runs of them.
const BOUNDARY = /[.!?]+(?=\s|$)|\n(?![^\S\n]*(?:\n[^\S\n]*)?\p{Cf}*\p{Ll})/gu;

/** Split a ToS into sentence-sized clauses, keeping each one's position in the original text. */
export function splitClauses(text: string): Clause[] {
  const clauses: Clause[] = [];

  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    const piece = text.slice(s, e);
    if (/[a-z]/i.test(piece)) clauses.push({ text: piece, start: s, end: e }); // drops "1." and blank pieces
  };

  let start = 0;
  for (const m of text.matchAll(BOUNDARY)) {
    const isNewline = m[0] === "\n";
    const end = isNewline ? m.index : m.index + m[0].length;
    if (!isNewline && ABBREVIATION.test(text.slice(start, end))) continue;
    push(start, end);
    start = m.index + m[0].length;
  }
  push(start, text.length);

  return clauses;
}
