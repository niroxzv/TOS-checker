// Checks the Firefox build in a real Firefox. No dependencies.
//
//   npm run build
//   npm run test:firefox      # same as: node scripts/test-firefox.ts
//
// 1. Serves the same fictional sign-up page as scripts/test-extension.ts (network.dns.localDomains points the
//    names at this machine) and starts Firefox headless with a throwaway profile.
// 2. Installs dist/firefox as a temporary add-on over WebDriver BiDi (webExtension.install).
// 3. Clicks Tickwise's toolbar action from the browser window (triggerAction, what a toolbar click runs, so
//    activeTab applies). This needs system access: --remote-allow-system-access and MOZ_REMOTE_ALLOW_SYSTEM_ACCESS.
// 4. Reads the popup through a frame script, presses Show on page, and checks the highlight in the tab.
//
// Shorter than the Edge test: Allow, Not OK, selected text and terms changes run the same code, tested there.
//
// Env: FIREFOX=<path to firefox.exe>   HEADED=1 to watch it
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGAL, SITE, site as sitePages } from "./test-extension.ts";

const root = join(import.meta.dirname, "..");
const EXTENSION_DIR = join(root, "dist", "firefox");
const ADDON_ID = "tickwise@niroxzv";
const UUID = "6b1f7a52-3c4e-4d8a-9f0e-2a7d5c1b9e44";
const TIMEOUT = 30_000;

const results: { ok: boolean; name: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findFirefox(): string {
  const local = process.env.LOCALAPPDATA ?? "";
  const found = [
    process.env.FIREFOX,
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    join(local, "Microsoft", "WindowsApps", "firefox.exe"), // Microsoft Store install
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "/usr/bin/firefox",
  ].find((p) => p && exists(p));
  if (!found) throw new Error("No Firefox found. Set FIREFOX to its path.");
  return found;
}

/** existsSync can't follow the Microsoft Store's app aliases, so look at the link itself too. */
function exists(path: string): boolean {
  try {
    return existsSync(path) || !!lstatSync(path);
  } catch {
    return false;
  }
}

/** WebDriver BiDi over a WebSocket (Node has one built in). */
class Bidi {
  #next = 0;
  #pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  events: { method: string; params: any }[] = [];
  ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === "event") return void this.events.push(msg);
      const call = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.type === "error") call?.reject(new Error(`${msg.error}: ${msg.message}`));
      else call?.resolve(msg.result);
    });
  }
  send(method: string, params: object = {}, timeout = TIMEOUT): Promise<any> {
    const id = ++this.#next;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeout);
      this.#pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
    });
  }
  /** Runs an expression in the tab and returns its JSON value. */
  async json(context: string, expression: string): Promise<any> {
    const r = await this.send("script.evaluate", { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context }, awaitPromise: true });
    if (r.type === "exception") throw new Error(r.exceptionDetails.text);
    return JSON.parse(r.result.value ?? "null");
  }
}

type Started = { proc: ChildProcess; profile: string; bidi: Bidi };

/**
 * Starts Firefox with a throwaway profile and opens a WebDriver BiDi session. Firefox 159 sometimes never
 * finishes starting with a new profile (session.new gets no answer, seen in about half the starts on the
 * test PC). A good start answers in about 2 seconds, so after 15 it's stopped and started again.
 */
async function launch(firefox: string): Promise<Started> {
  for (let attempt = 1; ; attempt++) {
    const profile = mkdtempSync(join(tmpdir(), "tickwise-firefox-"));
    // A fixed internal id, so the popup's moz-extension:// address is known in advance.
    writeFileSync(
      join(profile, "user.js"),
      [
        `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [ADDON_ID]: UUID }))});`,
        `user_pref("browser.shell.checkDefaultBrowser", false);`,
        `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
        // The test site's names point at this machine, over plain http.
        `user_pref("network.dns.localDomains", "${SITE}, ${LEGAL}");`,
        `user_pref("dom.security.https_first", false);`,
      ].join("\n"),
    );
    const port = 9300 + Math.floor(Math.random() * 500);
    // System access lets the test click Tickwise's toolbar action from the browser window, as a user would.
    const args = ["--remote-debugging-port", String(port), "--remote-allow-system-access", "--profile", profile, "--no-remote", "about:blank"];
    if (process.env.HEADED !== "1") args.unshift("--headless");
    const proc = spawn(firefox, args, { stdio: "ignore", env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });
    try {
      const bidi = new Bidi(await connect(`ws://127.0.0.1:${port}/session`));
      await bidi.send("session.new", { capabilities: {} }, 15_000);
      console.log(`Profile: ${profile}`);
      return { proc, profile, bidi };
    } catch (err) {
      await stop({ proc, profile });
      if (attempt === 5) throw err;
      console.log(`Firefox didn't finish starting (${err instanceof Error ? err.message : err}); starting it again.`);
    }
  }
}

/** Waits for Firefox to quit (or ends it and its child processes), then deletes the profile. */
async function stop({ proc, profile }: { proc: ChildProcess; profile: string }): Promise<void> {
  if (proc.exitCode === null) await Promise.race([new Promise((r) => proc.once("exit", r)), sleep(5000)]);
  if (proc.exitCode === null) {
    if (process.platform === "win32" && proc.pid) spawnSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
    else proc.kill("SIGKILL");
    await sleep(500);
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

async function main(): Promise<void> {
  if (!existsSync(join(EXTENSION_DIR, "manifest.json"))) throw new Error("dist/firefox is missing. Run `npm run build` first.");
  const firefox = findFirefox();
  const site = await startSite();
  console.log(`Firefox: ${firefox}`);

  let started: Started | null = null;
  let bidi: Bidi | null = null;
  try {
    started = await launch(firefox);
    bidi = started.bidi;
    const { product } = await bidi.send("session.status").catch(() => ({ product: "" }));
    await bidi.send("session.subscribe", { events: ["log.entryAdded"] });

    const { extension } = await bidi.send("webExtension.install", { extensionData: { type: "path", path: EXTENSION_DIR } });
    check("Firefox installs the add-on (manifest accepted)", extension === ADDON_ID, `${extension}${product ? `, ${product}` : ""}`);

    const { contexts } = await bidi.send("browsingContext.getTree");
    const context = contexts[0].context;
    await bidi.send("browsingContext.navigate", { context, url: `http://${SITE}:${site.port}/signup`, wait: "complete" });
    // The browser window itself (needs system access), where the toolbar action lives.
    const chrome = (await bidi.send("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
    const b = bidi;
    const action = `ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent`;
    const actionFor = `${action}.apiManager.global.browserActionFor(${action}.GlobalManager.getExtension(${JSON.stringify(ADDON_ID)}))`;
    /** Runs `body` (which can use `doc`, the popup's document) inside the open popup, through a frame script. */
    const inPopup = (body: string) =>
      b.json(chrome, `new Promise((resolve, reject) => {
        const popup = [...document.querySelectorAll("browser")].find((x) => (x.currentURI?.spec || "").startsWith("moz-extension://${UUID}/popup.html"));
        if (!popup) return reject(new Error("The popup isn't open"));
        const mm = popup.messageManager;
        const done = (msg) => { mm.removeMessageListener("tickwise-test", done); resolve(msg.data); };
        mm.addMessageListener("tickwise-test", done);
        const script = "(async () => { const doc = content.document; " + ${JSON.stringify(body)} + " })()"
          + ".then((v) => sendAsyncMessage('tickwise-test', v), (e) => sendAsyncMessage('tickwise-test', { error: String(e) }));";
        mm.loadFrameScript("data:application/javascript," + encodeURIComponent(script), false);
        setTimeout(() => reject(new Error("The popup didn't answer")), 10000);
      })`);

    // 1. Click Tickwise's toolbar action on the sign-up page, the way a toolbar click does (it grants activeTab).
    await bidi.json(chrome, `(${actionFor}.triggerAction(window), true)`);
    let report: any = null;
    const until = Date.now() + TIMEOUT;
    while (Date.now() < until && !(report && report.score)) {
      report = await inPopup(`return {
        score: doc.querySelector(".band .num")?.firstChild?.textContent,
        docs: [...doc.querySelectorAll(".docs li")].map((li) => li.querySelector("strong").textContent + ": " + (li.querySelector(".watch")?.textContent || "")),
        cards: doc.querySelectorAll(".card").length,
        show: [...doc.querySelectorAll("button.show")].map((x) => x.textContent),
        unread: [...doc.querySelectorAll(".links li strong")].map((x) => x.textContent),
        error: doc.querySelector(".error")?.textContent,
      }`).catch(() => null);
      if (!(report && report.score)) await sleep(300);
    }
    check("toolbar click opens the popup with a report", !!report?.score && report.cards > 0, report ? `score ${report.score}, ${report.cards} flags${report.error ? `, ${report.error}` : ""}` : "no popup");
    check("it read this page and the Privacy Policy", ["This page: First check", "Privacy Policy: First check"].every((d) => report?.docs.includes(d)), report?.docs.join(" | "));
    check("flags have Show on page / Open and show", report?.show.includes("Show on page") && report?.show.includes("Open and show"));
    check("the Cookie Policy on another site waits for Allow", report?.unread.join() === "Cookie Policy", report?.unread.join());
    const badge = await bidi.json(chrome, `({ text: ${actionFor}.action.getProperty(gBrowser.selectedTab, "badgeText"), title: ${actionFor}.action.getProperty(gBrowser.selectedTab, "title") })`);
    check("toolbar badge shows the high-risk count", badge.text === "4", `"${badge.text}", "${badge.title}"`);

    // 2. Show on page, pressed in the popup: the sentence is highlighted in the tab.
    await inPopup(`const card = [...doc.querySelectorAll(".card")].find((c) => c.querySelector(".source").textContent === "From: This page" && /binding individual arbitration/.test(c.querySelector(".quote").title || c.querySelector(".quote").textContent));
      card.querySelector("button.show").click();
      return true;`);
    await sleep(1500);
    const shown = await bidi.json(context, `(() => {
      const h = window.CSS && CSS.highlights && CSS.highlights.get("tickwise");
      const range = h && h.size ? [...h][0] : getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
      if (!range) return null;
      const box = range.getBoundingClientRect();
      return { how: h && h.size ? "highlight" : "selection", text: range.toString().replace(/\\s+/g, " ").trim(), visible: box.top >= 0 && box.bottom <= innerHeight };
    })()`);
    check("Show on page highlights the sentence", /^Any dispute arising .* class action\.$/.test(shown?.text ?? ""), shown ? `${shown.how}: ${shown.text.slice(0, 60)}…` : "nothing");
    check("and scrolls it into view", !!shown?.visible);

    // 3. Errors from the popup and the injected scripts. Firefox logs the blocked cross-origin read of the Cookie
    //    Policy, which is expected (it's the page listed under Allow), so that one doesn't count.
    const errors = await bidi.json(chrome, `Services.console.getMessageArray()
      .filter((m) => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag) && /moz-extension:/.test(m.sourceName + m.errorMessage))
      .map((m) => m.errorMessage)
      .filter((text) => !/^Cross-Origin Request Blocked/.test(text))`);
    const logged = bidi.events.filter((e) => e.method === "log.entryAdded" && e.params.level === "error").map((e) => String(e.params.text)).filter((text) => !/^Cross-Origin Request Blocked/.test(text));
    check("no errors from the add-on", errors.length === 0 && logged.length === 0, [...errors, ...logged].join(" | "));
  } catch (err) {
    check("test ran to the end", false, err instanceof Error ? err.message : String(err));
  } finally {
    await bidi?.send("browser.close").catch(() => {});
    if (started) await stop(started);
    site.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

/** The same fictional sign-up site as the Edge test. */
async function startSite(): Promise<{ port: number; close: () => void }> {
  let pages: Record<string, string> = {};
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const body = pages[`${host}${new URL(req.url ?? "/", "http://x").pathname}`];
    if (body === undefined) res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    else res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  pages = sitePages(port);
  return { port, close: () => server.close() };
}

/** Firefox takes a moment to open its debugging port. */
async function connect(url: string): Promise<WebSocket> {
  const until = Date.now() + TIMEOUT;
  for (;;) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => resolve(ws));
        ws.addEventListener("error", () => reject(new Error(`Can't connect to ${url}`)));
      });
    } catch (err) {
      if (Date.now() > until) throw err;
      await sleep(300);
    }
  }
}

if (import.meta.main) await main();
