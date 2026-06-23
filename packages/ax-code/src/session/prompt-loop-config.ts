import type { Config } from "@/config/config"
import { GLOBAL_STEP_LIMIT } from "@/constants/session"

export const MAX_EMPTY_MODEL_TURN_RETRIES = 1
// Maximum consecutive outer-loop turns where the model only produces tool
// calls (finish="tool-calls") without ever finishing with a text response.
// Normal agentic work involves a handful of tool-calling turns before the
// model summarizes. 25 consecutive tool-only turns without convergence
// strongly indicates a model stuck in a read-only exploration loop (e.g.
// repeatedly listing directories or running the same shell commands).
export const MAX_TOOL_ONLY_TURNS = 25
// Truncated turns (finish=length) are a normal consequence of output-token
// limits — the model was actively generating useful content that exceeded its
// budget. Recovery ("continue from where you left off") is usually effective,
// so allow more attempts than empty turns (which signal a provider failure and
// rarely recover). 3 attempts covers typical large code-generation responses
// that span multiple output windows.
export const MAX_TRUNCATED_MODEL_TURN_RETRIES = 3

export function promptLoopLimits(config: Pick<Config.Info, "session">) {
  const maxTodoRetries = config.session?.max_todo_retries ?? 10
  return {
    sessionStepLimit: config.session?.max_steps ?? GLOBAL_STEP_LIMIT,
    maxContinuations: config.session?.max_continuations ?? 3,
    maxTodoRetries,
    maxCompletionGateRetries: Math.min(maxTodoRetries, 2),
    maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
    maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
  }
}
