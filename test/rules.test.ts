import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyze } from "../src/engine.ts";
import { RULES } from "../src/rules.ts";
import { FIXTURES, NEUTRAL } from "./fixtures.ts";

// The rules on their own; test/model.test.ts covers the trained model on top.
const rulesHit = (text: string) => new Set(analyze(text, RULES, { model: false }).map((f) => f.ruleId));

for (const rule of RULES) {
  describe(rule.id, () => {
    const fx = FIXTURES[rule.id];

    test("has hit and miss fixtures", () => {
      assert.ok(fx?.hits.length && fx.misses.length, `add fixtures for "${rule.id}" in test/fixtures.ts`);
    });

    for (const s of fx?.hits ?? []) test(`flags: ${s}`, () => assert.ok(rulesHit(s).has(rule.id)));
    for (const s of fx?.misses ?? []) test(`skips: ${s}`, () => assert.ok(!rulesHit(s).has(rule.id)));
  });
}

describe("rule set", () => {
  test("neutral sentences flag nothing", () => {
    for (const s of NEUTRAL) assert.deepEqual([...rulesHit(s)], [], s);
  });

  test("rule ids are unique", () => {
    const ids = RULES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every fixture belongs to a real rule", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const key of Object.keys(FIXTURES)) assert.ok(ids.has(key), `fixture "${key}" has no rule`);
  });

  test("no pattern uses the g or y flag", () => {
    for (const r of RULES) {
      for (const re of [...r.match, ...(r.unless ?? [])]) assert.ok(!re.global && !re.sticky, `${r.id}: ${re}`);
    }
  });
});
