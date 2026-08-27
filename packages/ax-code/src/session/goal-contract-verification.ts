import { GoalPlan } from "./goal-plan"
import type { SessionID } from "./schema"

export namespace GoalContractVerification {
  export type Decision =
    | { ok: true }
    | { ok: false; reason: "missing_plan" | "digest_mismatch" | "missing_evidence"; message: string }

  export function decide(input: {
    sessionID: SessionID
    created: number
    acceptanceEvidence?: Record<string, string>
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
