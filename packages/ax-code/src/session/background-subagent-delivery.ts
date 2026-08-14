import { Log } from "@/util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { MessageID, SessionID } from "./schema"
import { TaskQueue } from "./task-queue"
import { syntheticTextPart } from "./prompt-message-builders"
import {
  childVisibleText,
  formatBackgroundTaskHandoff,
  isEmptySubagentResultText,
} from "./background-subagent-handoff"

const log = Log.create({ service: "session.background-subagent-delivery" })

export function isLiveTaskSubagent(item: TaskQueue.Info) {
  return item.kind === "subagent" && item.payload["source"] === "task"
}

export async function deliverBackgroundSubagentHandoff(input: {
  item: TaskQueue.Info
  outcome: { status: "completed"; result: unknown } | { status: "failed"; error: string }
}) {
  const { item, outcome } = input
  if (!isLiveTaskSubagent(item)) return item
  if (item.payload["deliveryStatus"] === "delivered") return item

  const parentSessionID = await resolveParentSessionID(item)
  if (!parentSessionID || !item.sessionID) {
    return TaskQueue.setDelivery({
      id: item.id,
      status: "blocked",
      error: "Background subagent has no parent session to deliver to.",
    })
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
    await persistParentHandoff(parentSessionID, handoff, item)
    const delivered = await TaskQueue.setDelivery({
      id: item.id,
      status: "delivered",
      error: undefined,
      resultEmpty: outcome.status === "failed" || isEmptySubagentResultText(text),
    })
    wakeParent(parentSessionID)
    return delivered
  } catch (error) {
    log.warn("failed to deliver background subagent handoff", {
      taskQueueID: item.id,
      sessionID: item.sessionID,
      parentSessionID,
      error,
    })
    return TaskQueue.setDelivery({
      id: item.id,
      status: "blocked",
      error: error instanceof Error ? error.message : "Failed to deliver background subagent result.",
    })
  }
}

async function resolveParentSessionID(item: TaskQueue.Info) {
  const fromPayload = item.payload["parentSessionID"]
  if (typeof fromPayload === "string" && fromPayload.startsWith("ses_")) return SessionID.make(fromPayload)
  if (!item.sessionID) return undefined
  const child = await Session.get(item.sessionID).catch(() => undefined)
  return child?.parentID
}

async function persistParentHandoff(parentSessionID: SessionID, text: string, item: TaskQueue.Info) {
  const messages = await Session.messages({ sessionID: parentSessionID })
  const lastUser = [...messages].reverse().find((message) => message.info.role === "user")
  const model = lastUser?.info.role === "user" ? lastUser.info.model : queueModel(item.model)
  const user = (await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: parentSessionID,
    role: "user",
    time: { created: Date.now() },
    agent: lastUser?.info.role === "user" ? lastUser.info.agent : (item.agent ?? "build"),
    model,
  })) as MessageV2.User
  await Session.updatePart(
    syntheticTextPart({
      messageID: user.id,
      sessionID: user.sessionID,
      text,
    }),
  )
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
