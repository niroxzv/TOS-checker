# Project status: Tickwise

## Done

### Core engine (no AI)
- [x] Sentence splitter that keeps exact positions, so every quote matches the document character for character.
- [x] 21 rules across six areas: data collected, data shared, your content, your rights, money, and what you can do.
- [x] Tuned on the UNFAIR-ToS benchmark: train and validation splits only, with the test split held out. Results are in "Accuracy" below.
- [x] Add / Check / Tell next move for every rule, with Singapore-specific help: PDPA, PDPC, CASE (`src/advice.ts`).
- [x] Boundary score out of 100, with dealbreakers costing extra (`src/score.ts`).
- [x] Small trained model (`src/model.ts`): logistic regression over words, word pairs and which rules fired. It confirms or adds the 8 benchmark clause types, about 600 KB, and runs on the device. Retrain with `npm run train`.
- [x] Disguised text doesn't hide a clause: hidden characters (soft hyphens, zero-width spaces), full-width letters and Latin words spelt with look-alike Cyrillic or Greek letters are read as plain text. Flags still quote the original.
- [x] No slow patterns: 200 KB of hostile text (like "a.b.a.b." or thousands of blank lines) is checked in about 0.1 s. Before 7 Nov 2026 it took tens of seconds.
- [x] All tests pass with `npm test` (197).

### Desktop / web app (`app/`)
- [x] Paste the terms, open a file, or try a sample, then press Check (or Ctrl+Enter).
- [x] Tickwise look: ivory paper, Redaction serif, uppercase mono labels, a dark score band with a verdict pill and a High / Med / Low tally, coral severity pills. Fonts are bundled, so nothing loads from the internet.
- [x] Each flag shows what it means, the exact quote, Add / Check / Tell, and Approve / Not OK buttons. Your choices are saved and the score updates.
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
- [x] **Tested in real Microsoft Edge 157.** `npm run test:extension` passes 51 of 51 checks (7 Nov 2026). The harness loads the extension, opens the popup with a real toolbar click on a fake sign-up page, and checks:
  - the page, the selection and both linked pages, including one on another site after "Allow";
  - the merged report, "From: …" on every flag, and Not OK lowering the score;
  - the badge, the icons, Show on page and Open and show;
  - a Privacy Policy that changes between two checks;
  - linked pages fetched without the site's login cookie, and a link to `router.local` skipped.
- [x] **Tested in real Firefox 159.** `npm run test:firefox` passes 9 of 9 checks (7 Nov 2026): install, the toolbar action, the report, the badge, and Show on page.
- [x] Popup restyled to the same Tickwise look, with the fonts bundled in the extension. Screenshots are in `docs/screenshots/`.
- [x] `npm run pack:extension` builds `tickwise-extension.zip` for Edge and Chrome.
- Not verified: answering Edge's own permission prompt, because headless Edge can't click it. In real use, the popup closes when the prompt opens. Accept the prompt and click the icon again. That second step is verified.
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

  The AI catches more, with higher recall, but wrongly flags about 1 in 5 fair sentences. That's why AI mode only **adds** checked points on top of the no-AI flags and never replaces them. The full table is in `eval/results-ai-test.txt`.
- [ ] Not done: the full 1,607-sentence AI run, any benchmark with 4b, and a real llama-server or the desktop (Tauri) flow.

### Demo video
- [x] `scripts/record-demo.ts` records a captioned demo video in Edge, with no extra tools (`HEADED=1` to watch, `SPEED=2` for double speed).

## Accuracy (UNFAIR-ToS test split: 1,607 sentences, never used for tuning or training)

| Version | LexGLUE micro-F1 | LexGLUE macro-F1 | Micro-F1, 8 unfair types | Fair sentences wrongly flagged |
|---|---|---|---|---|
| Rules before tuning | | | 35.3% | 10.7% |
| Rules after tuning | 94.4% | 76.8% | 73.1% | 2.8% |
| **Rules + trained model (shipped)** | **95.1%** | **77.4%** | **74.4%** | **2.0%** |
| Published TF-IDF + SVM baseline | 94.7% | 75.0% | | |
| Published Legal-BERT, fine-tuned (too big for an extension) | 96.0% | 83.0% | | |

- LexGLUE scoring also counts "no unfair clause" as a ninth label. That's how the published results are scored, so the first two columns compare like for like.
- Train and validation scores are not shown: the model was trained on those splits, so they would flatter it.
- The full tables are in `eval/results-test.txt` (shipped) and `eval/results-test-rules-only.txt`.
- To rerun them: `npm run eval -- test` and `npm run eval:rules`.
- Bigger variants (character n-grams, larger vocabularies) did not beat this model in cross-validation: all scored within 0.5 points. Plain-text models top out around here. The next real gain needs a transformer or the local LLM (see AI mode).

## To do

- [ ] Try the extension by hand in Firefox (about:debugging) and Chrome. The Firefox test drives the add-on from a script, and Chrome isn't installed here.
- [ ] Submit the Firefox build to addons.mozilla.org, so it installs and updates like any other add-on. Steps: `docs/extension.md`.
- [ ] **Desktop build (Tauri).** This needs Rust and app icons (`npx tauri icon`). Untested.
- [ ] **Desktop: limit what `start_ai` runs.** It starts any program path the app window sends it (`src-tauri/src/lib.rs`), which matters if the window ever loads something else, as in dev mode. Accept only a path the user picked in a file dialog. Needs Rust to build and test.
- [ ] Raise arbitration precision (37.5% on test) and unilateral-termination recall.
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
