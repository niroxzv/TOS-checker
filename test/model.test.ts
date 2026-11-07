import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyze } from "../src/engine.ts";
import { modelLabels, scoreClause } from "../src/model.ts";
import { MODEL } from "../src/model-weights.ts";
import { RULES } from "../src/rules.ts";

const types = (s: string) => new Set(analyze(s).map((f) => RULES.find((r) => r.id === f.ruleId)?.unfairTos).filter(Boolean));

describe("trained model", () => {
  test("weights are well formed", () => {
    assert.equal(MODEL.labels.length, 8);
    assert.equal(MODEL.idf.length, MODEL.vocab.length);
    for (const w of MODEL.weights) assert.equal(w.length, MODEL.vocab.length);
    for (const w of MODEL.ruleWeights) assert.equal(w.length, MODEL.ruleIds.length);
    const ids = new Set(RULES.map((r) => r.id));
    for (const id of MODEL.ruleIds) assert.ok(ids.has(id), `model knows a rule that no longer exists: ${id}`);
  });

  test("gives probabilities", () => {
    for (const p of scoreClause("We may change these terms at any time.", new Set()).values()) assert.ok(p >= 0 && p <= 1);
  });

  test("finds clear cases", () => {
    assert.ok(types("These terms are governed by the laws of the State of California.").has("Choice of law"));
    assert.ok(types("Any dispute will be resolved by binding arbitration.").has("Arbitration"));
    assert.ok(types("We may suspend or terminate your account at any time for any reason.").has("Unilateral termination"));
    assert.ok(types("In no event shall we be liable for any indirect or consequential damages.").has("Limitation of liability"));
  });

  test("leaves plain sentences alone", () => {
    for (const s of ["You can change your profile picture at any time.", "Contact us at support@example.com.", "Welcome to our service!"]) {
      assert.deepEqual([...modelLabels(s, new Set())], [], s);
    }
  });

  test("never re-adds a type a rule ruled out", () => {
    assert.ok(!types("You may terminate your account at any time.").has("Unilateral termination"));
  });

  test("catches what the rules miss, and can be turned off", () => {
    const s = "We reserve the right to modify or terminate free trials at any time, without notice and in our sole discretion.";
    assert.ok(analyze(s).some((f) => f.ruleId === "unilateral_termination"));
    assert.ok(!analyze(s, RULES, { model: false }).some((f) => f.ruleId === "unilateral_termination"));
  });
});
