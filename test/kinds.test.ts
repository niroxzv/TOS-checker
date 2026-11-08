import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, kindSay, rulesOfKind } from "../src/kinds.ts";

test("the jury / class-action waiver shares the arbitration card", () => {
  assert.equal(kindOf("class_action_waiver"), "arbitration");
  assert.equal(kindOf("arbitration"), "arbitration");
  assert.equal(kindOf("sells_data"), "sells_data");
});

test("OK / Not OK on the card covers both rules", () => {
  assert.deepEqual(rulesOfKind("class_action_waiver"), ["arbitration", "class_action_waiver"]);
  assert.deepEqual(rulesOfKind("sells_data"), ["sells_data"]);
});

test("the merged summary shows only when both rules fired", () => {
  assert.match(kindSay(["arbitration", "class_action_waiver"], "x"), /arbitration.*jury/);
  assert.equal(kindSay(["class_action_waiver"], "own"), "own");
});
