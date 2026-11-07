// Builds the document view: the full text, HTML-escaped, with each flagged passage wrapped in <mark>.
// Pure string code (no DOM), so it can be checked in Node.
import type { Severity } from "../src/types.ts";

export interface Span {
  key: string;
  start: number;
  end: number;
  severity: Severity;
}

/** One <mark>: every flag whose range overlaps it shares it. */
export interface MarkGroup {
  id: string;
  start: number;
  end: number;
  severity: Severity;
  keys: string[];
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Merge identical or overlapping ranges, so several flags on one clause share one mark. */
export function groupRanges(spans: Span[], textLength: number): MarkGroup[] {
  const valid = spans
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end <= textLength && s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const groups: MarkGroup[] = [];
  for (const s of valid) {
    const last = groups[groups.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.keys.push(s.key);
      if (RANK[s.severity] < RANK[last.severity]) last.severity = s.severity;
    } else {
      groups.push({ id: `mark-${groups.length}`, start: s.start, end: s.end, severity: s.severity, keys: [s.key] });
    }
  }
  return groups;
}

/** The text as HTML, with a <mark> per group. Groups must come from groupRanges (sorted, no overlaps). */
export function markedHtml(text: string, groups: MarkGroup[]): string {
  let html = "";
  let pos = 0;
  for (const g of groups) {
    html += escapeHtml(text.slice(pos, g.start));
    html += `<mark id="${g.id}" class="sev-${g.severity}" data-keys="${escapeHtml(g.keys.join(" "))}">`;
    html += `${escapeHtml(text.slice(g.start, g.end))}</mark>`;
    pos = g.end;
  }
  return html + escapeHtml(text.slice(pos));
}
