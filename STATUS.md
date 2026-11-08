# Project status: Tickwise

## Done

### Core engine (no AI)
- [x] Sentence splitter that keeps exact positions, so every quote matches the document character for character.
- [x] 21 rules across six areas: data collected, data shared, your content, your rights, money, and what you can do.
- [x] Tuned on the UNFAIR-ToS benchmark: train and validation splits only, with the test split held out. Results are in "Accuracy" below.
- [x] One safeguard to **Add** for every rule, each different, with Singapore-specific help where it fits, such as CASE (`src/advice.ts`). A rule that fires many times shows its Add on the first card only.
- [x] Boundary score out of 100, with dealbreakers costing extra (`src/score.ts`).
- [x] Small trained model (`src/model.ts`): logistic regression over words, word pairs and which rules fired. It confirms or adds the 8 benchmark clause types, about 600 KB, and runs on the device. Retrain with `npm run train`.
- [x] Disguised text doesn't hide a clause: hidden characters (soft hyphens, zero-width spaces), full-width letters and Latin words spelt with look-alike Cyrillic or Greek letters are read as plain text. Flags still quote the original.
- [x] No slow patterns: 200 KB of hostile text (like "a.b.a.b." or thousands of blank lines) is checked in about 0.1 s. Before 7 Nov 2026 it took tens of seconds.
- [x] All tests pass with `npm test` (243).

### Web app (`app/`)
- [x] Paste the terms, open a file, or try a sample, then press Check (or Ctrl+Enter).
- [x] Tickwise look: ivory paper, Redaction serif, uppercase mono labels, a dark score band with a verdict pill and a High / Med / Low tally, coral severity pills. Fonts are bundled, so nothing loads from the internet.
- [x] Each flag shows what it means, the exact quote, a safeguard to add (once per kind of flag), and OK / Not OK buttons. Your choices are saved and the score updates.
- [x] Click a flag to jump to the highlighted sentence in the document.
- [x] Tested in the browser with the sample: renders, no console errors.

### Browser extension (`extension/`)
- [x] Scans the current page, plus any text you've selected, plus the site's linked Terms, Privacy and Cookie pages, into one combined report.
- [x] Same score, advice and dealbreakers as the app, sharing the same prefs key.
- [x] **Show on page**: scrolls the page to a flagged sentence and highlights it. Flags from a linked page get **Open and show**, which opens that page at the sentence.
- [x] **Badge and icons**: the toolbar icon shows the number of high-risk flags for that tab. Icons are drawn by `npm run icons`.
- [x] **Changes since your last check**: each document says "First check", "No change since you checked …" or "Changed since you checked …: N new flags, M gone", and new flags are marked New. It compares flags, not the full text, and only when you click the icon.
- [x] **Linked pages** are fetched without cookies. Links to localhost and home-network addresses are skipped, and each document is checked up to 500,000 characters.
- [x] **Firefox build** in `dist/firefox` (add-on ID `tickwise@niroxzv`, Firefox 140 or newer). `npm run pack:firefox` and `npm run pack:source` make the two zips addons.mozilla.org asks for.
- [x] **Tested in real Microsoft Edge 157 and Chrome 157.** `npm run test:extension` passes 51 of 51 checks in Edge and in Chrome for Testing 157.0.8103.38 (8 Nov 2026). The harness loads the extension, opens the popup with a real toolbar click on a fake sign-up page, and checks:
  - the page, the selection and both linked pages, including one on another site after "Allow";
  - the merged report, "From: …" on every flag, and Not OK lowering the score;
  - the badge, the icons, Show on page and Open and show;
  - a Privacy Policy that changes between two checks;
  - linked pages fetched without the site's login cookie, and a link to `router.local` skipped.
- [x] **Tested in real Firefox 159.** `npm run test:firefox` passes 9 of 9 checks (8 Nov 2026): install, the toolbar action, the report, the badge, and Show on page.
- [x] **Checked step by step in Firefox and Chrome** (8 Nov 2026), from a script with the screenshots checked by eye: the popup, dark and light mode, Show on page, Open and show, and Allow with the browser's own prompt. Details: `docs/extension.md`.
  - It found a Firefox bug, now fixed: after Allow, a plain-http page on another site still couldn't be read, because Firefox sends the popup's request over https. Allow now asks for http and https.
  - In Firefox, a terms page on another site that only works over plain http still can't be read from the popup.
- [x] Popup restyled to the same Tickwise look, with the fonts bundled in the extension. Screenshots are in `docs/screenshots/`.
- [x] `npm run pack:extension` builds `tickwise-extension.zip` for Edge and Chrome.
- Not verified: answering the browser's own permission prompt in Edge and Chrome, because headless Edge and Chrome can't click it. In real use, the popup closes when the prompt opens. Accept the prompt and click the icon again. That second step is verified. In Firefox the prompt was answered and the page read, in the step-by-step check only.
- Flaky: the last step (Allow on a never-granted site) timed out in the test harness on 2 of 4 runs (6 Nov 2026); the other checks passed every time.

### AI mode (optional, local)
- [x] Works with **Ollama** (tested) or llama-server, using the OpenAI-compatible API, structured JSON output and thinking turned off. It finds the server and a Qwen model by itself.
- [x] Every AI point must quote the document. Points whose quote isn't really in the text are thrown away.
- [x] **Tested for real** with qwen3.5:4b and qwen3.5:9b on this PC.
  - In the web app with 9b: 37 s on the sample, and the summary was accurate.
  - Per document: 4b takes 11–17 s, 9b takes 38–56 s (9b doesn't fit fully in 8 GB of VRAM).
  - Invented quotes: 0–1 dropped per document.
  - The details are in `eval/results-ai-docs.txt` and `docs/ai-mode.md`.
- [x] **Benchmarked against no-AI mode** (`npm run eval:ai`). The run used qwen3.5:9b on a balanced test subset: all 172 unfair sentences plus 172 fair ones.

  | On the same 344 sentences | Precision | Recall | Micro-F1 | Fair sentences flagged |
  |---|---|---|---|---|
  | No AI (rules + trained model) | 90.5% | 72.0% | 80.2% | 1.2% |
  | AI only (qwen3.5:9b) | 71.4% | 89.8% | 79.5% | 22.1% |

  The AI catches more, with higher recall, but wrongly flags about 1 in 5 fair sentences. That's why AI mode only **adds** checked points on top of the no-AI flags and never replaces them. The full table is in `eval/results-ai-test.txt`. It was measured before the 8 Nov 2026 rule changes, which moved the no-AI test scores by under one point.
- [ ] Not done: the full 1,607-sentence AI run, any benchmark with 4b, and a real llama-server.

### Demo video
- [x] `scripts/record-demo.ts` records a captioned demo video in Edge, with no extra tools (`HEADED=1` to watch, `SPEED=2` for double speed).

## Accuracy (UNFAIR-ToS test split: 1,607 sentences, never used for tuning or training)

| Version | LexGLUE micro-F1 | LexGLUE macro-F1 | Micro-F1, 8 unfair types | Fair sentences wrongly flagged |
|---|---|---|---|---|
| Rules before tuning | | | 35.3% | 10.7% |
| Rules after tuning | 94.6% | 77.2% | 73.5% | 2.7% |
| **Rules + trained model (shipped)** | **95.2%** | **77.9%** | **74.9%** | **1.9%** |
| Published TF-IDF + SVM baseline | 94.7% | 75.0% | | |
| Published Legal-BERT, fine-tuned (too big for an extension) | 96.0% | 83.0% | | |

- LexGLUE scoring also counts "no unfair clause" as a ninth label. That's how the published results are scored, so the first two columns compare like for like.
- Train and validation scores are not shown: the model was trained on those splits, so they would flatter it.
- The full tables are in `eval/results-test.txt` (shipped) and `eval/results-test-rules-only.txt`.
- To rerun them: `npm run eval -- test` and `npm run eval:rules`.
- 8 Nov 2026: arbitration and unilateral termination were tuned again, on train and validation only, then checked once on test. Arbitration precision went from 41.7% to 45.5%. Unilateral termination recall went from 68.4% to 73.7%, and its precision from 76.5% to 73.7%.
  - Arbitration now skips class-arbitration waivers, "not combine" clauses, the Federal Arbitration Act line, and court clauses that only point to the arbitration section.
  - Unilateral termination now also catches "may stop providing the service", "grounds for termination", "has discretion to terminate", "terminates automatically if you…", "withdraw access" and "may suspend users".
  - Most arbitration flags still counted wrong are real arbitration sentences. UNFAIR-ToS marks only one sentence per arbitration section as unfair, so "disputes must be resolved by binding arbitration" in a summary notice counts as a mistake. Removing those would hide true clauses, so they stay.
- 8 Nov 2026: "They may use your content or data to train AI" no longer fires on rules for you, such as "don't use the service or what it generates to build a competing AI" (distillation) in a "you must not" list. Found on Qwen's terms. The test scores didn't change.
- 8 Nov 2026: the privacy and AI rules were rechecked on real terms and privacy policies (AI chat apps, social apps, GitHub) and tuned. The test scores didn't change.
  - Headings such as "GitHub May Terminate" or "AI Features, Training, and Your Data" are skipped; the sentences under them still flag.
  - Curly apostrophes read like straight ones, so "We don’t sell your personal information" no longer flags as selling.
  - Rules for you ("you may not…", "you agree not to…", items of a "don't do this" list) no longer flag as something the company does. Nor do "not based on selling", others sharing data *with* the company, a license the company gives *you*, how their models are trained in general, and "use our products for facial recognition" in a usage policy.
  - Collecting biometrics now needs something done with the data, not just the word. Tracking now catches "actions you take on other sites"; "usage across your devices" (their own app on your phone and laptop) no longer counts.
- Bigger variants (character n-grams, larger vocabularies) did not beat this model in cross-validation: all scored within 0.5 points. Plain-text models top out around here. The next real gain needs a transformer or the local LLM (see AI mode).

## To do

- [x] Check the extension step by step in Firefox and Chrome (8 Nov 2026, see above). Still open: a person clicking the real toolbar button, since every run so far calls what the click runs.
- [ ] Submit the Firefox build to addons.mozilla.org, so it installs and updates like any other add-on. Steps: `docs/extension.md`.
- [x] **Removed the desktop (Tauri) shell** (8 Nov 2026). It was never built or run. The project now focuses on the browser extension, with the web app for pasting or opening a document.
- [x] Raise arbitration precision and unilateral-termination recall (8 Nov 2026, see "Accuracy").
- [ ] More rules, for example children's data and in-app purchases.
- [ ] Translate the advice into Chinese, Malay and Tamil.
- [ ] Alert users when an app's terms change without them opening the page. Today the extension notices a change only when you click its icon on that page again.

## Run it

```bash
npm test
npm run build
npm run serve
```

Then open http://127.0.0.1:5173. The extension is in `dist/extension` (Edge, Chrome) and `dist/firefox` (Firefox).
