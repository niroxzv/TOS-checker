# Browser extension (Firefox, Edge, Chrome)

The extension checks the terms of service on the page you're on, plus its linked Terms, Privacy and Cookie pages, using the same rule engine as the rest of the app (`src/engine.ts`). Not legal advice.

![The popup on a sign-up page](screenshots/extension-in-context.png)

## Install it

Build it first with `npm run build`. That writes two folders:

- `dist/firefox` for Firefox
- `dist/extension` for Edge and Chrome

### Firefox, to try it (removed when Firefox closes)

1. Open **about:debugging#/runtime/this-firefox**.
2. Click **Load Temporary Add-on…** and choose `dist/firefox/manifest.json`.
3. Click the puzzle-piece (Extensions) button in the toolbar. Next to **Tickwise**, open the gear menu and choose **Pin to Toolbar**.
4. Open any sign-up page, terms of service or privacy policy, and click the **Tickwise** icon.

Release Firefox only keeps add-ons that Mozilla has signed. A temporary add-on goes away when Firefox restarts, so for everyday use, publish it (below).

### Firefox, to keep it (like any add-on from the store)

Publishing on addons.mozilla.org (AMO) is free. Mozilla signs the add-on, and Firefox then installs it with one click and updates it by itself.

1. Run `npm run pack:firefox`. It writes `tickwise-firefox.zip`, with `manifest.json` at the top of the zip as AMO wants.
2. Run `npm run pack:source` (after committing). It writes `tickwise-source.zip` from git. AMO asks for the source when the uploaded code was produced by a build step; here the build strips the TypeScript types.
3. Sign in at https://addons.mozilla.org/developers/ with a Mozilla account (free) and choose **Submit a New Add-on**.
4. Pick **On this site** to list it publicly, or **On your own** to get a signed `.xpi` that only you install.
5. Upload `tickwise-firefox.zip`. AMO's validator runs on it.
6. When asked whether the build used a generator or transpiler, say yes and upload `tickwise-source.zip`. Build notes for the reviewer: "Node 22.18 or newer (built with Node 24.16.0), no npm install needed. Run `npm run build`; the add-on is in `dist/firefox`. `src/model-weights.ts` holds the weights of a logistic-regression model trained by `eval/train-model.py`."
7. Fill in the listing (name, summary, category, screenshots from `docs/screenshots/`) and submit.

Things to check before submitting:

- **Add-on ID.** `extension/manifest.firefox.json` sets it to `tickwise@niroxzv`. It can't change after the first upload, so change it first if you want a different one.
- **Data collection.** The same file declares `"data_collection_permissions": { "required": ["none"] }`, meaning the add-on sends nothing to its developer or anyone else. That matches the code: it has no server, and the only requests it makes are for up to 8 legal-looking pages linked from the page you're checking: pages on the same site when you click the icon, pages on other sites only after you click Allow, all sent without cookies or a referrer (see "Linked pages" below). It's still your declaration to Mozilla, so read it before you submit.
- **Version.** Each upload needs a higher `version` in `extension/manifest.json`.

#### Just for yourself ("On your own")

Pick **On your own** in step 4 and skip step 7: there's no public listing, and nobody can find or install it from AMO. Mozilla signs it (usually within 24 hours) and gives you a `.xpi` to drag into Firefox; it stays installed. Signing still means accepting Mozilla's [Add-on Distribution Agreement](https://extensionworkshop.com/documentation/publish/firefox-add-on-distribution-agreement/) and [Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/), and Mozilla may review the code later. Keep the `.xpi` to yourself.

How Tickwise meets the policies, checked against them on 9 November 2026:

| Policy | Tickwise |
|---|---|
| 3.1 Reviewable source | Type-stripped, not minified or obfuscated; `tickwise-source.zip` and the build notes above. No third-party libraries. Fonts (Redaction, MCKL; IBM Plex Mono, IBM) are under the SIL Open Font License, with both copyright notices in `fonts/OFL-LICENSE.txt`. |
| 4 Only needed permissions | `activeTab` and `scripting` read the page you click on, `storage` keeps your Not OK choices. Other sites are optional, asked for one at a time when you click Allow. |
| 4 No remote code | Everything is bundled. Fetched pages are parsed as inert HTML (`DOMParser`, nothing runs) and shown only as text. |
| 4 Performance | Each linked page is read up to 3 MB and 10 seconds, then cut off. Nothing runs in the background. |
| 6 Data transmission | Nothing is sent to the developer or anyone else. The only requests are for terms pages linked from the page, without cookies or a referrer: same-site ones when you click the icon, other sites only after you click Allow for that site. Declared as `"none"`. |
| 6.3 Private browsing | In a private window, Tickwise doesn't save which sites you checked. |

Notes for the reviewer (paste into the "Notes to reviewer" box):

> Personal-use add-on, self-distributed. Build: Node 22.18 or newer (built with Node 24.16.0), no npm install needed; run `npm run build`, the add-on is in `dist/firefox`. The build only strips TypeScript types (`scripts/build-web.ts`). `src/model-weights.ts` is data: the weights of a logistic-regression model trained by `eval/train-model.py`. No data is collected or sent; the only network requests are for legal pages linked from the current page, without cookies or a referrer, after the user clicks the toolbar button. Only same-site links are requested on that click; another site gets no request until the user grants that one site through the Allow button (optional host permissions).

### Edge or Chrome (about one minute)

1. Open **edge://extensions** in Edge, or **chrome://extensions** in Chrome.
2. Turn on **Developer mode**. In Edge it's in the left sidebar; in Chrome it's at the top right.
3. Click **Load unpacked** and choose the `dist/extension` folder (the one with `manifest.json` directly inside it).
4. Click the puzzle-piece icon in the toolbar and pin **Tickwise**.

An unpacked extension stays installed, but it doesn't update by itself. To publish: Edge Add-ons is free (Microsoft Partner Center), and the Chrome Web Store has a one-time US$5 developer fee. Both take the zip from `npm run pack:extension`.

After changing the code, run `npm run build` again and click **Reload** on the extension's card (Edge, Chrome), or **Reload** on about:debugging (Firefox).

## What it does

- **This page**: reads the visible text of the tab when you click the icon (`activeTab` + `scripting`; no background script).
- **Selected text**: if you selected more than 200 characters, that's checked as its own document and listed first.
- **Linked pages**: up to 8 links that look like Terms, Privacy, Cookie or legal pages are found. The ones on the same site are fetched from inside the page, so they need no extra permission (a redirect to another site is stopped before it's sent). Each page is read up to 3 MB and 10 seconds. They're fetched without cookies or a referrer: a terms page doesn't need your login, and a link that does something when opened (say, "Accept cookies") does nothing logged out. Links to your own machine or home network (`localhost`, `192.168.x.x`, names with no dot, `.local`, `.lan` names and similar) are skipped, unless the page you're on is on one too.
- **Other sites**: nothing is sent to a link on another origin until you allow it, so that site doesn't learn which page you're on. Those links are listed under "Linked pages we couldn't read" with an **Allow reading N more pages** button, which asks for those origins (`optional_host_permissions`). Once you allow an origin, it's read straight away every time, also without cookies.
  - In Edge and Chrome the popup closes when the browser's prompt opens: accept it, then click the icon again. In Firefox the popup stays open and reads the page as soon as you accept.
  - For a plain-http link it asks for that site over http and https, because Firefox sends the extension's request over https (`upgrade-insecure-requests` in its default extension policy). So in Firefox, a terms page on another site that only works over plain http can't be read this way.
- **Very long pages**: each document is checked up to its first 500,000 characters (long terms run to about 300,000), and the list says when one was cut.
- **One report**: the boundary score band (its colour is the verdict, its line says how many big and smaller things there are), then one card per kind of point with severity, category, the plain-English point, a short quote cut around the words that matched, **From: <document>**, the safeguard to **Add**, and **Not OK**. Only high risks and your dealbreakers show at first; the rest sit behind "Show N smaller points", and repeats of one kind fold under "N more places it says this". "Checked N documents" comes last, folded (open when a document changed).
- **Show on page**: on a flag from the page you're on, scrolls the page to that sentence and highlights it in lime (the CSS Custom Highlight API; the browser selects the sentence instead if it doesn't have that API). The highlight stays until the page reloads. If the page changed since the check, the button says "Not found on page".
- **Open and show**: on a flag from a linked page, opens that page in a new tab at the sentence, using a text fragment (`#:~:text=…`). If the browser can't find the text (some pages build their text with JavaScript), the page opens at the top.
- **Badge**: after a check, the toolbar icon shows the number of high-risk flags in coral, for that tab only. The browser clears it when the tab goes to another page.
- **Changes since your last check**: Tickwise remembers which flags each document had, in `chrome.storage.local` under `tickwise.seen`, for the last 300 documents. It stores a short hash of each page's address and of each flag instead of the address or the text. That keeps the addresses out of plain sight, but it isn't real protection: the hash has no secret in it, so anyone with a copy of your browser profile can hash a list of likely addresses (a million take about a second) and see which ones you checked. On the next check of the same address, each document says "First check", "No change since you checked …", or "Changed since you checked …: 2 new flags, 1 gone". New flags get a lime **New** label, and the score line counts them. It compares flags, not the full text, so edits that don't change any flag aren't reported. It only checks when you click the icon; nothing runs in the background. The selection isn't tracked.
- **Not OK** makes a rule a dealbreaker. It moves to the top, costs extra in the score, and is saved in `chrome.storage.local` (`tos-checker.prefs`, the same shape as the web app). Click it again to clear it.
- Browser pages (`edge://`, `chrome://`, `about:`, the add-on stores) can't be read by any extension, so the popup says so.

The fonts (Redaction and IBM Plex Mono) are bundled in `extension/fonts`, so the popup makes no font requests. The icons are drawn by `npm run icons` (`scripts/make-icons.ts`) into `extension/icons`.

## Test it in a real browser

```bash
npm run build
npm run test:extension      # Edge (or Chrome): node scripts/test-extension.ts
npm run test:firefox        # Firefox: node scripts/test-firefox.ts
```

Both use no dependencies. On Windows, run them from PowerShell or cmd. Edge launched from Git Bash exited straight away in our setup.

**`scripts/test-extension.ts` (Edge or Chrome)**:

1. Serves a fictional sign-up page ("Snapnest") at `snapnest.test`, with its Privacy Policy on the same origin and its Cookie Policy on `legal.snapnest.test`. Both names point at 127.0.0.1 through `--host-resolver-rules`.
2. Starts headless Edge with a throwaway profile (deleted afterwards), and talks to it over `--remote-debugging-pipe` with `--enable-unsafe-extension-debugging`. It loads `dist/extension` with `Extensions.loadUnpacked`.
3. Clicks the toolbar button with `Extensions.triggerAction` (a real action click, so `activeTab` applies), attaches to the popup and checks the report. Then it clicks **Allow**, **Not OK**, **Show on page** and **Open and show**, selects text, changes the Privacy Policy between visits, and opens a browser page. The site sets a login cookie, so the test can check that linked pages are fetched without it, and the footer links to `router.local`, which must be skipped. It also checks that nothing is requested from the other site before Allow.
4. Saves the screenshots in `docs/screenshots/`.

It passes 53 of 53 checks in Edge (9 Nov 2026). On 8 Nov, Edge 157 and Chrome for Testing 157.0.8103.38 passed the 51 checks it had then. The Chrome run used [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/), Google's Chrome build for automated tests. To repeat it, unzip it and set `BROWSER` to its `chrome.exe`.

Options: `BROWSER=<path to msedge.exe or chrome.exe>`, `PROFILE_DIR=<folder>` to use a profile folder of your own (kept afterwards; never point it at your real browser profile), `HEADED=1` to watch, `NO_SHOTS=1` to skip screenshots. It exits with code 1 if any check fails.

**`scripts/test-firefox.ts` (Firefox)**:

1. Serves the same Snapnest pages. `network.dns.localDomains` points the names at this machine.
2. Starts headless Firefox with a throwaway profile, and installs `dist/firefox` as a temporary add-on over WebDriver BiDi (`webExtension.install`).
3. Clicks Tickwise's toolbar action from the browser window (`triggerAction`, which is what a toolbar click runs, so `activeTab` applies). This needs `--remote-allow-system-access` and `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, which the script sets.
4. Reads the popup through a frame script, presses **Show on page**, and checks the highlight in the tab.

It's shorter than the Edge test, because Allow, Not OK, selected text and terms changes run the same code. Options: `FIREFOX=<path to firefox.exe>`, `HEADED=1`.

Firefox 159 sometimes never finishes starting with a new profile (WebDriver BiDi doesn't answer). A good start answers in about 2 seconds, so the script stops Firefox after 15 seconds and starts it again, up to 5 times.

## Tested on

**9 November 2026, after linked pages on other sites stopped being requested before Allow: Edge 53 of 53, Firefox 9 of 9.** The new check: no request reaches the other site (`legal.snapnest.test`) until Allow.

**Microsoft Edge 157.0.4341.42, Windows 11, headless, 8 November 2026: 51 of 51 checks pass.**

Verified in the real browser:
- The extension loads unpacked with its icons, and the toolbar click opens the popup with no console errors.
- It reads the current page and the same-origin Privacy Policy. It skips links that aren't legal pages (Help, Features).
- One merged report: the score band, "Checked N documents", and flags from every document, one card per kind of point (high risks first, the rest folded), each with "From: <document>", an Add, Not OK, and Show on page (this page) or Open and show (linked pages).
- The toolbar badge shows the high-risk count (4), with a tooltip that says so.
- Cross-origin: the Cookie Policy on another origin is listed as unread with **Allow reading 1 more page**. Once the origin is granted, a real (trusted) click on Allow reads it, and the report goes to 3 documents. The next click on the icon reads it without asking.
- Not OK makes a dealbreaker, lowers the score (22 to 17), is saved to `chrome.storage.local`, and survives reopening. Clicking it again clears it.
- Show on page highlights the arbitration sentence and scrolls it into view, including inside the page's own scrolling terms box.
- Open and show opens the Privacy Policy in a new tab with a `#:~:text=` fragment for the sentence.
- Selected text (410 characters) becomes the first document, and its flags say "From: Selected text".
- Changes: the first check says "First check" for each document, the next says "No change since you checked today". After the Privacy Policy drops one flagged sentence and adds one, it says "Changed since you checked today: 1 new flag, 1 gone", the new flag (AI training) is the only one marked New, and the score line says "1 is new since you last checked." Storage holds hashes, not the page addresses.
- On `edge://version` the popup shows "Can't read this page."
- Cookies: the site sets a login cookie, and all 12 fetches of linked pages (from the page and from the popup) go out without it (8 on 9 November, since the other site is no longer asked before Allow), while opening a page in a tab still sends it. With `credentials: "omit"` taken out of the built popup, Edge sent the cookie on every one of those fetches, including to the allowed site, so the check does catch it.
- A footer link to `router.local` (your own network) is skipped: never requested, never listed.

**Firefox 159.0.1 (Microsoft Store build), Windows 11, headless, 8 November 2026: 9 of 9 checks pass.**

- Firefox installs `dist/firefox` (manifest, add-on ID and data declaration accepted).
- The toolbar action opens the popup with the same report as in Edge (score 26, 19 flags on the first check), reads this page and the Privacy Policy, and lists the Cookie Policy for Allow.
- The badge shows 4, with its tooltip.
- Show on page highlights the arbitration sentence with Firefox's CSS Custom Highlight API and scrolls it into view.
- No errors from the add-on. (Before 9 November, Firefox logged a blocked cross-origin read of the Cookie Policy; it's no longer requested before Allow.)

**Step-by-step checks in Firefox 159.0.1 and Chrome for Testing 157, 8 November 2026.** Each step was run from a script (browsers can't be clicked with a real mouse in this setup), and the screenshots were checked by eye.

- Firefox, headless, screenshots taken inside the browser:
  - The popup opens in about a second at 380 × 600 with no sideways scrolling. Firefox puts the button in the Extensions (puzzle piece) menu at first, like any new add-on.
  - The report, the badge (4) and its tooltip match Edge. Dark and light mode both look right.
  - Show on page highlights the arbitration sentence and the popup stays open. Open and show opens the Privacy Policy at the sentence, and Firefox highlights it in yellow.
  - Allow: Firefox's own prompt opens ("Access your data for sites in policies.snapnest.test domains") with the popup still open. After clicking the prompt's Allow, the same popup reads the Cookie Policy (3 documents, 21 flags, nothing unread), and so does the next click on the icon.
  - Linked pages go out without the site's cookie (page loads do send it), and `router.local` is never requested.
  - This run found a bug, now fixed: the Allow grant covered `http://` only, but Firefox sent the popup's request over https, so the page still couldn't be read. Allow now asks for http and https (see "Other sites" above). The old build fails this check and the new one passes.
- Chrome for Testing, in a window:
  - The popup opens in about a second, dark mode looks right, Show on page highlights the sentence, and Open and show opens the page with Chrome's own text-fragment highlight.
  - Allow closes the popup and opens Chrome's prompt ('"Tickwise" has requested additional permissions. It could: Read and change your data on policies.snapnest.test'). The prompt wasn't answered, and this run used the build from before the Allow fix. The automated test passes 51 of 51 with the fix.

Not verified, and why:
- **Answering the permission prompt in Edge and Chrome.** Headless Edge can't show or click the browser's own prompt. The Edge test grants the origin the way Site access on edge://extensions does (`chrome.developerPrivate.addHostPermission`), then clicks Allow. On an origin that was never granted, the Allow click does open the prompt: Edge closes the popup as the prompt takes focus. So for a real user: click **Allow**, accept the prompt, then click the icon again, and the page is read straight away. That last step is verified. In Firefox the prompt was answered (above), but only in the step-by-step check: `npm run test:firefox` doesn't test Allow, since it needs https and port-less addresses.
- **A real mouse click on the toolbar.** Every run calls what the click runs (`triggerAction`), not the click itself.
- **Publishing.** AMO's own validator hasn't seen the zip. It runs when you upload.
- **The popup's own window size in Edge.** Headless Edge keeps the popup at the height of its first "Reading…" frame, where a real popup grows to fit, up to 600px. So the screenshots draw the popup's live DOM in `popup.html` opened as a tab (same CSS and fonts) at 380 × 600, or at full length for `extension-popup-full.png`.
- Terms inside iframes, and a page long enough to hit the 500,000-character cap.

Screenshots: `extension-popup.png` (what you see on clicking), `extension-popup-full.png` (the whole report), `extension-popup-permission.png` (before Allow), `extension-popup-selection.png`, `extension-popup-dealbreaker.png`, `extension-popup-changed.png` (after the Privacy Policy changed), `extension-show-on-page.png` (the highlighted sentence), and `extension-in-context.png` (popup over the page).

## Known gaps

- It only reads the top frame, so terms inside an iframe are missed.
- One card per flag, so a rule that matches many sentences shows many cards.
- Linked pages that build their text with JavaScript come back mostly empty, because fetched HTML isn't run. Text a linked page hides with CSS is read like the rest.
- Hidden characters (soft hyphens, zero-width spaces), full-width letters and Latin words spelt with look-alike Cyrillic or Greek letters are read through. Other disguises, such as words broken up with spaces or text in images, aren't.
- Changes are only noticed when you click the icon on that page again.
