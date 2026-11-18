import { Tool } from "./tool"
import DESCRIPTION from "./message_background_task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageID, PartID, SessionID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { TaskQueue } from "../session/task-queue"
import { isLiveTaskSubagent } from "../session/background-subagent-delivery"
import { wakeBackgroundSubagentSession, writeBackgroundSubagentMessage } from "../session/background-subagent-message"
import { childResultText, resolveTarget } from "./waitfor"
import { Log } from "@/util/log"

const log = Log.create({ service: "message-background-task-tool" })

// Same terminal set as waitfor: messaging a terminal task returns its status
// instead of injecting.
const TERMINAL_STATUSES: TaskQueue.Status[] = ["completed", "failed", "cancelled"]

// Only a task that is already executing may be woken. Queued and
// waiting-for-idle rows are owned by the task queue; nudging them would start
// the child ahead of its admission gate and leave the queue's row behind. A
// paused row must stay paused.
const NUDGE_STATUSES: TaskQueue.Status[] = ["running", "blocked_permission", "blocked_question"]

const parameters = z.object({
  task_id: z
    .string()
    .describe(
      "The task_id (child session id, ses_...) or queue_id (tsk_...) of a background task started from this session",
    ),
  message: z.string().min(1).describe("The follow-up message to deliver to the background task"),
})

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

    const child = await Session.get(item.sessionID).catch((error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    })
    // The spawning session in the ledger and the recorded child parent both
    // support task ownership checks, including rows predating the payload field.
    if (item.payload["parentSessionID"] !== ctx.sessionID && child?.parentID !== ctx.sessionID) {
      throw new Error(
        `Task ${item.id} was not started from this session. Only the session that started a background task may message it.`,
      )
    }

    // Terminal tasks are never injected into — report the outcome instead.
    if (TERMINAL_STATUSES.includes(item.status)) {
      // Failed/cancelled items report the authoritative error, never a stale
      // assistant answer left by an earlier run of the same child session.
      const text =
        item.status === "completed"
          ? (await childResultText(item)) || item.error || `Task finished with status: ${item.status}.`
          : item.error || `Task finished with status: ${item.status}.`
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

    if (!child) throw new NotFoundError({ message: `Session not found: ${item.sessionID}` })
    if (child.projectID !== item.projectID) {
      throw new Error("Background task child belongs to a different project.")
    }

    // Exactly-once via the ADR-055 ledger (ADR-057 D3 guard pattern):
    // 1. atomically claim a "pending" control delivery slot (a same-text
    //    redelivery or concurrent duplicate reuses the recorded ids),
    // 2. persist the user message (upsert keyed on those ids),
    // 3. flip the entry to "delivered".
    // A crash between any two steps is retried by the model re-calling this
    // tool with the same text: the pending entry is found, its ids are
    // reused, and the idempotent upsert converges to exactly one message.
    const claim = await TaskQueue.claimControlDelivery({
      id: item.id,
      messageID: MessageID.ascending(),
      partID: PartID.ascending(),
      text: params.message,
    })
    if (claim.item.sessionID !== child.id) {
      throw new Error("Background task changed its child session before delivery.")
    }
    const redelivered = !claim.claimed
    const messageID = MessageID.make(claim.entry.messageID)
    const partID = PartID.make(claim.entry.partID)

    // A control message is normal follow-up input, including mid-turn, where
    // queued-user-message handling picks it up on the next provider request.
    await writeBackgroundSubagentMessage({
      recipient: child,
      item: claim.item,
      messageID,
      part: {
        id: partID,
        text: formatControlMessage(item, params.message),
        metadata: { source: "background_task_control", taskID: item.id },
      },
    })
    const delivered = await TaskQueue.setControlDelivery({
      id: item.id,
      messageID,
      partID,
      text: params.message,
      status: "delivered",
    })

    // Let the queue retain ownership if the task paused or stopped while the
    // message was being persisted or the child workspace was booting.
    if (NUDGE_STATUSES.includes(delivered.status)) {
      void wakeBackgroundSubagentSession(child, async () => {
        const current = await TaskQueue.get(item.id)
        return current.sessionID === child.id && NUDGE_STATUSES.includes(current.status)
      }).catch((error) => {
        log.warn("failed to nudge background task prompt loop", { sessionID: child.id, error })
      })
    }

    return controlResult(
      item.title,
      {
        taskID: item.id,
        sessionID: child.id,
        status: delivered.status,
        messageID,
        delivered: true,
        redelivered,
      },
      [
        `task_id: ${item.id}`,
        `session_id: ${child.id}`,
        `state: ${delivered.status}`,
        "",
        redelivered
          ? "Message delivered (redelivery of an interrupted send — the task still sees it exactly once)."
          : "Message delivered. The task will see it as follow-up input; you will be notified when the task finishes.",
      ].join("\n"),
    )
  },
})
