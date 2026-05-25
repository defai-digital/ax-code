import type { ModelMessage } from "ai"
import { Log } from "../util/log"
import type { Provider } from "../provider/provider"
import { SessionCompaction } from "./compaction"
import { MessageV2 } from "./message-v2"
import { pendingCompactionDecision, shouldScheduleUsageCompaction } from "./prompt-loop-decisions"
import { estimateRequestTokens } from "./prompt-request"
import { SessionRetry } from "./retry"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PendingCompactionResult =
  | { action: "break"; reason: "completed" | "error" }
  | { action: "retry"; busyRetries: number }
  | { action: "processed"; busyRetries: 0 }

export async function processPendingCompaction(input: {
  task: MessageV2.CompactionPart
  messages: MessageV2.WithParts[]
  parentID: MessageV2.User["id"]
  abort: AbortSignal
  sessionID: SessionID
  busyRetries: number
}): Promise<PendingCompactionResult> {
  const result = await SessionCompaction.process({
    messages: input.messages,
    parentID: input.parentID,
    abort: input.abort,
    sessionID: input.sessionID,
    auto: input.task.auto,
    overflow: input.task.overflow,
  })
  const decision = pendingCompactionDecision({
    result,
    overflow: input.task.overflow,
    busyRetries: input.busyRetries,
  })
  if (decision.type === "break") {
    return { action: "break", reason: decision.reason }
  }
  if (decision.type === "retry") {
    try {
      // Honor cancel: a plain setTimeout would sleep regardless of abort
      // state, so a busy-retry chain could stall session cancellation.
      await SessionRetry.sleep(decision.delayMs, input.abort)
    } catch {
      return { action: "break", reason: "error" }
    }
    return { action: "retry", busyRetries: input.busyRetries + 1 }
  }
  return { action: "processed", busyRetries: 0 }
}

export async function maybeScheduleUsageCompaction(input: {
  sessionID: SessionID
  agent: string
  userModel: MessageV2.User["model"]
  model: Provider.Model
  lastFinished?: MessageV2.Assistant
}) {
  const overflow = input.lastFinished
    ? await SessionCompaction.isOverflow({ tokens: input.lastFinished.tokens, model: input.model })
    : false
  if (!shouldScheduleUsageCompaction({ lastFinished: input.lastFinished, overflow })) return false

  await SessionCompaction.create({
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.userModel,
    auto: true,
    triggerReason: "provider_usage",
  })
  return true
}

function isSyntheticContinuation(parts: MessageV2.Part[]) {
  return parts.length > 0 && parts.every((part) => (part as { synthetic?: boolean }).synthetic === true)
}

export async function maybeSchedulePreflightCompaction(input: {
  sessionID: SessionID
  agent: string
  userModel: MessageV2.User["model"]
  model: Provider.Model
  userParts: MessageV2.Part[]
  system: string[]
  requestMessages: ModelMessage[]
}) {
  const tokenBudget = await SessionCompaction.budget(input.model)
  if (!tokenBudget || isSyntheticContinuation(input.userParts)) return false

  const estimatedTokens = estimateRequestTokens({ system: input.system, messages: input.requestMessages })
  if (estimatedTokens < tokenBudget.usable) return false

  log.info("prompt preflight scheduled compaction", {
    command: "session.prompt.preflight",
    status: "ok",
    sessionID: input.sessionID,
    estimatedTokens,
    usableTokens: tokenBudget.usable,
    modelID: input.model.id,
    providerID: input.model.providerID,
  })
  await SessionCompaction.create({
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.userModel,
    auto: true,
    triggerReason: "prompt_preflight",
  })
  return true
}
