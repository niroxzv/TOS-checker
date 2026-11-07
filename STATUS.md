# Project status: Tickwise

## Done

### Core engine (no AI)
- [x] Sentence splitter that keeps exact positions, so every quote matches the document character for character.
- [x] 21 rules across six areas: data collected, data shared, your content, your rights, money, and what you can do.
- [x] Tuned on the UNFAIR-ToS benchmark: train and validation splits only, with the test split held out. Results are in "Accuracy" below.
- [x] Add / Check / Tell next move for every rule, with Singapore-specific help: PDPA, PDPC, CASE (`src/advice.ts`).
- [x] Boundary score out of 100, with dealbreakers costing extra (`src/score.ts`).
- [x] Small trained model (`src/model.ts`): logistic regression over words, word pairs and which rules fired. It confirms or adds the 8 benchmark clause types, about 600 KB, and runs on the device. Retrain with `npm run train`.
- [x] All tests pass with `npm test`.

### Desktop / web app (`app/`)
- [x] Paste the terms, open a file, or try a sample, then press Check (or Ctrl+Enter).
- [x] Tickwise look: ivory paper, Redaction serif, uppercase mono labels, a dark score band with a verdict pill and a High / Med / Low tally, coral severity pills. Fonts are bundled, so nothing loads from the internet.
- [x] Each flag shows what it means, the exact quote, Add / Check / Tell, and Approve / Not OK buttons. Your choices are saved and the score updates.
- [x] Click a flag to jump to the highlighted sentence in the document.
- [x] Tested in the browser with the sample: renders, no console errors.

### Browser extension (`extension/`)
- [x] Scans the current page, plus any text you've selected, plus the site's linked Terms, Privacy and Cookie pages, into one combined report.
- [x] Same score, advice and dealbreakers as the app, sharing the same prefs key.
- [x] **Tested in real Microsoft Edge 156.** `npm run test:extension` passes 34 of 34 checks. The harness loads the extension, opens the popup with a real toolbar click on a fake sign-up page, and checks four things:
  - the page, the selection and both linked pages, including one on another site after "Allow";
  - the merged report;
  - "From: …" on every flag;
  - Not OK lowering the score.
- [x] Popup restyled to the same Tickwise look, with the fonts bundled in the extension. Screenshots are in `docs/screenshots/`.
- [x] `npm run pack:extension` builds `tickwise-extension.zip` to hand out.
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

- [ ] Try the extension by hand in Chrome too. It has been tested in Edge only, because Chrome isn't installed here.
- [ ] **Desktop build (Tauri).** This needs Rust and app icons (`npx tauri icon`). Untested.
- [ ] Raise arbitration precision (37.5% on test) and unilateral-termination recall.
- [ ] More rules, for example children's data and in-app purchases.
- [ ] Translate the advice into Chinese, Malay and Tamil.
- [ ] Alert users when an app's terms change.

## Run it

```bash
npm test
npm run build
npm run serve
```

Then open http://127.0.0.1:5173. The extension is in `dist/extension`.
