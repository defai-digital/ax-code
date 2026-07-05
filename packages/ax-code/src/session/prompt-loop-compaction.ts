import type { ModelMessage } from "ai"
import { Log } from "../util/log"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"
import type { Permission } from "@/permission"
import { SessionCompaction } from "./compaction"
import { MessageV2 } from "./message-v2"
import { pendingCompactionDecision, shouldScheduleUsageCompaction } from "./prompt-loop-decisions"
import { estimateRequestTokens } from "./prompt-request"
import { estimateRegistryToolSchemaTokens } from "./prompt-tools"
import { SessionRetry } from "./retry"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

// True when a user turn carries media (image/PDF) attachments. Proactive
// auto-compaction strips media to text placeholders, so compacting before such
// a turn is answered loses the visual context the user just provided (and the
// stale summary can then drive the successor turn off course). See #259.
export function hasUnresolvedMedia(parts: MessageV2.Part[]): boolean {
  return parts.some((part) => part.type === "file" && MessageV2.isMedia(part.mime))
}

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
  superLong?: boolean
  latestUserParts?: MessageV2.Part[]
}) {
  // Don't proactively compact (and strip media) while the latest user turn
  // still carries unanswered image/PDF attachments — answer it first. A genuine
  // provider overflow still routes through the reactive overflow path. See #259.
  if (input.latestUserParts && hasUnresolvedMedia(input.latestUserParts)) {
    log.info("skipping usage compaction: latest user turn has unresolved media", {
      sessionID: input.sessionID,
    })
    return false
  }

  const overflow = input.lastFinished
    ? await SessionCompaction.isOverflow({
        tokens: input.lastFinished.tokens,
        model: input.model,
        superLong: input.superLong,
      })
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
  agentInfo: Agent.Info
  userModel: MessageV2.User["model"]
  model: Provider.Model
  userParts: MessageV2.Part[]
  system: string[]
  requestMessages: ModelMessage[]
  tools?: Record<string, boolean>
  sessionPermission?: Permission.Ruleset
}) {
  const tokenBudget = await SessionCompaction.budget(input.model)
  if (!tokenBudget || isSyntheticContinuation(input.userParts)) return false

  // The turn about to be sent carries media; don't strip it via a proactive
  // pre-send compaction. The reactive overflow path still handles a real
  // provider size rejection. See #259.
  if (hasUnresolvedMedia(input.userParts)) {
    log.info("skipping preflight compaction: user turn has unresolved media", {
      sessionID: input.sessionID,
    })
    return false
  }

  const messageTokens = estimateRequestTokens({ system: input.system, messages: input.requestMessages })
  const toolSchemaTokens = await estimateRegistryToolSchemaTokens({
    agent: input.agentInfo,
    model: input.model,
    tools: input.tools,
    sessionPermission: input.sessionPermission,
  })
  const estimatedTokens = messageTokens + toolSchemaTokens
  if (estimatedTokens < tokenBudget.usable) return false

  // Compaction can only shrink message history, not the fixed tool schema
  // overhead. Skip futile preflight compaction when that overhead cannot fit.
  if (toolSchemaTokens >= tokenBudget.usable) {
    log.info("skipping preflight compaction: tool schema overhead alone exceeds budget", {
      sessionID: input.sessionID,
      toolSchemaTokens,
      usableTokens: tokenBudget.usable,
    })
    return false
  }

  log.info("prompt preflight scheduled compaction", {
    command: "session.prompt.preflight",
    status: "ok",
    sessionID: input.sessionID,
    estimatedTokens,
    messageTokens,
    toolSchemaTokens,
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
