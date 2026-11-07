import { readFileSync } from "node:fs";
import { analyze } from "./engine.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Usage: npm run analyze -- <tos.txt> [--json]");
  process.exit(1);
}

const flags = analyze(readFileSync(file, "utf8"));

if (json) {
  console.log(JSON.stringify(flags, null, 2));
} else if (flags.length === 0) {
  console.log("No flags. The rules only catch what they know, so this doesn't mean the terms are fine.");
} else {
  // One block per rule, so a point that shows up in several sentences is listed once.
  const byRule = Map.groupBy(flags, (f) => f.ruleId);
  for (const group of byRule.values()) {
    console.log(`\n[${group[0].severity.toUpperCase()}] ${group[0].say}`);
    for (const f of group) console.log(`    "${clip(f.quote)}"`);
  }
  console.log(`\n${byRule.size} points flagged. This is not legal advice.`);
}

function clip(s: string, max = 140): string {
  const flat = s.replace(/\s+/g, " ");
  return flat.length > max ? flat.slice(0, max - 3) + "..." : flat;
}
