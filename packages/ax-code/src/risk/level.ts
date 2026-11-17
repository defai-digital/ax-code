export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

const CRITICAL_SCORE = 70
const HIGH_SCORE = 45
const MEDIUM_SCORE = 20

/** Classify a score without loading session evidence or storage services. */
export function levelForScore(score: number): RiskLevel {
  return score >= CRITICAL_SCORE ? "CRITICAL" : score >= HIGH_SCORE ? "HIGH" : score >= MEDIUM_SCORE ? "MEDIUM" : "LOW"
}
