import type { StructuredFailure, VerificationEnvelope } from "../../quality/verification-envelope"

// Phase 2 P2.4: opt-in repair handoff scaffolding.
//
// This module is BEDROCK ONLY in v1 — pure data shapes and pure helpers.
// It does NOT spawn sub-tasks, fan out to LLMs, or open user dialogs.
// Those surfaces will be wired in a follow-up slice once we have a
// concrete UX for the handoff prompt and a stable orchestration story.
//
// What this slice DOES provide:
// - shouldHandoff(envelope, policy?): a pure decision function. Given
//   a failed VerificationEnvelope and an optional policy (allowlists,
//   max-failure caps), decide whether the failure is "well-bounded"
//   enough to be a candidate for automated repair.
// - briefFromFailure(envelope): a pure formatter that turns a
//   structured envelope into a short, model-ready prompt fragment
//   describing exactly what failed and where. Consumers use this
//   when they choose to invoke the repair handoff.
//
// "Opt-in" lives at the policy / caller level — this module never
// triggers anything; it only describes what would be triggered.

export type HandoffPolicy = {
  // Only consider failures whose runner is in this list. Default: any.
  allowedRunners?: ReadonlyArray<"typecheck" | "lint" | "test">
  // Drop the handoff when total structuredFailures exceed this. A
  // mountain of failures usually means something larger is wrong, not
  // a localized fix. Default: 25.
  maxFailures?: number
  // Only consider failures whose status is in this list. Default:
  // ["failed"]. Caller can opt into "error"/"timeout" but they're
  // usually infra problems, not code defects.
  allowedStatuses?: ReadonlyArray<VerificationEnvelope["result"]["status"]>
}

const DEFAULT_MAX_FAILURES = 25
const DEFAULT_ALLOWED_STATUSES: ReadonlyArray<VerificationEnvelope["result"]["status"]> = ["failed"]

export type HandoffDecision =
  | { handoff: true; reasoning: string }
  | { handoff: false; reasoning: string }

export function shouldHandoff(
  envelope: VerificationEnvelope,
  policy?: HandoffPolicy,
): HandoffDecision {
  const allowedRunners = policy?.allowedRunners
  const allowedStatuses = policy?.allowedStatuses ?? DEFAULT_ALLOWED_STATUSES
  const maxFailures = policy?.maxFailures ?? DEFAULT_MAX_FAILURES

  if (!allowedStatuses.includes(envelope.result.status)) {
    return {
      handoff: false,
      reasoning: `status ${envelope.result.status} not in allowedStatuses [${allowedStatuses.join(", ")}]`,
    }
  }

  const runner = envelope.command.runner
  if (allowedRunners && !allowedRunners.some((r) => r === runner)) {
    return {
      handoff: false,
      reasoning: `runner '${runner}' not in allowedRunners [${allowedRunners.join(", ")}]`,
    }
  }

  if (envelope.structuredFailures.length === 0) {
    return {
      handoff: false,
      reasoning: "no structured failures to repair (output may be raw text only)",
    }
  }

  if (envelope.structuredFailures.length > maxFailures) {
    return {
      handoff: false,
      reasoning: `${envelope.structuredFailures.length} failures exceeds maxFailures=${maxFailures} — too broad to be a localized repair`,
    }
  }

  return {
    handoff: true,
    reasoning: `${envelope.structuredFailures.length} structured ${runner} failure(s) — within repair handoff scope`,
  }
}

// Format a single structured failure as a short, anchor-first line.
function formatFailure(failure: StructuredFailure): string {
  if (failure.kind === "typecheck") {
    return `- ${failure.file}:${failure.line}${failure.column ? `:${failure.column}` : ""} ${failure.code}: ${failure.message}`
  }
  if (failure.kind === "lint") {
    return `- ${failure.file}:${failure.line} [${failure.severity}] ${failure.rule}: ${failure.message}`
  }
  if (failure.kind === "test") {
    return `- ${failure.framework}: ${failure.testName}${failure.assertion ? ` — ${failure.assertion}` : ""}`
  }
  return `- custom: ${failure.message}`
}

export function briefFromFailure(envelope: VerificationEnvelope): string {
  const lines: string[] = []
  const runner = envelope.command.runner
  lines.push(`# Repair brief: ${runner} (${envelope.result.status})`)
  lines.push("")
  lines.push(`Workflow: ${envelope.workflow}`)
  lines.push(`Scope: ${envelope.scope.kind}${envelope.scope.paths ? ` (${envelope.scope.paths.join(", ")})` : ""}`)
  lines.push(`Failures: ${envelope.structuredFailures.length}`)
  lines.push("")

  if (envelope.structuredFailures.length > 0) {
    lines.push("Failures to repair:")
    for (const failure of envelope.structuredFailures) {
      lines.push(formatFailure(failure))
    }
    lines.push("")
  }

  if (envelope.result.output) {
    const output = envelope.result.output.split("\n").slice(0, 30).join("\n")
    lines.push("Raw output (first 30 lines):")
    lines.push("```")
    lines.push(output)
    lines.push("```")
  }

  lines.push("")
  lines.push(
    "Repair guidance: fix only the listed failures. Do not refactor surrounding code. Re-run the same verification after editing — if new failures appear, stop and surface them rather than chasing them.",
  )
  return lines.join("\n")
}
