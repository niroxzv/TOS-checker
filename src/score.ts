import type { Severity } from "./types.ts";

// Boundary score: 100 means the terms ask for very little. Each distinct rule that fires costs points,
// so the same clause repeated ten times doesn't sink the score. Dealbreakers cost extra.
const COST: Record<Severity, number> = { high: 8, medium: 4, low: 2, info: 0 };
const DEALBREAKER_COST = 5;

export interface BoundaryScore {
  score: number;
  label: "Low risk" | "Think twice" | "High risk";
}

export function boundaryScore(
  flags: { ruleId: string | null; severity: Severity }[],
  dealbreakers: ReadonlySet<string> = new Set(),
): BoundaryScore {
  const worst = new Map<string, Severity>();
  for (const f of flags) {
    if (!f.ruleId) continue; // AI points don't count, so the score stays the same with or without AI
    const prev = worst.get(f.ruleId);
    if (!prev || COST[f.severity] > COST[prev]) worst.set(f.ruleId, f.severity);
  }
  let score = 100;
  for (const [ruleId, sev] of worst) score -= COST[sev] + (dealbreakers.has(ruleId) ? DEALBREAKER_COST : 0);
  score = Math.max(0, score);
  return { score, label: score >= 80 ? "Low risk" : score >= 50 ? "Think twice" : "High risk" };
}
