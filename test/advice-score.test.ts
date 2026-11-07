import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adviceFor } from "../src/advice.ts";
import { RULES } from "../src/rules.ts";
import { boundaryScore } from "../src/score.ts";

describe("advice", () => {
  test("every rule has an Add, Check and Tell", () => {
    for (const r of RULES) {
      const a = adviceFor(r.id, r.category);
      assert.ok(a.add && a.check && a.tell, r.id);
    }
  });

  test("AI points fall back to their category", () => {
    assert.ok(adviceFor(null, "money").add);
  });
});

describe("boundaryScore", () => {
  test("nothing flagged is 100, low risk", () => {
    assert.deepEqual(boundaryScore([]), { score: 100, label: "Low risk" });
  });

  test("a rule counts once however many sentences hit it", () => {
    const once = boundaryScore([{ ruleId: "sells_data", severity: "high" }]);
    const twice = boundaryScore([
      { ruleId: "sells_data", severity: "high" },
      { ruleId: "sells_data", severity: "high" },
    ]);
    assert.equal(once.score, 92);
    assert.equal(twice.score, 92);
  });

  test("dealbreakers cost extra, and the score never goes below 0", () => {
    assert.equal(boundaryScore([{ ruleId: "sells_data", severity: "high" }], new Set(["sells_data"])).score, 87);
    const many = RULES.map((r) => ({ ruleId: r.id, severity: "high" as const }));
    assert.deepEqual(boundaryScore(many), { score: 0, label: "High risk" });
  });

  test("AI points don't change the score", () => {
    assert.equal(boundaryScore([{ ruleId: null, severity: "high" }]).score, 100);
  });
});
