/**
 * Anonymous multi-round council debate helpers (ADR-049 Phase 3).
 * Pure — no IO. Synthesis never attributes member identities (Chatham House).
 */

import { Council } from "./council"

export namespace Debate {
  export const MAX_ROUNDS = 3

  export type RoundSummary = {
    round: number
    issuesRaised: string[]
    pointsOfAgreement: string[]
    openQuestions: string[]
  }

  export function resolveMaxRounds(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0
    return Math.max(0, Math.min(MAX_ROUNDS, Math.floor(value)))
  }

  // Parts that appear in many vendor ids and would over-redact ordinary prose
  // ("api", "code", …). Hoisted: a single synthesis used to rebuild this set,
  // the identity set and one RegExp per identity for every redacted string.
  const GENERIC_IDENTITY_PARTS = new Set([
    "api",
    "cli",
    "cloud",
    "local",
    "model",
    "core",
    "lab",
    "labs",
    "ai",
    "engine",
    "code",
    "copilot",
  ])
  const SHORT_MODEL_PART = /^[a-z]\d+$/i

  /** Every identity to mask, longest first so a longer id wins over its own prefix. */
  function memberIdentities(report: Council.CouncilReport, allMemberIds: readonly string[] = []): string[] {
    const identities = new Set<string>()
    const track = (memberId: string) => {
      identities.add(memberId)
      for (const part of memberId.split("/")) {
        const shortModel = SHORT_MODEL_PART.test(part)
        if ((part.length >= 3 || shortModel) && !GENERIC_IDENTITY_PARTS.has(part.toLowerCase())) identities.add(part)
      }
    }
    for (const item of [...report.consensus, ...report.majority, ...report.minority, ...report.singleton]) {
      for (const memberId of item.memberIds) track(memberId)
    }
    // A member that raised no issues is absent from every issue's
    // memberIds, but another member's finding can still name its identity —
    // redaction must cover every participant, not only the contributors.
    for (const memberId of allMemberIds) track(memberId)
    return [...identities].sort((a, b) => b.length - a.length)
  }

  function identityPattern(identity: string): RegExp {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu")
  }

  function redactIdentities(text: string, patterns: RegExp[]): string {
    let redacted = text
    for (const pattern of patterns) redacted = redacted.replace(pattern, "[member]")
    return redacted
  }

  /**
   * Shared identity masker for model-facing anonymous text (debate synthesis
   * and the chairman brief). Member-authored prose can name a vendor or model
   * even though the structured memberIds are removed, so every rendered line
   * passes through this.
   */
  export function identityRedactor(report: Council.CouncilReport, allMemberIds: readonly string[] = []) {
    const patterns = memberIdentities(report, allMemberIds).map(identityPattern)
    return (text: string) => redactIdentities(text, patterns)
  }

  /**
   * Build an anonymous synthesis block for the next debate round.
   * Strips member ids so models cannot anchor on brand prestige.
   */
  export function buildAnonymousSynthesis(
    report: Council.CouncilReport,
    round: number,
    allMemberIds: readonly string[] = [],
  ): RoundSummary {
    const redact = identityRedactor(report, allMemberIds)
    const issuesRaised: string[] = []
    for (const item of [...report.consensus, ...report.majority, ...report.minority, ...report.singleton]) {
      const loc = item.location ? ` @ ${item.location}` : ""
      issuesRaised.push(redact(`[${item.severity}/${item.tier}] ${item.category}${loc}: ${item.summary}`))
    }

    const pointsOfAgreement = report.consensus.map((item) => {
      const loc = item.location ? ` @ ${item.location}` : ""
      return redact(`${item.category}${loc}: ${item.summary}`)
    })

    const openQuestions = [...report.minority, ...report.singleton]
      .filter((item) => item.severity === "high" || item.severity === "medium")
      .map((item) => redact(item.summary))
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
      ...(summary.pointsOfAgreement.length ? summary.pointsOfAgreement.map((i) => `- ${i}`) : ["- (none yet)"]),
      "",
      "Open questions / minority and singleton concerns:",
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
    const total = report.consensus.length + report.majority.length + report.minority.length + report.singleton.length
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
    const unresolvedHighSeverity = [...input.report.minority, ...input.report.singleton].some(
      (item) => item.severity === "high",
    )
    if (ratio >= threshold && input.report.consensus.length > 0 && !unresolvedHighSeverity) {
      return { continue: false, reason: `converged:${ratio.toFixed(2)}` }
    }
    // Continue if there is still meaningful dissent
    if (
      input.report.singleton.length === 0 &&
      input.report.minority.length === 0 &&
      input.report.majority.length === 0
    ) {
      return { continue: false, reason: "no_dissent" }
    }
    return { continue: true, reason: `continue:agreement=${ratio.toFixed(2)}` }
  }
}
