import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/engine.ts";

// Sentences from real terms that used to land on a card whose summary they don't support.
const cases: [string, string][] = [
  ["no_refunds", "You will pay the non-refundable Initial Filing Fee and the non-refundable Administrative Fee."],
  ["choice_of_law", "Subject to applicable law, we reserve the right to suspend or terminate your account."],
  ["class_action_waiver", "This does not prevent either party from participating in a class-wide settlement."],
  ["limits_liability", "Nothing in these terms will limit Spotify's liability for fraud."],
  ["shares_data", "We will share your information with law enforcement agencies, public authorities or other organisations if required by law."],
  ["jurisdiction", "Disputes between us will be resolved by mandatory binding arbitration instead of a proceeding in court."],
  ["content_removal", "Nothing in these Terms will exclude or limit any responsibility we may have to remove content."],
];

for (const [ruleId, sentence] of cases) {
  test(`${ruleId} skips: ${sentence.slice(0, 50)}…`, () => {
    assert.ok(!analyze(sentence).some((f) => f.ruleId === ruleId));
  });
}

test("the real points still flag", () => {
  const ids = (s: string) => analyze(s).map((f) => f.ruleId);
  assert.ok(ids("Payments are non-refundable, except where required by law.").includes("no_refunds"));
  assert.ok(ids("These Terms are governed by the laws of the State of California.").includes("choice_of_law"));
  assert.ok(ids("You waive any right to participate in a class-action lawsuit.").includes("class_action_waiver"));
});
