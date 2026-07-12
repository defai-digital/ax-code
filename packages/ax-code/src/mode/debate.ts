/**
 * Anonymous multi-round council debate helpers (ADR-049 Phase 3).
 * Pure — no IO. Synthesis never attributes member identities (Chatham House).
 */

import { Council } from "./council"

export namespace Debate {
  export type RoundSummary = {
    round: number
    issuesRaised: string[]
    pointsOfAgreement: string[]
    openQuestions: string[]
  }

  /**
   * Build an anonymous synthesis block for the next debate round.
   * Strips member ids so models cannot anchor on brand prestige.
   */
  export function buildAnonymousSynthesis(
    report: Council.CouncilReport,
    round: number,
  ): RoundSummary {
    const issuesRaised: string[] = []
    for (const item of [...report.consensus, ...report.majority, ...report.singleton]) {
      const loc = item.location ? ` @ ${item.location}` : ""
      issuesRaised.push(`[${item.severity}/${item.tier}] ${item.category}${loc}: ${item.summary}`)
    }

    const pointsOfAgreement = report.consensus.map((item) => {
      const loc = item.location ? ` @ ${item.location}` : ""
      return `${item.category}${loc}: ${item.summary}`
    })

    const openQuestions = report.singleton
      .filter((item) => item.severity === "high" || item.severity === "medium")
      .map((item) => item.summary)
      .slice(0, 8)

    return {
      round,
      issuesRaised: issuesRaised.slice(0, 20),
      pointsOfAgreement: pointsOfAgreement.slice(0, 12),
      openQuestions,
    }
  }

  export function renderSynthesisPrompt(summary: RoundSummary): string {
    const lines = [
      `Other council members' feedback (round ${summary.round}, anonymous — Chatham House rule):`,
      "",
      "Issues raised:",
      ...(summary.issuesRaised.length ? summary.issuesRaised.map((i) => `- ${i}`) : ["- (none)"]),
      "",
      "Points of agreement:",
      ...(summary.pointsOfAgreement.length
        ? summary.pointsOfAgreement.map((i) => `- ${i}`)
        : ["- (none yet)"]),
      "",
      "Open questions / singleton concerns:",
      ...(summary.openQuestions.length ? summary.openQuestions.map((i) => `- ${i}`) : ["- (none)"]),
      "",
      "Re-evaluate independently. Keep, revise, or withdraw issues based on substance only.",
      "Do not invent who said what. Do not defer to brand prestige.",
    ]
    return lines.join("\n")
  }

  /**
   * Convergence: fraction of successful-member issues that are consensus or majority.
   * Returns 0..1. Incomplete reports return 0.
   */
  export function agreementRatio(report: Council.CouncilReport): number {
    if (report.incomplete || report.successfulMembers < 2) return 0
    const total =
      report.consensus.length + report.majority.length + report.singleton.length
    if (total === 0) return 1 // all quiet → converged
    const agreed = report.consensus.length + report.majority.length
    return agreed / total
  }

  /**
   * Stop early when agreement is high enough or rounds exhausted.
   */
  export function shouldContinueDebate(input: {
    round: number
    maxRounds: number
    report: Council.CouncilReport
    /** Default 0.75 */
    agreementThreshold?: number
  }): { continue: boolean; reason: string } {
    if (input.maxRounds <= 0) return { continue: false, reason: "debate_disabled" }
    if (input.round >= input.maxRounds) return { continue: false, reason: "max_rounds" }
    if (input.report.incomplete) return { continue: false, reason: "incomplete_members" }
    const ratio = agreementRatio(input.report)
    const threshold = input.agreementThreshold ?? 0.75
    if (ratio >= threshold && input.report.consensus.length > 0) {
      return { continue: false, reason: `converged:${ratio.toFixed(2)}` }
    }
    // Continue if there is still meaningful dissent
    if (input.report.singleton.length === 0 && input.report.majority.length === 0) {
      return { continue: false, reason: "no_dissent" }
    }
    return { continue: true, reason: `continue:agreement=${ratio.toFixed(2)}` }
  }
}
