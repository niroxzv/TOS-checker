// Records a captioned demo video of the app and the extension.
// Developer-only.
//
//   npm run build
//   node scripts/record-demo.ts        ->  tickwise-demo.mp4 (or .webm), plus app screenshots in docs/screenshots/
//
// It drives headless Edge (or Chrome) through the app and the extension, captures frames with the DevTools
// screencast, then plays them back onto a canvas with captions and encodes that with the browser's own
// MediaRecorder. So it needs nothing else installed, not even ffmpeg.
// The extension popup is redrawn in a tab, like scripts/test-extension.ts does, because headless Edge can't
// capture a popup past its first frame.
//
// Env: NO_AI=1 skips AI mode (otherwise it needs Ollama with AI_MODEL, default qwen3.5:4b),
//      BROWSER=<path>, OUT=<file name without extension>, HEADED=1 to watch.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, findBrowser, LEGAL, SITE, site } from "./test-extension.ts";

const root = join(import.meta.dirname, "..");
const APP_DIR = join(root, "dist", "app");
const EXTENSION_DIR = join(root, "dist", "extension");
const SHOTS_DIR = join(root, "docs", "screenshots");
// The default is a ~25 s cut for slides; LONG=1 records the full ~90 s walkthrough.
const LONG = process.env.LONG === "1";
const APP_CUT = process.env.APP === "1";
// SPEED=2 plays the whole recording at double speed.
const BASE_SPEED = Number(process.env.SPEED) || (LONG ? 1 : APP_CUT ? 1.5 : 1.2);
const OUT = join(root, process.env.OUT ?? (LONG ? "tickwise-demo-long" : "tickwise-demo"));
const MODEL = process.env.AI_MODEL ?? "qwen3.5:4b";
const USE_AI = process.env.NO_AI !== "1";

// The video is 1600x900: the page fills the top 1600x810 (1280x648 CSS px at 1.25x), captions the band below.
const SCALE = 1.25;
const VIEW = { width: 1280, height: 648 };
const POPUP = { width: 380, height: 600 };
const FPS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T>, timeout = 20_000): Promise<T> {
  const until = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last}` : ""}`);
}

// ── What gets recorded ──────────────────────────────────────────────

type Frame = { t: number; src: string; data: Buffer };
type Event = { t: number } & (
  | { kind: "src"; src: string }
  | { kind: "cap"; text: string }
  | { kind: "speed"; x: number; label: string }
  | { kind: "overlay"; on: boolean }
  | { kind: "card"; title: string; sub: string; foot: string; ms: number }
  | { kind: "cursor"; x: number; y: number; jump?: boolean }
  | { kind: "click"; x: number; y: number }
);
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

const frames: Frame[] = [];
const events: Event[] = [];
let recording = false;
const mark = (e: DistributiveOmit<Event, "t">) => events.push({ t: performance.now(), ...e } as Event);
const caption = (text: string) => mark({ kind: "cap", text });

// ── One local server: the app, the made-up Snapnest site, and the recorder's plumbing ──

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain",
};
let plan: unknown = null;
let resolveUpload: (v: { type: string; body: Buffer }) => void = () => {};
const uploaded = new Promise<{ type: string; body: Buffer }>((r) => (resolveUpload = r));

async function startServer(): Promise<{ port: number; close: () => void }> {
  let pages: Record<string, string> = {};
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (host !== "127.0.0.1") {
      const body = pages[`${host}${path}`];
      if (body === undefined) res.writeHead(404).end("Not found");
      else res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
      return;
    }
    if (path === "/__rec.html") return void res.writeHead(200, { "content-type": TYPES[".html"] }).end(RECORDER_HTML);
    if (path === "/__plan.json") return void res.writeHead(200, { "content-type": TYPES[".json"] }).end(JSON.stringify(plan));
    const frame = /^\/__frames\/(\d+)$/.exec(path);
    if (frame) {
      const f = frames[Number(frame[1])];
      if (!f) res.writeHead(404).end();
      else res.writeHead(200, { "content-type": "image/png" }).end(f.data);
      return;
    }
    if (path === "/__upload" && req.method === "POST") {
      const parts: Buffer[] = [];
      req.on("data", (c: Buffer) => parts.push(c));
      req.on("end", () => {
        res.writeHead(204).end();
        resolveUpload({ type: String(req.headers["content-type"] ?? ""), body: Buffer.concat(parts) });
      });
      return;
    }
    const file = normalize(join(APP_DIR, path.endsWith("/") ? path + "index.html" : path));
    if (file !== APP_DIR && !file.startsWith(APP_DIR + sep)) return void res.writeHead(403).end();
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return void res.writeHead(404).end("Not found");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  pages = site(port);
  return { port, close: () => server.close() };
}

// ── Browser helpers ─────────────────────────────────────────────────

let cdp: Cdp;
let extensionId = "";
const sources = new Map<string, string>();

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function openTab(url: string, background = false): Promise<{ targetId: string; sessionId: string }> {
  const { targetId } = await cdp.send("Target.createTarget", { url, background });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await waitFor(`${url} to load`, () => evaluate(sessionId, `document.readyState === "complete" && location.href !== "about:blank"`));
  return { targetId, sessionId };
}

/** Same size, light theme and smooth scrolling for every recorded tab. */
async function setupView(sessionId: string, size = VIEW): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: SCALE, mobile: false }, sessionId);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] }, sessionId);
  await evaluate(sessionId, `(document.documentElement.style.scrollbarWidth = "none", document.fonts.ready.then(() => true))`);
}

async function screencast(sessionId: string, src: string, size = VIEW): Promise<void> {
  sources.set(sessionId, src);
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: Math.round(size.width * SCALE), maxHeight: Math.round(size.height * SCALE), everyNthFrame: 1 }, sessionId);
}

/** Grants a host to the extension the way Site access on edge://extensions does, so the demo skips the prompt. */
async function grantHost(pattern: string): Promise<true | string> {
  const page = await openTab("edge://extensions/", true).catch(() => openTab("chrome://extensions/", true));
  try {
    return await evaluate(page.sessionId, `new Promise((resolve) => chrome.developerPrivate.addHostPermission(${JSON.stringify(extensionId)}, ${JSON.stringify(pattern)}, () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : true)))`);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
  }
}

/** Clicks the toolbar button for this tab (a real action click) and returns the popup's DOM once the report is in. */
async function popupReport(pageTargetId: string): Promise<{ html: string; sessionId: string }> {
  await cdp.send("Target.activateTarget", { targetId: pageTargetId });
  const { targetInfo: pageInfo } = await cdp.send("Target.getTargetInfo", { targetId: pageTargetId });
  const { targetInfos: tabs } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  const tab = tabs.find((t: any) => t.url === pageInfo.url);
  if (!tab) throw new Error(`No tab target for ${pageInfo.url}`);
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
  const popup = await waitFor("the popup to open", async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return targetInfos.find((t: any) => t.url.startsWith(`chrome-extension://${extensionId}/popup.html`));
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: popup.targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await waitFor("the popup report", () => evaluate(sessionId, `!!document.querySelector(".band, .error")`));
  return { html: await evaluate(sessionId, `document.body.innerHTML`), sessionId };
}

// The pointer is drawn onto the video by the recorder, from these events, so it glides smoothly at any speed.
// (Canvas px: page CSS px × SCALE, or inside the popup overlay at the top right.)
const GLIDE_MS = 1000;
function toCanvas(sessionId: string, x: number, y: number): { x: number; y: number } {
  if (sources.get(sessionId) === "popup") return { x: 1600 - Math.round(POPUP.width * SCALE) - 28 + x * SCALE, y: 14 + y * SCALE };
  return { x: x * SCALE, y: y * SCALE };
}
const pointer = (sessionId: string, x: number, y: number, jump = false) => mark({ kind: "cursor", ...toCanvas(sessionId, x, y), jump });

// An in-page cursor, now hidden: older steps still move it, harmlessly.
const CURSOR = `(() => {
  if (document.getElementById("__cursor")) return true;
  const c = document.createElement("div");
  c.id = "__cursor";
  c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 3 L4 22 L9.2 17.2 L12.6 25 L16.2 23.4 L12.8 15.8 L19.8 15.8 Z" fill="#141413" stroke="#FAF9F5" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.cssText = "display:none;position:fixed;left:${VIEW.width * 0.55}px;top:${VIEW.height * 0.6}px;width:28px;height:28px;margin:-3px 0 0 -4px;z-index:2147483647;pointer-events:none;transition:left .8s cubic-bezier(.45,0,.2,1),top .8s cubic-bezier(.45,0,.2,1)";
  document.documentElement.append(c);
  return true;
})()`;

/** Scrolls the element (a JS expression) smoothly to `offset` px from the top, or to the top of the page. */
async function scrollTo(sessionId: string, expr: string | null, offset = 20): Promise<void> {
  await evaluate(sessionId, `(() => {
    const el = ${expr ?? "null"};
    scrollTo({ top: el ? el.getBoundingClientRect().top + scrollY - ${offset} : 0, behavior: "smooth" });
    return true;
  })()`);
  await sleep(1100);
}

/** Moves the drawn cursor onto the element (scrolling it into view first if needed) and returns where it is. */
async function moveTo(sessionId: string, expr: string): Promise<{ x: number; y: number }> {
  const measure = () => evaluate(sessionId, `(() => {
    const el = ${expr};
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, x: b.left + Math.min(b.width / 2, 60), y: b.top + Math.min(b.height / 2, 18) };
  })()`);
  let r = await measure();
  if (!r) throw new Error(`Nothing to point at: ${expr}`);
  if (r.top < 40 || r.bottom > VIEW.height - 20) {
    await scrollTo(sessionId, expr, VIEW.height * 0.3);
    r = await measure();
  }
  pointer(sessionId, r.x, r.y);
  await sleep(GLIDE_MS + 100);
  return { x: r.x, y: r.y };
}

/** Moves there and clicks, with a lime ring so viewers see the click. A trusted click, like a user's. */
async function clickOn(sessionId: string, expr: string): Promise<void> {
  const { x, y } = await moveTo(sessionId, expr);
  mark({ kind: "click", ...toCanvas(sessionId, x, y) });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
}

/** A still for the slides, without the drawn cursor. Frames are paused meanwhile, so the video never shows it hidden. */
async function shot(sessionId: string, file: string): Promise<void> {
  recording = false;
  await evaluate(sessionId, `(document.getElementById("__cursor").style.visibility = "hidden", new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))).then(() => true))`);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(join(SHOTS_DIR, file), Buffer.from(data, "base64"));
  console.log(`SHOT  docs/screenshots/${file}`);
  await evaluate(sessionId, `(document.getElementById("__cursor").style.visibility = "visible", true)`);
  recording = true;
}

// ── The full walkthrough ─────────────────────────────────────────────

const TITLE = { title: "Tickwise", sub: "Know what you’re agreeing to before you tick." };

async function demo(port: number): Promise<number> {
  // Tab 1: the app, with old choices cleared and the AI model set.
  const app = await openTab(`http://127.0.0.1:${port}/`);
  const s = app.sessionId;
  await evaluate(s, `(localStorage.removeItem("tos-checker.prefs"), localStorage.setItem("tos-checker.settings", ${JSON.stringify(JSON.stringify({ aiUrl: "", aiModel: MODEL, aiMode: false }))}), true)`);
  await cdp.send("Page.reload", {}, s);
  await waitFor("the app to load", () => evaluate(s, `document.readyState === "complete" && !!document.getElementById("sample-btn")`));
  await setupView(s);
  await evaluate(s, CURSOR);
  await screencast(s, "app");
  recording = true;
  await sleep(700);

  mark({ kind: "src", src: "app" });
  pointer(s, VIEW.width * 0.55, VIEW.height * 0.6, true);
  caption("Paste the terms of service, open a file, or try a sample.");
  await sleep(1800);
  await clickOn(s, `document.getElementById("sample-btn")`);
  await sleep(1500);
  caption("Press Check. Hand-written rules and a small trained model read every sentence. No AI needed.");
  await sleep(1200);
  await clickOn(s, `document.getElementById("check-btn")`);
  await sleep(1400);
  caption("A boundary score out of 100, and how many points are high, medium and low risk.");
  await sleep(3600);
  await shot(s, "app-score.png");

  caption("Each point is in plain English, with the exact sentence it came from.");
  await scrollTo(s, `document.querySelector("#cards .card")`);
  await sleep(2800);
  caption("Click a point to find it in the document.");
  await clickOn(s, `document.querySelector("#cards .card .say")`);
  await sleep(2800);
  await shot(s, "app-flag.png");
  caption("Every point comes with a next move: Add a safeguard, Check a setting, or Tell someone.");
  await moveTo(s, `document.querySelector("#cards .card .moves dt")`);
  await sleep(900);
  await moveTo(s, `document.querySelectorAll("#cards .card .moves dt")[2]`);
  await sleep(1800);

  const share = `[...document.querySelectorAll("#cards .card")].find((c) => /share your data/.test(c.querySelector(".say")?.textContent ?? ""))`;
  caption("You set your own boundaries. Not OK makes a point a dealbreaker.");
  await scrollTo(s, share, 150);
  await sleep(500);
  await clickOn(s, `${share}?.querySelector(".choice-notok")`);
  await sleep(2000);
  await shot(s, "app-dealbreaker.png");
  caption("Dealbreakers cost extra, so the score drops. They stay marked in every terms document you check.");
  await scrollTo(s, `document.getElementById("summary")`);
  await sleep(3400);

  if (USE_AI) {
    caption(`Optional AI mode: a small model running on this laptop (${MODEL.replace("qwen3.5:", "Qwen 3.5 ").toUpperCase().replace("QWEN", "Qwen")} through Ollama).`);
    await scrollTo(s, null);
    await clickOn(s, `document.querySelector("label.switch")`);
    await sleep(1200);
    mark({ kind: "speed", x: 6, label: "6× speed while the AI reads" });
    const t0 = Date.now();
    await waitFor("the AI to finish", () => evaluate(s, `(() => { const b = document.getElementById("ai-box"); return !b.hidden && !b.classList.contains("is-loading"); })()`), 240_000);
    mark({ kind: "speed", x: 1, label: "" });
    const ok = await evaluate(s, `document.getElementById("ai-box").className === "ai-box"`);
    console.log(`AI    ${ok ? "answered" : "did not answer"} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    caption(ok ? "It writes a summary and adds points the rules missed." : "The AI didn't answer, so the rule results stay on screen.");
    await scrollTo(s, `document.getElementById("ai-box")`);
    await sleep(4200);
    if (ok) {
      await shot(s, "app-ai.png");
      const aiCard = `document.querySelector("#cards .card.is-ai")`;
      if (await evaluate(s, `!!${aiCard}`)) {
        caption("Every AI point must quote the terms word for word. If the quote isn't in the text, the point is thrown away.");
        await scrollTo(s, aiCard, 60);
        await sleep(4200);
      }
    }
  }

  // Tab 2: the extension, on the made-up Snapnest sign-up page. Its Cookie Policy is on another site, allowed beforehand.
  const granted = await grantHost(`http://${LEGAL}:${port}/*`);
  if (granted !== true) console.log(`NOTE  couldn't pre-allow ${LEGAL}: ${granted}`);
  const page = await openTab(`http://${SITE}:${port}/signup`);
  await setupView(page.sessionId);
  await evaluate(page.sessionId, CURSOR);
  await screencast(page.sessionId, "site");
  await sleep(600);
  mark({ kind: "src", src: "site" });
  pointer(page.sessionId, VIEW.width * 0.55, VIEW.height * 0.6, true);
  caption("The browser extension, on a sign-up page. (Snapnest is made up for this demo.)");
  await sleep(2800);
  caption("Click the Tickwise icon in the toolbar.");
  pointer(page.sessionId, VIEW.width - 34, 14);
  await sleep(GLIDE_MS + 100);
  mark({ kind: "speed", x: 3, label: "" });
  let popup: { html: string } | null = null;
  for (let i = 0; i < 4 && !popup; i++) popup = await popupReport(page.targetId).catch((e) => (console.log(`RETRY popup: ${e.message.slice(0, 80)}`), null));
  if (!popup) throw new Error("The popup never showed a report.");
  const { html } = popup;

  // The popup's report, redrawn at its real size in a tab of its own.
  const copy = await openTab(`chrome-extension://${extensionId}/popup.html`);
  await waitFor("popup.html as a tab", () => evaluate(copy.sessionId, `!!document.querySelector(".band, .error")`));
  await setupView(copy.sessionId, POPUP);
  await evaluate(copy.sessionId, `(document.body.innerHTML = ${JSON.stringify(html)}, document.fonts.ready.then(() => true))`);
  await screencast(copy.sessionId, "popup", POPUP);
  await waitFor("a popup frame", async () => frames.some((f) => f.src === "popup"));
  mark({ kind: "speed", x: 1, label: "" });
  mark({ kind: "overlay", on: true });
  caption("It checks the page plus the Terms, Privacy and Cookie pages it links to, in one report.");
  await sleep(4400);
  caption("Every point says which page it came from, with the same Add, Check, Tell moves.");
  await evaluate(copy.sessionId, `(scrollTo({ top: document.querySelector(".flags").getBoundingClientRect().top + scrollY - 8, behavior: "smooth" }), true)`);
  await sleep(4200);
  await evaluate(copy.sessionId, `(scrollBy({ top: 330, behavior: "smooth" }), true)`);
  await sleep(3000);

  recording = false;
  return performance.now();
}

/** The default: the browser extension only, for a slide (about 20 s). */
async function demoExtension(port: number): Promise<number> {
  const granted = await grantHost(`http://${LEGAL}:${port}/*`);
  if (granted !== true) console.log(`NOTE  couldn't pre-allow ${LEGAL}: ${granted}`);
  const page = await openTab(`http://${SITE}:${port}/signup`);
  const s = page.sessionId;
  await setupView(s);
  await evaluate(s, CURSOR);
  await screencast(s, "site");
  recording = true;
  await sleep(700);

  mark({ kind: "src", src: "site" });
  mark({ kind: "card", ...TITLE, foot: "A browser extension", ms: 1600 });
  caption("Signing up for an app? Before you tick “I agree”…");
  await moveTo(s, `document.querySelector("input[type=checkbox]")`);
  await sleep(1100);
  caption("…click the Tickwise icon in your browser’s toolbar.");
  await evaluate(s, `(() => { const c = document.getElementById("__cursor"); c.style.left = "${VIEW.width - 34}px"; c.style.top = "14px"; return true; })()`);
  await sleep(1300);
  mark({ kind: "speed", x: 10, label: "" });

  // The real popup reads the page and its linked pages. Its report, and the report after Not OK, are redrawn below.
  let popup: { html: string; sessionId: string } | null = null;
  console.log("STEP  opening the popup");
  for (let i = 0; i < 4 && !popup; i++) popup = await popupReport(page.targetId).catch((e) => (console.log(`RETRY popup: ${e.message.slice(0, 80)}`), null));
  if (!popup) throw new Error("The popup never showed a report.");
  console.log("STEP  popup report read, clicking Not OK");
  const notOk = await evaluate(popup!.sessionId, `(() => {
    const el = document.querySelector(".card .choice-notok");
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: notOk.x, y: notOk.y, button: "left", clickCount: 1 }, popup.sessionId);
  }
  await waitFor("the dealbreaker", () => evaluate(popup.sessionId, `!!document.querySelector(".card.is-dealbreaker")`));
  const after = await evaluate(popup.sessionId, `document.body.innerHTML`);
  console.log("STEP  dealbreaker read, redrawing the popup");

  const copy = await openTab(`chrome-extension://${extensionId}/popup.html`);
  const c = copy.sessionId;
  await waitFor("popup.html as a tab", () => evaluate(c, `!!document.querySelector(".band, .error")`));
  await setupView(c, POPUP);
  await evaluate(c, `(document.body.innerHTML = ${JSON.stringify(popup.html)}, document.fonts.ready.then(() => true))`);
  await evaluate(c, CURSOR.replace(`left:${VIEW.width * 0.55}px;top:${VIEW.height * 0.6}px`, "left:340px;top:-40px"));
  await screencast(c, "popup", POPUP);
  await waitFor("a popup frame", async () => frames.some((f) => f.src === "popup"));
  mark({ kind: "speed", x: 1, label: "" });
  mark({ kind: "overlay", on: true });
  caption("It checks the page and the Terms, Privacy and Cookie pages it links to: one score.");
  await sleep(3400);

  caption("Each point in plain English, with the exact sentence and the page it came from.");
  await evaluate(c, `(scrollTo({ top: document.querySelector(".flags").getBoundingClientRect().top + scrollY - 8, behavior: "smooth" }), true)`);
  await sleep(3300);

  caption("Not OK makes it a dealbreaker, and the score drops.");
  const btn = await evaluate(c, `(() => { const r = document.querySelector(".card .choice-notok").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await evaluate(c, `(() => { const k = document.getElementById("__cursor"); k.style.left = "${btn.x}px"; k.style.top = "${btn.y}px"; return true; })()`);
  await sleep(1000);
  await evaluate(c, `(() => {
    const y = scrollY;
    document.body.innerHTML = ${JSON.stringify(after)};
    scrollTo(0, y);
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;left:${btn.x}px;top:${btn.y}px;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(225,234,164,.7);border:2px solid #9DB33A;pointer-events:none;z-index:2147483646";
    document.documentElement.append(r);
    r.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.25)", opacity: 0 }], { duration: 650, easing: "ease-out" }).finished.then(() => r.remove());
    return true;
  })()`);
  await sleep(1400);
  await evaluate(c, `(scrollTo({ top: 0, behavior: "smooth" }), true)`);
  await sleep(2600);

  mark({ kind: "card", ...TITLE, foot: "Not legal advice", ms: 1800 });
  recording = false;
  return performance.now();
}

/** The same steps as demo(), with short captions and short holds, for a slide (about 25 s). */
async function demoShort(port: number): Promise<number> {
  const app = await openTab(`http://127.0.0.1:${port}/`);
  const s = app.sessionId;
  await evaluate(s, `(localStorage.removeItem("tos-checker.prefs"), localStorage.setItem("tos-checker.settings", ${JSON.stringify(JSON.stringify({ aiUrl: "", aiModel: MODEL, aiMode: false }))}), true)`);
  await cdp.send("Page.reload", {}, s);
  await waitFor("the app to load", () => evaluate(s, `document.readyState === "complete" && !!document.getElementById("sample-btn")`));
  await setupView(s);
  await evaluate(s, CURSOR);
  await screencast(s, "app");
  recording = true;
  await sleep(700);

  mark({ kind: "src", src: "app" });
  mark({ kind: "card", ...TITLE, foot: "A terms of service checker", ms: 1500 });
  caption("Paste the terms, or try a sample.");
  await clickOn(s, `document.getElementById("sample-btn")`);
  await sleep(500);
  caption("One click: a boundary score out of 100.");
  await clickOn(s, `document.getElementById("check-btn")`);
  await sleep(2600);
  await shot(s, "app-score.png");

  caption("Every point quotes the exact sentence, with a next move.");
  await scrollTo(s, `document.querySelector("#cards .card")`);
  await sleep(700);
  await clickOn(s, `document.querySelector("#cards .card .say")`);
  await sleep(1500);
  await shot(s, "app-flag.png");

  const share = `[...document.querySelectorAll("#cards .card")].find((c) => /share your data/.test(c.querySelector(".say")?.textContent ?? ""))`;
  caption("Mark it Not OK, and the score drops.");
  await scrollTo(s, share, 150);
  await clickOn(s, `${share}?.querySelector(".choice-notok")`);
  await sleep(800);
  await shot(s, "app-dealbreaker.png");
  await scrollTo(s, `document.getElementById("summary")`);
  await sleep(1300);

  if (USE_AI) {
    caption("Optional AI mode, on this laptop. Every AI point must quote the terms.");
    await scrollTo(s, null);
    await clickOn(s, `document.querySelector("label.switch")`);
    await sleep(400);
    mark({ kind: "speed", x: 15, label: "Fast-forward" });
    const t0 = Date.now();
    await waitFor("the AI to finish", () => evaluate(s, `(() => { const b = document.getElementById("ai-box"); return !b.hidden && !b.classList.contains("is-loading"); })()`), 240_000);
    mark({ kind: "speed", x: 1, label: "" });
    const ok = await evaluate(s, `document.getElementById("ai-box").className === "ai-box"`);
    console.log(`AI    ${ok ? "answered" : "did not answer"} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await scrollTo(s, `document.getElementById("ai-box")`);
    await sleep(2000);
    if (ok) await shot(s, "app-ai.png");
  }

  const granted = await grantHost(`http://${LEGAL}:${port}/*`);
  if (granted !== true) console.log(`NOTE  couldn't pre-allow ${LEGAL}: ${granted}`);
  const page = await openTab(`http://${SITE}:${port}/signup`);
  await setupView(page.sessionId);
  await evaluate(page.sessionId, CURSOR);
  await screencast(page.sessionId, "site");
  await sleep(600);
  mark({ kind: "src", src: "site" });
  caption("The browser extension checks the page and the terms it links to.");
  await sleep(900);
  await evaluate(page.sessionId, `(() => { const c = document.getElementById("__cursor"); c.style.left = "${VIEW.width - 34}px"; c.style.top = "14px"; return true; })()`);
  await sleep(1000);
  mark({ kind: "speed", x: 8, label: "" });
  const { html } = await popupReport(page.targetId);
  const copy = await openTab(`chrome-extension://${extensionId}/popup.html`);
  await waitFor("popup.html as a tab", () => evaluate(copy.sessionId, `!!document.querySelector(".band, .error")`));
  await setupView(copy.sessionId, POPUP);
  await evaluate(copy.sessionId, `(document.body.innerHTML = ${JSON.stringify(html)}, document.fonts.ready.then(() => true))`);
  await screencast(copy.sessionId, "popup", POPUP);
  await waitFor("a popup frame", async () => frames.some((f) => f.src === "popup"));
  mark({ kind: "speed", x: 1, label: "" });
  mark({ kind: "overlay", on: true });
  await sleep(2600);
  await evaluate(copy.sessionId, `(scrollTo({ top: document.querySelector(".flags").getBoundingClientRect().top + scrollY - 8, behavior: "smooth" }), true)`);
  await sleep(1900);

  mark({ kind: "card", ...TITLE, foot: "Not legal advice", ms: 1800 });
  recording = false;
  return performance.now();
}

// ── Turning frames and events into one frame list at 30 fps ─────────

function buildPlan(end: number) {
  const bySrc = new Map<string, number[]>();
  frames.forEach((f, i) => {
    if (!bySrc.has(f.src)) bySrc.set(f.src, []);
    bySrc.get(f.src)!.push(i);
  });
  /** The newest frame of `src` at wall time w, or its first one if none has arrived yet. */
  const latest = (src: string, w: number): number => {
    const list = bySrc.get(src);
    if (!list?.length) return -1;
    let lo = 0, hi = list.length - 1, best = list[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[list[mid]].t <= w) (best = list[mid]), (lo = mid + 1);
      else hi = mid - 1;
    }
    return best;
  };
  const evs = [...events].sort((a, b) => a.t - b.t);
  const out: any[] = [];
  let src = "", cap = "", chip = "", speed = 1, overlay = false, ei = 0;
  type Glide = { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number };
  let cur: Glide | null = null;
  let ring: { x: number; y: number; t0: number } | null = null;
  /** Where the pointer is at wall time w: an eased glide from where it was to where it's going. */
  const at = (c: Glide, w: number): [number, number] => {
    const k = c.dur ? Math.min(1, Math.max(0, (w - c.t0) / c.dur)) : 1;
    const e = 0.5 - Math.cos(Math.PI * k) / 2;
    return [c.fx + (c.tx - c.fx) * e, c.fy + (c.ty - c.fy) * e];
  };
  const apply = (e: Event) => {
    if (e.kind === "cursor") {
      const [fx, fy] = cur && !e.jump ? at(cur, e.t) : [e.x, e.y];
      cur = { fx, fy, tx: e.x, ty: e.y, t0: e.t, dur: e.jump ? 0 : GLIDE_MS };
    } else if (e.kind === "click") ring = { x: e.x, y: e.y, t0: e.t };
    else if (e.kind === "src") src = e.src;
    else if (e.kind === "cap") cap = e.text;
    else if (e.kind === "speed") (speed = e.x), (chip = e.label);
    else if (e.kind === "overlay") overlay = e.on;
    else {
      const n = Math.round((e.ms / 1000) * FPS);
      for (let k = 0; k < n; k++) out.push({ card: [e.title, e.sub, e.foot], k, n });
    }
  };
  for (let w = evs[0].t; w < end; w += (1000 / FPS) * speed * BASE_SPEED) {
    while (ei < evs.length && evs[ei].t <= w) apply(evs[ei++]);
    const m = cur ? at(cur, w).map((v) => Math.round(v * 10) / 10) : null;
    const r = ring && w - ring.t0 < 650 ? [ring.x, ring.y, (w - ring.t0) / 650] : null;
    out.push({ p: latest(src, w), o: overlay ? latest("popup", w) : -1, c: cap, s: chip, m, r });
  }
  while (ei < evs.length) apply(evs[ei++]);
  return { fps: FPS, frames: out };
}

// The recorder page: draws each planned frame with its caption and records the canvas in real time.
const RECORDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>recorder</title><style>
@font-face { font-family: "Redaction 10"; src: url("/fonts/redaction-10-latin-400-normal.woff2") format("woff2"); }
@font-face { font-family: "Redaction"; src: url("/fonts/redaction-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "Mono Local"; src: url("/fonts/IBMPlexMono-600.woff2") format("woff2"); font-weight: 600; }
html, body { margin: 0; background: #141413; }
</style></head><body><canvas id="c" width="1600" height="900"></canvas><script type="module">
const W = 1600, H = 900, PH = 810;
const INK = "#141413", IVORY = "#FAF9F5", SLATE = "#5E5D59", LIME = "#E1EAA4", TICK = "#9DB33A";
const c = document.getElementById("c"), g = c.getContext("2d");
const ARROW = new Path2D("M4 3 L4 22 L9.2 17.2 L12.6 25 L16.2 23.4 L12.8 15.8 L19.8 15.8 Z");
await Promise.all(['400 40px "Redaction 10"', '400 30px "Redaction"', '600 16px "Mono Local"'].map((f) => document.fonts.load(f)));
const { fps, frames } = await (await fetch("/__plan.json")).json();

const lastUse = new Map();
frames.forEach((f, k) => { if (f.p >= 0) lastUse.set(f.p, k); if (f.o >= 0) lastUse.set(f.o, k); });
const cache = new Map();
const get = (i) => {
  if (!cache.has(i)) cache.set(i, fetch("/__frames/" + i).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  return cache.get(i);
};
const prefetch = (k) => { for (let j = k; j < Math.min(frames.length, k + 60); j++) { const f = frames[j]; if (f.p >= 0) get(f.p); if (f.o >= 0) get(f.o); } };
const evict = (k) => { for (const [i, p] of cache) if ((lastUse.get(i) ?? -1) < k) { cache.delete(i); p.then((b) => b.close()); } };

function logo(x, y, s, stroke) {
  g.save(); g.translate(x, y); g.scale(s / 32, s / 32);
  g.beginPath(); g.roundRect(2, 2, 28, 28, 4); g.lineWidth = 2.5; g.strokeStyle = stroke; g.stroke();
  g.beginPath(); g.moveTo(8, 16.5); g.lineTo(13.5, 22); g.lineTo(24, 10.5);
  g.lineWidth = 3.5; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = TICK; g.stroke();
  g.restore();
}
function wrap(text, max) {
  const lines = []; let line = "";
  for (const word of text.split(" ")) {
    const next = line ? line + " " + word : word;
    if (g.measureText(next).width > max && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function caption(text, chip) {
  g.fillStyle = INK; g.fillRect(0, PH, W, H - PH);
  logo(40, PH + 27, 36, IVORY);
  let right = W - 40;
  if (chip) {
    g.font = '600 15px "Mono Local"'; g.letterSpacing = "1.5px";
    const t = chip.toUpperCase(), w = g.measureText(t).width + 32;
    g.fillStyle = LIME; g.beginPath(); g.roundRect(right - w, PH + 27, w, 36, 18); g.fill();
    g.fillStyle = INK; g.textBaseline = "middle"; g.fillText(t, right - w + 16, PH + 46);
    g.letterSpacing = "0px"; right -= w + 24;
  }
  const x = 100, max = right - x;
  g.font = '400 30px "Redaction"'; let lines = wrap(text, max);
  if (lines.length > 1) { g.font = '400 25px "Redaction"'; lines = wrap(text, max).slice(0, 2); }
  g.fillStyle = IVORY; g.textBaseline = "middle";
  if (lines.length === 1) g.fillText(lines[0], x, PH + 46);
  else if (lines.length > 1) { g.fillText(lines[0], x, PH + 31); g.fillText(lines[1], x, PH + 62); }
}
function card([title, sub, foot], k, n) {
  g.fillStyle = IVORY; g.fillRect(0, 0, W, H);
  g.globalAlpha = Math.max(0, Math.min(1, k / 12, (n - k) / 12));
  logo(150, 268, 112, INK);
  g.fillStyle = INK; g.textBaseline = "alphabetic"; g.font = '400 132px "Redaction 10"'; g.fillText(title, 300, 372);
  g.font = '400 44px "Redaction"';
  const w = g.measureText(sub).width;
  g.fillStyle = LIME; g.fillRect(150, 448, w + 24, 62);
  g.fillStyle = INK; g.fillText(sub, 162, 494);
  g.font = '600 17px "Mono Local"'; g.letterSpacing = "2px"; g.fillStyle = SLATE; g.fillText(foot.toUpperCase(), 152, 640); g.letterSpacing = "0px";
  g.globalAlpha = 1;
}
async function draw(f) {
  if (f.card) return card(f.card, f.k, f.n);
  g.fillStyle = IVORY; g.fillRect(0, 0, W, PH);
  if (f.p >= 0) { const b = await get(f.p); g.drawImage(b, 0, 0, W, b.height * W / b.width); }
  if (f.o >= 0) {
    const b = await get(f.o), x = W - b.width - 28, y = 14;
    g.save(); g.shadowColor = "rgba(20,20,19,.35)"; g.shadowBlur = 40; g.shadowOffsetY = 14; g.fillStyle = IVORY; g.fillRect(x, y, b.width, b.height); g.restore();
    g.drawImage(b, x, y);
    g.strokeStyle = "rgba(20,20,19,.3)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, b.width - 1, b.height - 1);
  }
  if (f.r) {
    const [x, y, k] = f.r;
    g.save(); g.globalAlpha = 1 - k; g.beginPath(); g.arc(x, y, 29 * (0.3 + 0.95 * k), 0, Math.PI * 2);
    g.fillStyle = "rgba(225,234,164,.7)"; g.fill(); g.lineWidth = 2.5; g.strokeStyle = TICK; g.stroke(); g.restore();
  }
  if (f.m) {
    const [x, y] = f.m;
    g.save(); g.translate(x - 5, y - 3.75); g.scale(1.25, 1.25);
    g.fillStyle = INK; g.fill(ARROW); g.strokeStyle = IVORY; g.lineWidth = 1.6; g.lineJoin = "round"; g.stroke(ARROW); g.restore();
  }
  caption(f.c, f.s);
}

const types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 40_000_000 });
const chunks = [];
rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
const stopped = new Promise((r) => (rec.onstop = r));
prefetch(0);
await Promise.all([...cache.values()]);
await draw(frames[0]);
rec.start(1000);
const start = performance.now();
let late = 0;
for (let k = 0; k < frames.length; k++) {
  prefetch(k);
  await draw(frames[k]);
  track.requestFrame();
  evict(k);
  const wait = start + ((k + 1) * 1000) / fps - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait)); else late++;
  if (k % 30 === 0) document.title = "recording " + k + "/" + frames.length;
}
rec.stop();
await stopped;
await fetch("/__upload", { method: "POST", headers: { "content-type": mime, "x-late": String(late) }, body: new Blob(chunks, { type: mime }) });
document.title = "done";
</script></body></html>`;

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(join(EXTENSION_DIR, "manifest.json")) || !existsSync(join(APP_DIR, "index.html"))) {
    throw new Error("dist/ is missing. Run `npm run build` first.");
  }
  mkdirSync(SHOTS_DIR, { recursive: true });
  const { port, close } = await startServer();
  const profile = mkdtempSync(join(tmpdir(), "tickwise-rec-"));
  const args = [
    process.env.HEADED === "1" ? "" : "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--hide-scrollbars",
    "--window-size=1600,900",
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${LEGAL} 127.0.0.1`,
    "about:blank",
  ].filter(Boolean);
  const browser: ChildProcess = spawn(findBrowser(), args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  cdp = new Cdp(browser.stdio[3] as Writable, browser.stdio[4] as Readable);
  cdp.on((m) => {
    if (m.method !== "Page.screencastFrame" || !m.sessionId) return;
    cdp.send("Page.screencastFrameAck", { sessionId: m.params.sessionId }, m.sessionId).catch(() => {});
    const src = sources.get(m.sessionId);
    if (src && recording) frames.push({ t: performance.now(), src, data: Buffer.from(m.params.data, "base64") });
  });

  try {
    console.log(`Running: ${(await cdp.send("Browser.getVersion")).product}`);
    ({ id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: EXTENSION_DIR }));
    const end = await (LONG ? demo(port) : APP_CUT ? demoShort(port) : demoExtension(port));
    plan = buildPlan(end);
    const n = (plan as any).frames.length;
    console.log(`PLAN  ${frames.length} captured frames -> ${n} video frames (${(n / FPS).toFixed(0)} s). Encoding in real time...`);

    const rec = await openTab(`http://127.0.0.1:${port}/__rec.html`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, rec.sessionId);
    const timeout = sleep((n / FPS) * 1000 + 120_000).then(() => {
      throw new Error("The recorder didn't finish in time.");
    });
    const video = await Promise.race([uploaded, timeout]);
    const ext = video.type.startsWith("video/mp4") ? "mp4" : "webm";
    writeFileSync(`${OUT}.${ext}`, video.body);
    console.log(`VIDEO ${OUT}.${ext}  ${(video.body.length / 1e6).toFixed(1)} MB, ${video.type}`);
  } finally {
    await cdp.send("Browser.close").catch(() => browser.kill());
    await new Promise((r) => (browser.exitCode !== null ? r(null) : browser.once("exit", r)));
    close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

await main();
