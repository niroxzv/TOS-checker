import type { Category } from "./types.ts";

// A next move for every flag, in the Add / Check / Tell habit from the
// Digital4Good "Spot It! Stop It!" field guide:
//   Add   - put a safeguard in place.
//   Check - verify it in settings or in the terms themselves.
//   Tell  - talk to someone, or speak up.
export interface Advice {
  add: string;
  check: string;
  tell: string;
}

const BY_RULE: Record<string, Advice> = {
  collects_location: {
    add: "Set the app's location permission to \"While using\" or \"Never\" in your phone settings.",
    check: "Turn off precise location if the app doesn't need to know your exact spot.",
    tell: "Ask friends before tagging them somewhere. Your location gives away theirs too.",
  },
  collects_contacts: {
    add: "Say no to contacts access and add friends by username instead.",
    check: "Look in your phone's privacy settings to see which apps can read your contacts.",
    tell: "Your contacts never agreed to this. Ask before you upload them.",
  },
  collects_biometrics: {
    add: "Skip face or voice features you don't really need.",
    check: "Find out if you can delete your face or voice data later.",
    tell: "Talk to a parent or trusted adult first. You can't change your face like a password.",
  },
  tracks_across_sites: {
    add: "Turn off app tracking: \"Allow Apps to Request to Track\" on iPhone, or delete your advertising ID on Android.",
    check: "On cookie banners, choose \"Reject all\" or \"Necessary only\".",
    tell: "Show a friend how to switch off tracking too.",
  },
  keeps_data_after_deletion: {
    add: "Delete your posts and messages yourself before you close the account.",
    check: "Read how long they keep your data after you leave.",
    tell: "Under Singapore's PDPA you can ask a company what personal data it holds about you.",
  },
  sells_data: {
    add: "Share as little as you can and skip the optional profile fields.",
    check: "Look in privacy settings for options to limit data sharing or personalised ads.",
    tell: "This is a big one. Talk to a parent or trusted adult before signing up.",
  },
  shares_data: {
    add: "Turn off personalised ads in the app's settings.",
    check: "Look for the list of \"partners\" in the privacy policy so you know who gets your data.",
    tell: "If you see data being misused, you can report it to the PDPC.",
  },
  broad_content_license: {
    add: "Think twice before posting art, music or photos of your face that you want to keep control of.",
    check: "Check whether their license ends when you delete your post.",
    tell: "Ask friends before posting photos of them. The app gets rights to their faces too.",
  },
  ai_training: {
    add: "Turn off \"use my data to improve the model\" if there's a setting for it.",
    check: "Find out if your chats are used for training and whether you can opt out.",
    tell: "Never share secrets, passwords or friends' private info with an AI chat.",
  },
  content_removal: {
    add: "Keep your own backup of anything you'd hate to lose.",
    check: "Read the community rules so you know what gets taken down.",
    tell: "If your post is removed by mistake, use the appeal button.",
  },
  arbitration: {
    add: "Look for an opt-out window. Many terms give you about 30 days.",
    check: "Check whether you can still use Singapore's Small Claims Tribunals.",
    tell: "Ask a parent or trusted adult if anything here is unclear before you agree.",
  },
  class_action_waiver: {
    add: "Screenshot the terms on the day you sign up.",
    check: "Check whether there's a way to opt out of this.",
    tell: "You can still complain to CASE or the Small Claims Tribunals. Keep screenshots.",
  },
  unilateral_change: {
    add: "Keep email notifications on so you hear about changes to the terms.",
    check: "When you get an update notice, read what actually changed.",
    tell: "If a change feels unfair, say so in reviews. Companies do back down.",
  },
  unilateral_termination: {
    add: "Back up your photos, chats and saves regularly.",
    check: "Read what can get you banned so it doesn't happen by surprise.",
    tell: "If you're banned unfairly, use the appeal process and keep screenshots.",
  },
  contract_by_using: {
    add: "Read this summary before you keep scrolling, because scrolling counts as agreeing.",
    check: "Look for a link to the full terms on the sign-up page.",
    tell: "Share this check with friends who use the same app.",
  },
  auto_renewal: {
    add: "Set a reminder a few days before the free trial ends.",
    check: "See what renews in your App Store or Google Play subscriptions.",
    tell: "Let whoever pays the card bill know before you start a trial.",
  },
  no_refunds: {
    add: "Try the free version first before you pay.",
    check: "Read the refund policy page, and the App Store or Google Play refund rules.",
    tell: "If you're charged unfairly, contact the company, then CASE.",
  },
  arbitration_opt_out: {
    add: "Put the opt-out deadline in your calendar now.",
    check: "Note exactly how to opt out: by email, a form or a letter.",
    tell: "Tell friends who use the app. Most people never know this exists.",
  },
};

const BY_CATEGORY: Record<Category, Advice> = {
  "data-collection": BY_RULE.collects_location,
  "data-sharing": BY_RULE.shares_data,
  "your-content": BY_RULE.broad_content_license,
  "your-rights": {
    add: "Screenshot the terms on the day you sign up.",
    check: "Talk to a parent or trusted adult before signing up for anything paid.",
    tell: "If something goes wrong, the Consumers Association of Singapore (CASE) can help.",
  },
  money: BY_RULE.auto_renewal,
  action: BY_RULE.arbitration_opt_out,
};

/** Advice for a flag. AI points have no rule id, so they get their category's advice. */
export function adviceFor(ruleId: string | null, category: Category): Advice {
  return (ruleId && BY_RULE[ruleId]) || BY_CATEGORY[category];
}
