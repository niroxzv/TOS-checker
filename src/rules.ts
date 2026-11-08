import type { Rule } from "./types.ts";

// How rules work
// - Each rule is checked against one clause (roughly one sentence) at a time.
// - `match`: flag the clause if ANY pattern hits. `unless`: skip it if ANY of these hit too.
// - Gaps like [^.]{0,60} keep a match inside one sentence.
// - Never use the /g or /y flag here: it makes RegExp.test() remember its position between calls.

/** Matches "not / never / cannot / don't" right before one of the verbs, e.g. denies("sell|rent"). */
const denies = (verbs: string) => new RegExp(String.raw`(?:\bnot|\bnever|\bcannot|n't),?\s+(?:(?!only\b)(?:\w+,|\w+\s+(?:or|and)|\w+ly|be)\s+){0,2}(?:${verbs})\w*`, "i");

/**
 * "They may": the company gives itself a power. Real terms often use the company's name instead of "we"
 * ("Airbnb may…", "Linden Lab further reserves the right…"), so any subject counts except you or the users.
 */
const NOT_THEM = String.raw`(?!(?:you|your|users?|members?|it|this|that|these|those|which|who|they|i|and|or|but|nor|not|there|as|if|terms?|agreement|features?|software|material|services?|products?|content|apps?|administrator|guidelines|policies|prices?|rules)\b)`;
// The name is capped at 40 characters: left open, a long run like "a.b.a.b." takes seconds to rule out.
const THEY_MAY = String.raw`\b${NOT_THEM}[a-z][\w.'&-]{0,40},?\s+(?:also\s+|further\s+|nevertheless\s+|expressly\s+|hereby\s+|\(?at\s+(?:its|our)\s+(?:sole\s+)?discretion\)?,?\s+)?(?:(?:may|can|might)(?!\s+(?:not\b|be\b|only\b|ask\b|require\b|provide\b|send\b|apply\b))|reserves?|retains?|has\s+the\s+right|have\s+the\s+right|shall\s+have\s+the\s+right|is\s+entitled|are\s+entitled)\b`;
/** A verb with its object close behind, e.g. near("remove|delete", "content"). */
const near = (verbs: string, objects: string, gap = 80) => String.raw`\b(?:${verbs})\w*\b[^.]{0,${gap}}?\b(?:${objects})\b`;
/** Every lookahead must hit somewhere in the clause, in any order. */
const all = (...parts: string[]) => new RegExp("^" + parts.map((p) => `(?=.*?${p})`).join(""), "is");

/**
 * A rule for you, not a power of theirs: "you may not…", "you agree not to…", "we recommend that you…".
 * "You may not be able to…" and "you won't be told…" are about what happens to you, so they don't count.
 */
const FOR_YOU = /\b(?:you|users?)\s+(?:(?:may|must|shall|will|should)\s+not|(?:won|mustn|shouldn)'t)\b(?!\s+be\b)|\b(?:you|users?)\s+(?:agree|promise|undertake)\s+not\s+to\b|\b(?:you|users?)\s+are\s+not\s+(?:allowed|permitted)\b|\brecommend\s+that\s+you\b/i;
/** An item of a "don't do this" list (an acceptable use policy): it starts with an order, e.g. "Misuse, collect… biometric data". */
const DONT_LIST_ITEM = /^\W*(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:misuse|solicit|target|utili[sz]e|exploit|infer|harvest|scrape|distill|circumvent|impersonate)\b/i;
const BIOMETRIC = String.raw`\b(?:biometrics?|facial (?:geometry|recognition)|face ?prints?|voice ?prints?|fingerprints?|face (?:geometry|data|scans?)|retina scans?|iris scans?)\b`;

export const RULES: Rule[] = [
  // ── What they collect ─────────────────────────────────────────────
  {
    id: "collects_location",
    category: "data-collection",
    severity: "medium",
    say: "They collect your location.",
    match: [/\b(collect|track|access|gather|obtain|receive)\w*\b[^.]{0,60}\b(location|GPS|geolocation)\b/i,
      /\b(location|GPS|geolocation)\b[^.]{0,20}\b(collected|tracked|accessed)\b/i],
    unless: [denies("collect|track|access|gather|obtain|receive"), FOR_YOU, DONT_LIST_ITEM],
  },
  {
    id: "collects_contacts",
    category: "data-collection",
    severity: "medium",
    say: "They collect your contacts.",
    match: [/\b(collect|access|upload|import|sync)\w*\b[^.]{0,60}\b(contacts|address book|contact list|phone ?book)\b/i,
      /\b(contacts|address book|contact list)\b[^.]{0,20}\b(uploaded|synced|imported|collected|accessed)\b/i],
    unless: [denies("collect|access|upload|import|sync"), FOR_YOU, DONT_LIST_ITEM],
  },
  {
    id: "collects_biometrics",
    category: "data-collection",
    severity: "high",
    say: "They collect biometric data, like your face or voice.",
    // A biometric word and something done with it. A bare mention ("never upload biometric data") isn't enough.
    match: [all(BIOMETRIC, String.raw`\b(?:(?:collect|process|captur|receiv|obtain|access|extract|analy[sz]|generat|deriv|retain|disclos)\w*|use[sd]?|using|stor(?:e|es|ed|ing)|keeps?|kept|shar(?:e|es|ed|ing)|sells?|sold)\b`)],
    unless: [denies("collect|use|store|process|capture|receive|extract|mine"), FOR_YOU, DONT_LIST_ITEM,
      // "This includes using our products for facial recognition": you using their product, in a usage policy.
      /\b(?:includes?|including)\s+using\s+(?:our|the|its)\s+(?:products?|services?|models?)\b/i],
  },
  {
    id: "tracks_across_sites",
    category: "data-collection",
    severity: "medium",
    say: "They track you on other sites and apps.",
    match: [
      // Not "across your devices": that's their own app on your phone and laptop, not other sites.
      /\b(track|collect|monitor|follow)\w*\b[^.]{0,80}\b(across|on other)\b[^.]{0,40}\b(websites|sites|apps|applications|services)\b/i,
      /\b(third[- ]party|advertising)\s+(cookies|trackers|pixels)\b/i,
      // "Advertisers share information with us about … actions you have taken outside of the Platform"
      /\b(activit(y|ies)|actions?|browsing|what you do)\b[^.]{0,60}\b(outside (of )?(the|our) (platform|services?|apps?|sites?)|on other (websites|sites|apps|platforms))\b/i,
    ],
    unless: [denies("track|follow|monitor|use (?:third[- ]party|advertising)"), /\bno\s+(third[- ]party|advertising)\s+(cookies|trackers|pixels)\b/i, FOR_YOU],
  },
  {
    id: "keeps_data_after_deletion",
    category: "data-collection",
    severity: "medium",
    say: "They may keep your data after you delete your account.",
    match: [
      /\b(retain|keep|store|preserve)\w*\b[^.]{0,60}\b(data|information|content|records)\b[^.]{0,80}\b(after|following|even if)\b[^.]{0,40}\b(delet|terminat|clos|cancel)/i,
      /\b(data|information|content)\b[^.]{0,40}\b(retained|kept|stored)\b[^.]{0,80}\b(after|following|even if)\b[^.]{0,40}\b(delet|terminat|clos|cancel)/i,
      /\b(remain|persist)\w*\b[^.]{0,40}\b(backups?|(?<!your )archives?)\b/i,
    ],
    unless: [denies("retain|keep|store|preserve"), /\bonly (while|as long as)\b/i],
  },

  // ── Who they give it to ───────────────────────────────────────────
  {
    id: "sells_data",
    category: "data-sharing",
    severity: "high",
    say: "They may sell your personal data.",
    match: [
      /\b(sell|sells|selling|rent|rents|renting)\b[^.,;]{0,60}\b(data(?! plans?\b)|information)\b/i,
      /\b(data|information)\b[^.,;]{0,20}\b(sold|rented)\b/i,
      /\bsale of\b[^.,;]{0,30}\b(data|information)\b/i,
    ],
    unless: [denies("sell|rent|be sold|be rented|sold|rented"), FOR_YOU,
      // "not based on selling your personal information", "we don't make money from selling it"
      /(?:\bnot|\bnever|n't)\s+(?:\w+\s+){0,3}(?:from|by|on|through)\s+(?:selling|renting)\b/i],
  },
  {
    id: "shares_data",
    category: "data-sharing",
    severity: "medium",
    say: "They share your data with other companies.",
    // Needs all three in one clause: a sharing verb, an outside company, and data.
    match: [
      /^(?=.*\b(share[sd]?|sharing|disclose[sd]?|disclosing|transfer(s|red)?)\b)(?=.*\b(third[- ]part(y|ies)|advertisers|partners|affiliates|data brokers|new owners?|successors?)\b)(?=.*\b(data|information)\b)/is,
    ],
    unless: [denies("share|disclose|transfer"), /\bno third[- ]part(y|ies)\b/i, FOR_YOU,
      // Others sharing with them ("authorize third-party services to share data with us") is the other way round.
      /\bshar\w*\s+(?:[\w,'-]+\s+){0,6}?with\s+us\b/i,
      // "Confidential Information" clauses are about their secrets you must keep, not your data.
      /\bconfidential information\b/i],
  },

  // ── What happens to your content ──────────────────────────────────
  {
    id: "broad_content_license",
    category: "your-content",
    severity: "high",
    say: "They can use what you upload, for free, often forever.",
    // "you (hereby) grant ..." + a broad-license word + "license". Ignores the license *they* give *you*.
    match: [
      /^(?=.*\byou(\s+(?!we\b)\w+){0,3}\s+(grant\w*|give)\b)(?=.*\b(perpetual|irrevocable|worldwide|world-wide|royalty[- ]free|sublicensable)\b)(?=.*\b(licen[cs]e|right)s?\b)/is,
    ],
    unless: [denies("grant|give"), /\byou\s+(?:are|have\s+been)\s+(?:\w+\s+)?granted\b/i], // "you are hereby granted" a license: theirs to you
  },
  {
    id: "ai_training",
    category: "your-content",
    severity: "high",
    say: "They may use your content or data to train AI.",
    match: [
      /\b(train(s|ed|ing)?|fine[- ]tun\w*)\b(?!\s+plans?\b)[^.]{0,60}\b(AI|artificial intelligence|machine[- ]learning|models?|algorithms?|LLMs?)\b/i,
      /\b(AI|artificial intelligence|machine[- ]learning|models?|LLMs?)\b[^.]{0,20}\btrain(s|ed|ing)?\b/i,
      /\b(develop|improve)\b[^.]{0,40}\b(AI|artificial intelligence|machine[- ]learning)\b/i,
    ],
    unless: [
      /(?:\bnot|\bnever|n't)\b[^.,]{0,30}\b(use|train)\w*\b[^.]{0,40}\b(your|customer|user|AI|models?)\b/i,
      // A rule for you, not them: don't use the service or what it generates to build a competing AI
      // (distillation). Often an item in a "you must not" list, so the clause itself has no "not".
      /\b(compet(e|es|ing|itive|itors?)|distill\w*|reverse[- ]engineer\w*)\b/i,
      FOR_YOU,
      DONT_LIST_ITEM,
      // Training *any* or *other* models is about you ("training other models", "scraping to train any AI model").
      // Not "develop other products and services, including training our models": that one is theirs.
      /\b(?:develop\w*|train\w*)\s+(?:or\s+\w+\s+)?(?:any|other|another|your\s+own)\s+(?:[\w-]+\s+){0,3}?(?:models?|AI|artificial intelligence|LLMs?)\b/i,
      // Permission for you: "(3) You may apply the Inputs and Outputs to … training other models".
      // "You may opt out of model training" still flags: it means they train on your data unless you do.
      /^\W*(?:\(?[a-z0-9]{1,3}[.)]\s*)?you\s+(?:may|can)\b(?!\s+(?:also\s+)?opt\b)/i,
      // About how their models work, not what they do with your data.
      /\btraining\s+(?:methods?|process(?:es)?|mechanisms?)\b|\bmodel'?s?\s+(?:mechanism|principles)\b|\b(?:model'?s?|static)\s+training\s+data\b/i,
      // "This license does not, however, permit GitHub to share your Inputs … for model training"
      /\b(?:does|do|will|shall)\s+not\b[^.]{0,30}\b(?:permit|allow|authori[sz]e)\b/i,
    ],
  },
  {
    id: "content_removal",
    category: "your-content",
    severity: "low",
    unfairTos: "Content removal",
    say: "They can remove your content without asking you.",
    match: [
      all(THEY_MAY, near("remov|delet|take down|disabl|disallow|block|edit|screen|reject|refus\\w* to (?:post|display|surface)|reclaim|eliminat|delay|modify|regulate|withdraw|cancel(?= a user ?name)",
        "content|posts?|postings?|uploads?|materials?|submissions?|listings?|reviews?|messages?|emails|photos|user ?names?|account names?|virtual (?:items|goods|money)|digital goods|(?:in-game|game) currency|name|label")),
      /\b(removal|deletion|modification)\s+of\s+(any\s+)?(posting|material|content|submission)s?\b/i,
      /\bsubject to\b[^.]{0,40}\b(modification|deletion|removal)\b/i,
      /\bno obligation to (store|retain|publish|make available)\b[^.]{0,40}\bcontent\b/i,
      /\b(removed|deleted)\/(removed|deleted)\b/i,
      /\b(content|posts?|materials?|submissions?)\b[^.]{0,40}\b(may|can) be\b[^.]{0,20}\b(removed|deleted|taken down|disabled|edited)\b/i,
      /\b(deletion|loss) of (all |any )?(your )?(user )?content\b/i,
      /\blose\b[^.]{0,60}\b(user ?names?|content|items)\b/i,
      /\b(disabling|terminat\w*)\b[^.]{0,40}\baccess\b[^.]{0,60}\bcontent\b/i,
    ],
    unless: [denies("remov|delet|take down|disabl|block|edit"), /\b(if|when|once) you (delete|close|deactivate)\w* your account\b/i,
      /\b(dmca|notice of (claimed )?infringement)\b/i, /\bif your subscription\b/i],
  },

  // ── Your rights ───────────────────────────────────────────────────
  {
    id: "arbitration",
    category: "your-rights",
    severity: "high",
    unfairTos: "Arbitration",
    say: "Disputes go to private arbitration, not court.",
    // Flags the sentence that sends disputes to arbitration, not every sentence of the arbitration section
    // (who picks the arbitrator, the fees, the location...). One clear flag is more useful than thirty.
    match: [
      all(String.raw`\b(disputes?|claims?|controvers(y|ies))\b`,
        String.raw`\b(resolved|settled|submitted|determined|decided|governed|referred|subject)\b[^.]{0,60}\barbitra(tion|l)\b`),
      /\b(agree|consent)(s|d)?\s+(to\s+)?(arbitrate\b[^.]{0,30}\b(any|all|claims?|disputes?)|(be bound by )?(this|the) arbitration (clause|agreement|provision)|(final\s+and\s+)?binding\s+(individual\s+)?arbitration)\b/i,
      /\b(resolve|settle)\w*\b[^.]{0,80}\b(through|by|in|via)\s+(final\s+and\s+)?(binding|mandatory|individual)(\s+individual)?\s+arbitration\b/i,
      /^arbitration notice\b/i,
      /\bempower\w* the arbitrator\b/i,
      /\barbitration\b[^.]{0,20}\b(rather|instead) (than|of)\b[^.]{0,20}\bcourts?\b/i,
      /\bexclusive means of resolving\b[^.]{0,120}\barbitration\b/i,
      /\bonly through arbitration\b/i,
      /\bsubmit\b[^.]{0,30}\b(binding|exclusive|individual)\b[^.]{0,20}\barbitration\b/i,
      /\b(contain|affect|include)s?\s+(a\s+)?binding\s+arbitration\s+(provision|agreement|clause)\b/i,
      /\barbitration clause and class action waiver\b[^.]{0,40}\baffects?\b/i,
    ],
    unless: [/\b(not|never)\s+(contain|require|include|use)\w*\s+(an?\s+)?arbitration\b/i, /\bnot (obliged|required) to participate\b/i,
      /\bopt[- ]?out of (this|the) agreement to arbitrate\b/i, /\bnot (subject to|required to be resolved through) arbitration\b/i,
      /\bgoverned by the (us |u\.s\. )?(federal )?arbitration act\b/i, /\bin your favou?r\b/i, /\bshall be a retired judge\b/i,
      // Details around the clause, not the clause itself: not mixing claims, the Federal Arbitration Act line,
      // class-arbitration waivers, and court clauses that only point to the arbitration section.
      /\bnot (to )?combine\b/i, /\barbitration act\b[^.]{0,40}\bgoverns?\b/i, /\bclass arbitration\b/i,
      /\bnot subject to (the )?[^.]{0,12}arbitration\b/i,
      /\bsubject to (the )?([\w"'-]+ ){0,4}arbitration (provisions?|section|clause|agreement)\b/i],
  },
  {
    id: "class_action_waiver",
    category: "your-rights",
    severity: "high",
    say: "You give up jury trials and group lawsuits.",
    match: [
      /(?<!-)\b(class|collective|representative)[- ](action|arbitration|proceeding|lawsuit|claim)s?\b/i,
      /\bclass[- ]wide\b/i,
      /\b(jury trial|trial by jury|by a jury)\b/i,
    ],
  },
  {
    id: "unilateral_change",
    category: "your-rights",
    severity: "medium",
    unfairTos: "Unilateral change",
    say: "They can change the terms or prices anytime.",
    match: [
      all(THEY_MAY, near("chang|modif|amend|updat|revis|increas|rais|add(?:s|ed)?\\b|alter|improve|enhance",
        "terms|agreement|agreements|polic(?:y|ies)|prices?|pricing|fees?|charges|rates|services?|platform|features?|functionality|warnings|products?|rules|eula|subscriptions?|virtual (?:goods|items|money|currency)|payment methods|practices|trial", 60)),
      /\b(terms|agreement|polic(y|ies)|service|prices?|fees?)\b[^.]{0,40}\b((may|can) be\b[^.]{0,30}\b(changed|modified|amended|updated|revised)|subject to change)\b/i,
      /\b(makes?|post\w*)\s+(any\s+)?changes to (these|this|the|our)\s+(terms|agreement)\b/i,
      /\b(review|check|look at)\b[^.]{0,40}\b(terms|agreement|polic(y|ies)|page)\b[^.]{0,40}\b(periodically|regular|frequent|from time to time)\w*/i,
      /\bregularly (check|review|look)\b/i,
      /\bsubject to change\b/i,
      /\b(may|can|will)\s+change\s+(from time to time|at any time|without (prior )?notice)\b/i,
      /\bchanges (shall|will) (become|be) effective\b/i,
      /\bresponsible for reviewing\b[^.]{0,40}\bmodifications\b/i,
      /\b(we|\w+) may\b[^.]{0,30}\bmake changes to\b/i,
      /\bbound by\b[^.]{0,20}\b(amended|revised|updated|modified|changed)\s+(terms|agreement|version)\b/i,
    ],
    unless: [denies("chang|modif|amend|updat|revis|increas|rais"), /\b(last|recently) (updated|revised|modified|changed|amended)\b/i,
      /\b(notices?|inform\w*|notify\w*)\s+(you\s+)?(with\s+)?(notices?\s+)?(of|regarding|about|including those regarding)\s+(material\s+)?(the\s+)?changes\b/i,
      /\b(vacate|confirm)\b[^.]{0,20}\baward\b/i,
      /\b(correct|error)\b[^.]{0,40}\border\b/i, /\bdelete or change any account name\b/i],
  },
  {
    id: "unilateral_termination",
    category: "your-rights",
    severity: "medium",
    unfairTos: "Unilateral termination",
    say: "They can close your account at any time.",
    match: [
      all(THEY_MAY, near("suspend|terminat|disabl|deactivat|clos|cancel(?!lation)|ban(?!ner)|revok|restrict(?= (?:your )?(?:access|use))|deny|limit(?= (?:your )?(?:access|use))|discontinu|stop offering",
        "accounts?|access|agreement|licen[cs]e|subscriptions?|membership|privileges|right to use|use of|ability to (?:access|use)|service|services|relationship")),
      /\b(suspend|terminat|disabl|deactivat)\w*\b[^.]{0,40}\b(accounts?|access)\b[^.]{0,60}\b(at any time|for any reason|without (prior )?notice|sole discretion)\b/i,
      /\b(accounts?|access|licen[cs]e|right)\b[^.]{0,40}\b(may|will|can) be\b[^.]{0,20}\b(suspended|terminated|disabled|deactivated|banned|revoked)\b/i,
      /\b(result in|lead to)\b[^.]{0,40}\b(termination|suspension|revocation|deactivation)\b/i,
      /\b(automatically|immediately)\s+terminates?\b[^.]{0,30}\b(your|the)\b/i,
      /\bpolicy\b[^.]{0,40}\b(terminat|disabl)\w*\b[^.]{0,80}\b(accounts?|privileges)\b/i,
      /\b(adopted|have) a policy of terminating\b/i,
      /\byour right to use\b[^.]{0,40}\b(cease|end)\w*\b/i,
      /\b(may|can|might|will|right to)\s+(also\s+)?stop\s+(\([^)]*\)\s+)?providing\b/i,
      /\bgrounds for (the )?(immediate )?(terminat|suspen|cancel)\w*/i,
      /\b(has|have|retains?)\s+(the\s+)?(sole\s+|absolute\s+|full\s+)?discretion\b[^.]{0,60}\b(terminat|suspend|disabl)\w*\b[^.]{0,40}\b(accounts?|access|users?)\b/i,
      /\bterminate[sd]?\s+automatically\b|\bautomatically\s+terminate[sd]?\s+if\b/i,
      all(THEY_MAY, near("withdraw", "access|right to use|service|services|subscriptions?")),
      all(THEY_MAY, near("suspend|terminat|disabl|deactivat|ban(?!ner)", "users?")),
    ],
    // "You may terminate your account" is your right, not theirs.
    // Known gap: a clause giving both sides that right is skipped too.
    unless: [new RegExp(String.raw`^(?!.*${THEY_MAY}).*\byou\s+((may|can|have the ability to)\s+)?(terminat|cancel|clos|delet|disabl)\w*`, "is"),
      /\bwhile we address\b/i, /\b(dmca|notice of (claimed )?infringement)\b/i, /\bunder 13\b/i,
      /\b(maintenance|repair)\b/i, /\bright to cancel\b[^.]{0,40}\bwithin\b/i, /\bautomatically terminate at the end\b/i],
  },
  {
    id: "contract_by_using",
    category: "your-rights",
    severity: "medium",
    unfairTos: "Contract by using",
    say: "Just using it counts as agreeing.",
    match: [
      /\bby (\w+ing\s+(\w+\s+){0,2}or\s+)?(accessing|using|visiting|browsing|downloading|installing|continuing to use)\b[^.]{0,80}\b(agree|accept|consent)\w*\s+(to\s+)?(comply|be bound|these|this|the|our)\b/i,
      /\b(continue|keep) (to use|using)\b[^.]{0,60}\b(agree|accept|consent)/i,
      /\b(use|access) of (the|our|this) (site|services?|app|website|platform)\b[^.]{0,40}\b(constitutes|means|signifies|indicates) (your )?(acceptance|agreement|consent)/i,
      /\bcontinued\s+(use|access)\b[^.]{0,120}\b(constitut|indicat|confirm|mean|signif|deem)\w*\b[^.]{0,20}\b(acceptance|agreement|consent|accept)/i,
      /\b(deemed|considered)\s+to\s+have\s+(accepted|agreed)\b[^.]{0,60}\b(using|use|continuing)\b/i,
      /\byou accept\b[^.]{0,30}\bterms\b[^.]{0,10}\bby (using|accessing|continuing)\b/i,
      /\bin order to (access|use)\b[^.]{0,40}\byou agree to\b/i,
      /\b(when|if|once) you\b[^.]{0,30}\b(use|access)\b[^.]{0,60}\byou agree to be bound\b/i,
      /\b(accepting|agreeing to)\b[^.]{0,30}\bor using\b[^.]{0,60}\b(agree|accept)\w* to be bound\b/i,
      /\bby\s+(\w+\s+){0,3}?(creating|signing up|registering|installing|accessing|using|visiting|browsing|downloading|clicking|continuing|ordering)\b.{0,220}?\byou\b[^.]{0,40}\b(agree|accept|consent|acknowledge|confirm)\w*/is,
      /\b(when|whenever|if|once) you\b[^.]{0,40}\b(use|sign up|access|install|make a payment)\w*\b[^.]{0,80}\byou\s+(also\s+)?(agree|accept|consent)\w*/i,
      /\b(use|using|access)\b[^.]{0,120}\b(constitut|mean|signif|indicat)\w*\s+(your\s+|subscriber's\s+|that you\s+)?(acceptance|agreement|consent|acknowledg|agree)/i,
      /\byou (agree to|accept)\b[^.]{0,30}\bterms\b[^.]{0,30}\bby\b[^.]{0,20}\b(installing|accessing|using|creating)\b/i,
      /\buse of\b[^.]{0,60}\bagreement to be bound\b/i,
      /\bif you continue to use\b/i,
      /\baccepted by you\b[^.]{0,30}\bwhen you\b/i,
    ],
    unless: [/\bby using instant booking\b/i],
  },
  {
    id: "limits_liability",
    category: "your-rights",
    severity: "medium",
    unfairTos: "Limitation of liability",
    say: "They limit what they owe you if things go wrong.",
    match: [
      /\b(not|never)\s+(be\s+)?(held\s+)?(responsible\s+(or|and|nor)\s+)?liable\b/i,
      // "Not responsible" alone is often just "third-party sites aren't ours". Count it when a loss is named.
      /\b(not|never)\s+(be\s+)?(held\s+)?responsible\b[^.]{0,80}\b(loss|losses|damages?|lost|profits?|suspension|interruptions?|disruptions?|errors|outages?|unavailab\w*|repair\w*)\b/i,
      /\bno liability\b/i,
      /\bliability\b[^.]{0,40}\b(is|are|will be|shall be) (limited|capped)\b/i,
      /\bin no event\b[^.]{0,150}\b(liable|liability)\b/i,
      /\b(total|aggregate|maximum|entire)\s+liability\b/i,
      /\b(incidental|indirect|special|exemplary|punitive|consequential)\b[^.]{0,30}\bdamages\b/i,
      /\bnot\s+(to\s+)?hold\b[^.]{0,30}\b(liable|responsible)\b/i,
      /\bliab\w*\b[^.]{0,20}\b(only|expressly limited|limited to)\b/i,
      /\blimits?\b[^.]{0,30}\bliability\b/i,
      /\bno (further )?(obligation or )?(responsibility or )?liability\b/i,
      /\bwithout\b[^.]{0,30}\b(or )?liability\b/i,
      /\bnot\s+(incur|accept)\s+any\s+liability\b/i,
      // No refund "for any reason", or none when they close your account. A plain "no refunds after 90 days" is fair.
      /\bnot (be )?(required|obliged) to (provide|give|issue|pay)\b[^.]{0,30}\b(refunds?|compensation)\b|\bnot receive (any )?(money|refunds?|compensation)\b/i,
      all(String.raw`\b(no|without( any)?|not be)\s+(\w+\s+)?(refunds?|refunded|compensation)\b`, String.raw`\b(terminat|clos|discontinu|suspen)\w*`),
      /\bunder no circumstances\b[^.]{0,80}\b(liable|responsible)\b/i,
      /\b(exclude|disclaim)\w*\s+(any\s+|all\s+)?(\w+\s+){0,2}liability\b/i,
      /\b(takes?|assumes?|accepts?)\s+no\s+(responsibility\s+(or|and)\s+)?liability\b/i,
      /\bnot\s+assume\s+(any\s+)?liability\b/i,
      // Same for "no responsibility": only with a named loss.
      /\b((exclude|disclaim)\w*|(takes?|assumes?|accepts?)\s+no|not\s+assume)\s+(any\s+|all\s+)?responsibility\b[^.]{0,80}\b(loss|losses|damages?|lost|profits?|interruptions?|disruptions?|errors|outages?)\b/i,
      /\brelease\b[^.]{0,30}\bfrom (all |any )?liability\b/i,
      /(\bnot|can't|cannot)\s+recover\b[^.]{0,30}\bdamages\b/i,
      /\b(responsible|liable) to you only\b/i,
      /\bonly (liable for|liability)\b/i,
      /\bliabilit(y|ies)\b[^.]{0,60}\b(exceed|limited to)\b/i,
      /\bneither\b[^.]{0,80}\b(will|shall)\s+(be\s+liable|have\s+any\s+liability)\b/i,
      /\bpossibility of (such |any )?(damages?|loss(es)?)\b/i,
      /\b(damage|loss)\b[^.]{0,20}\bwhether direct or indirect\b/i,
      /\blimitations?\b[^.]{0,30}\b(will|shall) apply\b/i,
      /\bdisclaimers? of\b[^.]{0,20}\bliability\b/i,
    ],
    // UNFAIR-ToS counts "we're not responsible for third-party sites / other users' content" as fair,
    // and so do we: that's a statement of fact, not a cap on what they owe you.
    unless: [/\byou\s+(are|will|shall)\s+not\s+(be\s+)?(held\s+)?(liable|responsible)\b/i,
      /^(?!.*\b(liable|liability|damages|loss|injury|limited|consequential)\b).*\bnot\s+(be\s+)?(held\s+)?responsible\b[^.]{0,80}\b(third[- ]part(y|ies)|other users|any user|websites?|content (of|accessed)|accuracy|availability|privacy practices|user material|user-generated)\b/is,
      /\b(some|certain) (\w+\s+)?(jurisdictions|states|places|countries)\b[^.]{0,30}\bdo not allow\b/i, /\bsurvive\b/i, /\ballocation of risk\b/i,
      /\bnothing in\b[^.]{0,60}\b(limits?|exclud\w*|removes?)\b/i, /\bwithout (any )?admission as to liability\b/i,
      /\bshall not relieve\b/i,
      /^\W*[\w\s;,]{0,60}\b(liability limits|limitation of liability)\b[\w\s;,]{0,60}$/i],
  },
  {
    id: "choice_of_law",
    category: "your-rights",
    severity: "low",
    unfairTos: "Choice of law",
    say: "Another place's law applies, maybe not yours.",
    match: [
      // Not "governing law" or "under the laws of" alone: those are mostly headings and "a company incorporated under the laws of...".
      /\bgoverned\b[^.]{0,40}\blaws?\b/i,
      /\blaw (governs|shall govern|will govern)\b/i,
      // The gap lets "U.S.A.," through: a period followed by a non-space doesn't end the sentence.
      /\blaws? of\b(?:[^.]|\.(?=\S)){0,80}\b(shall|will) (govern|apply)\b/i,
      /\blaws? of\b[^.]{0,80}\bgovern\w*\b/i,
      /\b(interpreted|construed)\b[^.]{0,30}\b(in accordance with|under)\b[^.]{0,60}\blaws?\b/i,
      /\bsubject to\s+(the\s+)?\w+(\s+\w+)? law\b/i,
      /\bsubject to the laws? of\b/i,
      /\bconflicts? of laws?\b/i,
      /\bapplicable law and venue\b/i,
    ],
    // The law of the place where you live is no surprise.
    unless: [/\blaws?\s+(of|in|applicable in)\s+(the\s+(state|country|province)(\s+or\s+(state|country|province))?\s+(where|in which)\s+you\s+(live|reside)|your\s+(state|country|province))\b/i],
  },
  {
    id: "jurisdiction",
    category: "your-rights",
    severity: "low",
    unfairTos: "Jurisdiction",
    say: "Lawsuits go to courts they chose, maybe far away.",
    match: [
      /\b(exclusive|sole)\s+(jurisdiction|venue)\b/i,
      /\bjurisdiction of the\b[^.]{0,20}\bcourts?\b/i,
      /\bsubmit to the\b[^.]{0,40}\bjurisdiction\b/i,
      /\bcourts? (located )?(in|of)\b[^.]{0,60}\b(shall|will) have\b/i,
      /\bvenue\b[^.]{0,40}\b(shall|will) (be|lie)\s+(exclusively\s+)?(in|at)\b/i,
      /\bpersonal jurisdiction\b/i,
      /\b(brought|heard|resolved|litigated|commenced|filed|adjudicated)\b[^.]{0,60}\b(in|by)\s+(a|the)?\s*(state or federal|federal or state|superior|small claims|competent)?\s*courts?\b[^.]{0,60}\b(located|in|of)\b/i,
      /\bcourts? located in\b/i,
      /\bconsent to (the )?(exclusive )?(venue|personal jurisdiction|jurisdiction)\b/i,
      /\bjurisdiction\b[^.]{0,60}\blocated in\b/i,
    ],
    unless: [/\bcourts? (of|in) (your|the country where you)\b/i],
  },

  // ── Money ─────────────────────────────────────────────────────────
  {
    id: "auto_renewal",
    category: "money",
    severity: "medium",
    say: "Your subscription renews and charges you automatically.",
    match: [
      /\bautomatically\s+(renew|charg|bill)\w*/i,
      /\bauto-?renew\w*/i,
      /\brenew\w*\s+automatically\b/i,
      /\brecurring\s+(charge|payment|billing|fee)s?\b/i,
      /\buntil you cancel\b/i,
      /\bconvert\w* (in)?to a paid\b/i,
    ],
    unless: [denies("renew|automatically|auto-?renew|charg|bill")],
  },
  {
    id: "no_refunds",
    category: "money",
    severity: "low",
    say: "Payments are not refundable.",
    match: [
      /\bnon-?refundable\b/i,
      /\bno refunds?\b(?!\s+request)/i,
      /\b(sales|purchases)\b[^.]{0,30}\b(are|is) final\b/i,
      /(\bnot|cannot) (be )?refund(able|ed)\b/i,
      /(\bnot|\bnever|n't)\s+(offer|give|provide|issue)\s+(any\s+)?refunds?\b/i,
    ],
  },

  // ── Things you can do about it ────────────────────────────────────
  {
    id: "arbitration_opt_out",
    category: "action",
    severity: "info",
    say: "You can opt out of arbitration, before a deadline.",
    match: [
      /\bopt[- ]out\b[^.]{0,60}\barbitration\b/i,
      /\barbitration\b[^.]{0,80}\bopt[- ]out\b/i,
      /\b(reject|decline)\b[^.]{0,30}\barbitrat(ion|e)\b/i,
    ],
    unless: [denies("opt[- ]out|reject"), /\bno way to opt[- ]out\b/i],
  },
];
