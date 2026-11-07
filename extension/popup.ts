import { analyze } from "../src/engine.ts";
import { boundaryScore } from "../src/score.ts";
import { adviceFor } from "../src/advice.ts";
import type { Category, Flag, Severity } from "../src/types.ts";

declare const chrome: any;

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
}

/** A flag plus the document its quote came from. */
interface Hit {
  flag: Flag;
  doc: Doc;
}

/** Shared with the desktop app. */
const PREFS_KEY = "tos-checker.prefs";
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
const QUOTE_MAX = 200;
const SELECTION_MIN = 200;
const DROP = "script, style, noscript, nav, header, footer, template, svg, iframe";
const BLOCKS = "p, div, li, br, h1, h2, h3, h4, h5, h6, section, article, main, aside, ul, ol, dl, dt, dd, table, tr, blockquote, pre, hr";

const main = document.getElementById("main") as HTMLElement;
const pageLine = document.getElementById("page") as HTMLElement;

let prefs: Prefs = {};
let page: PageData | null = null;
let docs: Doc[] = [];
/** Legal links we couldn't read (usually cross-origin). */
let failed: PageLink[] = [];

/**
 * Runs inside the page (chrome.scripting serializes it), so it must not use anything from outside its own body.
 * Returns the visible text, the current selection, and links that look like terms or privacy pages.
 */
function grabPage(): PageData {
  const LOOKS_LEGAL = /terms|conditions|privacy|cookie|eula|legal|\btos\b/i;
  const here = location.href.split("#")[0];
  const seen = new Set<string>();
  const links: PageLink[] = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    if (!(a instanceof HTMLAnchorElement) || !/^https?:$/.test(a.protocol)) continue;
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
 * Also runs inside the page, so it must be self-contained. Fetching from the page works for same-origin
 * links with no extra permissions. Returns the body for text responses, null for anything that failed.
 */
async function fetchInPage(urls: string[]): Promise<(string | null)[]> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.startsWith("text/")) return null;
        return (await res.text()).slice(0, 3000000);
      } catch {
        return null;
      }
    }),
  );
}

async function start(): Promise<void> {
  let tabId: number;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) throw new Error("No active tab.");
    tabId = tab.id;
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: grabPage });
    const result = results && results[0] && results[0].result;
    if (!result) throw new Error("The page returned nothing.");
    page = result as PageData;
  } catch (err) {
    showBlocked(err);
    return;
  }

  prefs = await loadPrefs();
  pageLine.textContent = describePage(page);

  // Selection first, so a clause the user picked out is credited to "Selected text" after dedupe.
  const selection = page.selection.trim();
  if (selection.length > SELECTION_MIN) addDoc("Selected text", page.url, selection);
  addDoc("This page", page.url, page.text);

  if (page.links.length > 0) {
    status(`Reading ${plural(page.links.length, "linked page")}…`);
    let bodies: (string | null)[] = [];
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: fetchInPage, args: [page.links.map((l) => l.href)] });
      bodies = (results && results[0] && results[0].result) || [];
    } catch {
      // Treat every link as failed; the permission button can still fetch them.
    }
    page.links.forEach((link, i) => {
      const html = bodies[i];
      if (typeof html === "string") addDoc(link.text, link.href, htmlToText(html));
      else failed.push(link);
    });
    // Origins the user allowed on an earlier visit can be fetched straight away.
    await readFromPopup(await alreadyAllowed(failed));
  }
  render();
}

function addDoc(name: string, url: string, text: string): void {
  if (text.trim()) docs.push({ name, url, flags: analyze(text) });
}

/** Fetch from the popup itself. This only works cross-origin once the user has granted the host. */
async function readFromPopup(links: PageLink[]): Promise<void> {
  await Promise.all(
    links.map(async (link) => {
      try {
        const res = await fetch(link.href, { signal: AbortSignal.timeout(10000) });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.startsWith("text/")) return;
        addDoc(link.text, link.href, htmlToText(await res.text()));
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
      if (await chrome.permissions.contains({ origins: [originPattern(link.href)] })) allowed.push(link);
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
  return (doc.body.textContent || "")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadPrefs(): Promise<Prefs> {
  try {
    const got = await chrome.storage.local.get(PREFS_KEY);
    const value = got && got[PREFS_KEY];
    return value && typeof value === "object" ? (value as Prefs) : {};
  } catch {
    return {};
  }
}

/** Clicking the pressed button again clears the pref. */
async function setPref(ruleId: string, value: Pref): Promise<void> {
  if (prefs[ruleId] === value) delete prefs[ruleId];
  else prefs[ruleId] = value;
  render();
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  } catch (err) {
    console.warn("Tickwise: could not save prefs", err);
  }
}

/** Every flag from every document, deduped by rule + quote. The first document wins. */
function mergedHits(): Hit[] {
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const doc of docs) {
    for (const flag of doc.flags) {
      const key = `${flag.ruleId}|${normalize(flag.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ flag, doc });
    }
  }
  // Dealbreakers first, then most severe, then document order (sort is stable).
  const isDeal = (h: Hit) => (prefs[h.flag.ruleId] === "notok" ? 0 : 1);
  return hits.sort((a, b) => isDeal(a) - isDeal(b) || SEVERITY_RANK[a.flag.severity] - SEVERITY_RANK[b.flag.severity]);
}

function render(): void {
  if (!page) return;
  main.replaceChildren();

  if (docs.length === 0) {
    main.append(el("p", { className: "muted", text: "No readable text on this page." }));
    if (failed.length > 0) main.append(failedBlock());
    return;
  }

  const hits = mergedHits();
  main.append(scoreBlock(hits), docList());
  // Straight under the document list, not after every card, so the button is seen without scrolling.
  if (failed.length > 0) main.append(failedBlock());
  const flags = el("section", { className: "flags" }, el("h2", { text: plural(hits.length, "flag") }));
  if (hits.length === 0) flags.append(el("p", { className: "muted", text: "Nothing flagged. That doesn't mean it's harmless, so skim it anyway." }));
  for (const hit of hits) flags.append(card(hit));
  main.append(flags);
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
  for (const h of hits) tally[h.flag.severity]++;
  const counts = SEVERITIES.filter((s) => tally[s] > 0).map((s) => `${tally[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(", ");
  const line = el("p", { className: "line", text: hits.length === 0 ? "Nothing flagged." : `${plural(hits.length, "thing")} to know before you tick: ${counts}.` });
  const deals = new Set(hits.filter((h) => prefs[h.flag.ruleId] === "notok").map((h) => h.flag.ruleId)).size;
  if (deals > 0) line.append(` ${deals} of your dealbreaker${deals === 1 ? " is" : "s are"} in here.`);

  const k = el("p", { className: "k", text: "Boundary score" }, el("span", { className: "verdict", text: label }));
  const tallyRow = el("p", { className: "tally" });
  for (const [sev, short] of [["high", "High"], ["medium", "Med"], ["low", "Low"]] as const) {
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
  for (const doc of docs) {
    list.append(
      el(
        "li",
        {},
        el("span", { className: "link-text" }, el("strong", { text: doc.name }), el("small", { text: shortUrl(doc.url) })),
        el("span", { className: "doc-count", text: plural(doc.flags.length, "flag") }),
      ),
    );
  }
  return el("section", {}, el("h2", { text: `Checked ${plural(docs.length, "document")}` }), list);
}

function card({ flag, doc }: Hit): HTMLElement {
  const pref = prefs[flag.ruleId];
  let className = `card sev-${flag.severity}`;
  if (pref === "notok") className += " is-dealbreaker";
  if (pref === "ok") className += " is-ok";

  const meta = el(
    "div",
    { className: "meta" },
    el("span", { className: "pill-sev", text: SEVERITY_LABEL[flag.severity] }),
    el("span", { className: "cat", text: CATEGORY_LABEL[flag.category] ?? flag.category }),
  );
  if (pref === "notok") meta.prepend(el("span", { className: "badge", text: "Dealbreaker" }));

  const quoteText = normalize(flag.quote);
  const quote = el("blockquote", { className: "quote", text: clip(quoteText, QUOTE_MAX) });
  if (quoteText.length > QUOTE_MAX) quote.title = quoteText;

  const advice = adviceFor(flag.ruleId, flag.category);
  const steps = el("dl", { className: "advice" });
  for (const [term, text] of [["Add", advice.add], ["Check", advice.check], ["Tell", advice.tell]]) {
    steps.append(el("dt", { text: term }), el("dd", { text }));
  }

  const actions = el(
    "div",
    { className: "actions" },
    toggle("Approve", "choice-ok", pref === "ok", () => setPref(flag.ruleId, "ok")),
    toggle("Not OK", "choice-notok", pref === "notok", () => setPref(flag.ruleId, "notok")),
  );

  return el(
    "article",
    { className },
    meta,
    el("p", { className: "say", text: flag.say }),
    quote,
    el("p", { className: "source", text: `From: ${doc.name}` }),
    steps,
    actions,
  );
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
          if (/^https?:\/\//i.test(link.href)) chrome.tabs.create({ url: link.href });
        }),
      ),
    );
  }
  const allow = plainButton(`Allow reading ${plural(failed.length, "more page")}`, async () => {
    const origins = [...new Set(failed.map((l) => originPattern(l.href)))];
    let granted = false;
    try {
      // Must be called straight from the click, before any other await.
      granted = await chrome.permissions.request({ origins });
    } catch {
      granted = false;
    }
    if (!granted) return;
    allow.disabled = true;
    allow.textContent = "Reading…";
    await readFromPopup([...failed]);
    render();
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
      text: "Browsers don't let extensions read their own pages (chrome://, edge://, the Chrome Web Store, Edge Add-ons) or some PDF viewers. Open the site's terms page and click Tickwise again.",
    }),
    el("p", { className: "muted", text: "For a local file, turn on \"Allow access to file URLs\" for Tickwise on the extensions page." }),
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

function originPattern(href: string): string {
  return `${new URL(href).origin}/*`;
}

function shortUrl(href: string): string {
  try {
    const u = new URL(href);
    return clip(u.hostname + u.pathname, 60);
  } catch {
    return clip(href, 60);
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function plainButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { text: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function toggle(label: string, className: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const b = plainButton(label, onClick);
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
