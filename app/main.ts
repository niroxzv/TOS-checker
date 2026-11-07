import { adviceFor } from "../src/advice.ts";
import { analyze } from "../src/engine.ts";
import { boundaryScore } from "../src/score.ts";
import type { Category, Flag, Severity } from "../src/types.ts";
import { groupRanges, markedHtml } from "./highlight.ts";
import { SAMPLE_TOS } from "./sample.ts";

type Choice = "ok" | "notok";
type Prefs = Record<string, Choice>;

interface Settings {
  /** Where the AI server is, e.g. Ollama's "http://127.0.0.1:11434". Blank: llama-server on `port`. */
  aiUrl: string;
  /** Model name to ask for, e.g. "qwen3.5:9b". Blank: the AI module picks one. */
  aiModel: string;
  /** Desktop only: how to start llama-server. */
  serverPath: string;
  modelPath: string;
  port: number;
  aiMode: boolean;
}

/** One card: a rule flag (ruleId set) or an AI point (ruleId null). */
interface Item {
  key: string;
  ruleId: string | null;
  category: Category;
  severity: Severity;
  say: string;
  quote: string;
  start: number;
  end: number;
  ai: boolean;
}

// Mirrors src/ai/index.ts. Declared here so the app still runs when that module is missing.
interface AiOptions { baseUrl?: string; model?: string; fetch?: typeof fetch; signal?: AbortSignal }
interface AiPoint { category: Category; severity: Severity; say: string; quote: string; start: number; end: number }
interface AiResult { summary: string; points: AiPoint[]; dropped: number; model?: string }
interface AiModule {
  OLLAMA_BASE_URL: string;
  isAiAvailable(opts?: AiOptions): Promise<boolean>;
  findAiServer(opts?: AiOptions): Promise<string | null>;
  analyzeWithAi(text: string, ruleFlags: Flag[], opts?: AiOptions): Promise<AiResult>;
}
interface TauriGlobal { core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> } }

const PREFS_KEY = "tos-checker.prefs";
const SETTINGS_KEY = "tos-checker.settings";
const DEFAULT_SETTINGS: Settings = { aiUrl: "", aiModel: "", serverPath: "", modelPath: "", port: 8080, aiMode: false };
const SEVERITIES: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", info: "Info" };
const CATEGORY_LABEL: Record<Category, string> = {
  "data-collection": "Data collected",
  "data-sharing": "Data shared",
  "your-content": "Your content",
  "your-rights": "Your rights",
  money: "Money",
  action: "Action you can take",
};

// ---------- storage (localStorage can throw or be missing; the app keeps working in memory) ----------
function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: keep the value in memory only
  }
}

// ---------- DOM helpers ----------
function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", className, label);
  btn.type = "button";
  btn.addEventListener("click", onClick);
  return btn;
}

function scrollBehavior(): ScrollBehavior {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getTauri(): TauriGlobal | undefined {
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

const input = byId<HTMLTextAreaElement>("tos-input");
const fileInput = byId<HTMLInputElement>("file-input");
const statusEl = byId("status");
const output = byId("output");
const aiBox = byId("ai-box");
const summaryEl = byId("summary");
const cardsEl = byId("cards");
const docEl = byId("doc");
const docCountEl = byId("doc-count");
const aiToggle = byId<HTMLInputElement>("ai-mode");
const settingsEl = byId<HTMLDetailsElement>("settings");
const setServer = byId<HTMLInputElement>("set-server");
const setModel = byId<HTMLInputElement>("set-model");
const setPort = byId<HTMLInputElement>("set-port");
const setAiUrl = byId<HTMLInputElement>("set-ai-url");
const setAiModel = byId<HTMLInputElement>("set-ai-model");
const aiUrlEl = byId("ai-url");

// ---------- state ----------
const prefs: Prefs = load<Prefs>(PREFS_KEY, {});
const settings: Settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
let checkedText = "";
let ruleFlags: Flag[] = [];
let items: Item[] = [];
let markIdByKey = new Map<string, string>();
let aiRun: AbortController | null = null;
let aiModule: AiModule | null = null;

function port(): number {
  const p = Math.trunc(Number(settings.port));
  return p > 0 && p < 65536 ? p : 8080;
}

/** Where a llama-server started by the desktop app listens. */
function localUrl(): string {
  return `http://127.0.0.1:${port()}`;
}

function baseUrl(): string {
  return String(settings.aiUrl || "").trim().replace(/\/+$/, "") || localUrl();
}

function status(text: string): void {
  statusEl.textContent = text;
}

function isDealbreaker(item: Item): boolean {
  return item.ruleId !== null && prefs[item.ruleId] === "notok";
}

// ---------- check ----------
function check(): void {
  const text = input.value;
  if (!text.trim()) {
    status("Paste a terms of service, open a file, or try the sample first.");
    input.focus();
    return;
  }
  status("");
  checkedText = text;
  ruleFlags = analyze(text);
  items = ruleFlags.map((f, n) => ({
    key: `r${n}`, ruleId: f.ruleId, category: f.category, severity: f.severity,
    say: f.say, quote: f.quote, start: f.start, end: f.end, ai: false,
  }));
  output.hidden = false;
  render();
  // Jump straight to the verdict so the score is the first thing you see.
  summaryEl.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  if (settings.aiMode) {
    void runAi();
  } else {
    aiRun?.abort();
    aiBox.hidden = true;
  }
}

function render(): void {
  renderSummary();
  renderCards();
  renderDoc();
}

function renderSummary(): void {
  summaryEl.replaceChildren();
  if (!items.length) {
    summaryEl.className = "hero is-empty";
    summaryEl.append(h("p", "line", "Nothing flagged. That doesn't mean it's harmless, so skim the document anyway."));
    return;
  }
  const deal = new Set(Object.keys(prefs).filter((id) => prefs[id] === "notok"));
  const { score, label } = boundaryScore(items, deal);
  summaryEl.className = `hero band-${label === "Low risk" ? "ok" : label === "Think twice" ? "warn" : "bad"}`;
  const num = h("p", "num", String(score));
  num.append(h("small", "", "/ 100"));
  const counts = SEVERITIES.map((sev) => [sev, items.filter((i) => i.severity === sev).length] as const)
    .filter(([, n]) => n)
    .map(([sev, n]) => `${n} ${SEVERITY_LABEL[sev].toLowerCase()}`)
    .join(", ");
  const deals = new Set(items.filter(isDealbreaker).map((i) => i.ruleId)).size;
  const line = h("p", "line");
  line.append(`${items.length} ${items.length === 1 ? "thing" : "things"} to know before you tick: ${counts}.`);
  if (deals) line.append(` ${deals} of your dealbreaker${deals === 1 ? " is" : "s are"} in here.`);
  const k = h("p", "k", "Boundary score");
  k.append(h("span", "verdict", label));
  const tally = h("div", "tally");
  for (const [sev, name] of [["high", "High"], ["medium", "Med"], ["low", "Low"]] as const) {
    const cell = h("div");
    cell.append(h("b", "", String(items.filter((i) => i.severity === sev).length)), h("span", "", name));
    tally.append(cell);
  }
  summaryEl.append(k, num, line, tally);
}

function renderCards(): void {
  cardsEl.replaceChildren();
  for (const sev of SEVERITIES) {
    // Dealbreakers first, then document order.
    const group = items
      .filter((i) => i.severity === sev)
      .sort((a, b) => Number(isDealbreaker(b)) - Number(isDealbreaker(a)) || a.start - b.start || Number(a.ai) - Number(b.ai));
    if (!group.length) continue;
    const section = h("section", `group sev-${sev}`);
    section.append(h("h3", "group-title", `${SEVERITY_LABEL[sev]} (${group.length})`), ...group.map(renderCard));
    cardsEl.append(section);
  }
}

function renderCard(item: Item): HTMLElement {
  const choice = item.ruleId ? prefs[item.ruleId] : undefined;
  let cls = `card sev-${item.severity}`;
  if (choice === "notok") cls += " is-dealbreaker";
  if (item.ai) cls += " is-ai";
  const card = h("article", cls);
  card.id = `card-${item.key}`;
  card.tabIndex = 0;
  card.title = "Show in document";

  const tags = h("div", "tags");
  tags.append(h("span", "pill-sev", SEVERITY_LABEL[item.severity]), h("span", "chip", CATEGORY_LABEL[item.category] ?? item.category));
  if (choice === "notok") tags.append(h("span", "badge badge-deal", "Dealbreaker"));
  if (item.ai) tags.append(h("span", "badge badge-ai", "AI · quote checked"));
  card.append(tags, h("p", "say", item.say), h("blockquote", "quote", item.quote));

  // Next move, in the Add / Check / Tell habit.
  const advice = adviceFor(item.ruleId, item.category);
  const moves = h("dl", "moves");
  for (const [label, text] of [["Add", advice.add], ["Check", advice.check], ["Tell", advice.tell]]) {
    moves.append(h("dt", "", label), h("dd", "", text));
  }
  card.append(moves);

  const ruleId = item.ruleId;
  if (ruleId) {
    const actions = h("div", "actions");
    const options: [Choice, string][] = [["ok", "Approve"], ["notok", "Not OK"]];
    for (const [value, label] of options) {
      const btn = button(label, `choice choice-${value}`, () => setPref(ruleId, value, item.key));
      btn.setAttribute("aria-pressed", String(choice === value));
      actions.append(btn);
    }
    card.append(actions);
  }

  card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    focusMark(item.key);
  });
  card.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === card) {
      e.preventDefault();
      focusMark(item.key);
    }
  });
  return card;
}

/** Clicking the active choice again clears it. Cards update in place (no re-sort under the cursor). */
function setPref(ruleId: string, value: Choice, focusKey: string): void {
  if (prefs[ruleId] === value) delete prefs[ruleId];
  else prefs[ruleId] = value;
  save(PREFS_KEY, prefs);
  for (const item of items) {
    if (item.ruleId === ruleId) document.getElementById(`card-${item.key}`)?.replaceWith(renderCard(item));
  }
  renderSummary();
  document.querySelector<HTMLButtonElement>(`#card-${focusKey} .choice-${value}`)?.focus();
}

function renderDoc(): void {
  const groups = groupRanges(items, checkedText.length);
  markIdByKey = new Map();
  for (const g of groups) for (const k of g.keys) markIdByKey.set(k, g.id);
  docEl.innerHTML = markedHtml(checkedText, groups);
  docCountEl.textContent = `${groups.length} flagged passage${groups.length === 1 ? "" : "s"}`;
}

let flashed: HTMLElement | null = null;
let flashTimer = 0;
function flash(el: HTMLElement): void {
  flashed?.classList.remove("flash");
  window.clearTimeout(flashTimer);
  void el.offsetWidth; // restart the animation when the same element flashes again
  el.classList.add("flash");
  flashed = el;
  flashTimer = window.setTimeout(() => el.classList.remove("flash"), 1600);
}

function focusMark(key: string): void {
  const id = markIdByKey.get(key);
  const mark = id ? document.getElementById(id) : null;
  if (!mark) return;
  mark.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  flash(mark);
}

docEl.addEventListener("click", (e) => {
  const mark = (e.target as HTMLElement).closest("mark");
  const key = mark?.dataset.keys?.split(" ")[0];
  const card = key ? document.getElementById(`card-${key}`) : null;
  if (!card) return;
  card.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  flash(card);
});

// ---------- AI mode ----------
async function loadAi(): Promise<AiModule | null> {
  if (aiModule) return aiModule;
  try {
    aiModule = (await import("../src/ai/index.ts")) as AiModule;
    return aiModule;
  } catch (err) {
    console.warn("AI module failed to load:", err);
    return null;
  }
}

function showAiLoading(text: string): void {
  aiBox.hidden = false;
  aiBox.className = "ai-box is-loading";
  aiBox.replaceChildren(h("p", "", text));
}

function showAiSummary(result: AiResult, seconds: number): void {
  aiBox.hidden = false;
  aiBox.className = "ai-box";
  const n = result.points.length;
  let note = `${n} more AI point${n === 1 ? "" : "s"} added below, each quote checked against the text.`;
  if (result.dropped) note += ` ${result.dropped} dropped because their quote wasn't in the text.`;
  note += ` ${result.model ?? "Local model"}, ${seconds.toFixed(0)} s.`;
  aiBox.replaceChildren(h("h2", "", "AI summary"), h("p", "", result.summary), h("p", "muted", note));
}

function showAiHelp(reason: string): void {
  aiBox.hidden = false;
  aiBox.className = "ai-box is-help";
  const how = h("p", "muted");
  if (getTauri()) {
    how.append("Start Ollama, or set the llama-server and model paths in AI settings and press Start AI.");
  } else {
    how.append("Start Ollama with a model (for example ", h("code", "", "ollama pull qwen3.5:4b"),
      ") or a llama.cpp server (", h("code", "", `llama-server -m model.gguf --port ${port()}`),
      "), or set the server URL in AI settings, then press Retry.");
  }
  how.append(" The rule-based results below don't need it.");
  const actions = h("div", "actions");
  if (getTauri()) actions.append(button("Start AI", "primary", () => void startAi()));
  actions.append(button("Retry", "", () => void runAi()));
  aiBox.replaceChildren(h("h2", "", "AI isn't running"), h("p", "", reason), how, actions);
}

async function runAi(): Promise<void> {
  if (!checkedText) return;
  aiRun?.abort();
  const run = new AbortController();
  aiRun = run;
  const text = checkedText;
  const flags = ruleFlags;
  showAiLoading("Asking the local AI... The rule-based results are already below.");

  const ai = await loadAi();
  if (run.signal.aborted) return;
  if (!ai) return showAiHelp("The AI module couldn't be loaded, so only the rule-based check ran.");

  // The configured server first, then Ollama on its usual port.
  const server = await ai.findAiServer({ baseUrl: baseUrl(), signal: run.signal }).catch(() => null);
  if (run.signal.aborted) return;
  if (!server) {
    const tried = [...new Set([baseUrl(), ai.OLLAMA_BASE_URL])].join(" or ");
    return showAiHelp(`Nothing answered at ${tried}.`);
  }
  aiUrlEl.textContent = server;
  showAiLoading(`Asking ${settings.aiModel || "the local AI"} at ${server}... The rule-based results are already below.`);

  try {
    const t0 = performance.now();
    const result = await ai.analyzeWithAi(text, flags, { baseUrl: server, model: settings.aiModel || undefined, signal: run.signal });
    if (run.signal.aborted) return;
    const aiItems: Item[] = result.points.map((p, n) => ({
      key: `a${n}`, ruleId: null, category: p.category, severity: p.severity,
      say: p.say, quote: p.quote, start: p.start, end: p.end, ai: true,
    }));
    items = items.filter((i) => !i.ai).concat(aiItems);
    showAiSummary(result, (performance.now() - t0) / 1000);
    render();
  } catch (err) {
    if (!run.signal.aborted) showAiHelp(`The AI check failed: ${errorText(err)}`);
  }
}

async function startAi(): Promise<void> {
  const tauri = getTauri();
  if (!tauri) return;
  if (!settings.serverPath || !settings.modelPath) {
    settingsEl.open = true;
    setServer.focus();
    return showAiHelp("Set the llama-server path and the model path in AI settings first.");
  }
  showAiLoading("Starting the local AI. Loading the model can take a minute...");
  try {
    await tauri.core.invoke("start_ai", { serverPath: settings.serverPath, modelPath: settings.modelPath, port: port() });
  } catch (err) {
    return showAiHelp(`Couldn't start the AI: ${errorText(err)}`);
  }
  // invoke returns once the process starts; wait for the model to answer.
  const ai = await loadAi();
  for (let i = 0; ai && i < 60; i++) {
    if (await ai.isAiAvailable({ baseUrl: localUrl() }).catch(() => false)) {
      if (checkedText) return runAi();
      aiBox.hidden = true;
      status("The AI is running. Press Check.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  showAiHelp("The AI server started but didn't answer within 60 seconds. Check the paths in AI settings.");
}

// ---------- input ----------
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, template, svg").forEach((el) => el.remove());
  doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  doc.body.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote, pre, dt, dd")
    .forEach((el) => el.append("\n"));
  return (doc.body.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

byId("open-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const raw = await file.text();
    input.value = /\.html?$/i.test(file.name) ? htmlToText(raw) : raw;
    check();
    status(`Opened ${file.name}.`);
  } catch (err) {
    status(`Couldn't read ${file.name}: ${errorText(err)}`);
  }
  fileInput.value = ""; // lets the same file be opened again
});

byId("sample-btn").addEventListener("click", () => {
  input.value = SAMPLE_TOS;
  check();
});
byId("check-btn").addEventListener("click", check);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    check();
  }
});

// ---------- settings ----------
function saveSettings(): void {
  settings.aiUrl = setAiUrl.value.trim();
  settings.aiModel = setAiModel.value.trim();
  settings.serverPath = setServer.value.trim();
  settings.modelPath = setModel.value.trim();
  settings.port = Number(setPort.value);
  settings.port = port();
  save(SETTINGS_KEY, settings);
  showSettings();
}

function showSettings(): void {
  aiUrlEl.textContent = baseUrl();
  setAiUrl.placeholder = localUrl();
}

setAiUrl.value = String(settings.aiUrl || "");
setAiModel.value = String(settings.aiModel || "");
setServer.value = settings.serverPath;
setModel.value = settings.modelPath;
setPort.value = String(port());
showSettings();
aiToggle.checked = Boolean(settings.aiMode);
document.body.classList.toggle("has-tauri", Boolean(getTauri()));
for (const el of [setAiUrl, setAiModel, setServer, setModel, setPort]) el.addEventListener("change", saveSettings);

aiToggle.addEventListener("change", () => {
  settings.aiMode = aiToggle.checked;
  save(SETTINGS_KEY, settings);
  if (!checkedText) return;
  if (settings.aiMode) {
    void runAi();
  } else {
    aiRun?.abort();
    aiBox.hidden = true;
    items = items.filter((i) => !i.ai);
    render();
  }
});
