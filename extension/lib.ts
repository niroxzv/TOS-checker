// Helpers for the popup that don't touch any browser API, so `npm test` can check them in Node.

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** cyrb53, a fast 53-bit string hash. Only used to tell flags apart between visits; not for security. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A flag's identity across visits: the same rule on the same sentence. */
export function flagKey(ruleId: string, quote: string): string {
  return hash(`${ruleId}|${normalize(quote)}`);
}

/** The address a document is matched by: no #fragment and no tracking parameters. */
export function watchKey(href: string): string {
  try {
    const u = new URL(href);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|mc_)|^(fbclid|gclid|msclkid)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.href;
  } catch {
    return href;
  }
}

/** The key a document is stored under: a hash of its address, so storage never holds the address itself. */
export function seenKey(href: string): string {
  return hash(watchKey(href));
}

// ── Watching documents for changes ──────────────────────────────────

/** What changed in a document's flags, found when it was checked at `on`. */
export interface Change {
  /** When it was checked before the change. */
  since: number;
  on: number;
  /** Keys (flagKey) of the flags that are new. */
  added: string[];
  removed: number;
}

/** What Tickwise remembers about one document. */
export interface Seen {
  checked: number;
  flags: string[];
  /** The latest change, kept until the next one. */
  change?: Change;
}

/** Compares this check's flags with the last check of the same document. */
export function compareSeen(prev: Seen | undefined, flags: string[], now: number): Seen {
  const unique = [...new Set(flags)];
  if (!prev) return { checked: now, flags: unique };
  const before = new Set(prev.flags);
  const after = new Set(unique);
  const added = unique.filter((f) => !before.has(f));
  const removed = prev.flags.filter((f) => !after.has(f)).length;
  if (added.length === 0 && removed === 0) {
    return prev.change ? { checked: now, flags: unique, change: prev.change } : { checked: now, flags: unique };
  }
  return { checked: now, flags: unique, change: { since: prev.checked, on: now, added, removed } };
}

/** Keeps the documents checked most recently, so storage doesn't grow forever. */
export function pruneSeen(seen: Record<string, Seen>, max: number): Record<string, Seen> {
  const keys = Object.keys(seen);
  if (keys.length <= max) return seen;
  keys.sort((a, b) => seen[b].checked - seen[a].checked);
  return Object.fromEntries(keys.slice(0, max).map((k) => [k, seen[k]]));
}

/** "today", "yesterday" or "on 3 Nov". */
export function dayLabel(ms: number, now: number, locale?: string): string {
  const day = new Date(ms).toDateString();
  if (day === new Date(now).toDateString()) return "today";
  if (day === new Date(now - 86_400_000).toDateString()) return "yesterday";
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return `on ${new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

/** The line under a document in the popup: first check, no change, or what changed. */
export function watchLine(prev: Seen | undefined, current: Seen, now: number, locale?: string): { text: string; changed: boolean } {
  if (!prev) return { text: "First check", changed: false };
  const c = current.change;
  if (!c) return { text: `No change since you checked ${dayLabel(prev.checked, now, locale)}`, changed: false };
  const parts: string[] = [];
  if (c.added.length > 0) parts.push(plural(c.added.length, "new flag"));
  if (c.removed > 0) parts.push(`${c.removed} gone`);
  const what = parts.join(", ");
  // Found on this check, or an older change that's still the latest one.
  if (c.on === current.checked) return { text: `Changed since you checked ${dayLabel(c.since, now, locale)}: ${what}`, changed: true };
  return { text: `Last change, seen ${dayLabel(c.on, now, locale)}: ${what}`, changed: true };
}

// ── The page itself ─────────────────────────────────────────────────

/**
 * A link that opens the page and asks the browser to scroll to the sentence and highlight it (a text fragment,
 * `#:~:text=start,end`). If the browser can't find the text, the page just opens at the top.
 */
export function textFragmentUrl(href: string, quote: string): string {
  const words = normalize(quote).split(" ");
  // In a text fragment, "-" and "," have meanings of their own, so they're escaped too.
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  const text = words.length <= 8 ? enc(words.join(" ")) : `${enc(words.slice(0, 4).join(" "))},${enc(words.slice(-4).join(" "))}`;
  return `${href.split("#")[0]}#:~:text=${text}`;
}

/**
 * The site permissions to ask for before reading a link from the popup. A plain-http link asks for http and
 * https: Firefox sends an extension page's http requests as https (its default extension CSP has
 * upgrade-insecure-requests), and a grant for http alone doesn't cover that request. Two patterns rather than
 * one `*://` pattern, because Site access on chrome://extensions (which the browser tests use) refuses `*://`.
 */
export function originPatterns(href: string): string[] {
  const url = new URL(href);
  return url.protocol === "http:" ? [`http://${url.host}/*`, `https://${url.host}/*`] : [`${url.origin}/*`];
}

/** Same scheme, host and port, so the page can read it without asking. False for anything that isn't a URL. */
export function sameOrigin(href: string, pageUrl: string): boolean {
  try {
    const a = new URL(href);
    return a.origin !== "null" && a.origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

/**
 * A response's text, read up to about `max` bytes and then cut off, so a huge or endless answer can't fill the
 * popup's memory. (`res.text()` would read all of it first.)
 */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= max) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return text + decoder.decode();
}

/** The toolbar badge after a check: the number of high-risk flags, in coral. */
export function badgeFor(high: number): { text: string; title: string } {
  if (high === 0) return { text: "", title: "Tickwise: no high-risk flags here. Click to see the rest." };
  return { text: high > 99 ? "99+" : String(high), title: `Tickwise: ${plural(high, "high-risk flag")} here. Click to see them.` };
}
