import type { Config } from "@/config/config"
import { GLOBAL_STEP_LIMIT, SUPER_LONG_TOTAL_STEP_HEADROOM } from "@/constants/session"

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
// Truncated turns (finish=length) are a normal consequence of output-token
// limits — the model was actively generating useful content that exceeded its
// budget. Recovery ("continue from where you left off") is usually effective,
// so allow more attempts than empty turns (which signal a provider failure and
// rarely recover). 3 attempts covers typical large code-generation responses
// that span multiple output windows.
export const MAX_TRUNCATED_MODEL_TURN_RETRIES = 3

export function promptLoopLimits(config: Pick<Config.Info, "session">) {
  const maxTodoRetries = config.session?.max_todo_retries ?? 10
  const sessionStepLimit = config.session?.max_steps ?? GLOBAL_STEP_LIMIT
  const maxContinuations = config.session?.max_continuations ?? 3
  return {
    sessionStepLimit,
    maxContinuations,
    // Cumulative ceiling across ALL continuations — the one bound that active
    // goals and Super-Long mode cannot lift or reset. Defaults preserve the
    // documented behavior (step limit × every permitted continuation) while
    // closing the previously unbounded goal/Super-Long paths.
    maxTotalSteps: config.session?.max_total_steps ?? sessionStepLimit * (maxContinuations + 1),
    maxTotalStepsSuperLong: config.session?.max_total_steps ?? sessionStepLimit * SUPER_LONG_TOTAL_STEP_HEADROOM,
    maxTodoRetries,
    maxCompletionGateRetries: Math.min(maxTodoRetries, 2),
    maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
    maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
  }
}
