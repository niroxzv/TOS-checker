import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { analyze } from "../src/engine.ts";
import { splitClauses } from "../src/split.ts";

const sample = readFileSync(new URL("../samples/sample-tos.txt", import.meta.url), "utf8");
const texts = (s: string) => splitClauses(s).map((c) => c.text);

describe("splitClauses", () => {
  test("splits sentences", () => {
    assert.deepEqual(texts("We collect data. We share it! Fine?"), ["We collect data.", "We share it!", "Fine?"]);
  });

  test("doesn't split after abbreviations", () => {
    assert.deepEqual(texts("We work with partners, e.g. advertisers. They pay us."), [
      "We work with partners, e.g. advertisers.",
      "They pay us.",
    ]);
  });

  test("joins hard-wrapped lines, splits real line breaks, drops bare numbers", () => {
    assert.deepEqual(texts("3. Privacy\nWe may share your\ninformation with partners.\nSecond line."), [
      "Privacy",
      "We may share your\ninformation with partners.",
      "Second line.",
    ]);
  });

  test("offsets point back at the exact source text", () => {
    for (const c of splitClauses(sample)) assert.equal(sample.slice(c.start, c.end), c.text);
  });
});

describe("analyze", () => {
  const flags = analyze(sample);
  const ids = new Set(flags.map((f) => f.ruleId));

  test("every quote is exact source text", () => {
    for (const f of flags) assert.equal(sample.slice(f.start, f.end), f.quote);
  });

  test("most severe first", () => {
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    for (let i = 1; i < flags.length; i++) assert.ok(order[flags[i - 1].severity] <= order[flags[i].severity]);
  });

  test("finds the sample's main points", () => {
    for (const id of ["broad_content_license", "ai_training", "shares_data", "arbitration", "arbitration_opt_out"]) {
      assert.ok(ids.has(id), id);
    }
  });

  test('"We do not sell your personal information" is not flagged as selling', () => {
    assert.ok(!ids.has("sells_data"));
  });
});
