import { GoalPlan } from "./goal-plan"
import type { SessionID } from "./schema"
import type { SourceState } from "../quality/verification-envelope"
import type { GoalVerification } from "./goal-verification"
import { GoalCheckVerification } from "./goal-check-verification"

export namespace GoalContractVerification {
  export type Decision =
    | { ok: true }
    | {
        ok: false
        reason: "missing_plan" | "digest_mismatch" | "missing_evidence" | "missing_executed_checks"
        message: string
      }

  export function decide(input: {
    sessionID: SessionID
    created: number
    acceptanceEvidence?: Record<string, string>
    execution?: { messages: readonly GoalVerification.Message[]; source: SourceState; cwd: string }
  }): Decision {
    const stored = GoalPlan.storedDigest(input.sessionID, input.created)
    const result = GoalPlan.read(input.sessionID, input.created)
    if (!stored && result.status === "missing") {
      // Pre-v1 goals and storage-primitive creates have no contract.
      return { ok: true }
    }
    if (result.status !== "found" || !stored || stored !== GoalPlan.digestOf(result.contract)) {
      return {
        ok: false,
        reason: "digest_mismatch",
        message:
          "Cannot mark the goal complete: the frozen acceptance contract is missing, invalid, or modified. " +
          "Restore the original acceptance criteria, verification plan, non-goals, and assumed scope, " +
          "then supply acceptanceEvidence for every AC id.",
      }
    }
    const contract = result.contract
    if (contract.assurance) {
      const missing = input.execution
        ? GoalCheckVerification.missing({
            assurance: contract.assurance,
            sessionID: input.sessionID,
            created: input.created,
            digest: stored,
            ...input.execution,
          })
        : contract.assurance.checks.map((check) => check.id)
      if (missing.length)
        return {
          ok: false,
          reason: "missing_executed_checks",
          message: `Cannot mark the goal complete: required checks lack current successful execution evidence: ${missing.join(", ")}. Run verify_project with goalCheck for each missing id after the last source change. Prose evidence and ordinary shell commands do not satisfy these checks.`,
        }
    }
    const evidence = input.acceptanceEvidence ?? {}
    const missing = contract.acceptance.filter((item) => !String(evidence[item.id] ?? "").trim())
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "missing_evidence",
        message:
          `Cannot mark the goal complete: missing acceptanceEvidence for ${missing.map((item) => item.id).join(", ")}. ` +
          `Pass a short evidence string for every acceptance id from the goal plan.`,
      }
    }
    return { ok: true }
  }
}
