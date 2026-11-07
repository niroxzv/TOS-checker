// Downloads one split of UNFAIR-ToS (LexGLUE, on Hugging Face) to eval/data/unfair-tos-<split>.jsonl.
// Each line: {"text": "...", "labels": ["Arbitration", ...]}. An empty labels list means a fair sentence.
// Usage: npm run eval:fetch -- [test|validation|train]   (default: test)
import { mkdirSync, writeFileSync } from "node:fs";

const split = process.argv[2] ?? "test";
const PAGE = 100; // the API's maximum

// Label order from the LexGLUE dataset card. Replaced by the names the API sends, if it sends them.
let names = [
  "Limitation of liability",
  "Unilateral termination",
  "Unilateral change",
  "Content removal",
  "Contract by using",
  "Choice of law",
  "Jurisdiction",
  "Arbitration",
];

const rows: { text: string; labels: string[] }[] = [];
for (let offset = 0; ; offset += PAGE) {
  const url =
    "https://datasets-server.huggingface.co/rows?dataset=coastalcph/lex_glue&config=unfair_tos" +
    `&split=${split}&offset=${offset}&length=${PAGE}`;
  const page = await getJson(url);
  if (offset === 0) names = findClassNames(page.features) ?? names;

  for (const { row } of page.rows) rows.push({ text: row.text, labels: row.labels.map((i: number) => names[i]) });
  process.stdout.write(`\r${rows.length} / ${page.num_rows_total}`);
  if (offset + PAGE >= page.num_rows_total) break;
}

const outDir = new URL("./data/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const out = new URL(`unfair-tos-${split}.jsonl`, outDir);
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`\nSaved ${rows.length} sentences to ${out.pathname}`);

async function getJson(url: string, tries = 8): Promise<any> {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= tries || (res.status !== 429 && res.status < 500)) {
      throw new Error(`${res.status} ${res.statusText} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 5000 * i)); // rate-limited or server hiccup: wait and retry
  }
}

/** Finds the first ClassLabel `names` list anywhere in the API's feature description. */
function findClassNames(x: unknown): string[] | undefined {
  if (!x || typeof x !== "object") return undefined;
  const names = (x as { names?: unknown }).names;
  if (Array.isArray(names)) return names as string[];
  for (const v of Object.values(x)) {
    const found = findClassNames(v);
    if (found) return found;
  }
  return undefined;
}
