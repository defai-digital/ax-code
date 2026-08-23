import { Tool } from "./tool"
import DESCRIPTION from "./waitfor.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, TaskQueueID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { TaskQueue } from "../session/task-queue"
import { childVisibleText } from "../session/background-subagent-handoff"
import { Log } from "@/util/log"

const log = Log.create({ service: "waitfor-tool" })

// Terminal statuses from TaskQueue.Status (task-queue.ts). `waiting_for_idle`
// is handled separately below: waiting on it from the gating session would
// deadlock by construction.
const TERMINAL_STATUSES: TaskQueue.Status[] = ["completed", "failed", "cancelled"]

// Test seam: tests shrink the poll interval instead of waiting a full second
// per iteration.
export const WaitForInternals = {
  pollIntervalMs: 1000,
}

const MAX_TREE_DEPTH = 10

const parameters = z.object({
  task_id: z
    .string()
    .describe(
      "The task_id (child session id, ses_...) or queue_id (tsk_...) of a background task started from this session",
    )
    .optional(),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(600)
    .describe("Maximum seconds to wait for the task to reach a terminal state (1-600)"),
})

function abortError() {
  return new DOMException("Aborted", "AbortError")
}

function sleep(ms: number, abort: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (abort.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    abort.addEventListener("abort", onAbort, { once: true })
  })
}

// Exported for the background-task control tools (message_background_task),
// which resolve and scope targets the same way.
export async function resolveTarget(taskID: string): Promise<TaskQueue.Info | undefined> {
  if (taskID.startsWith("tsk_")) {
    return TaskQueue.get(TaskQueueID.make(taskID)).catch((e) => {
      if (NotFoundError.isInstance(e)) return undefined
      throw e
    })
  }
  if (taskID.startsWith("ses_")) {
    const items = await TaskQueue.list({ sessionID: SessionID.make(taskID), limit: 100 }).catch((e) => {
      if (NotFoundError.isInstance(e)) return [] as TaskQueue.Info[]
      throw e
    })
    // A child session can hold multiple subagent queue items; list order is
    // not creation order, so `.at(-1)` can return a stale row. Pick the item
    // with the greatest time.created (tie-break: greatest id).
    return items
      .filter((item) => item.kind === "subagent")
      .reduce<TaskQueue.Info | undefined>((latest, item) => {
        if (!latest) return item
        if (item.time.created > latest.time.created) return item
        if (item.time.created === latest.time.created && item.id > latest.id) return item
        return latest
      }, undefined)
  }
  return undefined
}

// The target must belong to the caller's session tree: walk the item's child
// session parent chain (same pattern as the depth walk in tool/task.ts) and
// require ctx.sessionID to appear.
async function belongsToSessionTree(item: TaskQueue.Info, sessionID: SessionID) {
  if (!item.sessionID) return false
  let current: SessionID | undefined = item.sessionID
  let depth = 0
  while (current) {
    if (current === sessionID) return true
    if (depth++ >= MAX_TREE_DEPTH) return false
    const session: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(current).catch((e) => {
      if (NotFoundError.isInstance(e)) return undefined
      throw e
    })
    current = session?.parentID
  }
  return false
}

export async function childResultText(item: TaskQueue.Info) {
  if (!item.sessionID) return ""
  const messages = await Session.messages({ sessionID: item.sessionID }).catch((e) => {
    if (NotFoundError.isInstance(e)) return [] as Awaited<ReturnType<typeof Session.messages>>
    throw e
  })
  const lastAssistant = messages.findLast((message) => message.info.role === "assistant")
  return childVisibleText(lastAssistant)
}

// Parent-idle gating: the executor only starts a waiting_for_idle item once
// the session it is scoped to goes idle (task-queue-executor-impl.ts:323-327).
// If that session is the caller itself, waiting here would deadlock until the
// timeout by construction.
function idleGateError(item: TaskQueue.Info) {
  return new Error(
    `Task ${item.id} is waiting for this session to go idle before it can start — waiting on it here would deadlock until the timeout. End your turn instead; you will be notified when it finishes.`,
  )
}

function isIdleGatedOn(item: TaskQueue.Info, sessionID: SessionID) {
  return item.status === "waiting_for_idle" && item.sessionID === sessionID
}

export const WaitForTool = Tool.define("waitfor", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!params.task_id) {
        throw new Error(
          "task_id is required: pass the task_id (ses_...) or queue_id (tsk_...) returned when the background task was started.",
        )
      }

      const item = await resolveTarget(params.task_id)
      if (!item) {
        throw new Error(
          `No background task found for task_id=${params.task_id}. Use the task_id or queue_id returned by the background task call.`,
        )
      }

      if (!(await belongsToSessionTree(item, ctx.sessionID))) {
        throw new Error(
          `Task ${item.id} is outside this session's tree. waitfor can only wait on background tasks started from this session or its descendants.`,
        )
      }

      if (isIdleGatedOn(item, ctx.sessionID)) {
        throw idleGateError(item)
      }

      const deadline = Date.now() + params.timeout * 1000
      let current = item
      while (!TERMINAL_STATUSES.includes(current.status)) {
        if (ctx.abort.aborted) throw abortError()
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        await sleep(Math.min(WaitForInternals.pollIntervalMs, remaining), ctx.abort)
        current = await TaskQueue.get(item.id).catch((e) => {
          // A transient read failure must not end the wait early; keep the
          // last known status and retry on the next poll.
          log.warn("failed to poll task queue item", { taskQueueID: item.id, error: e })
          return current
        })
        // Re-check the idle gate on the freshly polled item: an item can
        // transition queued → waiting_for_idle while we wait, which would
        // otherwise deadlock until the timeout.
        if (isIdleGatedOn(current, ctx.sessionID)) {
          throw idleGateError(current)
        }
      }

      if (!TERMINAL_STATUSES.includes(current.status)) {
        return {
          title: `Waiting on ${item.title}`,
          metadata: {
            taskID: item.id,
            sessionID: item.sessionID,
            status: current.status,
            timedOut: true,
            delivered: false,
          },
          output: `Still running after ${params.timeout}s. task_id=${item.id}; you will be notified when it finishes.`,
        }
      }

      // Re-read after the terminal transition so deliveryStatus is current.
      const latest = await TaskQueue.get(item.id).catch(() => current)
      const alreadyDelivered = latest.payload["deliveryStatus"] === "delivered"

      let text = ""
      if (item.kind === "subagent") {
        text = await childResultText(latest)
      }
      if (!text) {
        text =
          latest.error ??
          (latest.status === "completed"
            ? "Task completed without a final response."
            : `Task finished with status: ${latest.status}.`)
      }

      // Consume the result exactly once: marking delivered makes the handoff
      // path's guard (background-subagent-delivery.ts) suppress the automatic
      // completion notification. If delivery already ran, just read the child
      // session result without re-marking (the race is benign either way).
      // `delivered` in the metadata is true ONLY when this call actually
      // marked the item delivered.
      let markedDelivered = false
      if (!alreadyDelivered && item.kind === "subagent") {
        markedDelivered = await TaskQueue.setDelivery({
          id: item.id,
          status: "delivered",
          resultEmpty: text.trim().length === 0,
        }).then(
          () => true,
          (e) => {
            log.warn("failed to mark background task delivered", { taskQueueID: item.id, error: e })
            return false
          },
        )
      }

      return {
        title: item.title,
        metadata: {
          taskID: item.id,
          sessionID: item.sessionID,
          status: latest.status,
          timedOut: false,
          delivered: markedDelivered,
        },
        output: [
          // Echo the queue item id — the same id form the timeout path uses.
          `task_id: ${item.id}`,
          ...(item.sessionID ? [`session_id: ${item.sessionID}`] : []),
          `state: ${latest.status}`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n"),
      }
    },
  }
})
