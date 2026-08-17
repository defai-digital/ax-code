import type { AutonomousCompletionGate } from "@/control-plane/autonomous-completion-gate"

const EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode received an empty model turn: the provider returned finish=other with zero input, ` +
  `output, and reasoning tokens. The session is stopped, but the work should not be treated as complete.`

export function emptyModelTurnIncompleteMessage(cause: string | undefined): string {
  const trimmed = cause?.trim()
  if (!trimmed) return EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE
  return `${EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE} Underlying provider error: ${trimmed}`
}

const TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode received a truncated model turn: the provider returned finish=length before the model ` +
  `could complete its response. The session is stopped, but the work should not be treated as complete.`

const REPEATED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode stopped because the provider repeated the same substantial output after a truncated-turn ` +
  `recovery instead of continuing. This usually indicates stale provider or local model runtime state. Retry with ` +
  `a fresh provider connection; for a local model, restart its runtime. The work should not be treated as complete.`

type ModelTurnTokens = {
  input?: number
  output?: number
  reasoning?: number
}

const UNFINISHED_MODEL_TURN_FINISH_REASONS = new Set(["tool-calls", "unknown", "length"])

export function modelTurnFinished(finish: string | undefined): boolean {
  return finish !== undefined && !UNFINISHED_MODEL_TURN_FINISH_REASONS.has(finish)
}

export function isEmptyModelTurn(input: { finish: string | undefined; tokens: ModelTurnTokens }): boolean {
  return (
    input.finish === "other" &&
    (input.tokens.input ?? 0) === 0 &&
    (input.tokens.output ?? 0) === 0 &&
    (input.tokens.reasoning ?? 0) === 0
  )
}

export function isTruncatedModelTurn(input: { finish: string | undefined }): boolean {
  return input.finish === "length"
}

type EmptyModelTurnDecision =
  | {
      action: "ignore"
      emptyModelTurnRetries: number
    }
  | {
      action: "recover"
      emptyModelTurnRetries: number
      todoRetries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "stalled"
      errorCode: "EMPTY_MODEL_TURN"
      message: string
    }

type TruncatedModelTurnDecision =
  | {
      action: "ignore"
      truncatedModelTurnRetries: number
    }
  | {
      action: "recover"
      truncatedModelTurnRetries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "stalled"
      errorCode: "TRUNCATED_MODEL_TURN" | "REPEATED_TRUNCATED_MODEL_TURN"
      message: string
    }

type GoalForContinuationDecision = {
  objective: string
  status: string
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
}

// Budget wrap-up lifecycle for a goal that hit its token budget:
//   "none"      — no wrap-up owed or sent yet (goal not budget_limited, or it
//                 became budget_limited during this run and the wrap-up turn
//                 has not been injected).
//   "sent"      — the single wrap-up continuation was injected during THIS
//                 prompt-loop run; when the wrap-up turn ends the loop stops
//                 with an explicit budget message.
//   "concluded" — the wrap-up already ran in an EARLIER run (the goal was
//                 already budget_limited when this run started, including on
//                 forked sessions). The goal is inert: no wrap-up re-fires and
//                 no budget error hijacks unrelated new prompts.
export type GoalBudgetWrapUp = "none" | "sent" | "concluded"

type GoalContinuationDecision =
  | { action: "ignore" }
  | {
      action: "continue_active"
      objective: string
      continuation: number
    }
  | {
      action: "continue_budget_wrapup"
      objective: string
      tokensUsed: number
      tokenBudget: number
      timeUsedSeconds: number
    }
  | {
      action: "stop_budget_limit"
      reason: "stalled"
      message: string
    }

type CompletionGateRetryDecision =
  | {
      action: "continue"
      signature: string
      retries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "step_limit" | "stalled"
      errorCode: "STEP_LIMIT" | "COMPLETION_GATE_BLOCKED"
      attempts: number
      message: string
    }

type CompletionGateEventReason = "none" | Extract<AutonomousCompletionGate.Decision, { status: "blocked" }>["reason"]
type EmptySubagentResultGateDecision = Extract<
  AutonomousCompletionGate.Decision,
  { status: "blocked"; reason: "empty_subagent_result" }
>

type GlobalStepLimitDecision =
  | { action: "ignore" }
  | {
      action: "continue"
      continuation: number
    }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }

type TotalStepLimitDecision =
  | { action: "ignore" }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "TOTAL_STEP_LIMIT"
      message: string
    }

type AgentStepLimitContinuationDecision =
  | { action: "ignore" }
  | {
      action: "continue"
      continuation: number
    }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }

function nextContinuation(input: { continuations: number; maxContinuations: number }): number | undefined {
  return input.continuations < input.maxContinuations ? nextDecisionCount(input.continuations) : undefined
}

function nextAutonomousContinuation(input: {
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): number | undefined {
  if (!input.autonomous) return undefined
  return nextContinuation(input)
}

/**
 * Ordinary `session.max_continuations` bounds plain autonomous auto-continue.
 * Active goals and Super-Long must not be starved by that cap — the cumulative
 * total-step ceiling (and Super-Long deadline / goal budget) remain the hard
 * bounds. Paused / complete / blocked / budget_limited goals do not lift the
 * cap: budget wrap-up is scheduled by goalContinuationDecision after the model
 * finishes a turn, not by the step-limit continuation path.
 */
export function effectiveContinuationCap(input: {
  maxContinuations: number
  superLongActive: boolean
  goalStatus?: string
}): number {
  if (input.superLongActive || input.goalStatus === "active") {
    return Number.POSITIVE_INFINITY
  }
  return input.maxContinuations
}

function retryBudgetExhausted(input: { attempts: number; maxAttempts: number }): boolean {
  return !(input.attempts < input.maxAttempts)
}

function normalizedDecisionCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function nextDecisionCount(value: number) {
  return normalizedDecisionCount(value) + 1
}

export function formatDecisionCount(value: number) {
  return Number.isFinite(value) ? String(value) : "an invalid number of"
}

export function globalStepLimitDecision(input: {
  step: number
  stepLimit: number
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): GlobalStepLimitDecision {
  if (input.step < input.stepLimit) return { action: "ignore" }

  const continuation = nextAutonomousContinuation(input)
  if (continuation !== undefined) {
    return {
      action: "continue",
      continuation,
    }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "STEP_LIMIT",
    message:
      `Agent reached maximum step limit (${formatDecisionCount(input.stepLimit)} steps${
        input.continuations > 0 ? ` after ${formatDecisionCount(input.continuations)} auto-continuations` : ""
      }). ` +
      `To increase, set "session.max_steps" in ax-code.json. ` +
      `Try breaking the task into smaller parts or increase the limit for complex autonomous tasks.`,
  }
}

type ToolOnlyTurnDecision =
  | { action: "ignore" }
  | { action: "nudge"; final: boolean; forced: boolean }
  | { action: "stop" }

type ToolActivityPart = {
  type?: string
  tool?: string
  state?: {
    status?: string
    output?: string
    input?: unknown
  }
}

// These tools can inspect or control an inspection process without directly
// creating a source patch. Bash is treated as read-only only when the same
// turn has no persisted patch part, so shell-based edits do not trip the
// local-model convergence guard.
const READ_ONLY_EXPLORATION_TOOLS = new Set(["bash", "bash_output", "kill_shell", "list", "read", "glob", "grep"])
const MUTATING_PROGRESS_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch", "todowrite"])

/** True when this turn persisted a source change or completed a mutating tool. */
export function isMutatingProgressTurn(parts: readonly ToolActivityPart[] | undefined): boolean {
  if (!parts?.length) return false
  if (parts.some((part) => part.type === "patch")) return true
  return parts.some(
    (part) =>
      part.type === "tool" &&
      MUTATING_PROGRESS_TOOLS.has(part.tool ?? "") &&
      part.state?.status === "completed",
  )
}

export function toolSignaturesFromParts(parts: readonly ToolActivityPart[] | undefined): string[] {
  if (!parts?.length) return []
  const signatures: string[] = []
  for (const part of parts) {
    if (part.type !== "tool" || !part.tool) continue
    signatures.push(`${part.tool}:${canonicalizePartInput(part.state?.input)}`)
  }
  return signatures
}

/**
 * No-progress = every tool this turn is read-only inspection AND the
 * run-scoped ring gained no new unique signatures (the same calls already
 * appeared). Prefer `afterSignatures` from the ring so canonicalization
 * matches the processor. Novel reads and any mutation are progress.
 */
export function isNoProgressToolTurn(
  parts: readonly ToolActivityPart[] | undefined,
  priorSignatures: ReadonlySet<string>,
  afterSignatures?: ReadonlySet<string>,
): boolean {
  if (!isReadOnlyExplorationTurn(parts)) return false
  if (afterSignatures) {
    if (afterSignatures.size === 0) return false
    for (const signature of afterSignatures) {
      if (!priorSignatures.has(signature)) return false
    }
    return true
  }
  const signatures = toolSignaturesFromParts(parts)
  if (signatures.length === 0) return false
  return signatures.every((signature) => priorSignatures.has(signature))
}

function canonicalizePartInput(input: unknown): string {
  if (typeof input === "string") return input.length > 4096 ? input.slice(0, 4096) : input
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return String(input)
    return serialized.length > 4096 ? serialized.slice(0, 4096) : serialized
  } catch {
    return "[unprintable]"
  }
}

export function isReadOnlyExplorationTurn(parts: readonly ToolActivityPart[] | undefined): boolean {
  if (!parts?.length || parts.some((part) => part.type === "patch")) return false
  const tools = parts.filter((part) => part.type === "tool")
  return tools.length > 0 && tools.every((part) => READ_ONLY_EXPLORATION_TOOLS.has(part.tool ?? ""))
}

/** True when at least one read-only tool finished successfully this turn. */
export function hasUsableReadOnlyEvidence(parts: readonly ToolActivityPart[] | undefined): boolean {
  if (!parts?.length) return false
  return parts.some(
    (part) =>
      part.type === "tool" &&
      READ_ONLY_EXPLORATION_TOOLS.has(part.tool ?? "") &&
      part.state?.status === "completed",
  )
}

/** True when this turn completed a read-only tool with a large output payload. */
export function hasLargeSuccessfulReadOnlyOutput(
  parts: readonly ToolActivityPart[] | undefined,
  minChars: number,
): boolean {
  if (!parts?.length || !Number.isFinite(minChars) || minChars <= 0) return false
  return parts.some(
    (part) =>
      part.type === "tool" &&
      READ_ONLY_EXPLORATION_TOOLS.has(part.tool ?? "") &&
      part.state?.status === "completed" &&
      typeof part.state.output === "string" &&
      part.state.output.length >= minChars,
  )
}

type ReadOnlyExplorationDecision = { action: "ignore" } | { action: "nudge" } | { action: "force_text" }

/**
 * Why the loop forced a text-only turn. Unexecutable-tool recovery must only
 * re-enable tools for the ax-engine read-only trap — not response-only /
 * goal-complete / truncated recovery paths that intentionally stay tool-free.
 */
export type ForceTextReason =
  | "ax_engine_read_only"
  | "response_only"
  | "goal_complete"
  | "tool_only_breaker"
  | "truncated_recovery"
  | "other"

/**
 * Local-engine read-only convergence. Force synthesis once the model has had
 * a chance to gather evidence — but do not strip tools while every probe is
 * still failing (wrong invented paths), or pure Q&A never gets a working call.
 * When force would fire on the same turn as a large successful tool result,
 * grant one tools-on grace turn so the model can absorb the payload. A hard
 * ceiling still forces text eventually so latency cannot run away.
 */
export function readOnlyExplorationDecision(input: {
  consecutiveTurns: number
  nudged: boolean
  nudgeThreshold: number
  forceThreshold: number
  /** True when this streak has at least one successful read-only tool result. */
  hasUsableEvidence?: boolean
  /** This turn completed a large read-only tool payload. */
  freshLargeEvidence?: boolean
  /** Already deferred force once this streak for large evidence. */
  largeEvidenceGraceUsed?: boolean
}): ReadOnlyExplorationDecision {
  const hardCeiling = input.forceThreshold + 2
  if (input.consecutiveTurns >= hardCeiling) return { action: "force_text" }
  if (input.consecutiveTurns >= input.forceThreshold && input.hasUsableEvidence) {
    // Large payload just landed: keep tools on once so the model can analyze
    // instead of force-texting raw diffs into hallucinated answers.
    if (input.freshLargeEvidence && !input.largeEvidenceGraceUsed) {
      return { action: "nudge" }
    }
    return { action: "force_text" }
  }
  // At/over force threshold but no usable evidence yet: keep tools on and
  // re-issue path/cwd guidance instead of force-texting empty failures.
  if (input.consecutiveTurns >= input.forceThreshold && !input.hasUsableEvidence) {
    return { action: "nudge" }
  }
  if (!input.nudged && input.consecutiveTurns >= input.nudgeThreshold) return { action: "nudge" }
  return { action: "ignore" }
}

/**
 * After a forced text-only turn, unexecutable tool markup should recover
 * with tools re-enabled once. Applies to ax-engine read-only convergence
 * and the generic tool-only / backstop breaker (models often paste
 * <function=edit> as chat). Intentional text-only paths stay tool-free.
 *
 * `recoveriesUsed` is a CONSECUTIVE-offense counter: the prompt loop resets
 * it to 0 whenever the completion gate next evaluates "allow" (a completed
 * tool call or clean prose intervened since the last offense). Callers must
 * preserve that contract — a lifetime counter would hard-stop the session on
 * the second forced-text trap no matter how much real work happened between.
 */
const RECOVERABLE_UNEXECUTABLE_FORCE_REASONS = new Set<ForceTextReason>([
  "ax_engine_read_only",
  "tool_only_breaker",
])

export function unexecutableToolTextRecoveryDecision(input: {
  lastTurnWasForceTextOnly: boolean
  recoveriesUsed: number
  maxRecoveries: number
  forceReason?: ForceTextReason
}): { action: "recover" } | { action: "stop" } {
  if (!input.lastTurnWasForceTextOnly) return { action: "stop" }
  if (!input.forceReason || !RECOVERABLE_UNEXECUTABLE_FORCE_REASONS.has(input.forceReason)) {
    return { action: "stop" }
  }
  if (input.recoveriesUsed >= input.maxRecoveries) return { action: "stop" }
  return { action: "recover" }
}

// Stall breaker for consecutive *no-progress* tool-calling turns (read-only
// repeats). Two checkpoints fire before a hard stop. The caller increments
// `consecutiveToolOnlyTurns` only on no-progress turns and resets it on
// mutations, novel tool signatures, or a finish that is not tool-calls.
//
// The first FINAL checkpoint is forced (`toolChoice: none`) so a single long
// streak can land a summary. `finalCheckpointHits` / `forcedWrapUps` still
// bound repeated leniency after a wrap-up (#340): after two forced wrap-ups
// with no recent mutations, the hard stop may fire.
export function toolOnlyTurnDecision(input: {
  consecutiveToolOnlyTurns: number
  toolOnlyNudges: number
  nudgeThreshold: number
  finalNudgeThreshold: number
  maxToolOnlyTurns: number
  finalCheckpointHits: number
  /** Mutation in the last few turns — do not hard-fail after productive work. */
  recentProgress?: boolean
  /** Forced wrap-ups already issued this run (usually `finalCheckpointHits`). */
  forcedWrapUps?: number
}): ToolOnlyTurnDecision {
  const thresholds = [input.nudgeThreshold, input.finalNudgeThreshold]
  const nextThreshold = thresholds[input.toolOnlyNudges]
  if (nextThreshold !== undefined && input.consecutiveToolOnlyTurns >= nextThreshold) {
    const final = input.toolOnlyNudges === thresholds.length - 1
    return { action: "nudge", final, forced: final }
  }
  if (input.consecutiveToolOnlyTurns > input.maxToolOnlyTurns) {
    const wrapUps = input.forcedWrapUps ?? input.finalCheckpointHits
    if (input.recentProgress || wrapUps < 2) {
      return { action: "nudge", final: true, forced: true }
    }
    return { action: "stop" }
  }
  return { action: "ignore" }
}

/** Absolute tool-calling cap: force a wrap-up, never a hard fail. */
export function toolCallingBackstopDecision(input: {
  consecutiveToolCallingTurns: number
  maxToolOnlyTurns: number
}): { action: "ignore" } | { action: "force_wrap" } {
  if (input.consecutiveToolCallingTurns > input.maxToolOnlyTurns) return { action: "force_wrap" }
  return { action: "ignore" }
}

export function toolOnlyStopMessage(input: {
  consecutiveToolOnlyTurns: number
  toolOnlyNudges: number
}): string {
  const reminderClause =
    input.toolOnlyNudges > 0
      ? `, despite ${input.toolOnlyNudges} checkpoint reminder${input.toolOnlyNudges === 1 ? "" : "s"}`
      : ""
  return (
    `Agent loop stopped: ${input.consecutiveToolOnlyTurns} consecutive no-progress tool-calling turns` +
    `${reminderClause}. ` +
    `The loop was halted as a circuit breaker after forced wrap-up attempts; work done so far is preserved in the transcript. ` +
    `Resume with a more specific request, or break the task into smaller steps.`
  )
}

type GoalCompleteToolPart = {
  type?: string
  tool?: string
  state?: {
    status?: string
    title?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
}

/**
 * Detect a successful `update_goal { status: "complete" }` tool result on the
 * current assistant turn. Used to force a final user-facing text response
 * instead of letting the tool-only circuit breaker fire after the goal is done
 * (see #381).
 */
export function hasSuccessfulGoalCompleteTool(parts: readonly GoalCompleteToolPart[] | undefined): boolean {
  if (!parts?.length) return false
  for (const part of parts) {
    if (part.type !== "tool" || part.tool !== "update_goal") continue
    if (part.state?.status !== "completed") continue
    if (part.state.input?.status === "complete") return true
    if (part.state.title === "Completed goal") return true
    const goalMeta = part.state.metadata?.goal
    if (goalMeta && typeof goalMeta === "object" && (goalMeta as { status?: unknown }).status === "complete") {
      return true
    }
  }
  return false
}

/**
 * After a successful goal completion tool call, a tool-only finish must not
 * keep driving the agent loop toward the tool-call circuit breaker. Force a
 * text-only final summary turn instead.
 */
export function goalCompleteForceTextDecision(input: {
  modelFinished: boolean
  goalCompletedThisTurn: boolean
}): { action: "force_text" } | { action: "ignore" } {
  if (input.modelFinished) return { action: "ignore" }
  if (!input.goalCompletedThisTurn) return { action: "ignore" }
  return { action: "force_text" }
}

// Resolves the toolChoice for a turn given two independent, possibly
// conflicting demands: structured output (a schema-forced turn MUST call its
// output tool) and the tool-only-turn circuit breaker (a forced turn MUST
// NOT call any tool). structuredOutputChoice wins when both are set — a
// pending forceTextOnlyTurn is left un-consumed (consumedForceTextOnlyTurn:
// false) rather than being dropped, so the caller can retry it on a later
// turn once structured output is no longer required. Silently discarding it
// on the structured-output turn would leave the tool-only-turn breaker
// permanently unenforceable for the rest of that session — see #340.
export function resolveTurnToolChoice(input: {
  structuredOutputChoice: "required" | undefined
  forceTextOnlyTurn: boolean
  /** Finite agent budget last step (ADR-051): tools must be disabled on the wire. */
  isLastStep?: boolean
}): { toolChoice: "required" | "none" | undefined; consumedForceTextOnlyTurn: boolean } {
  if (input.structuredOutputChoice) {
    return { toolChoice: input.structuredOutputChoice, consumedForceTextOnlyTurn: false }
  }
  if (input.forceTextOnlyTurn) {
    return { toolChoice: "none", consumedForceTextOnlyTurn: true }
  }
  // Last agent step is text-only for the whole turn (not a one-shot flag to
  // consume). Do not mark forceTextOnlyTurn as consumed.
  if (input.isLastStep) {
    return { toolChoice: "none", consumedForceTextOnlyTurn: false }
  }
  return { toolChoice: undefined, consumedForceTextOnlyTurn: false }
}

// A forced text-only turn is only consumed after a successful provider turn.
// If inference errors (for example, a local prefill idle timeout), keep the
// guard armed so an outer retry cannot silently restore tool schemas/calls.
export function shouldRestoreForcedTextOnlyTurn(input: { consumed: boolean; errored: boolean }): boolean {
  return input.consumed && input.errored
}

/**
 * Selects which cumulative step ceiling bounds the current iteration.
 * Super-Long and goal runs both lift the per-run continuation cap, so both
 * get long-run ceilings — the plain-autonomous default (step limit × every
 * permitted continuation) is sized for capped runs and would end legitimate
 * long goal runs with a step-limit error. Super-Long wins over a goal run
 * because its ceiling is checked against the durable cross-invocation step
 * counter (with the shipped defaults the two values are identical anyway).
 *
 * `goalLongRun` must cover the WHOLE goal run, including the in-run budget
 * wrap-up phase (status "budget_limited" whose wrap-up has not concluded) —
 * a goal that crosses its token budget beyond the plain ceiling would
 * otherwise drop back to that ceiling the moment its status flips and be
 * step-limit-stopped before the wrap-up turn ever runs. Inert budget-limited
 * goals from an earlier run (wrap-up concluded) must NOT set it: unrelated
 * later prompts in that session are ordinary runs.
 */
export function effectiveTotalStepLimit(input: {
  superLongActive: boolean
  goalLongRun: boolean
  maxTotalSteps: number
  maxTotalStepsSuperLong: number
  maxTotalStepsGoal: number
}): number {
  if (input.superLongActive) return input.maxTotalStepsSuperLong
  if (input.goalLongRun) return input.maxTotalStepsGoal
  return input.maxTotalSteps
}

/**
 * Whether the session is in a goal-driven long run for ceiling selection:
 * an active goal, or a budget-limited goal whose single wrap-up turn has not
 * yet concluded (the wrap-up is part of the run and must not be cut short by
 * the plain-autonomous ceiling the moment the status flips). A concluded
 * budget-limited goal is inert — later prompts in the session are ordinary.
 */
export function goalLongRunActive(input: { goalStatus?: string; budgetWrapUp: GoalBudgetWrapUp }): boolean {
  if (input.goalStatus === "active") return true
  return input.goalStatus === "budget_limited" && input.budgetWrapUp !== "concluded"
}

// The cumulative ceiling across ALL continuations. Unlike the per-continuation
// step limit, `totalSteps` is never reset by continueAutonomousLoop, so this
// bound applies equally to plain autonomous continuations, active goals (which
// have no continuation cap), and Super-Long runs (which lift the continuation
// cap). There is deliberately no "continue" branch: hitting this limit always
// stops the loop.
export function totalStepLimitDecision(input: {
  totalSteps: number
  totalStepLimit: number
  continuations: number
}): TotalStepLimitDecision {
  if (!Number.isFinite(input.totalStepLimit) || input.totalSteps < input.totalStepLimit) {
    return { action: "ignore" }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "TOTAL_STEP_LIMIT",
    message:
      `Session reached the cumulative step ceiling (${formatDecisionCount(input.totalStepLimit)} total steps` +
      `${input.continuations > 0 ? ` across ${formatDecisionCount(input.continuations)} auto-continuations` : ""}). ` +
      `This ceiling bounds every autonomous run, including active goals and Super-Long mode. ` +
      `To raise it, set "session.max_total_steps" in ax-code.json. ` +
      `The session is stopped; remaining work should not be treated as complete.`,
  }
}

export function agentStepLimitContinuationDecision(input: {
  step: number
  maxSteps: number
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): AgentStepLimitContinuationDecision {
  if (!Number.isFinite(input.maxSteps) || input.step < input.maxSteps) {
    return { action: "ignore" }
  }

  if (!input.autonomous) return { action: "ignore" }

  // A 1-step agent must run its only step (isLastStep disables tools). Continuing
  // here would reset the step counter without ever calling the model and livelock
  // under Super-Long / active-goal infinite continuation caps.
  if (input.step === input.maxSteps && input.maxSteps <= 1) {
    return { action: "ignore" }
  }

  // For multi-step agents at the last permitted step, prefer starting a fresh
  // continuation (when budget remains) before running the tool-disabled last step.
  const continuation = nextContinuation(input)
  if (continuation !== undefined) {
    return {
      action: "continue",
      continuation,
    }
  }

  // When step === maxSteps and maxContinuations === 0 (no continuation budget
  // was ever configured), return ignore so the LLM can complete its last
  // permitted step; pendingTodoContinuationDecision will emit the "unfinished
  // todo" error with isLastStep=true and break the loop cleanly.
  // When step === maxSteps and a continuation budget existed but is now
  // exhausted (maxContinuations > 0), stop immediately.
  if (input.step === input.maxSteps && input.maxContinuations === 0) {
    return { action: "ignore" }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "STEP_LIMIT",
    message:
      `Agent reached the per-agent step limit (${formatDecisionCount(input.maxSteps)} steps) ` +
      `and the continuation budget is exhausted ` +
      `(${formatDecisionCount(input.continuations)} continuations used). ` +
      `To increase, set the agent's step limit or raise session.max_continuations.`,
  }
}

export function completionGateEventState(input: {
  gate: AutonomousCompletionGate.Decision
  todoRetries: number
  maxTodoRetries: number
  completionGateRetries: number
  maxCompletionGateRetries: number
}): {
  reason: CompletionGateEventReason
  message: string
  retryCount: number
  maxRetries: number
} {
  if (input.gate.status !== "blocked") {
    return {
      reason: "none",
      message: "Completion gate passed.",
      retryCount: normalizedDecisionCount(input.completionGateRetries),
      maxRetries: normalizedDecisionCount(input.maxCompletionGateRetries),
    }
  }

  const useTodoRetries = input.gate.reason === "unfinished_todos"
  const retryCount = useTodoRetries ? input.todoRetries : input.completionGateRetries
  const maxRetries = useTodoRetries ? input.maxTodoRetries : input.maxCompletionGateRetries
  return {
    reason: input.gate.reason,
    message: input.gate.message,
    retryCount: normalizedDecisionCount(retryCount),
    maxRetries: normalizedDecisionCount(maxRetries),
  }
}

export function completionGateRetryDecision(input: {
  gate: EmptySubagentResultGateDecision
  previousSignature: string | undefined
  retries: number
  maxRetries: number
  isLastStep: boolean
}): CompletionGateRetryDecision {
  const signatureChanged = input.gate.signature !== input.previousSignature
  const retries = signatureChanged ? 0 : input.retries

  if (input.isLastStep || retryBudgetExhausted({ attempts: retries, maxAttempts: input.maxRetries })) {
    return {
      action: "stop",
      reason: input.isLastStep ? "step_limit" : "stalled",
      errorCode: input.isLastStep ? "STEP_LIMIT" : "COMPLETION_GATE_BLOCKED",
      attempts: normalizedDecisionCount(retries),
      message:
        `Autonomous mode stopped because the control-plane completion gate found incomplete subagent evidence. ` +
        `${input.gate.message} ` +
        `The session is stopped, but the task should not be treated as complete.`,
    }
  }

  const nextRetries = nextDecisionCount(retries)
  return {
    action: "continue",
    signature: input.gate.signature,
    retries: nextRetries,
    attempt: nextRetries,
  }
}

// Deliberately takes no maxContinuations: goal continuations are uncapped —
// the cumulative total-step ceiling and the goal's own budget/status are the
// bounds on an active goal, not session.max_continuations.
export function goalContinuationDecision(input: {
  goal: GoalForContinuationDecision | undefined
  continuations: number
  budgetWrapUp: GoalBudgetWrapUp
}): GoalContinuationDecision {
  if (!input.goal) return { action: "ignore" }

  if (input.goal.status === "active") {
    // Goals run until the model marks them complete or blocked — no continuation cap.
    return {
      action: "continue_active",
      objective: input.goal.objective,
      continuation: normalizedDecisionCount(input.continuations) + 1,
    }
  }

  if (input.goal.status === "budget_limited") {
    // The wrap-up ran in a previous prompt-loop run (the goal was already
    // budget_limited when this run started). The goal is inert: injecting
    // another wrap-up or publishing the budget error again would hijack
    // every later user prompt in this session with a spurious goal turn.
    if (input.budgetWrapUp === "concluded") return { action: "ignore" }

    // After the single wrap-up turn has run, a goal still sitting at
    // budget_limited must stop the loop explicitly. Previously this fell
    // through to "ignore", leaving termination to unrelated completion paths —
    // a wrap-up turn that kept tool-calling could keep the loop running with
    // no goal driver and no budget stop ever surfacing to the user.
    if (input.budgetWrapUp === "sent") {
      const budget = input.goal.tokenBudget
      return {
        action: "stop_budget_limit",
        reason: "stalled",
        message:
          `Goal "${input.goal.objective}" reached its token budget` +
          (budget !== undefined ? ` (${input.goal.tokensUsed} of ${budget} tokens used)` : "") +
          `. The wrap-up turn has already run, so the session is stopped. ` +
          `Review the wrap-up summary, then resume with a new prompt or start a new goal with a larger budget.`,
      }
    }

    if (input.goal.tokenBudget !== undefined) {
      // The single budget wrap-up turn is guaranteed once per budget cycle
      // (bounded by budgetWrapUp), independent of the continuation cap.
      // Active goals deliberately run past maxContinuations, so by the time a
      // long active goal exhausts its budget, `continuations` is almost always
      // already past the cap — gating the wrap-up on it denied the wrap-up turn
      // and surfaced a spurious "continuation limit reached" stop instead.
      return {
        action: "continue_budget_wrapup",
        objective: input.goal.objective,
        tokensUsed: input.goal.tokensUsed,
        tokenBudget: input.goal.tokenBudget,
        timeUsedSeconds: input.goal.timeUsedSeconds,
      }
    }
  }

  return { action: "ignore" }
}

export function emptyModelTurnDecision(input: {
  emptyModelTurn: boolean
  emptyModelTurnRetries: number
  maxEmptyModelTurnRetries: number
  todoRetries: number
  cause?: string
}): EmptyModelTurnDecision {
  if (!input.emptyModelTurn) {
    return {
      action: "ignore",
      emptyModelTurnRetries: 0,
    }
  }

  if (
    retryBudgetExhausted({
      attempts: input.emptyModelTurnRetries,
      maxAttempts: input.maxEmptyModelTurnRetries,
    })
  ) {
    return {
      action: "stop",
      reason: "stalled",
      errorCode: "EMPTY_MODEL_TURN",
      message: emptyModelTurnIncompleteMessage(input.cause),
    }
  }

  const nextEmptyModelTurnRetries = nextDecisionCount(input.emptyModelTurnRetries)
  return {
    action: "recover",
    emptyModelTurnRetries: nextEmptyModelTurnRetries,
    todoRetries: input.todoRetries,
    attempt: nextEmptyModelTurnRetries,
  }
}

export function truncatedModelTurnDecision(input: {
  truncatedModelTurn: boolean
  truncatedModelTurnRetries: number
  maxTruncatedModelTurnRetries: number
  repeatedOutput?: boolean
}): TruncatedModelTurnDecision {
  if (!input.truncatedModelTurn) {
    return {
      action: "ignore",
      truncatedModelTurnRetries: 0,
    }
  }

  const retries = normalizedDecisionCount(input.truncatedModelTurnRetries)
  if (input.repeatedOutput) {
    return {
      action: "stop",
      reason: "stalled",
      errorCode: "REPEATED_TRUNCATED_MODEL_TURN",
      message: REPEATED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE,
    }
  }

  if (retryBudgetExhausted({ attempts: retries, maxAttempts: input.maxTruncatedModelTurnRetries })) {
    return {
      action: "stop",
      reason: "stalled",
      errorCode: "TRUNCATED_MODEL_TURN",
      message: TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE,
    }
  }

  const nextRetries = nextDecisionCount(retries)
  return {
    action: "recover",
    truncatedModelTurnRetries: nextRetries,
    attempt: nextRetries,
  }
}
