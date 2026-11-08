import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { analyze, isHeading, readable } from "../src/engine.ts";
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

  test("one blank line inside a wrapped sentence still joins it; two end the clause", () => {
    assert.deepEqual(texts("We may share your\n\ninformation."), ["We may share your\n\ninformation."]);
    assert.deepEqual(texts("Heading\n\n\nlowercase start."), ["Heading", "lowercase start."]);
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

describe("disguised text", () => {
  const SOFT_HYPHEN = String.fromCharCode(0xad);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  const CYRILLIC: Record<string, number> = { a: 0x430, e: 0x435, o: 0x43e, p: 0x440, c: 0x441 };
  /** Puts the mark after the second letter of every word of three letters or more. */
  const hide = (s: string, mark: string) => s.replace(/\b([a-z]{2})([a-z])/g, `$1${mark}$2`);
  const lookalike = (s: string) => s.replace(/[aeopc]/g, (ch) => String.fromCharCode(CYRILLIC[ch]));
  const plain = analyze(sample).map((f) => f.ruleId).sort();

  const cases: [string, string][] = [
    ["soft hyphens", hide(sample, SOFT_HYPHEN)],
    ["zero-width spaces", hide(sample, ZERO_WIDTH_SPACE)],
    ["Cyrillic look-alike letters", lookalike(sample)],
  ];
  for (const [name, text] of cases) {
    test(`${name} inside words don't hide any flag, and quotes stay exact`, () => {
      assert.notEqual(text, sample);
      const flags = analyze(text);
      assert.deepEqual(flags.map((f) => f.ruleId).sort(), plain);
      for (const f of flags) assert.equal(text.slice(f.start, f.end), f.quote);
    });
  }

  test("real Cyrillic and accented words are left alone; ligatures are spelt out", () => {
    assert.equal(readable("Мы продаём данные"), "Мы продаём данные");
    assert.equal(readable("café résumé"), "café résumé");
    assert.equal(readable(`pro${String.fromCharCode(0xfb01)}le`), "profile");
  });
});

describe("headings and curly quotes", () => {
  test("headings are not flagged; the sentences under them are", () => {
    for (const h of ["GitHub May Terminate", "Subject to Change", "AI Features, Training, and Your Data", "BILLING SCHEDULE; NO REFUNDS"]) {
      assert.ok(isHeading(h), h);
      assert.deepEqual(analyze(h), [], h);
    }
    for (const s of ["We may terminate your account at any time.", "We may sell your data.", "WE MAY SELL YOUR DATA."]) {
      assert.ok(!isHeading(s), s);
    }
  });

  test("a curly apostrophe reads like a straight one", () => {
    assert.equal(readable("We don’t sell “your” data"), `We don't sell "your" data`);
    assert.deepEqual(analyze("We don’t sell your personal information."), []);
  });
});

describe("speed on hostile text", () => {
  // Before the patterns were bounded, each of these took tens of seconds at this size.
  const cases: [string, string][] = [["a.b.", "a.b."], ["a'", "a'"], ["blank lines", "\n"], ["blank lines with a space", "\n "]];
  for (const [name, unit] of cases) {
    test(`200 KB of "${name}" is checked in under 2 seconds`, () => {
      const text = "We may sell your data. " + unit.repeat(200_000 / unit.length);
      const t0 = performance.now();
      analyze(text);
      const ms = performance.now() - t0;
      assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
    });
  }
});
