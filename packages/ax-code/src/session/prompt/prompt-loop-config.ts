import type { Config } from "@/config/config"
import { GLOBAL_STEP_LIMIT } from "@/constants/session"
import { resolveAutonomyBudget, type ResolvedAutonomyBudget } from "../autonomy-budget"
export * from "./prompt-loop-thresholds"
import {
  MAX_EMPTY_MODEL_TURN_RETRIES,
  TOOL_ONLY_TURN_NUDGE,
  MAX_TOOL_ONLY_TURNS,
  TOOL_ONLY_TURN_FINAL_NUDGE,
  FAILED_TOOL_TURN_NUDGE,
  FAILED_TOOL_TURN_FORCE,
  MAX_FAILED_TOOL_TURNS,
  MAX_FAILED_MUTATION_ATTEMPTS,
  AX_ENGINE_READ_ONLY_TURN_NUDGE,
  AX_ENGINE_READ_ONLY_TURN_FORCE,
  AX_ENGINE_LARGE_TOOL_OUTPUT_CHARS,
  MAX_UNEXECUTABLE_TOOL_TEXT_RECOVERIES,
  MAX_TRUNCATED_MODEL_TURN_RETRIES,
  AX_ENGINE_MAX_TRUNCATED_MODEL_TURN_RETRIES,
  AX_ENGINE_TRUNCATED_RECOVERY_MAX_OUTPUT_TOKENS,
  AX_ENGINE_TRUNCATED_CODE_RECOVERY_MAX_OUTPUT_TOKENS,
} from "./prompt-loop-thresholds"

/**
 * Every stop-condition ladder's thresholds, declared side by side.
 *
 * The ladders are deliberately separate decision functions and must not be
 * collapsed into one: they carry different predicates (no-progress turas,
 * all-failed turns, segment-cumulative failed mutations, and the local
 * read-only evidence guard), and the last one exists to hold a local latency
 * boundary rather than to be a shorter generic ladder — see the item-4 design
 * review in `.internal/reports/2026-09-25-agentic-rework-review/`.
 *
 * What they must not do is drift silently: the ax-engine guard and the generic
 * ladder keeping separate copies of the same intent is how one could be changed
 * while the other kept its old numbers. Declaring them in one table makes every
 * difference a visible choice, and `prompt-loop-ladders.test.ts` pins the
 * relationships that reasoning depends on.
 */
export const LOOP_LADDERS = {
  /** Generic liveness guard: tool-only turns with no progress. */
  tool_only: {
    nudge: TOOL_ONLY_TURN_NUDGE,
    finalNudge: TOOL_ONLY_TURN_FINAL_NUDGE,
    stop: MAX_TOOL_ONLY_TURNS,
  },
  /** Fast ladder for turns where every tool call errored. */
  failed_tool: {
    nudge: FAILED_TOOL_TURN_NUDGE,
    force: FAILED_TOOL_TURN_FORCE,
    stop: MAX_FAILED_TOOL_TURNS,
  },
  /** Segment-cumulative net for failed mutations that interleave with successes. */
  failed_mutation: {
    stop: MAX_FAILED_MUTATION_ATTEMPTS,
  },
  /**
   * Local MLX read-only guard. Deliberately far tighter than `tool_only`
   * because every extra local round costs prefill; it is a policy bound, not a
   * shortened copy. Its evidence/grace/synthesis phases live in
   * `readOnlyExplorationDecision`.
   */
  ax_engine_read_only: {
    nudge: AX_ENGINE_READ_ONLY_TURN_NUDGE,
    force: AX_ENGINE_READ_ONLY_TURN_FORCE,
  },
} as const

/**
 * Turns a mutation keeps counting as recent progress for the tool-only ladder
 * (its `recentProgress` leniency). Assigned here rather than inline so the
 * grace window is visible next to the thresholds it relaxes.
 */
export const RECENT_MUTATION_GRACE_TURNS = 5

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

export function promptLoopLimits(config: Pick<Config.Info, "session" | "experimental" | "autonomy">): PromptLoopLimits {
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
