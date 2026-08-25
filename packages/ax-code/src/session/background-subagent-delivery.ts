import { Log } from "@/util/log"
import { NotFoundError } from "@/storage/db"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { MessageID, PartID, SessionID } from "./schema"
import { TaskQueue } from "./task-queue"
import { childVisibleText, formatBackgroundTaskHandoff, isEmptySubagentResultText } from "./background-subagent-handoff"

const log = Log.create({ service: "session.background-subagent-delivery" })

export function isLiveTaskSubagent(item: TaskQueue.Info) {
  return item.kind === "subagent" && item.payload["source"] === "task"
}

export const BackgroundSubagentDeliveryInternals = {
  async afterPersist(_item: TaskQueue.Info): Promise<void> {},
}

export async function deliverBackgroundSubagentHandoff(input: {
  item: TaskQueue.Info
  outcome: { status: "completed"; result: unknown } | { status: "failed"; error: string }
}) {
  const { item, outcome } = input
  if (!isLiveTaskSubagent(item)) return item

  const requestedClaim: TaskQueue.ResultDeliveryClaim = {
    owner: "handoff",
    messageID: MessageID.ascending(),
    partID: PartID.ascending(),
    time: Date.now(),
  }
  const selection = await TaskQueue.claimResultDelivery({ id: item.id, claim: requestedClaim })
  if (!selection.accepted || selection.claim?.owner !== "handoff") return selection.item
  const claim = selection.claim

  const parentSessionID = await resolveParentSessionID(item)
  if (!parentSessionID || !item.sessionID) {
    return TaskQueue.blockResultDelivery({
      id: item.id,
      claim,
      error: "Background subagent has no parent session to deliver to.",
    }).then((result) => result.item)
  }

  const text = outcome.status === "completed" ? childVisibleText(outcome.result) : ""
  const errorMessage = outcome.status === "failed" ? outcome.error : undefined
  const handoff = formatBackgroundTaskHandoff({
    taskID: item.sessionID,
    title: item.title,
    state: outcome.status === "failed" ? "error" : "completed",
    text,
    errorMessage,
  })

  try {
    await persistParentHandoff(parentSessionID, handoff, item, claim)
    await BackgroundSubagentDeliveryInternals.afterPersist(item)
    const delivered = await TaskQueue.completeResultDelivery({
      id: item.id,
      claim,
      resultEmpty: outcome.status === "failed" || isEmptySubagentResultText(text),
    })
    wakeParent(parentSessionID)
    return delivered.item
  } catch (error) {
    log.warn("failed to deliver background subagent handoff", {
      taskQueueID: item.id,
      sessionID: item.sessionID,
      parentSessionID,
      error,
    })
    return TaskQueue.blockResultDelivery({
      id: item.id,
      claim,
      error: error instanceof Error ? error.message : "Failed to deliver background subagent result.",
    }).then((result) => result.item)
  }
}

export async function recoverBackgroundSubagentHandoffs() {
  const items = await TaskQueue.listBackgroundResultDeliveriesForRecovery()
  let delivered = 0
  let preserved = 0
  let blocked = 0

  for (const item of items) {
    try {
      let current = item
      const claim = TaskQueue.resultDeliveryClaim(current)
      if (claim?.owner === "waitfor") {
        if (await waitForResultWasPersisted(item, claim)) {
          await TaskQueue.completeResultDelivery({ id: item.id, claim })
          preserved++
          continue
        }
        const released = await TaskQueue.releaseWaitForResultDelivery({ id: item.id, claim })
        if (!released.released) {
          preserved++
          continue
        }
        current = released.item
      }

      const recovered = await deliverBackgroundSubagentHandoff({
        item: current,
        outcome: await recoveryOutcome(current),
      })
      if (recovered.payload["deliveryStatus"] === "delivered") delivered++
      else blocked++
    } catch (error) {
      blocked++
      log.warn("failed to recover background subagent handoff", {
        taskQueueID: item.id,
        sessionID: item.sessionID,
        error,
      })
    }
  }

  return { delivered, preserved, blocked }
}

async function resolveParentSessionID(item: TaskQueue.Info) {
  const fromPayload = item.payload["parentSessionID"]
  if (typeof fromPayload === "string" && fromPayload.startsWith("ses_")) return SessionID.make(fromPayload)
  if (!item.sessionID) return undefined
  const child = await Session.get(item.sessionID).catch(() => undefined)
  return child?.parentID
}

async function persistParentHandoff(
  parentSessionID: SessionID,
  text: string,
  item: TaskQueue.Info,
  claim: Extract<TaskQueue.ResultDeliveryClaim, { owner: "handoff" }>,
) {
  const messages = await Session.messages({ sessionID: parentSessionID })
  const lastUser = [...messages].reverse().find((message) => message.info.role === "user")
  const model = lastUser?.info.role === "user" ? lastUser.info.model : queueModel(item.model)
  const existing = await MessageV2.get({ sessionID: parentSessionID, messageID: claim.messageID }).catch(
    (error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    },
  )
  const user = (await Session.updateMessage({
    id: claim.messageID,
    sessionID: parentSessionID,
    role: "user",
    time: { created: existing?.info.role === "user" ? existing.info.time.created : Date.now() },
    agent: lastUser?.info.role === "user" ? lastUser.info.agent : (item.agent ?? "build"),
    model,
  })) as MessageV2.User
  await Session.updatePart({
    id: claim.partID,
    messageID: user.id,
    sessionID: user.sessionID,
    type: "text",
    text,
    synthetic: true,
    metadata: {
      source: "background_subagent_handoff",
      taskQueueID: item.id,
    },
  })
}

async function waitForResultWasPersisted(
  item: TaskQueue.Info,
  claim: Extract<TaskQueue.ResultDeliveryClaim, { owner: "waitfor" }>,
) {
  const message = await MessageV2.get({ sessionID: claim.sessionID, messageID: claim.messageID }).catch(
    (error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    },
  )
  return message?.parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool === "waitfor" &&
      part.callID === claim.callID &&
      part.state.status === "completed" &&
      part.state.metadata?.["taskID"] === item.id &&
      part.state.metadata?.["delivered"] === true,
  )
}

async function recoveryOutcome(
  item: TaskQueue.Info,
): Promise<{ status: "completed"; result: unknown } | { status: "failed"; error: string }> {
  if (item.status === "failed") {
    return { status: "failed", error: item.error ?? "Background subagent failed before delivery." }
  }
  if (!item.sessionID) return { status: "completed", result: { parts: [] } }
  const messages = await Session.messages({ sessionID: item.sessionID }).catch((error: unknown) => {
    if (NotFoundError.isInstance(error)) return [] as MessageV2.WithParts[]
    throw error
  })
  return {
    status: "completed",
    result: messages.findLast((message) => message.info.role === "assistant") ?? { parts: [] },
  }
}

function queueModel(model: unknown) {
  if (!model || typeof model !== "object") {
    return { providerID: "unknown" as never, modelID: "unknown" as never }
  }
  const record = model as { providerID?: unknown; modelID?: unknown }
  if (typeof record.providerID === "string" && typeof record.modelID === "string") {
    return { providerID: record.providerID as never, modelID: record.modelID as never }
  }
  return { providerID: "unknown" as never, modelID: "unknown" as never }
}

function wakeParent(parentSessionID: SessionID) {
  void SessionPrompt.loop({ sessionID: parentSessionID }).catch((error) => {
    log.warn("failed to wake parent after background subagent handoff", {
      sessionID: parentSessionID,
      error,
    })
  })
}
