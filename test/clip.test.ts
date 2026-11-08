import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { clipAround } from "../src/clip.ts";
import { analyze } from "../src/engine.ts";

describe("clipAround", () => {
  const long = "This means that, except for certain types of disputes mentioned below, you and we both waive the right to a jury trial in any court.";

  test("short text is left alone", () => {
    assert.equal(clipAround("We may sell your data.", 90), "We may sell your data.");
  });

  test("cuts at whole words and stays near the limit", () => {
    const out = clipAround(long, 60);
    assert.ok(out.length <= 62, out);
    assert.match(out, /…$/);
    assert.ok(!/\w…$/.test(out.replace(/\s\S*…$/, "")), out);
    for (const word of out.replace(/…/g, "").split(" ")) assert.ok(long.includes(word), word);
  });

  test("keeps the matched words in view", () => {
    const at = long.indexOf("waive");
    const out = clipAround(long, 60, at);
    assert.match(out, /^…/);
    assert.match(out, /waive the right to a jury trial/);
  });

  test("the engine records where the rule matched", () => {
    const [flag] = analyze(long).filter((f) => f.ruleId === "class_action_waiver");
    assert.ok(flag && flag.at !== undefined && flag.at > 0, JSON.stringify(flag));
  });
});
