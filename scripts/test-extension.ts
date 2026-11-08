// End-to-end check of the browser extension in a real Microsoft Edge (or Chrome). No dependencies.
//
//   npm run build
//   node scripts/test-extension.ts
//
// 1. Serves a fictional app, "Snapnest", at snapnest.test (--host-resolver-rules points it at 127.0.0.1):
//    a sign-up page with the terms on it, and linked Privacy and Cookie Policy pages on the same origin.
// 2. Starts headless Edge with a throwaway profile, speaks the DevTools protocol over --remote-debugging-pipe
//    and loads dist/extension with Extensions.loadUnpacked.
// 3. Clicks the toolbar button with Extensions.triggerAction (a real action click, so activeTab applies),
//    attaches to the popup and checks the report, the badge and the icons. Then checks Allow, Not OK, Show on
//    page, Open and show, selected text, a terms change, and a browser page the extension can't read.
// 4. Saves screenshots to docs/screenshots/.
//
// Not covered: answering the browser's own permission prompt (nothing can click it in headless Edge).
//
// Env: BROWSER=<msedge.exe or chrome.exe>   PROFILE_DIR=<profile folder to use; kept afterwards, never your real one>
//      HEADED=1 to watch it   NO_SHOTS=1 to skip screenshots
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { originPatterns } from "../extension/lib.ts";

const root = join(import.meta.dirname, "..");
const EXTENSION_DIR = join(root, "dist", "extension");
const SHOTS_DIR = join(root, "docs", "screenshots");
export const SITE = "snapnest.test";
export const LEGAL = "legal.snapnest.test";
/** Only linked from /teams, and never granted, for the real permission prompt. */
const FRESH = "policies.snapnest.test";
const STEP_TIMEOUT = 20_000;

// ── Results ─────────────────────────────────────────────────────────

const results: { ok: boolean; name: string; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): boolean {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return ok;
}
function note(text: string): void {
  console.log(`NOTE  ${text}`);
}

// ── The test site ───────────────────────────────────────────────────

// Every request the site answered. A page load asks for text/html first; fetch() accepts anything.
const served: { host: string; path: string; origin: string; pageLoad: boolean; cookie: string }[] = [];

/** Version 2 of the Privacy Policy drops one flagged sentence and adds another, for "changed since you checked". */
export function site(port: number, privacyVersion = 1) {
  const page = (title: string, body: string, cookieUrl = `http://${LEGAL}:${port}/cookies`) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { font-family: system-ui, "Segoe UI", sans-serif; color: #1d2433; background: #f5f6fa; }
  body { margin: 0; }
  .top { display: flex; align-items: center; gap: 28px; padding: 14px 40px; background: #fff; border-bottom: 1px solid #e3e6ee; }
  .logo { font-weight: 800; font-size: 21px; color: #6d28d9; text-decoration: none; letter-spacing: -.02em; }
  .top nav a { color: #4b5568; text-decoration: none; margin-right: 20px; font-size: 15px; }
  .wrap { max-width: 1180px; margin: 32px auto; padding: 0 40px; display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 36px; align-items: start; }
  .box { background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 6px 24px rgba(20, 30, 60, .08); }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -.02em; }
  .lead { color: #5b6476; margin: 0 0 20px; }
  label { display: block; font-size: 14px; font-weight: 600; margin: 14px 0 6px; }
  input[type=text], input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #cfd5e1; border-radius: 8px; font: inherit; }
  .agree { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; font-size: 14px; margin-top: 18px; }
  .agree a, .legal a { color: #6d28d9; }
  .cta { width: 100%; margin-top: 18px; padding: 13px; border: 0; border-radius: 8px; background: #6d28d9; color: #fff; font: 600 16px system-ui, sans-serif; }
  .terms { max-height: 640px; overflow: auto; }
  .terms h2 { margin: 0 0 4px; font-size: 20px; }
  .terms h3 { margin: 20px 0 6px; font-size: 15px; }
  .terms p { margin: 0 0 10px; line-height: 1.55; color: #343c4e; }
  .updated { color: #7a8396; font-size: 13px; }
  .doc { max-width: 760px; margin: 32px auto; }
  .doc p { line-height: 1.6; }
  footer { max-width: 1180px; margin: 0 auto 40px; padding: 18px 40px; color: #7a8396; font-size: 13px; display: flex; gap: 22px; }
  footer a { color: #4b5568; }
</style></head>
<body>
<header class="top"><a class="logo" href="/signup">snapnest</a>
  <nav><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/help">Help</a></nav></header>
${body}
<footer><span>© 2026 Snapnest (a fictional app for testing Tickwise)</span>
  <a href="/privacy">Privacy Policy</a><a href="${cookieUrl}">Cookie Policy</a><a href="http://router.local:${port}/cookie-settings">Cookie settings</a><a href="/help">Help centre</a></footer>
</body></html>`;

  const signupBody = `
<main class="wrap">
  <form class="box" onsubmit="return false">
    <h1>Create your account</h1>
    <p class="lead">Share photo stories with friends. Free for 7 days, then S$9.98 a month.</p>
    <label for="name">Name</label><input id="name" type="text" autocomplete="off">
    <label for="email">Email</label><input id="email" type="email" autocomplete="off">
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="off">
    <label class="agree"><input type="checkbox"> <span>I have read and agree to the <a href="#terms">Terms of Service</a> and the <a href="/privacy">Privacy Policy</a>.</span></label>
    <button class="cta" type="submit">Start free trial</button>
  </form>
  <section id="terms" class="box terms legal">
    <h2>Terms of Service</h2>
    <p class="updated">Last updated 1 October 2026</p>
    <h3>1. Agreement</h3>
    <p>By creating an account or using Snapnest, you agree to be bound by these Terms and our <a href="/privacy">Privacy Policy</a>.</p>
    <h3>2. Subscriptions and payment</h3>
    <p>Snapnest Premium starts with a 7-day free trial. Your subscription automatically renews every month and we will charge the card on file until you cancel.</p>
    <p>All payments are non-refundable, including for partly used months.</p>
    <h3>3. Your content</h3>
    <p>You grant Snapnest a worldwide, royalty-free, sublicensable and perpetual license to use, copy, modify and display the photos and stories you upload.</p>
    <p>We may share your personal information, including your contacts and location, with advertising partners and other third parties.</p>
    <h3>4. Changes and termination</h3>
    <p>We may modify these Terms at any time, and your continued use of the service constitutes acceptance of the changes.</p>
    <p>Snapnest may suspend or terminate your account at any time, for any reason, without notice.</p>
    <h3>5. Liability</h3>
    <p>To the maximum extent permitted by law, Snapnest will not be liable for any indirect, incidental or consequential damages, and our total liability is limited to the amount you paid us in the last month.</p>
    <h3>6. Disputes</h3>
    <p>Any dispute arising from these Terms will be resolved by final and binding individual arbitration, and you waive your right to a jury trial or to take part in a class action.</p>
    <p>You may opt out of arbitration by writing to us within 30 days of signing up.</p>
    <p>These Terms are governed by the laws of the State of Delaware, and you consent to the exclusive jurisdiction of the courts located in Wilmington, Delaware.</p>
  </section>
</main>`;
  const signup = page("Create your account · Snapnest", signupBody);
  const teams = page("Snapnest for Teams", signupBody, `http://${FRESH}:${port}/cookies`);

  const privacy = page("Privacy Policy · Snapnest", `
<main class="doc box">
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated 1 October 2026</p>
  <p>We collect your precise location from your phone's GPS, even when the app is in the background.</p>
  <p>If you allow it, we upload your contacts and address book to help you find friends.</p>
  ${privacyVersion === 1 ? "<p>We may sell your personal information to data brokers.</p>" : "<p>We use your photos and messages to train our artificial intelligence models.</p>"}
  <p>We share usage data with our affiliates and partners for analytics.</p>
  <p>We may retain your data for up to three years after you delete your account.</p>
</main>`);

  const cookies = page("Cookie Policy · Snapnest", `
<main class="doc box">
  <h1>Cookie Policy</h1>
  <p class="updated">Last updated 1 October 2026</p>
  <p>We and our partners use third-party cookies and advertising pixels to track your activity across other websites and apps.</p>
  <p>Cookie data is shared with advertisers and ad networks to show you personalised ads.</p>
</main>`);

  const help = page("Help · Snapnest", `<main class="doc box"><h1>Help centre</h1><p>How can we help?</p></main>`);

  return {
    [`${SITE}/`]: signup,
    [`${SITE}/signup`]: signup,
    [`${SITE}/privacy`]: privacy,
    [`${SITE}/help`]: help,
    [`${SITE}/teams`]: teams,
    [`${LEGAL}/cookies`]: cookies,
    [`${FRESH}/cookies`]: cookies,
  } as Record<string, string>;
}

async function startSite(): Promise<{ port: number; close: () => void; setPrivacy: (version: number) => void }> {
  let pages: Record<string, string> = {};
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    served.push({ host, path, origin: String(req.headers.origin ?? ""), pageLoad: String(req.headers.accept ?? "").startsWith("text/html"), cookie: String(req.headers.cookie ?? "") });
    const body = pages[`${host}${path}`];
    if (body === undefined) res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    else {
      // A login cookie for the whole site, so the test can check that linked pages are fetched without it.
      const login = path === "/signup" ? { "set-cookie": `tw_session=1; Path=/; Domain=${SITE}; SameSite=Lax` } : {};
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...login }).end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  pages = site(port);
  return { port, close: () => server.close(), setPrivacy: (version) => (pages = site(port, version)) };
}

// ── DevTools protocol over a pipe ───────────────────────────────────

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

export class Cdp {
  #next = 0;
  #pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  #listeners = new Set<(m: Message) => void>();
  #out: Writable;

  constructor(out: Writable, input: Readable) {
    this.#out = out;
    // Messages are JSON, each ended by a NUL byte.
    let parts: Buffer[] = [];
    input.on("data", (chunk: Buffer) => {
      let start = 0;
      for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, start)) {
        parts.push(chunk.subarray(start, end));
        this.#receive(JSON.parse(Buffer.concat(parts).toString("utf8")));
        parts = [];
        start = end + 1;
      }
      if (start < chunk.length) parts.push(chunk.subarray(start));
    });
  }

  #receive(msg: Message): void {
    if (msg.id !== undefined) {
      const call = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) call?.reject(new Error(msg.error.message));
      else call?.resolve(msg.result);
    } else {
      for (const fn of this.#listeners) fn(msg);
    }
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.#next;
    this.#out.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), STEP_TIMEOUT);
      this.#pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(new Error(`${method}: ${e.message}`))),
      });
    });
  }

  on(fn: (m: Message) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T>, timeout = STEP_TIMEOUT): Promise<T> {
  const until = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last}` : ""}`);
}

export function findBrowser(): string {
  const candidates = [
    process.env.BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("No Edge or Chrome found. Set BROWSER to its path.");
  return found;
}

// ── Browser helpers ─────────────────────────────────────────────────

let cdp: Cdp;
let extensionId = "";
const seenPopups = new Set<string>();
const consoleErrors = new Map<string, string[]>();

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function attach(targetId: string): Promise<string> {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const errors: string[] = [];
  consoleErrors.set(sessionId, errors);
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  return sessionId;
}

async function openTab(url: string, background = false): Promise<{ targetId: string; sessionId: string }> {
  const { targetId } = await cdp.send("Target.createTarget", { url, background });
  const sessionId = await attach(targetId);
  await waitFor(`${url} to load`, () => evaluate(sessionId, `document.readyState === "complete" && location.href !== "about:blank"`));
  return { targetId, sessionId };
}

/** Clicks the toolbar button for this tab, like a user would, and attaches to the popup that opens. */
async function openPopup(pageTargetId: string): Promise<{ targetId: string; sessionId: string }> {
  await cdp.send("Target.activateTarget", { targetId: pageTargetId });
  // triggerAction wants the tab target that wraps the page, not the page itself. They share the URL.
  const { targetInfo: pageInfo } = await cdp.send("Target.getTargetInfo", { targetId: pageTargetId });
  const { targetInfos: tabs } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  const tabTarget = tabs.find((t: any) => t.url === pageInfo.url);
  if (!tabTarget) throw new Error(`No tab target for ${pageInfo.url}`);
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: tabTarget.targetId });
  const popup = await waitFor("the popup to open", async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return targetInfos.find((t: any) => t.url.startsWith(`chrome-extension://${extensionId}/popup.html`) && !seenPopups.has(t.targetId));
  });
  seenPopups.add(popup.targetId);
  const sessionId = await attach(popup.targetId);
  // Light mode for the screenshots (headless follows the system theme).
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }, sessionId).catch(() => {});
  // Done when the report (or the "can't read" message) is on screen.
  await waitFor("the popup report", () => evaluate(sessionId, `!!document.querySelector(".band, .error") || /^No readable text/.test(document.getElementById("main").innerText)`));
  await evaluate(sessionId, `document.fonts.ready.then(() => true)`);
  return { targetId: popup.targetId, sessionId };
}

async function closePopup(targetId: string): Promise<void> {
  await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  await waitFor("the popup to close", async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return !targetInfos.some((t: any) => t.targetId === targetId);
  }).catch(() => {});
}

/** A trusted click (counts as a user gesture), on the first element matching the selector whose text matches. */
async function click(sessionId: string, selector: string, text?: string): Promise<void> {
  const box = await evaluate(sessionId, `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text === undefined ? "true" : `e.textContent.trim() === ${JSON.stringify(text)}`});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`Nothing to click: ${selector} ${text ?? ""}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
}

/** What the popup shows, read from the DOM. */
function readReport(sessionId: string): Promise<any> {
  return evaluate(sessionId, `(() => {
    const all = (s, root = document) => [...root.querySelectorAll(s)];
    const text = (e) => (e ? e.textContent.replace(/\\s+/g, " ").trim() : "");
    const band = document.querySelector(".band");
    return {
      page: text(document.getElementById("page")),
      band: band ? band.className : "",
      score: band ? parseInt(text(band.querySelector(".num")), 10) : NaN,
      line: text(band && band.querySelector(".line")),
      headings: all("h2").map(text),
      docs: all(".docs li").map((li) => ({ name: text(li.querySelector("strong")), url: text(li.querySelector("small")), count: text(li.querySelector(".doc-count")), watch: text(li.querySelector(".watch")) })),
      cards: all(".card").map((c) => ({
        say: text(c.querySelector(".say")),
        quote: c.querySelector(".quote").title || text(c.querySelector(".quote")),
        severity: (c.className.match(/sev-(\\w+)/) || [])[1],
        source: text(c.querySelector(".source")),
        advice: all(".advice dt", c).map(text).join("/"),
        addText: text(c.querySelector(".advice dd")),
        buttons: all(".actions button:not(.show)", c).map(text).join("/"),
        show: text(c.querySelector("button.show")),
        isNew: !!c.querySelector(".badge-new"),
        dealbreaker: c.classList.contains("is-dealbreaker"),
      })),
      allow: all("button.primary").map(text),
      failed: all(".links li strong").map(text),
      error: text(document.querySelector(".error")),
      font: [...document.fonts].some((f) => f.family.includes("Redaction") && f.status === "loaded"),
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    };
  })()`);
}

const snapshots: { file: string; html: string; full: boolean }[] = [];

/** Keeps the popup's DOM as it is now, for renderShots() to draw at the end. */
async function snapshot(popupSessionId: string, file: string, full = false): Promise<void> {
  snapshots.push({ file, full, html: await evaluate(popupSessionId, `document.body.innerHTML`) });
}

/**
 * Headless Edge keeps a popup window at the height of its first "Reading…" frame (a real one grows to fit, up
 * to 600px), and can't capture past it. So each snapshot of the popup's DOM is drawn in popup.html opened as
 * a tab, which has the same stylesheet and fonts, at the real popup size: 380px wide, up to 600px tall.
 */
async function renderShots(): Promise<Map<string, Buffer>> {
  const pngs = new Map<string, Buffer>();
  if (process.env.NO_SHOTS === "1" || snapshots.length === 0) return pngs;
  const tab = await openTab(`chrome-extension://${extensionId}/popup.html`);
  // As the active tab it tries to read itself and says it can't. Wait for that so it doesn't overwrite the copy.
  await waitFor("popup.html as a tab", () => evaluate(tab.sessionId, `!!document.querySelector(".band, .error")`));
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }, tab.sessionId);
  for (const shot of snapshots) {
    const height = await evaluate(tab.sessionId, `(() => {
      document.body.innerHTML = ${JSON.stringify(shot.html)};
      document.documentElement.style.scrollbarWidth = "none";
      return document.fonts.ready.then(() => document.documentElement.scrollHeight);
    })()`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 380, height: shot.full ? height : Math.min(height, 600), deviceScaleFactor: 2, mobile: false }, tab.sessionId);
    await evaluate(tab.sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const png = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, tab.sessionId)).data, "base64");
    writeFileSync(join(SHOTS_DIR, shot.file), png);
    console.log(`SHOT  docs/screenshots/${shot.file}`);
    pngs.set(shot.file, png);
  }
  await cdp.send("Target.closeTarget", { targetId: tab.targetId });
  return pngs;
}

/** Puts the popup screenshot over the page screenshot, top right, where the real popup opens. */
async function composite(pagePng: Buffer, popupPng: Buffer, file: string): Promise<void> {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const sessionId = await attach(targetId);
  let clip = { width: 1280, height: 800 };
  await evaluate(sessionId, `(() => {
    document.body.style.cssText = "margin:0;background:#fff;overflow:hidden";
    document.body.innerHTML = '<img id="p" style="position:absolute;left:0;top:0">'
      + '<img id="x" style="position:absolute;right:16px;top:8px;width:380px;outline:1px solid rgba(14,22,36,.35);box-shadow:0 12px 32px rgba(14,22,36,.28)">';
    document.getElementById("p").src = "data:image/png;base64,${pagePng.toString("base64")}";
    document.getElementById("x").src = "data:image/png;base64,${popupPng.toString("base64")}";
    return Promise.all([...document.images].map((i) => i.decode())).then(() => {
      const p = document.getElementById("p");
      p.style.width = p.naturalWidth / 2 + "px"; // shots are taken at 2x
      return { width: p.naturalWidth / 2, height: p.naturalHeight / 2 };
    });
  })()`).then((size) => (clip = size));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: clip.width, height: clip.height, scale: 1 } }, sessionId);
  writeFileSync(join(SHOTS_DIR, file), Buffer.from(data, "base64"));
  console.log(`SHOT  docs/screenshots/${file}`);
  await cdp.send("Target.closeTarget", { targetId });
}

// ── The run ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(join(EXTENSION_DIR, "manifest.json"))) throw new Error("dist/extension is missing. Run `npm run build` first.");
  mkdirSync(SHOTS_DIR, { recursive: true });
  const { port, close: closeSite, setPrivacy } = await startSite();
  const browserPath = findBrowser();
  // Only a folder this script made is deleted afterwards.
  const ownProfile = !process.env.PROFILE_DIR;
  const profile = process.env.PROFILE_DIR ?? mkdtempSync(join(tmpdir(), "bya-edge-"));
  mkdirSync(profile, { recursive: true });
  const signupUrl = `http://${SITE}:${port}/signup`;
  console.log(`Browser: ${browserPath}\nProfile: ${profile}\nSite:    ${signupUrl}`);

  const args = [
    process.env.HEADED === "1" ? "" : "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1280,800",
    "--force-device-scale-factor=2",
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${LEGAL} 127.0.0.1, MAP ${FRESH} 127.0.0.1, MAP router.local 127.0.0.1`,
    "about:blank",
  ].filter(Boolean);
  const browser: ChildProcess = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "";
  browser.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  cdp = new Cdp(browser.stdio[3] as Writable, browser.stdio[4] as Readable);

  try {
    const version = await cdp.send("Browser.getVersion");
    console.log(`Running: ${version.product}`);
    ({ id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: EXTENSION_DIR }));
    check("extension loads unpacked", !!extensionId, extensionId);
    await run(port, signupUrl, setPrivacy);
  } catch (err) {
    check("harness ran to the end", false, err instanceof Error ? err.message : String(err));
    if (stderr) console.log(`--- browser stderr (tail) ---\n${stderr}`);
  } finally {
    await cdp.send("Browser.close").catch(() => browser.kill());
    await new Promise((r) => (browser.exitCode !== null ? r(null) : browser.once("exit", r)));
    closeSite();
    if (ownProfile && !process.env.KEEP_PROFILE) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function run(port: number, signupUrl: string, setPrivacy: (version: number) => void): Promise<void> {
  const legalOrigin = `http://${LEGAL}:${port}`;
  const tab = await openTab(signupUrl);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }, tab.sessionId);
  const pagePng = process.env.NO_SHOTS === "1" ? null : Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, tab.sessionId)).data, "base64");
  await cdp.send("Emulation.clearDeviceMetricsOverride", {}, tab.sessionId);

  // 1. First click: the page and the same-origin Privacy Policy are read; the Cookie Policy on another
  //    origin can't be fetched from inside the page, so it waits behind "Allow reading 1 more page".
  const a = await openPopup(tab.targetId);
  let r = await readReport(a.sessionId);
  check("popup names the page", r.page.startsWith(SITE), r.page);
  check("score band is shown with a colour", /band-(ok|warn|bad)/.test(r.band) && r.score >= 0 && r.score <= 100, `${r.score}, ${r.band}`);
  check("score line explains it", /things? to know/.test(r.line), r.line);
  check("'Checked 2 documents' before permission", r.headings.includes("Checked 2 documents"), r.headings.join(" | "));
  check("documents are This page + Privacy Policy", r.docs.map((d: any) => d.name).join(",") === "This page,Privacy Policy", r.docs.map((d: any) => d.name).join(","));
  check("flags were found", r.cards.length > 0, `${r.cards.length} flags`);
  check("every flag says which document it came from", r.cards.every((c: any) => /^From: (This page|Privacy Policy)$/.test(c.source)), [...new Set(r.cards.map((c: any) => c.source))].join(", "));
  check("flags come from both documents", ["This page", "Privacy Policy"].every((n) => r.cards.some((c: any) => c.source === `From: ${n}`)));
  const adds = r.cards.filter((c: any) => c.advice).map((c: any) => c.addText);
  check("a flag has at most one Add", r.cards.every((c: any) => c.advice === "" || c.advice === "Add"));
  check("each Add shows once, on the first card of its kind", adds.length > 0 && new Set(adds).size === adds.length, `${adds.length} Adds on ${r.cards.length} cards`);
  check("every flag has OK / Not OK", r.cards.every((c: any) => c.buttons === "OK/Not OK"));
  check("cross-origin Cookie Policy is listed as unread", r.failed.join() === "Cookie Policy", r.failed.join());
  check("'Allow reading 1 more page' button is shown", r.allow.includes("Allow reading 1 more page"), r.allow.join());
  check("non-legal links are not fetched", !served.some((s) => s.path === "/help" || s.path === "/features"));
  check("a link to your own network (router.local) is skipped", !served.some((s) => s.host === "router.local") && !r.failed.includes("Cookie settings"), r.failed.join());
  check("popup fits its 380px width", r.width <= 380, `${r.width}px`);
  check("Tickwise fonts load from the extension (no network)", r.font);
  check("flags from this page have Show on page", r.cards.filter((x: any) => x.source === "From: This page").every((x: any) => x.show === "Show on page"));
  check("flags from a linked page have Open and show", r.cards.filter((x: any) => x.source === "From: Privacy Policy").every((x: any) => x.show === "Open and show"));
  check("first check: each document says so", r.docs.every((x: any) => x.watch === "First check"), r.docs.map((x: any) => x.watch).join(" | "));
  const high = r.cards.filter((x: any) => x.severity === "high").length;
  const badge = await evaluate(a.sessionId, `chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => Promise.all([chrome.action.getBadgeText({ tabId: t.id }), chrome.action.getTitle({ tabId: t.id })]))`);
  check("toolbar badge shows the high-risk count", high > 0 && badge[0] === String(high), `"${badge[0]}" for ${high} high; title "${badge[1]}"`);
  const icons = await evaluate(a.sessionId, `Promise.all(Object.values(chrome.runtime.getManifest().icons).map((p) => fetch(chrome.runtime.getURL(p)).then((res) => res.ok && res.headers.get("content-type") === "image/png")))`);
  check("manifest icons are real PNGs", icons.length === 4 && icons.every(Boolean), JSON.stringify(icons));
  await snapshot(a.sessionId, "extension-popup-permission.png");

  // 2. Allow, through the real button. A trusted CDP click is a user gesture, so chrome.permissions.request
  //    runs. A new origin makes the browser show a prompt, and nothing can answer that prompt in headless.
  //    So the origin is granted first, the way Site access on edge://extensions does it (developerPrivate);
  //    the request then resolves true without a prompt and the button's own code reads the page.
  const granted = await grantHost(originPatterns(`${legalOrigin}/cookies`));
  check("Cookie Policy origin granted through the extensions page", granted === true, String(granted));
  const servedBefore = served.length;
  await click(a.sessionId, "button.primary");
  await waitFor("the Cookie Policy to be read", () => evaluate(a.sessionId, `!document.querySelector(".links")`)).catch(() => {});
  r = await readReport(a.sessionId);
  check("after Allow: 'Checked 3 documents'", r.headings.includes("Checked 3 documents"), r.headings.join(" | "));
  check("after Allow: Cookie Policy is a document", r.docs.some((d: any) => d.name === "Cookie Policy" && d.url === `${LEGAL}/cookies`), r.docs.map((d: any) => d.name).join(","));
  check("after Allow: flags from the Cookie Policy", r.cards.some((c: any) => c.source === "From: Cookie Policy"));
  check("after Allow: nothing left unread", r.failed.length === 0 && r.allow.length === 0);
  check("Cookie Policy was fetched after the click", served.slice(servedBefore).some((s) => s.host === LEGAL && s.path === "/cookies"));
  const errorsA = consoleErrors.get(a.sessionId) ?? [];
  check("no console errors in the popup", errorsA.length === 0, errorsA.join(" | "));
  await closePopup(a.targetId);

  // 3. Second click: the allowed origin is read straight away, into one merged report.
  const b = await openPopup(tab.targetId);
  r = await readReport(b.sessionId);
  check("reopen: allowed origin is read without asking", r.headings.includes("Checked 3 documents") && r.failed.length === 0, r.headings.join(" | "));
  check("reopen: flags from all three documents", ["This page", "Privacy Policy", "Cookie Policy"].every((n) => r.cards.some((c: any) => c.source === `From: ${n}`)));
  const scoreBefore = r.score;
  await snapshot(b.sessionId, "extension-popup.png");
  await snapshot(b.sessionId, "extension-popup-full.png", true);

  // 4. Not OK makes a dealbreaker: badge, top of the list, lower score, saved. Clicking again clears it.
  const first = r.cards[0].say;
  await click(b.sessionId, ".card:first-of-type button", "Not OK");
  r = await readReport(b.sessionId);
  check("Not OK marks a dealbreaker", r.cards[0].dealbreaker && r.cards[0].say === first, r.cards[0].say);
  check("dealbreaker lowers the score", r.score < scoreBefore, `${scoreBefore} -> ${r.score}`);
  const stored = await evaluate(b.sessionId, `chrome.storage.local.get("tos-checker.prefs").then((x) => x["tos-checker.prefs"])`);
  check("choice is saved to chrome.storage.local", !!stored && Object.values(stored).includes("notok"), JSON.stringify(stored));
  const seenKeys = await evaluate(b.sessionId, `chrome.storage.local.get("tickwise.seen").then((x) => Object.keys(x["tickwise.seen"] || {}))`);
  check(
    "checked pages are stored as hashes, not addresses",
    Array.isArray(seenKeys) && seenKeys.length > 0 && seenKeys.every((k: string) => /^[0-9a-z]+$/.test(k)),
    JSON.stringify(seenKeys),
  );
  await snapshot(b.sessionId, "extension-popup-dealbreaker.png");
  await click(b.sessionId, ".card:first-of-type button", "Not OK");
  r = await readReport(b.sessionId);
  check("clicking Not OK again clears it", !r.cards.some((x: any) => x.dealbreaker) && r.score === scoreBefore, `${r.score}`);
  check("reopen: each document says there's no change", r.docs.every((x: any) => x.watch === "No change since you checked today"), r.docs.map((x: any) => x.watch).join(" | "));

  // Show on page: highlights the sentence in the tab and scrolls it into view, here inside the scrolling terms box.
  const pick = r.cards.findIndex((x: any) => x.source === "From: This page" && /binding individual arbitration/.test(x.quote));
  await evaluate(b.sessionId, `document.querySelectorAll(".card")[${pick}].querySelector("button.show").setAttribute("data-pick", "")`);
  await click(b.sessionId, "[data-pick]");
  const shown = await waitFor("the highlight", () =>
    evaluate(tab.sessionId, `(() => {
      const h = CSS.highlights && CSS.highlights.get("tickwise");
      if (!h || h.size === 0) return null;
      const range = [...h][0];
      const box = range.getBoundingClientRect();
      return { text: range.toString().replace(/\\s+/g, " ").trim(), top: box.top, bottom: box.bottom, height: innerHeight, scrolled: document.querySelector(".terms").scrollTop };
    })()`),
  ).catch((err) => ({ error: String(err) }) as any);
  check("Show on page highlights the sentence", /^Any dispute arising .* class action\.$/.test(shown.text ?? ""), shown.text ?? shown.error);
  check("Show on page scrolls it into view", shown.top >= 0 && shown.bottom <= shown.height, `top ${Math.round(shown.top)}, bottom ${Math.round(shown.bottom)}, viewport ${shown.height}, terms box scrolled ${shown.scrolled}px`);
  if (process.env.NO_SHOTS !== "1") {
    writeFileSync(join(SHOTS_DIR, "extension-show-on-page.png"), Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, tab.sessionId)).data, "base64"));
    console.log("SHOT  docs/screenshots/extension-show-on-page.png");
  }

  // Open and show: opens a linked page at the sentence (a text fragment). The popup closes as the tab opens.
  const before = new Set((await cdp.send("Target.getTargets")).targetInfos.map((t: any) => t.targetId));
  await evaluate(b.sessionId, `[...document.querySelectorAll(".card")].find((c) => c.querySelector(".source").textContent === "From: Privacy Policy").querySelector("button.show").setAttribute("data-open", "")`);
  await click(b.sessionId, "[data-open]");
  const opened = await waitFor("the linked page to open", async () =>
    (await cdp.send("Target.getTargets")).targetInfos.find((t: any) => t.type === "page" && !before.has(t.targetId) && t.url.includes("/privacy")),
  ).catch(() => null);
  check("Open and show opens the linked page at the sentence", !!opened && /\/privacy#:~:text=/.test(opened.url), opened?.url ?? "no new tab");
  if (opened) await cdp.send("Target.closeTarget", { targetId: opened.targetId });
  await closePopup(b.targetId);

  // 5. Selected text over 200 characters is checked as its own document, listed first.
  const selected = await evaluate(tab.sessionId, `(() => {
    const p = [...document.querySelectorAll("#terms p")].filter((e) => /arbitration|Delaware/.test(e.textContent));
    const range = document.createRange();
    range.setStartBefore(p[0]);
    range.setEndAfter(p[p.length - 1]);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return getSelection().toString().length;
  })()`);
  const c = await openPopup(tab.targetId);
  r = await readReport(c.sessionId);
  check("selected text becomes the first document", r.docs[0]?.name === "Selected text" && r.headings.includes("Checked 4 documents"), `${selected} chars; ${r.docs.map((x: any) => x.name).join(", ")}`);
  check("selected clauses are credited to the selection", r.cards.some((x: any) => x.source === "From: Selected text"));
  await snapshot(c.sessionId, "extension-popup-selection.png");
  await closePopup(c.targetId);
  await evaluate(tab.sessionId, `getSelection().removeAllRanges()`);

  // Terms change: the Privacy Policy drops one flagged sentence (selling data) and adds one (AI training).
  setPrivacy(2);
  const e = await openPopup(tab.targetId);
  r = await readReport(e.sessionId);
  const privacy = r.docs.find((x: any) => x.name === "Privacy Policy");
  check("changed Privacy Policy says what changed", privacy?.watch === "Changed since you checked today: 1 new flag, 1 gone", privacy?.watch);
  check("unchanged page says no change", r.docs.find((x: any) => x.name === "This page")?.watch === "No change since you checked today");
  const fresh = r.cards.filter((x: any) => x.isNew);
  check("only the new flag is marked New", fresh.length === 1 && fresh[0].source === "From: Privacy Policy" && /train AI/.test(fresh[0].say), fresh.map((x: any) => `${x.say} (${x.source})`).join(" | "));
  check("score line counts the new flag", / 1 is new since you last checked\.$/.test(r.line), r.line);
  await snapshot(e.sessionId, "extension-popup-changed.png");
  await closePopup(e.targetId);
  setPrivacy(1);

  // 6. A browser page can't be read by any extension: the popup says so.
  const blocked = await openTab("edge://version/").catch(() => openTab("chrome://version/"));
  const d = await openPopup(blocked.targetId);
  r = await readReport(d.sessionId);
  check("browser page shows 'Can't read this page.'", r.error === "Can't read this page.", r.error);
  await closePopup(d.targetId);
  await cdp.send("Target.closeTarget", { targetId: blocked.targetId });

  // The site set a login cookie on the sign-up page. Linked pages must be fetched without it, from the page
  // (Privacy Policy, same site) and from the popup (Cookie Policy, allowed site).
  const fetched = served.filter((s) => !s.pageLoad && (s.path === "/privacy" || s.path === "/cookies"));
  check("linked pages are fetched without the site's cookies", fetched.length > 0 && fetched.every((s) => !s.cookie), `${fetched.length} fetches; ${fetched.filter((s) => s.cookie).map((s) => `${s.host}${s.path} "${s.cookie}"`).join(", ")}`);
  check("control: the browser does send that cookie on page loads", served.some((s) => s.pageLoad && s.cookie.includes("tw_session")));

  // 7. The real prompt: a page whose Cookie Policy is on an origin never granted (Chrome remembers origins it
  //    granted once, even after permissions.remove, and then doesn't ask again). Click Allow and watch.
  const teams = await openTab(`http://${SITE}:${port}/teams`);
  const f = await openPopup(teams.targetId);
  r = await readReport(f.sessionId);
  check("fresh origin: Allow button is shown", r.allow.includes("Allow reading 1 more page"), r.allow.join());
  await evaluate(f.sessionId, `(() => {
    const request = chrome.permissions.request.bind(chrome.permissions);
    window.__requests = [];
    chrome.permissions.request = (p) => {
      const call = { state: "pending" };
      window.__requests.push(call);
      return request(p).then((v) => ((call.state = "resolved"), (call.value = v), v), (err) => ((call.state = "rejected"), (call.error = String(err)), Promise.reject(err)));
    };
  })()`);
  await click(f.sessionId, "button.primary");
  await sleep(3000);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const stillOpen = targetInfos.some((t: any) => t.targetId === f.targetId);
  const calls = stillOpen ? await evaluate(f.sessionId, `window.__requests`).catch(() => null) : null;
  const call = calls?.[0];
  // Seen on Edge 156: the prompt opens and takes focus, which closes the popup. After the user allows it,
  // the next click on the icon reads the page straight away (step 3).
  check("trusted click on Allow opens the browser prompt (popup closes) or resolves", !stillOpen || (!!call && !String(call.error ?? "").includes("gesture")), JSON.stringify(calls));
  note(`never-granted origin, 3 s after the click: popup ${stillOpen ? "open" : "closed"}, request ${call?.state ?? "unknown"}${call && "value" in call ? ` = ${call.value}` : ""}${call?.error ? ` (${call.error})` : ""}`);
  await closePopup(f.targetId);

  // Last, because switching tabs closes the popup.
  const pngs = await renderShots();
  const popupTop = pngs.get("extension-popup.png");
  if (pagePng && popupTop) await composite(pagePng, popupTop, "extension-in-context.png");
}

/** Grants hosts to the extension the way Site access on edge://extensions does. Test-only. */
async function grantHost(patterns: string[]): Promise<true | string> {
  // In the background: switching tabs would close the popup.
  const page = await openTab("edge://extensions/", true).catch(() => openTab("chrome://extensions/", true));
  try {
    return await evaluate(page.sessionId, `(async () => {
      for (const p of ${JSON.stringify(patterns)}) {
        const err = await new Promise((resolve) => chrome.developerPrivate.addHostPermission(${JSON.stringify(extensionId)}, p, () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)));
        if (err) return p + ": " + err;
      }
      return true;
    })()`);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
  }
}

if (import.meta.main) await main();
