import { Tool } from "./tool"
import DESCRIPTION from "./message_background_task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageID, PartID, SessionID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { TaskQueue } from "../session/task-queue"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { isLiveTaskSubagent } from "../session/background-subagent-delivery"
import { childResultText, resolveTarget } from "./waitfor"
import { Log } from "@/util/log"

const log = Log.create({ service: "message-background-task-tool" })

// Same terminal set as waitfor: messaging a terminal task returns its status
// instead of injecting.
const TERMINAL_STATUSES: TaskQueue.Status[] = ["completed", "failed", "cancelled"]

// Test seam (same pattern as WaitForInternals): tests stub the nudge so no
// provider loop runs offline. Production nudge = wake the child session's
// prompt loop, the same mechanism the completion-handoff path uses to wake
// the parent (background-subagent-delivery.ts wakeParent).
export const MessageBackgroundTaskInternals = {
  nudge(sessionID: SessionID): Promise<unknown> {
    return SessionPrompt.loop({ sessionID })
  },
}

const parameters = z.object({
  task_id: z
    .string()
    .describe(
      "The task_id (child session id, ses_...) or queue_id (tsk_...) of a background task started from this session",
    ),
  message: z.string().min(1).describe("The follow-up message to deliver to the background task"),
})

function queueModel(model: unknown): MessageV2.User["model"] {
  if (!model || typeof model !== "object") {
    return { providerID: "unknown" as never, modelID: "unknown" as never }
  }
  const record = model as { providerID?: unknown; modelID?: unknown }
  if (typeof record.providerID === "string" && typeof record.modelID === "string") {
    return { providerID: record.providerID as never, modelID: record.modelID as never }
  }
  return { providerID: "unknown" as never, modelID: "unknown" as never }
}

// Only the DIRECT parent may message a background task (ADR-057 D2 scoping):
// the payload records the spawning session, with the child session's parentID
// as fallback (same resolution as the handoff path's resolveParentSessionID).
async function isDirectChild(item: TaskQueue.Info, sessionID: SessionID) {
  const fromPayload = item.payload["parentSessionID"]
  if (typeof fromPayload === "string" && fromPayload === sessionID) return true
  if (!item.sessionID) return false
  const child: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(item.sessionID).catch((e) => {
    if (NotFoundError.isInstance(e)) return undefined
    throw e
  })
  return child?.parentID === sessionID
}

function formatControlMessage(item: TaskQueue.Info, text: string) {
  return [
    `<background_task_message task_id="${item.id}" from="parent_session">`,
    text,
    "</background_task_message>",
  ].join("\n")
}

type ControlMetadata = {
  taskID: TaskQueue.Info["id"]
  sessionID: SessionID | undefined
  status: TaskQueue.Status
  delivered: boolean
  messageID?: MessageID
  redelivered?: boolean
}

function controlResult(title: string, metadata: ControlMetadata, output: string) {
  return { title, metadata, output }
}

// Persist the control message as a user message in the child session. Both
// writes are upserts keyed on the ledger-recorded ids, so redelivery after a
// mid-flight crash re-writes the SAME message instead of appending a copy.
// The text part is deliberately NOT synthetic: queued-user-message handling
// (prompt-loop-messages.ts remindQueuedMessages) folds it into the child's
// next provider request when the child is mid-turn, so a reentrant message
// becomes follow-up input without corrupting the running turn.
async function persistControlMessage(input: {
  item: TaskQueue.Info
  sessionID: SessionID
  messageID: MessageID
  partID: PartID
  text: string
}) {
  const messages = await Session.messages({ sessionID: input.sessionID })
  const lastUser = [...messages].reverse().find((message) => message.info.role === "user")
  const user = (await Session.updateMessage({
    id: input.messageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: lastUser?.info.role === "user" ? lastUser.info.agent : (input.item.agent ?? "build"),
    model: lastUser?.info.role === "user" ? lastUser.info.model : queueModel(input.item.model),
  })) as MessageV2.User
  await Session.updatePart({
    id: input.partID,
    messageID: user.id,
    sessionID: user.sessionID,
    type: "text",
    text: formatControlMessage(input.item, input.text),
    metadata: {
      source: "background_task_control",
      taskID: input.item.id,
    },
  })
}

export const MessageBackgroundTaskTool = Tool.define("message_background_task", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const item = await resolveTarget(params.task_id)
    if (!item) {
      throw new Error(
        `No background task found for task_id=${params.task_id}. Use the task_id or queue_id returned by the background task call.`,
      )
    }

    if (!isLiveTaskSubagent(item) || !item.sessionID) {
      throw new Error(
        `Task ${item.id} is not a background task started via the task tool. message_background_task can only message background subagent tasks.`,
      )
    }

    if (!(await isDirectChild(item, ctx.sessionID))) {
      throw new Error(
        `Task ${item.id} was not started from this session. Only the session that started a background task may message it.`,
      )
    }

    // Terminal tasks are never injected into — report the outcome instead.
    if (TERMINAL_STATUSES.includes(item.status)) {
      const text = (await childResultText(item)) || item.error || `Task finished with status: ${item.status}.`
      return controlResult(
        item.title,
        {
          taskID: item.id,
          sessionID: item.sessionID,
          status: item.status,
          delivered: false,
        },
        [
          `task_id: ${item.id}`,
          `session_id: ${item.sessionID}`,
          `state: ${item.status}`,
          "",
          "The task already finished, so the message was NOT delivered.",
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n"),
      )
    }

    const childSessionID = item.sessionID

    // Exactly-once via the ADR-055 ledger (ADR-057 D3 guard pattern):
    // 1. record a "pending" control delivery with the message/part ids,
    // 2. persist the user message (upsert keyed on those ids),
    // 3. flip the entry to "delivered".
    // A crash between any two steps is retried by the model re-calling this
    // tool with the same text: the pending entry is found, its ids are
    // reused, and the idempotent upsert converges to exactly one message.
    const pending = TaskQueue.controlDeliveries(item)
      .filter((entry) => entry.status === "pending" && entry.text === params.message)
      .sort((a, b) => a.time - b.time)[0]
    const redelivered = pending !== undefined
    const messageID = pending ? MessageID.make(pending.messageID) : MessageID.ascending()
    const partID = pending ? PartID.make(pending.partID) : PartID.ascending()

    if (!pending) {
      await TaskQueue.setControlDelivery({
        id: item.id,
        messageID,
        partID,
        text: params.message,
        status: "pending",
      })
    }
    await persistControlMessage({ item, sessionID: childSessionID, messageID, partID, text: params.message })
    await TaskQueue.setControlDelivery({
      id: item.id,
      messageID,
      partID,
      text: params.message,
      status: "delivered",
    })

    // Nudge the child's prompt loop. If the child is mid-turn, loop() joins
    // the active run's queue and the persisted message is picked up as
    // follow-up input; if the child is idle, a fresh loop starts on it.
    // Fire-and-forget with a logged catch, same as wakeParent.
    void MessageBackgroundTaskInternals.nudge(childSessionID).catch((error) => {
      log.warn("failed to nudge background task prompt loop", { sessionID: childSessionID, error })
    })

    return controlResult(
      item.title,
      {
        taskID: item.id,
        sessionID: childSessionID,
        status: item.status,
        messageID,
        delivered: true,
        redelivered,
      },
      [
        `task_id: ${item.id}`,
        `session_id: ${childSessionID}`,
        `state: ${item.status}`,
        "",
        redelivered
          ? "Message delivered (redelivery of an interrupted send — the task still sees it exactly once)."
          : "Message delivered. The task will see it as follow-up input; you will be notified when the task finishes.",
      ].join("\n"),
    )
  },
})
