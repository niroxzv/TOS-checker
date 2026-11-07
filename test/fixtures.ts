// Hand-written test sentences for each rule.
// hits:   the rule MUST flag these.
// misses: the rule must NOT flag these (negations, look-alikes, the user's own rights).
// When you find a real ToS sentence the engine gets wrong, add it here first, then fix the rule.

export const FIXTURES: Record<string, { hits: string[]; misses: string[] }> = {
  collects_location: {
    hits: [
      "We collect your precise location when the app is open.",
      "The app may access your device's GPS signal.",
    ],
    misses: ["We do not collect your location.", "Our offices are located in Singapore."],
  },
  collects_contacts: {
    hits: [
      "With your permission, the app will upload your address book to our servers.",
      "We may access your contacts to help you find friends.",
    ],
    misses: ["We never upload your contacts.", "Contact us if you have questions."],
  },
  collects_biometrics: {
    hits: [
      "We may collect biometric identifiers such as face geometry from photos you upload.",
      "Our app uses facial recognition to tag your friends.",
    ],
    misses: ["We do not collect biometric data.", "Upload a profile photo of your face."],
  },
  tracks_across_sites: {
    hits: [
      "We and our partners use cookies to track your activity across other websites.",
      "This site uses third-party advertising cookies.",
    ],
    misses: ["We do not track you across other websites.", "Our app is available across all devices."],
  },
  keeps_data_after_deletion: {
    hits: [
      "We may retain your information for up to two years after you delete your account.",
      "Deleted content may remain in our backups for a reasonable period.",
    ],
    misses: ["We will keep you informed after you cancel.", "We delete your data within 30 days of account closure."],
  },
  sells_data: {
    hits: [
      "We may sell your personal information to marketing companies.",
      "Your data may be sold to our partners.",
      "This includes the sale of personal data to data brokers.",
    ],
    misses: [
      "We do not sell your personal information.",
      "We don't sell or rent your data.",
      "When you buy products we sell, we store your order information.",
    ],
  },
  shares_data: {
    hits: [
      "We may share your personal information with our advertising partners.",
      "We disclose information to third parties who provide services on our behalf.",
    ],
    misses: ["We do not share your personal information with third parties.", "You can share photos with your friends."],
  },
  broad_content_license: {
    hits: [
      "By posting content, you grant us a worldwide, royalty-free, perpetual license to use, copy and modify it.",
      "You hereby grant the Company an irrevocable, sublicensable licence to your User Content.",
    ],
    misses: [
      "We grant you a limited, non-exclusive, non-transferable license to use the app.",
      "You retain ownership of the content you post.",
    ],
  },
  ai_training: {
    hits: [
      "We may use your content to train our AI models.",
      "Your prompts may be used for model training.",
      "We use customer data to develop and improve our artificial intelligence features.",
    ],
    misses: ["We do not use your content to train our AI models.", "We provide training to our support staff."],
  },
  content_removal: {
    hits: [
      "We may remove any content that we consider inappropriate, without notice.",
      "Posts that break these rules may be deleted.",
    ],
    misses: ["You can delete your posts at any time."],
  },
  arbitration: {
    hits: ["Any dispute will be resolved by binding individual arbitration."],
    misses: ["Moderators will not act in an arbitrary way."],
  },
  class_action_waiver: {
    hits: [
      "You waive any right to participate in a class action lawsuit.",
      "Both parties waive the right to a jury trial.",
    ],
    misses: ["Our premium class gives you more storage."],
  },
  unilateral_change: {
    hits: [
      "We may modify these Terms at any time without notice.",
      "We may make changes to these Terms from time to time.",
      "Acme reserves the right to change or update these terms at its sole discretion.",
      "Prices may be changed at any time.",
    ],
    misses: ["You may change your password at any time.", "We update the app regularly."],
  },
  unilateral_termination: {
    hits: [
      "We may suspend or terminate your account at any time for any reason.",
      "We reserve the right to disable your access to the Service without notice.",
      "Your account may be suspended without notice.",
    ],
    misses: [
      "You may close your account at any time from the settings page.",
      "You can contact us to close your account.",
      "You may terminate your account at any time.",
    ],
  },
  contract_by_using: {
    hits: [
      "By using the Service, you agree to be bound by these Terms.",
      "Your continued use of the Site constitutes acceptance of the updated Terms.",
    ],
    misses: ["Please read these Terms before you use the app."],
  },
  limits_liability: {
    hits: [
      "In no event will Acme be liable for any indirect or consequential damages.",
      "Our total liability to you will not exceed $100.",
      "We are not responsible for any loss of data or profits caused by outages.",
    ],
    misses: ["You are responsible for keeping your password safe."],
  },
  choice_of_law: {
    hits: ["These Terms are governed by the laws of the State of Delaware."],
    misses: ["We comply with applicable data protection laws."],
  },
  jurisdiction: {
    hits: [
      "You agree to submit to the exclusive jurisdiction of the courts located in Santa Clara County, California.",
      "The courts of Ireland will have jurisdiction over any dispute.",
    ],
    misses: ["Some jurisdictions do not allow the exclusion of certain warranties."],
  },
  auto_renewal: {
    hits: [
      "Your subscription will automatically renew each month until you cancel.",
      "Plans renew automatically at the then-current price.",
    ],
    misses: ["You can renew your plan manually from the billing page."],
  },
  no_refunds: {
    hits: ["All payments are non-refundable.", "We do not offer refunds for partial months."],
    misses: ["You can request a refund within 14 days of purchase."],
  },
  arbitration_opt_out: {
    hits: ["You can opt out of this arbitration agreement by emailing us within 30 days."],
    misses: ["You can opt out of marketing emails at any time."],
  },
};

// Tricky real-world-style cases found by red-teaming the rules, merged into FIXTURES above.
const RED_TEAM: Record<string, { hits?: string[]; misses?: string[] }> = {
  sells_data: {
    misses: [
      "We do not knowingly sell the personal information of users under 16.",
      "We do not, and will not, sell your personal information.",
    ],
  },
  shares_data: {
    hits: ["We may share your watch history and other usage information with our partners so they can show you relevant ads."],
    misses: [
      "We do not rent, sell or share your personal information with third parties for their own marketing.",
      "Your health information will never be shared with advertisers or data brokers.",
    ],
  },
  collects_biometrics: {
    hits: ["You can approve payments with your fingerprint, which we store in encrypted form on our servers."],
    misses: ["Biometric data is not collected, stored or shared by our games.", "Video quality may be reduced on older devices without a Retina display."],
  },
  ai_training: {
    hits: ["We do not sell your data, but we may use your chats to train our models."],
    misses: ["Your conversations are never used to train our AI models.", "Your training plan is generated by our coaching algorithm based on the workouts you log."],
  },
  class_action_waiver: {
    hits: ["Each of us gives up the right to have a dispute heard by a jury."],
    misses: ["Our store features world-class action and adventure games for every age."],
  },
  unilateral_change: {
    hits: ["All prices and plan features are subject to change without notice."],
    misses: ["We last updated this Privacy Policy on 2 March 2026."],
  },
  unilateral_termination: {
    hits: [
      "Accounts found using cheats or exploits may be permanently banned.",
      "You may cancel your membership at any time, and we may suspend or close your account if you break these Terms.",
    ],
    misses: ["We may show banner ads to people using free accounts."],
  },
  jurisdiction: {
    misses: ["The venue for each live tournament will be announced on our Discord server at least two weeks before the event."],
  },
  no_refunds: {
    hits: ["Virtual currency cannot be refunded or exchanged for real money.", "We don't give refunds for months you have only partly used."],
  },
  auto_renewal: {
    misses: ["Gift subscriptions and prepaid plans do not renew automatically."],
  },
  contract_by_using: {
    hits: ["By creating an account or using BrightBoard, you agree to these Terms."],
  },
};
for (const [id, extra] of Object.entries(RED_TEAM)) {
  FIXTURES[id].hits.push(...(extra.hits ?? []));
  FIXTURES[id].misses.push(...(extra.misses ?? []));
}

// Ordinary sentences that no rule should flag.
export const NEUTRAL = [
  "Welcome to Acme Notes.",
  "Please read these Terms carefully.",
  "You must be at least 13 years old to use the Service.",
  "Contact us at support@acme.example if you have questions.",
  "You are responsible for keeping your password safe.",
  "We use encryption to protect your data in transit.",
  // UNFAIR-ToS labels "not responsible for other users' content" as fair: a fact, not a cap on what they owe you.
  "We are not responsible for content posted by other users.",
];
