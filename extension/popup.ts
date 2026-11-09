import { analyze } from "../src/engine.ts";
import { boundaryScore } from "../src/score.ts";
import { adviceFor } from "../src/advice.ts";
import { clipAround } from "../src/clip.ts";
import { kindOf, kindSay, rulesOfKind } from "../src/kinds.ts";
import type { Category, Flag, Severity } from "../src/types.ts";
import { badgeFor, compareSeen, flagKey, normalize, originPatterns, plural, pruneSeen, seenKey, textFragmentUrl, watchLine, type Seen } from "./lib.ts";

/** Firefox has `browser` (promises everywhere); Chrome and Edge have `chrome`. */
const ext: any = (globalThis as any).browser ?? (globalThis as any).chrome;

type Pref = "ok" | "notok";
type Prefs = Record<string, Pref>;

interface PageLink {
  text: string;
  href: string;
}

interface PageData {
  url: string;
  title: string;
  text: string;
  selection: string;
  links: PageLink[];
}

/** One thing we read: the page, the selection, or a linked terms page. */
interface Doc {
  name: string;
  url: string;
  flags: Flag[];
  /** The page or the selection, so its sentences can be shown in the open tab. */
  onPage: boolean;
  /** The last check of the same document, and this one. The selection isn't watched. */
  watch?: { prev?: Seen; now: Seen };
  /** Longer than MAX_TEXT, so only the start was checked. */
  cut?: boolean;
}

/** A flag plus the document its quote came from. */
interface Hit {
  flag: Flag;
  doc: Doc;
}

/** Same key and shape as the web app. */
const PREFS_KEY = "tos-checker.prefs";
/** Flags of each document at its last check, for "changed since you checked". */
const SEEN_KEY = "tickwise.seen";
const SEEN_MAX = 300;
const SEVERITIES: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", info: "Info" };
const CATEGORY_LABEL: Record<Category, string> = {
  "data-collection": "Data collected",
  "data-sharing": "Data shared",
  "your-content": "Your content",
  "your-rights": "Your rights",
  money: "Money",
  action: "You can act",
};
const QUOTE_MAX = 90;
const SELECTION_MIN = 200;
/** Characters checked per document. Long terms run to about 300,000; this keeps a huge page from stalling the popup. */
const MAX_TEXT = 500_000;
/** Bytes of a linked page read before converting it to text. */
const MAX_HTML = 3_000_000;
const DROP = "script, style, noscript, nav, header, footer, template, svg, iframe";
const BLOCKS = "p, div, li, br, h1, h2, h3, h4, h5, h6, section, article, main, aside, ul, ol, dl, dt, dd, table, tr, blockquote, pre, hr";
const HIGHLIGHT_CSS = "::highlight(tickwise) { background-color: #E1EAA4; color: #141413; }";

const main = document.getElementById("main") as HTMLElement;
const pageLine = document.getElementById("page") as HTMLElement;

let tabId: number | null = null;
let prefs: Prefs = {};
let seen: Record<string, Seen> = {};
let page: PageData | null = null;
let docs: Doc[] = [];
/** Legal links we couldn't read (usually cross-origin). */
let failed: PageLink[] = [];
let highlightCss = false;

/**
 * Runs inside the page (chrome.scripting serializes it), so it must not use anything from outside its own body.
 * Returns the visible text, the current selection, and links that look like terms or privacy pages.
 */
function grabPage(): PageData {
  const LOOKS_LEGAL = /terms|conditions|privacy|cookie|eula|legal|\btos\b/i;
  // Your own machine and home network: a website shouldn't get Tickwise to open your router's pages.
  const LOCAL = /^(?:localhost|.+\.localhost|.+\.local|.+\.internal|.+\.home\.arpa|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[.*\])$/i;
  const pageIsLocal = LOCAL.test(location.hostname);
  const here = location.href.split("#")[0];
  const seen = new Set<string>();
  const links: PageLink[] = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    if (!(a instanceof HTMLAnchorElement) || !/^https?:$/.test(a.protocol)) continue;
    if (!pageIsLocal && LOCAL.test(a.hostname)) continue;
    const href = a.href.split("#")[0];
    if (href === here || seen.has(href)) continue;
    const text = (a.textContent || "").replace(/\s+/g, " ").trim();
    // Match the path, not the host, so a site called legal-something.com doesn't match every link.
    if (!LOOKS_LEGAL.test(text) && !LOOKS_LEGAL.test(a.pathname + a.search)) continue;
    seen.add(href);
    links.push({ text: text.slice(0, 80) || href, href });
    if (links.length >= 8) break;
  }
  const selection = window.getSelection();
  return {
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText : "",
    selection: selection ? selection.toString() : "",
    links,
  };
}

/**
 * Also runs inside the page, so it must be self-contained. Fetching from the page works with no extra
 * permissions for same-origin links and for sites that allow any origin (docs.github.com does). Other
 * sites refuse, and the browser logs a CORS error in the page's console; those links go to the "Allow
 * reading" list. Returns the body for text responses, null for anything that failed.
 */
async function fetchInPage(urls: string[]): Promise<(string | null)[]> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        // No cookies, as in readFromPopup.
        const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10000) });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.startsWith("text/")) return null;
        return (await res.text()).slice(0, 3000000); // MAX_HTML: this function can't see constants outside it
      } catch {
        return null;
      }
    }),
  );
}

/**
 * Also runs inside the page, so it must be self-contained. Finds the quote in the page, highlights it and
 * scrolls it into view. Returns false if it isn't on the page.
 */
function findAndShow(quote: string): boolean {
  // innerText (where the quote came from) and the page's text nodes differ in spacing and capitals,
  // so both sides are compared with whitespace removed and in lower case.
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA"]);
  const chars: string[] = [];
  const at: { node: Text; offset: number }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.parentElement && SKIP.has(node.parentElement.tagName)) continue;
    const s = node.data;
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) continue;
      const lower = s[i].toLowerCase();
      for (let k = 0; k < lower.length; k++) {
        chars.push(lower[k]);
        at.push({ node, offset: i });
      }
    }
  }
  const hay = chars.join("");
  let needle = "";
  for (let i = 0; i < quote.length; i++) if (!/\s/.test(quote[i])) needle += quote[i].toLowerCase();
  if (!needle) return false;

  // The first visible match; hidden copies (menus, templates) have no boxes.
  let found: Range | null = null;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const start = at[i];
    const end = at[i + needle.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    found = found || range;
    if (range.getClientRects().length > 0) {
      found = range;
      break;
    }
  }
  if (!found) return false;

  try {
    const w = window as any;
    w.CSS.highlights.set("tickwise", new w.Highlight(found));
  } catch {
    // No CSS Custom Highlight API: select the sentence instead.
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(found);
  }
  // The element first, so scrolling boxes inside the page move too; then centre the sentence itself.
  found.startContainer.parentElement?.scrollIntoView({ block: "center" });
  const box = found.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) window.scrollBy(0, box.top - window.innerHeight / 3);
  return true;
}

async function start(): Promise<void> {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) throw new Error("No active tab.");
    tabId = tab.id as number;
    const results = await ext.scripting.executeScript({ target: { tabId }, func: grabPage });
    const result = results && results[0] && results[0].result;
    if (!result) throw new Error("The page returned nothing.");
    page = result as PageData;
  } catch (err) {
    showBlocked(err);
    return;
  }

  [prefs, seen] = await Promise.all([loadObject<Prefs>(PREFS_KEY), loadObject<Record<string, Seen>>(SEEN_KEY)]);
  // Test builds of 0.4.0 stored the full address as the key. Drop those; a hash never contains ":".
  for (const key of Object.keys(seen)) if (key.includes(":")) delete seen[key];
  pageLine.textContent = describePage(page);

  // Selection first, so a clause the user picked out is credited to "Selected text" after dedupe.
  const selection = page.selection.trim();
  if (selection.length > SELECTION_MIN) addDoc("Selected text", page.url, selection, true, false);
  addDoc("This page", page.url, page.text, true, true);

  if (page.links.length > 0) {
    status(`Reading ${plural(page.links.length, "linked page")}…`);
    let bodies: (string | null)[] = [];
    try {
      const results = await ext.scripting.executeScript({ target: { tabId }, func: fetchInPage, args: [page.links.map((l) => l.href)] });
      bodies = (results && results[0] && results[0].result) || [];
    } catch {
      // Treat every link as failed; the permission button can still fetch them.
    }
    page.links.forEach((link, i) => {
      const html = bodies[i];
      if (typeof html === "string") addDoc(link.text, link.href, htmlToText(html), false, true);
      else failed.push(link);
    });
    // Origins the user allowed on an earlier visit can be fetched straight away.
    await readFromPopup(await alreadyAllowed(failed));
  }
  render();
  await saveSeen();
}

function addDoc(name: string, url: string, text: string, onPage: boolean, watched: boolean): void {
  if (!text.trim()) return;
  const cut = text.length > MAX_TEXT;
  const doc: Doc = { name, url, flags: analyze(cut ? text.slice(0, MAX_TEXT) : text), onPage, cut };
  if (watched) {
    const key = seenKey(url);
    const prev = seen[key];
    const now = compareSeen(prev, doc.flags.map((f) => flagKey(f.ruleId, f.quote)), Date.now());
    seen[key] = now;
    doc.watch = { prev, now };
  }
  docs.push(doc);
}

/** Fetch from the popup itself. This only works cross-origin once the user has granted the host. */
async function readFromPopup(links: PageLink[]): Promise<void> {
  await Promise.all(
    links.map(async (link) => {
      try {
        // No cookies: a terms page doesn't need your login, and a link that does something when visited does nothing logged out.
        const res = await fetch(link.href, { credentials: "omit", signal: AbortSignal.timeout(10000) });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.startsWith("text/")) return;
        addDoc(link.text, link.href, htmlToText((await res.text()).slice(0, MAX_HTML)), false, true);
        failed = failed.filter((l) => l !== link);
      } catch {
        // Still failed; it stays in the list.
      }
    }),
  );
}

async function alreadyAllowed(links: PageLink[]): Promise<PageLink[]> {
  const allowed: PageLink[] = [];
  for (const link of links) {
    try {
      if (await ext.permissions.contains({ origins: originPatterns(link.href) })) allowed.push(link);
    } catch {
      // Ignore; the link stays failed.
    }
  }
  return allowed;
}

/** HTML to plain text: drop page chrome, keep each block on its own line. */
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of Array.from(doc.querySelectorAll(DROP))) node.remove();
  // Source formatting puts newlines mid-sentence, so flatten text first, then add our own line breaks.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    node.nodeValue = (node.nodeValue || "").replace(/\s+/g, " ");
  }
  for (const node of Array.from(doc.body.querySelectorAll(BLOCKS))) node.after("\n");
  // Trim line by line: a regex like / *\n */ is slow on a long run of spaces.
  return (doc.body.textContent || "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadObject<T extends object>(key: string): Promise<T> {
  try {
    const got = await ext.storage.local.get(key);
    const value = got && got[key];
    return value && typeof value === "object" ? (value as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

async function saveSeen(): Promise<void> {
  try {
    seen = pruneSeen(seen, SEEN_MAX);
    await ext.storage.local.set({ [SEEN_KEY]: seen });
  } catch (err) {
    console.warn("Tickwise: could not save what was checked", err);
  }
}

/** Clicking the pressed button again clears the pref. */
async function setPref(ruleId: string, value: Pref): Promise<void> {
  const clear = prefs[ruleId] === value;
  for (const id of rulesOfKind(ruleId)) {
    if (clear) delete prefs[id];
    else prefs[id] = value;
  }
  render();
  try {
    await ext.storage.local.set({ [PREFS_KEY]: prefs });
  } catch (err) {
    console.warn("Tickwise: could not save prefs", err);
  }
}

/** Every flag from every document, deduped by rule + quote. The first document wins. */
function mergedHits(): Hit[] {
  const seenKeys = new Set<string>();
  const hits: Hit[] = [];
  for (const doc of docs) {
    for (const flag of doc.flags) {
      const key = `${flag.ruleId}|${normalize(flag.quote)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      hits.push({ flag, doc });
    }
  }
  // Dealbreakers first, then most severe, then document order (sort is stable).
  const isDeal = (h: Hit) => (prefs[h.flag.ruleId] === "notok" ? 0 : 1);
  return hits.sort((a, b) => isDeal(a) - isDeal(b) || SEVERITY_RANK[a.flag.severity] - SEVERITY_RANK[b.flag.severity]);
}

/** Flags grouped by rule, in report order: one group per kind of point. */
function kindsOf(hits: Hit[]): Hit[][] {
  const kinds = new Map<string, Hit[]>();
  for (const hit of hits) {
    const kind = kindOf(hit.flag.ruleId);
    const group = kinds.get(kind) ?? [];
    // Two rules on one card often quote the same sentence: show it once.
    if (!group.some((h) => normalize(h.flag.quote) === normalize(hit.flag.quote))) group.push(hit);
    kinds.set(kind, group);
  }
  return [...kinds.values()];
}

/** The rules that fired for this card's kind, on any document. */
function ruleIdsOf(ruleId: string): string[] {
  const kind = kindOf(ruleId);
  return [...new Set(docs.flatMap((d) => d.flags.map((f) => f.ruleId)).filter((id) => kindOf(id) === kind))];
}

/** Shown straight away: high risks and your dealbreakers. */
function isBig(kind: Hit[]): boolean {
  return kind[0].flag.severity === "high" || prefs[kind[0].flag.ruleId] === "notok";
}

/** New since the document was last checked. */
function isNew({ flag, doc }: Hit): boolean {
  const change = doc.watch?.now.change;
  return !!change && change.added.includes(flagKey(flag.ruleId, flag.quote));
}

function render(): void {
  if (!page) return;
  main.replaceChildren();

  if (docs.length === 0) {
    main.append(el("p", { className: "muted", text: "No readable text on this page." }));
    if (failed.length > 0) main.append(failedBlock());
    setBadge(0);
    return;
  }

  const hits = mergedHits();
  setBadge(kindsOf(hits).flat().filter((h) => h.flag.severity === "high").length);
  main.append(scoreBlock(hits));
  // Straight under the score, not after every card, so the button is seen without scrolling.
  if (failed.length > 0) main.append(failedBlock());
  const flags = el("section", { className: "flags" }, el("h2", { text: "What to look at" }));
  if (hits.length === 0) flags.append(el("p", { className: "muted", text: "Nothing flagged. That doesn't mean it's harmless, so skim it anyway." }));
  // One card per kind, with its Add, and the repeats folded under it. High risks and your dealbreakers show
  // first; everything else waits behind one "smaller points" fold, so a long policy isn't a wall of cards.
  const kinds = kindsOf(hits);
  const big = kinds.filter(isBig);
  const small = kinds.filter((k) => !isBig(k));
  const kindBlock = ([first, ...rest]: Hit[]): HTMLElement[] => {
    const say = kindSay(ruleIdsOf(first.flag.ruleId), first.flag.say);
    const out: HTMLElement[] = [card(first, adviceFor(kindOf(first.flag.ruleId), first.flag.category), say)];
    if (rest.length === 0) return out;
    const more = el("details", { className: "more" }, el("summary", { text: `${rest.length} more ${rest.length === 1 ? "place" : "places"} it says this` }), ...rest.map((h) => card(h, null)));
    if (rest.some(isNew)) more.open = true;
    return [...out, more];
  };
  for (const kind of big.length ? big : kinds) flags.append(...kindBlock(kind));
  if (big.length && small.length) {
    const rest = el("details", { className: "smaller" }, el("summary", { text: `Show ${small.length} smaller ${small.length === 1 ? "point" : "points"}` }), ...small.flatMap(kindBlock));
    if (small.some((k) => k.some(isNew))) rest.open = true;
    flags.append(rest);
  }
  // What was read comes last and folded: the cards are what you came for.
  main.append(flags, docList());
}

/** The toolbar badge for this tab. The browser clears it when the tab goes to another page. */
function setBadge(high: number): void {
  if (tabId === null) return;
  const { text, title } = badgeFor(high);
  const calls = [
    ext.action.setBadgeText({ tabId, text }),
    ext.action.setBadgeBackgroundColor({ tabId, color: "#FF5A36" }),
    ext.action.setTitle({ tabId, title }),
  ];
  if (ext.action.setBadgeTextColor) calls.push(ext.action.setBadgeTextColor({ tabId, color: "#141413" }));
  Promise.all(calls).catch(() => {
    // The tab may be gone; the badge doesn't matter then.
  });
}

/** The score band: its colour is the verdict, and its line says what's behind it. */
function scoreBlock(hits: Hit[]): HTMLElement {
  const notOk = new Set(Object.keys(prefs).filter((id) => prefs[id] === "notok"));
  const { score, label } = boundaryScore(
    hits.map((h) => ({ ruleId: h.flag.ruleId, severity: h.flag.severity })),
    notOk,
  );
  const tone = score >= 80 ? "ok" : score >= 50 ? "warn" : "bad";

  const tally: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const [first] of kindsOf(hits)) tally[first.flag.severity]++; // kinds of point, not repeats
  const kinds = kindsOf(hits);
  const big = kinds.filter(isBig).length;
  const line = el("p", { className: "line", text: hits.length === 0 ? "Nothing flagged." : big ? `${big} big ${big === 1 ? "thing" : "things"} to know before you tick, and ${kinds.length - big} smaller.` : `${plural(kinds.length, "thing")} to know before you tick, none of them high risk.` });
  const deals = new Set(hits.filter((h) => prefs[h.flag.ruleId] === "notok").map((h) => kindOf(h.flag.ruleId))).size;
  if (deals > 0) line.append(` ${deals} of your dealbreaker${deals === 1 ? " is" : "s are"} in here.`);
  const fresh = hits.filter(isNew).length;
  if (fresh > 0) line.append(` ${fresh} ${fresh === 1 ? "is" : "are"} new since you last checked.`);

  const k = el("p", { className: "k", text: "Boundary score" }, el("span", { className: "verdict", text: label }));
  const tallyRow = el("p", { className: "tally" });
  for (const [sev, short] of [["high", "High"], ["medium", "Med"], ["low", "Low"], ["info", "Info"]] as const) {
    if (sev === "info" && tally.info === 0) continue;
    tallyRow.append(el("span", {}, el("b", { text: String(tally[sev]) }), short));
  }

  return el(
    "section",
    { className: `band band-${tone}` },
    k,
    el("p", { className: "num", text: String(score) }, el("small", { text: "/ 100" })),
    line,
    tallyRow,
  );
}

function docList(): HTMLElement {
  const list = el("ul", { className: "docs" });
  let open = false;
  for (const doc of docs) {
    const text = el("span", { className: "link-text" }, el("strong", { text: doc.name }), el("small", { text: shortUrl(doc.url) }));
    if (doc.watch) {
      const { text: line, changed } = watchLine(doc.watch.prev, doc.watch.now, Date.now());
      text.append(el("small", { className: changed ? "watch changed" : "watch", text: line }));
      open ||= changed;
    }
    if (doc.cut) text.append(el("small", { className: "watch", text: `Very long: only the first ${MAX_TEXT.toLocaleString("en")} characters were checked` }));
    list.append(el("li", {}, text, el("span", { className: "doc-count", text: plural(doc.flags.length, "flag") })));
  }
  const box = el("details", { className: "read" }, el("summary", {}, el("h2", { text: `Checked ${plural(docs.length, "document")}` })), list);
  box.open = open; // a document that changed since last time is worth seeing
  return box;
}

function card(hit: Hit, advice: string | null, say = hit.flag.say): HTMLElement {
  const { flag, doc } = hit;
  const pref = prefs[flag.ruleId];
  let className = `card sev-${flag.severity}`;
  if (pref === "notok") className += " is-dealbreaker";

  const meta = el(
    "div",
    { className: "meta" },
    el("span", { className: "pill-sev", text: SEVERITY_LABEL[flag.severity] }),
    el("span", { className: "cat", text: CATEGORY_LABEL[flag.category] ?? flag.category }),
  );
  if (isNew(hit)) meta.prepend(el("span", { className: "badge badge-new", text: "New" }));
  if (pref === "notok") meta.prepend(el("span", { className: "badge", text: "Dealbreaker" }));

  const quoteText = normalize(flag.quote);
  const quote = el("blockquote", { className: "quote", text: clipAround(quoteText, QUOTE_MAX, flag.at) });
  if (quoteText.length > QUOTE_MAX) quote.title = quoteText;


  const actions = el(
    "div",
    { className: "actions" },
    toggle("Not OK", "choice-notok", pref === "notok", () => setPref(flag.ruleId, "notok"), "A dealbreaker: lowers the score, and stays marked on every site you check"),
  );
  const show = showButton(flag, doc);
  if (show) actions.append(show);

  return el(
    "article",
    { className },
    meta,
    el("p", { className: "say", text: say }),
    quote,
    el("p", { className: "source", text: `From: ${doc.name}` }),
    ...(advice ? [el("dl", { className: "advice" }, el("dt", { text: "Add" }), el("dd", { text: advice }))] : []),
    actions,
  );
}

/** "Show on page" for the open tab; "Open and show" for a linked page, which opens it at the sentence. */
function showButton(flag: Flag, doc: Doc): HTMLButtonElement | null {
  if (doc.onPage) {
    const b = plainButton("Show on page", async () => {
      if (tabId === null) return;
      let found = false;
      try {
        if (!highlightCss) {
          await ext.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS });
          highlightCss = true;
        }
        const results = await ext.scripting.executeScript({ target: { tabId }, func: findAndShow, args: [flag.quote] });
        found = !!(results && results[0] && results[0].result);
      } catch {
        found = false;
      }
      if (!found) {
        b.textContent = "Not found on page";
        b.disabled = true;
      }
    });
    b.className = "show";
    return b;
  }
  if (!/^https?:\/\//i.test(doc.url)) return null;
  const b = plainButton("Open and show", () => ext.tabs.create({ url: textFragmentUrl(doc.url, flag.quote) }));
  b.className = "show";
  return b;
}

function failedBlock(): HTMLElement {
  const list = el("ul", { className: "links" });
  for (const link of failed) {
    list.append(
      el(
        "li",
        {},
        el("span", { className: "link-text" }, el("strong", { text: link.text }), el("small", { text: shortUrl(link.href) })),
        plainButton("Open", () => {
          if (/^https?:\/\//i.test(link.href)) ext.tabs.create({ url: link.href });
        }),
      ),
    );
  }
  const allow = plainButton(`Allow reading ${plural(failed.length, "more page")}`, async () => {
    const origins = [...new Set(failed.flatMap((l) => originPatterns(l.href)))];
    let granted = false;
    try {
      // Must be called straight from the click, before any other await.
      granted = await ext.permissions.request({ origins });
    } catch {
      granted = false;
    }
    if (!granted) return;
    allow.disabled = true;
    allow.textContent = "Reading…";
    await readFromPopup([...failed]);
    render();
    await saveSeen();
  });
  allow.className = "primary";
  return el(
    "section",
    { className: "more" },
    el("h2", { text: "Linked pages we couldn't read" }),
    el("p", { className: "muted", text: "These look like terms or privacy pages on another site. Reading them needs your permission." }),
    allow,
    list,
  );
}

function status(text: string): void {
  main.replaceChildren(el("p", { className: "muted", text }));
}

function showBlocked(err: unknown): void {
  main.replaceChildren(
    el("p", { className: "error", text: "Can't read this page." }),
    el("p", {
      text: "Browsers don't let extensions read their own pages (chrome://, edge://, about:, the add-on stores) or some PDF viewers. Open the site's terms page and click Tickwise again.",
    }),
    el("p", { className: "muted", text: "For a local file in Chrome or Edge, turn on \"Allow access to file URLs\" for Tickwise on the extensions page." }),
    el("p", { className: "muted detail", text: err instanceof Error ? err.message : String(err) }),
  );
}

function describePage(p: PageData): string {
  try {
    const host = new URL(p.url).hostname;
    return p.title ? `${host} · ${p.title}` : host;
  } catch {
    return p.title;
  }
}

/** Host and path, shortened. A long host loses its start, not its end: the end names the real site. */
function shortUrl(href: string): string {
  try {
    const u = new URL(href);
    const host = u.hostname.length > 40 ? `…${u.hostname.slice(-39)}` : u.hostname;
    return host + clip(u.pathname, 60 - host.length);
  } catch {
    return clip(href, 60);
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function plainButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { text: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function toggle(label: string, className: string, pressed: boolean, onClick: () => void, hint: string): HTMLButtonElement {
  const b = plainButton(label, onClick);
  b.title = hint;
  b.className = `choice ${className}`;
  b.setAttribute("aria-pressed", String(pressed));
  return b;
}

/** Tiny DOM helper. Text always goes in as textContent, never HTML, since it comes from the page. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

start();
