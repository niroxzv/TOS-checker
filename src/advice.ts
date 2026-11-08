import type { Category } from "./types.ts";

// One next move for every flag, shown as "Add": a safeguard you can put in place, after the Add step of the
// Add / Check / Tell habit in the Digital4Good "Spot It! Stop It!" field guide. Each line is different, so
// two flags never repeat the same advice (test/advice-score.test.ts checks that).
const BY_RULE: Record<string, string> = {
  collects_location: "Set location to \"While using\" or \"Never\".",
  collects_contacts: "Say no to contacts; add friends by username.",
  collects_biometrics: "Skip face or voice features you don't need.",
  tracks_across_sites: "Turn off app tracking; pick \"Reject all\" on cookies.",
  keeps_data_after_deletion: "Delete your posts yourself before closing the account.",
  sells_data: "Leave optional profile fields empty.",
  shares_data: "Turn off personalised ads in settings.",
  broad_content_license: "Don't post work you want to control.",
  ai_training: "Turn off \"improve the model\" and keep secrets out.",
  content_removal: "Read the community rules first.",
  arbitration: "Look for an opt-out. CASE, Singapore's consumer body, can still help.",
  class_action_waiver: "You can still complain to CASE, Singapore's consumer body.",
  unilateral_change: "Keep email alerts on for term changes.",
  unilateral_termination: "Back up your photos, chats and saves.",
  contract_by_using: "Read this before carrying on: using means agreeing.",
  limits_liability: "Keep receipts and screenshots of what you paid.",
  choice_of_law: "Screenshot the terms the day you sign up.",
  jurisdiction: "Ask Singapore's Small Claims Tribunals about small claims.",
  auto_renewal: "Set a reminder before the free trial ends.",
  no_refunds: "Try the free version before you pay.",
  arbitration_opt_out: "Put the opt-out deadline in your calendar.",
};

// For AI points, which have no rule.
const BY_CATEGORY: Record<Category, string> = {
  "data-collection": "Turn off permissions the app doesn't need.",
  "data-sharing": "Check the privacy policy's partner list.",
  "your-content": "Only post what you'd let them reuse.",
  "your-rights": "Ask a trusted adult if anything's unclear.",
  money: "Check your app store for renewing subscriptions.",
  action: "Note what to do and by when.",
};

/** The next move for a flag. AI points have no rule id, so they get their category's. */
export function adviceFor(ruleId: string | null, category: Category): string {
  return (ruleId && BY_RULE[ruleId]) || BY_CATEGORY[category];
}

/** Every line, for the uniqueness test. */
export const ALL_ADVICE = [...Object.values(BY_RULE), ...Object.values(BY_CATEGORY)];
