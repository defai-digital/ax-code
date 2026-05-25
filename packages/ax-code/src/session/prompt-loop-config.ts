import type { Config } from "@/config/config"
import { GLOBAL_STEP_LIMIT } from "@/constants/session"

export const MAX_EMPTY_MODEL_TURN_RETRIES = 1

export function promptLoopLimits(config: Pick<Config.Info, "session">) {
  const maxTodoRetries = config.session?.max_todo_retries ?? 10
  return {
    sessionStepLimit: config.session?.max_steps ?? GLOBAL_STEP_LIMIT,
    maxContinuations: config.session?.max_continuations ?? 3,
    maxTodoRetries,
    maxCompletionGateRetries: Math.min(maxTodoRetries, 2),
    maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
  }
}
