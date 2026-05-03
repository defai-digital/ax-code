import { AgentControl } from "./agent-control"

export namespace ExecutionController {
  export type Signal = {
    planRequired?: boolean
    approvalRequired?: boolean
    approvalGranted?: boolean
    executionStarted?: boolean
    executionCompleted?: boolean
    validationRequired?: boolean
    validationPassed?: boolean
    recoverableFailure?: boolean
    unrecoverableFailure?: boolean
    blockedReason?: string
  }

  export type Decision = {
    phase: AgentControl.Phase
    reason: string
    validationStatus?: AgentControl.ValidationStatus
    blockedReason?: string
  }

  export function decide(input: { state: AgentControl.State; signal?: Signal }): Decision {
    const signal = input.signal ?? {}
    if (signal.unrecoverableFailure) {
      return {
        phase: "blocked",
        reason: signal.blockedReason ?? "unrecoverable_failure",
        blockedReason: signal.blockedReason ?? "unrecoverable_failure",
      }
    }
    if (signal.recoverableFailure) {
      return {
        phase: "recover",
        reason: signal.blockedReason ?? "recoverable_failure",
        validationStatus: input.state.validationStatus === "pending" ? "failed" : input.state.validationStatus,
      }
    }

    switch (input.state.phase) {
      case "assess":
        if (signal.planRequired || planHasOpenWork(input.state.plan)) return { phase: "plan", reason: "plan_required" }
        return { phase: "execute", reason: "ready_to_execute" }
      case "plan":
        if (signal.approvalRequired && !signal.approvalGranted) {
          return { phase: "await_approval", reason: "approval_required" }
        }
        return { phase: "execute", reason: "plan_ready" }
      case "await_approval":
        if (signal.approvalGranted) return { phase: "execute", reason: "approval_granted" }
        return { phase: "await_approval", reason: signal.blockedReason ?? "approval_pending" }
      case "execute":
        if (signal.executionCompleted) {
          if (signal.validationRequired) {
            return { phase: "validate", reason: "validation_required", validationStatus: "pending" }
          }
          return { phase: "summarize", reason: "execution_completed" }
        }
        return { phase: "execute", reason: signal.executionStarted ? "execution_in_progress" : "awaiting_execution" }
      case "validate":
        if (signal.validationPassed === true) {
          return { phase: "summarize", reason: "validation_passed", validationStatus: "passed" }
        }
        if (signal.validationPassed === false) {
          return { phase: "recover", reason: "validation_failed", validationStatus: "failed" }
        }
        return { phase: "validate", reason: "validation_pending", validationStatus: "pending" }
      case "recover":
        if (signal.planRequired || planHasOpenWork(input.state.plan)) return { phase: "plan", reason: "replan_required" }
        return { phase: "execute", reason: "retry_execution" }
      case "summarize":
        if (planHasOpenWork(input.state.plan)) {
          return {
            phase: "blocked",
            reason: "plan_tasks_open",
            blockedReason: "plan_tasks_open",
          }
        }
        return { phase: "complete", reason: "ready_to_complete" }
      case "blocked":
        if (signal.planRequired) return { phase: "plan", reason: "user_unblocked_with_plan" }
        if (signal.executionStarted) return { phase: "execute", reason: "user_unblocked_with_execution" }
        return { phase: "assess", reason: "reassess_after_block" }
      case "complete":
        return { phase: "complete", reason: "already_complete" }
    }
  }

  export function apply(input: { state: AgentControl.State; signal?: Signal }): AgentControl.State {
    const decision = decide(input)
    if (decision.phase === input.state.phase) {
      return AgentControl.State.parse({
        ...input.state,
        lastDecisionReason: decision.reason,
        validationStatus: decision.validationStatus ?? input.state.validationStatus,
        blockedReason: decision.phase === "blocked" ? decision.blockedReason ?? decision.reason : undefined,
      })
    }
    return AgentControl.transition({
      state: input.state,
      phase: decision.phase,
      reason: decision.reason,
      validationStatus: decision.validationStatus,
      blockedReason: decision.blockedReason,
    })
  }

  function planHasOpenWork(plan: AgentControl.PlanArtifact | undefined) {
    if (!plan) return false
    const progress = AgentControl.planProgress(plan)
    return progress.open > 0 || progress.blocked > 0
  }
}
