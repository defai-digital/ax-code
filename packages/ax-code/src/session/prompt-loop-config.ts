import type { Config } from "@/config/config"
import { GLOBAL_STEP_LIMIT } from "@/constants/session"
import { resolveAutonomyBudget, type ResolvedAutonomyBudget } from "./autonomy-budget"

export const MAX_EMPTY_MODEL_TURN_RETRIES = 1
// Nudge threshold: after this many consecutive tool-only turns, inject a
// continuation message telling the model to synthesize its findings and
// produce a final text response. This gives the model a chance to self-correct
// before the hard circuit-breaker fires.
export const TOOL_ONLY_TURN_NUDGE = 15
// Hard limit on consecutive outer-loop turns where the model only produces tool
// calls (finish="tool-calls") without ever finishing with a text response.
// Normal agentic work involves a handful of tool-calling turns before the
// model summarizes. After the nudge at TOOL_ONLY_TURN_NUDGE, give the model
// additional headroom before breaking out — legitimate deep-research tasks
// (e.g. reading 30+ files across a large codebase) may need 25-30 turns.
// 35 consecutive tool-only turns after a nudge strongly indicates the model
// is stuck in a read-only exploration loop (e.g. repeatedly listing
// directories or running the same shell commands).
export const MAX_TOOL_ONLY_TURNS = 35
// Final-warning checkpoint shortly before the hard limit: the first nudge at
// TOOL_ONLY_TURN_NUDGE fires once per streak, so without this a model that
// kept tool-calling would go from that single reminder straight to a hard
// stop 20 turns later with no further signal.
export const TOOL_ONLY_TURN_FINAL_NUDGE = MAX_TOOL_ONLY_TURNS - 5
// Local MLX prefill makes every extra model/tool round comparatively
// expensive. Still bound open-ended inspection, but allow a real evidence
// window first: pure Q&A (LOC counts, greps) is read-only work and must not
// be force-texted after two failed path probes. Mutating/editing turns use
// the normal tool-only limits above. When the streak has no successful tool
// results, force is delayed further (see readOnlyExplorationDecision).
export const AX_ENGINE_READ_ONLY_TURN_NUDGE = 2
export const AX_ENGINE_READ_ONLY_TURN_FORCE = 4
// When force would fire on the same turn that just produced a large successful
// tool payload (e.g. multi-file git diff), defer force once so the model can
// absorb/analyze with tools still available. 8k chars is well below the
// 26k+ diffs that otherwise get force-texted mid-review.
export const AX_ENGINE_LARGE_TOOL_OUTPUT_CHARS = 8_000
// After a forced text-only turn, if the model pastes unexecutable tool XML,
// re-enable tools once instead of hard-stopping (self-inflicted trap).
export const MAX_UNEXECUTABLE_TOOL_TEXT_RECOVERIES = 1
// Truncated turns (finish=length) are a normal consequence of output-token
// limits — the model was actively generating useful content that exceeded its
// budget. Recovery ("continue from where you left off") is usually effective,
// so allow more attempts than empty turns (which signal a provider failure and
// rarely recover). 3 attempts covers typical large code-generation responses
// that span multiple output windows.
export const MAX_TRUNCATED_MODEL_TURN_RETRIES = 3

export type PromptLoopLimits = {
  sessionStepLimit: number
  maxContinuations: number
  maxTotalSteps: number
  maxTotalStepsSuperLong: number
  maxTotalStepsGoal: number
  maxTodoRetries: number
  maxCompletionGateRetries: number
  maxEmptyModelTurnRetries: number
  maxTruncatedModelTurnRetries: number
  /** Full resolved budget (tool-only, burst, blast caps, profile). */
  autonomy: ResolvedAutonomyBudget
}

export function promptLoopLimits(
  config: Pick<Config.Info, "session" | "experimental" | "autonomy">,
): PromptLoopLimits {
  const autonomy = resolveAutonomyBudget(config)
  return {
    sessionStepLimit: autonomy.modelTurnsPerSegment,
    maxContinuations: autonomy.maxContinuations,
    maxTotalSteps: autonomy.modelTurnsTotal,
    maxTotalStepsSuperLong: autonomy.modelTurnsTotalSuperLong,
    maxTotalStepsGoal: autonomy.modelTurnsTotalGoal,
    maxTodoRetries: autonomy.maxTodoRetries,
    maxCompletionGateRetries: autonomy.maxCompletionGateRetries,
    maxEmptyModelTurnRetries: autonomy.maxEmptyModelTurnRetries,
    maxTruncatedModelTurnRetries: autonomy.maxTruncatedModelTurnRetries,
    autonomy,
  }
}

/**
 * Effective per-segment pacing cap shown in SessionStatus / TUI (ADR-051).
 * When the agent has a finite `steps` budget, the chip must show that
 * ceiling (bounded by session.max_steps), not always the session default.
 */
export function effectivePacingMaxSteps(input: { agentSteps: number; sessionStepLimit: number }): number {
  const sessionCap =
    Number.isFinite(input.sessionStepLimit) && input.sessionStepLimit > 0 ? input.sessionStepLimit : GLOBAL_STEP_LIMIT
  if (!Number.isFinite(input.agentSteps) || input.agentSteps <= 0) return sessionCap
  return Math.min(input.agentSteps, sessionCap)
}
