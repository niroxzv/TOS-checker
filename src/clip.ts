/**
 * Shortens a quote to about `max` characters around `at` (where the rule matched), cutting at whole words,
 * so the cut quote still shows the words the flag is about. "…" marks each cut end.
 */
export function clipAround(text: string, max: number, at = 0): string {
  if (text.length <= max) return text;
  let start = Math.max(0, Math.min(at - 20, text.length - max));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space === -1 || space > at ? start : space + 1;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start + max * 0.6) end = space;
  }
  const body = text.slice(start, end).replace(/^[\s,;:.-]+/, "").replace(/[\s,;:.-]+$/, "");
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
