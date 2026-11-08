import type { Category } from "./types.ts";

// One next move for every flag, shown as "Add": a safeguard you can put in place. Each line is different, so
// two flags never repeat the same advice (test/advice-score.test.ts checks that).
const BY_RULE: Record<string, string> = {
  collects_location: "Set the app's location access to \"While using\" or \"Never\", and turn off precise location.",
  collects_contacts: "Say no to contacts access and add friends by username instead.",
  collects_biometrics: "Skip face or voice features you don't need. Unlike a password, you can't change your face.",
  tracks_across_sites: "Turn off app tracking (\"Allow Apps to Request to Track\" on iPhone, delete your advertising ID on Android) and choose \"Reject all\" on cookie banners.",
  keeps_data_after_deletion: "Delete your posts and messages yourself before you close the account.",
  sells_data: "Leave optional profile fields empty. What you don't give them, they can't sell.",
  shares_data: "Turn off personalised ads in the app's settings.",
  broad_content_license: "Think twice before posting art, music or photos you want to keep control of.",
  ai_training: "Turn off \"use my data to improve the model\" if there's a setting for it, and keep secrets out of the chat.",
  content_removal: "Read the community rules so you know what gets taken down.",
  arbitration: "Look for an opt-out or a small-claims exception before you agree.",
  class_action_waiver: "You can still complain to CASE (the Consumers Association of Singapore) on your own.",
  unilateral_change: "Keep email notifications on so you hear when the terms change.",
  unilateral_termination: "Back up your photos, chats and saves somewhere else, in case your account is closed.",
  contract_by_using: "Read this summary before you carry on: using the service counts as agreeing.",
  limits_liability: "Keep receipts and screenshots of what you paid for, in case you need to claim.",
  choice_of_law: "Screenshot the terms on the day you sign up, so you know which version you agreed to.",
  jurisdiction: "For a small claim, ask Singapore's Small Claims Tribunals whether they can still hear it.",
  auto_renewal: "Set a reminder a few days before the free trial ends.",
  no_refunds: "Try the free version first before you pay.",
  arbitration_opt_out: "Put the opt-out deadline in your calendar now, and note how to opt out: email, form or letter.",
};

// For AI points, which have no rule.
const BY_CATEGORY: Record<Category, string> = {
  "data-collection": "Turn off any permission the app doesn't need in your phone's settings.",
  "data-sharing": "Find the list of partners in the privacy policy so you know who gets your data.",
  "your-content": "Only post what you'd be fine with them reusing.",
  "your-rights": "Ask a parent or trusted adult about anything here that's unclear before you agree.",
  money: "Check your App Store or Google Play subscriptions for anything that renews.",
  action: "Note what you need to do and by when.",
};

/** The next move for a flag. AI points have no rule id, so they get their category's. */
export function adviceFor(ruleId: string | null, category: Category): string {
  return (ruleId && BY_RULE[ruleId]) || BY_CATEGORY[category];
}

/** Every line, for the uniqueness test. */
export const ALL_ADVICE = [...Object.values(BY_RULE), ...Object.values(BY_CATEGORY)];
