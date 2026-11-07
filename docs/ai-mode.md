# AI mode: a local model through Ollama (tested) or llama-server

AI mode sends the clauses the rules flagged (plus clauses with broad keywords such as "data", "share", "arbitration" or "renew", up to about 8,000 characters) to a small model on your own PC. The model returns a short summary and extra points. A point is kept only if its quote really appears in the clause it names.

Tested on 6 November 2026 on a Windows 11 laptop with an RTX 4060 Laptop GPU (8 GB), Ollama 0.40.14, and the models `qwen3.5:4b` and `qwen3.5:9b` (both Q4_K_M).

## 1. Ollama (the tested route)

1. Install Ollama from <https://ollama.com> and pull a model:

   ```powershell
   ollama pull qwen3.5:4b    # 3.3 GB, fits in 8 GB of VRAM: about 11-17 s per document
   ollama pull qwen3.5:9b    # 6.6 GB, partly runs on the CPU with 8 GB of VRAM: about 38-56 s per document
   ```

2. Ollama runs in the background at `http://127.0.0.1:11434`. Nothing else to start.
3. In the app, switch on **AI mode** and press **Check**. If nothing answers at the configured server URL (default `http://127.0.0.1:8080`), the app tries Ollama at `http://127.0.0.1:11434` by itself. With **Model name** left blank it takes the first Qwen model Ollama lists. To choose, open **AI settings** and set, for example, Server URL `http://127.0.0.1:11434` and Model name `qwen3.5:4b`.

The browser app on `http://127.0.0.1:5173` can call Ollama directly: Ollama's default allowed origins include `http://127.0.0.1:*` and `http://localhost:*`.

To try it from the command line on the sample and two real ToS (Netflix and Snap, rebuilt from the UNFAIR-ToS test split):

```powershell
npm run eval:ai-docs                    # qwen3.5:4b and qwen3.5:9b
npm run eval:ai-docs -- qwen3.5:4b
```

## 2. llama-server (the alternative)

1. Download a recent Windows release of llama.cpp from its GitHub releases page (the CPU build `llama-…-bin-win-cpu-x64.zip` is fine) and unzip it, e.g. to `C:\llama`.
2. Get a GGUF model, e.g. a Qwen3 8B GGUF, or Bonsai 8B (`Q1_0`, from the Hugging Face repo prism-ml/Bonsai-8B-gguf; built from Qwen3-8B).
3. Start it:

   ```powershell
   cd C:\llama
   .\llama-server.exe -m C:\models\model.gguf -c 8192 --port 8080
   ```

4. Wait until `http://127.0.0.1:8080/health` returns 200 (it's 503 while the model loads). The app's default server URL is this one. The desktop app can also start llama-server for you (AI settings: llama-server path, model file, port).

> The llama-server route is **not tested on a real server yet**, only against a fake one in `test/ai.test.ts`.

## Measured results

### AI mode on whole documents

`npm run eval:ai-docs`, full output in [eval/results-ai-docs.txt](../eval/results-ai-docs.txt). Times are per document, with the model already loaded (loading took 2 s for 4b and 17 s for 9b). "Repeated" means the point was on the same clause and topic as a rule flag (or an earlier AI point), so it isn't shown twice.

| Document | Model | Time | Returned | Kept | Dropped (quote not in clause) | Repeated |
|---|---|---|---|---|---|---|
| App sample (1,133 chars, 13 rule flags) | 4b | 11.0 s | 11 | 1 | 0 | 10 |
| | 9b | 37.6 s | 12 | 0 | 0 | 12 |
| Netflix (13,456 chars, 10 rule flags) | 4b | 14.3 s | 12 | 7 | 1 | 4 |
| | 9b | 48.5 s | 12 | 9 | 1 | 2 |
| Snap (22,268 chars, 24 rule flags) | 4b | 17.1 s | 12 | 6 | 0 | 6 |
| | 9b | 55.7 s | 12 | 5 | 1 | 6 |

Summaries: all six were on topic. The 9b summaries were accurate in every detail we checked. The 4b summary of the sample said you "waive your right to a jury trial", but the sample waives class actions, not jury trials; its Netflix summary said you grant Netflix "a limited license to use your data", which garbles the licence clause.

Two real kept points (9b, Netflix):

- *High · Money:* "If you don't cancel before your billing date, we will charge your payment method for the next month." Quote: "Unless you cancel your membership before your monthly billing date, you authorize us to charge your next month's membership fee to your payment method"
- *Medium · Action you can take:* "You can cancel anytime and keep access until the end of your current billing period." Quote: "You can cancel your netflix membership at any time, and you will continue to have access to the netflix service through the end of your monthly billing period."

A checked quote doesn't make the point right. 9b said "You give Snap a free, worldwide license to use your content" and quoted Snap's licence **to you** ("Snap group limited grants you a personal, worldwide, royalty-free... license to access and use the services"). The quote is real; the reading is backwards. Both models also sometimes pick the wrong category (4b filed Snap's liability disclaimer under Money). That's why AI points are marked "AI · quote checked" and the rule flags stay the main result.

### UNFAIR-ToS benchmark (same held-out test split as the rules)

`npm run eval:ai -- test --model qwen3.5:9b --stratified`, full output in [eval/results-ai-test.txt](../eval/results-ai-test.txt). The model gets 20 sentences per request and tags each with zero or more of the 8 labels (JSON schema output), with short label definitions after the CLAUDETTE paper. The prompt was written once and not tuned on the test split.

**Coverage: a stratified subset, not the full split.** All 172 unfair test sentences plus 172 of the 1,435 fair ones (every 8th): 344 sentences, 194 s (1.8 sentences/s). The full 1,607 sentences didn't fit the time we had. A balanced subset flatters precision, so read the AI and rules rows against each other, not against the full-split numbers in `eval/results-test.txt`. `qwen3.5:4b` was not benchmarked.

| Clause type | Precision | Recall | F1 | Count |
|---|---|---|---|---|
| Limitation of liability | 63.8% | 97.4% | 77.1% | 38 |
| Unilateral termination | 87.2% | 89.5% | 88.3% | 38 |
| Unilateral change | 68.9% | 81.6% | 74.7% | 38 |
| Content removal | 68.4% | 100.0% | 81.3% | 13 |
| Contract by using | 94.1% | 69.6% | 80.0% | 23 |
| Choice of law | 76.5% | 100.0% | 86.7% | 13 |
| Jurisdiction | 84.2% | 100.0% | 91.4% | 16 |
| Arbitration | 35.0% | 100.0% | 51.9% | 7 |
| **All (micro)** | 71.4% | 89.8% | **79.5%** | |

On the same 344 sentences:

| | Precision | Recall | Micro-F1 | Fair sentences flagged |
|---|---|---|---|---|
| No AI (rules + trained model, as the app runs it) | 90.5% | 72.0% | 80.2% | 1.2% |
| AI only (qwen3.5:9b) | 71.4% | 89.8% | 79.5% | 22.1% |
| Rules or AI | 69.9% | 92.5% | 79.6% | 22.7% |

The model finds more of the unfair clauses (recall 90% vs 72%) but flags 22% of fair sentences, against about 1% for the no-AI engine. On the full split that would be roughly 300 false flags, so the AI is not a replacement for the rules as a classifier. That fits how AI mode is used: as extra, quote-checked points next to the rule flags.

## What the app sends

- Readiness: `GET /health` (llama-server) and, if there's no `/health`, `GET /v1/models` (Ollama). A 503 from `/health` means llama-server is still loading.
- Model: the one in AI settings, else the first Qwen model in `GET /v1/models` (embedding models are skipped). llama-server with one model loaded doesn't need a name.
- `POST /v1/chat/completions` with `temperature: 0`, `presence_penalty: 0`, a JSON schema in `response_format`, `reasoning_effort: "none"` and `chat_template_kwargs: { enable_thinking: false }`.
  - **Thinking off.** Qwen 3.5 thinks by default, and the thinking eats the token budget. Measured on Ollama 0.40.14: `reasoning_effort: "none"` turns it off (a test reply went from 400 tokens, cut off mid-thinking, to 97). `chat_template_kwargs` and `think: false` in the OpenAI-style body do nothing on Ollama; on the native `/api/chat`, `think: false` works. llama-server uses `chat_template_kwargs`. Any `<think>…</think>` that still comes back is stripped.
  - **Structured output works through Ollama.** `response_format: { type: "json_schema" }` is enforced (enum values come back exactly as listed), so no `json_object` fallback is needed.
  - **`presence_penalty: 0`.** Ollama's qwen3.5 sets 1.5 by default, which pushes the model to reword quotes. On the Snap terms with 4b, adding it took dropped points from 1 to 0 (and the prompt rule "never use ..." took them from 6 to 1 before that).
- The system prompt never changes, so the server can reuse its cache between runs.

## Troubleshooting

- **"AI isn't running"**: check `http://127.0.0.1:11434/v1/models` (Ollama) or `http://127.0.0.1:8080/health` (llama-server) in a browser, and the Server URL in AI settings.
- **HTTP 404 "model ... not found"**: the Model name in AI settings isn't pulled. `ollama list` shows what is.
- **Slow**: the 9b model doesn't fit in 8 GB of VRAM next to its context, so part of it runs on the CPU (5.6 of 6.7 GB on the GPU here). Use `qwen3.5:4b` on 8 GB cards.
- **"dropped" is high**: the model invented or shortened quotes. Those points are hidden on purpose.
