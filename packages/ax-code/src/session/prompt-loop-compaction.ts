import { SessionCompaction } from "./compaction"
import { MessageV2 } from "./message-v2"
import { pendingCompactionDecision } from "./prompt-loop-decisions"
import { SessionRetry } from "./retry"
import type { SessionID } from "./schema"

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
