import { Tool } from "./tool"
import DESCRIPTION from "./waitfor.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, TaskQueueID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { TaskQueue } from "../session/task-queue"
import { BackgroundShell } from "./bash-background"
import { BackgroundNotification } from "../session/background-notification"
import { childVisibleText, isEmptySubagentResultText } from "../session/background-subagent-handoff"
import { Log } from "@/util/log"
import { abortError } from "@/util/abort"
import { sleep } from "@/util/timeout"

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
      "The task_id (child session id, ses_...), queue_id (tsk_...), or background shell id (bash_...) of a background task started from this session",
    )
    .optional(),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(600)
    .describe("Maximum seconds to wait for the task to reach a terminal state (1-600)"),
})

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
    // Newest-first: the default queue order is oldest-first, so a bounded limit
    // would keep the oldest rows and drop the live one for a busy child session.
    const items = await TaskQueue.list({ sessionID: SessionID.make(taskID), limit: 100, descending: true }).catch(
      (e) => {
        if (NotFoundError.isInstance(e)) return [] as TaskQueue.Info[]
        throw e
      },
    )
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

/**
 * Background-shell branch (bash_ ids: run_in_background, timeout adoption,
 * or monitors). Waits for the shell to leave "running" within the caller's
 * timeout, then returns the status plus the unread output tail. The terminal
 * read consumes the shell record exactly like bash_output, and any pending
 * exit notification for that shell is dropped so the result is not
 * presented twice.
 */
async function waitForShell(
  shellID: string,
  timeoutSeconds: number,
  ctx: Tool.Context,
): Promise<{ title: string; metadata: Record<string, any>; output: string }> {
  let info = BackgroundShell.get(shellID, ctx.sessionID)
  if (!info) {
    throw new Error(
      `No background shell with ID "${shellID}" in this session. Finished records may have been consumed or evicted by retention limits; call bash_output without shell_id to list available shells.`,
    )
  }

  const deadline = Date.now() + timeoutSeconds * 1000
  let vanished = false
  while (info.status === "running") {
    if (ctx.abort.aborted) throw abortError()
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(WaitForInternals.pollIntervalMs, remaining), { signal: ctx.abort })
    const next = BackgroundShell.get(shellID, ctx.sessionID)
    // A finished record is forgotten once read: another reader (bash_output)
    // consumed it while we waited. Stop polling instead of spinning on the
    // stale running snapshot until the timeout.
    if (!next) {
      vanished = true
      break
    }
    info = next
  }

  if (vanished) {
    return {
      title: `Waiting on ${info.description}`,
      // `info` is the last running snapshot; the shell finished, so neither
      // that status nor a timeout describes what happened.
      metadata: {
        shellID: info.id,
        timedOut: false,
        consumed: true,
      },
      output:
        `Background shell "${shellID}" finished and its record was consumed by another reader (e.g. bash_output). ` +
        `No unread output remains for waitfor.`,
    }
  }

  if (info.status === "running") {
    return {
      title: `Waiting on ${info.description}`,
      metadata: {
        shellID: info.id,
        status: info.status,
        timedOut: true,
      },
      output: `Still running after ${timeoutSeconds}s. shell_id=${info.id}; read incremental output with bash_output, wait again later, or use kill_shell to stop it.`,
    }
  }

  const read = BackgroundShell.read(shellID, ctx.sessionID)
  // The read consumed the record; a pending exit notification would repeat
  // the same tail on the next model step. Drop it (claim semantics, the
  // same reason the task branch claims its delivery).
  BackgroundNotification.clearShell(ctx.sessionID, shellID)
  const exit = info.exitCode === null ? "" : ` (exit ${info.exitCode})`
  const integrity = info.outputStatus === "complete" ? "" : `; output ${info.outputStatus}`
  const tail = (read?.output ?? "").trimEnd()
  return {
    title: info.description,
    metadata: {
      shellID: info.id,
      status: info.status,
      exitCode: info.exitCode,
      timedOut: false,
    },
    output: [
      `shell_id: ${info.id}`,
      `state: ${info.status}${exit}${integrity}`,
      "",
      "<shell_output>",
      ...(tail ? [tail] : ["(no unread output; it may already have been consumed via bash_output)"]),
      "</shell_output>",
    ].join("\n"),
  }
}

export const WaitForTool = Tool.define("waitfor", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!params.task_id) {
        throw new Error(
          "task_id is required: pass the task_id (ses_...), queue_id (tsk_...), or background shell id (bash_...) returned when the background task was started.",
        )
      }

      if (params.task_id.startsWith("bash_")) {
        return await waitForShell(params.task_id, params.timeout, ctx)
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
        await sleep(Math.min(WaitForInternals.pollIntervalMs, remaining), { signal: ctx.abort })
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

      // Re-read after the terminal transition so the delivery claim is based
      // on current state rather than the last polling snapshot.
      const latest = await TaskQueue.get(item.id).catch(() => current)

      // A failed/cancelled execution must report its own error. Reading the
      // session's last assistant message would surface an earlier successful
      // run when a retried/resumed item fails before writing a new answer.
      let text = ""
      if (item.kind === "subagent" && latest.status === "completed") {
        text = await childResultText(latest)
      }
      // Decide emptiness before the placeholder below replaces an empty child
      // result with non-empty status prose.
      const resultEmpty = latest.status !== "completed" || isEmptySubagentResultText(text)
      if (!text) {
        text =
          latest.error ??
          (latest.status === "completed"
            ? "Task completed without a final response."
            : `Task finished with status: ${latest.status}.`)
      }

      const liveTaskSubagent = latest.kind === "subagent" && latest.payload["source"] === "task"
      let markedDelivered = false
      if (liveTaskSubagent) {
        const selection = await TaskQueue.claimResultDelivery({
          id: item.id,
          claim: {
            owner: "waitfor",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID ?? "",
            time: Date.now(),
          },
          resultEmpty,
        }).catch((error) => {
          log.warn("failed to claim background task result", { taskQueueID: item.id, error })
          return undefined
        })

        if (!selection?.accepted) {
          const owner = selection?.claim?.owner
          return {
            title: item.title,
            metadata: {
              taskID: item.id,
              sessionID: item.sessionID,
              status: latest.status,
              timedOut: false,
              delivered: false,
            },
            output: [
              `task_id: ${item.id}`,
              ...(item.sessionID ? [`session_id: ${item.sessionID}`] : []),
              `state: ${latest.status}`,
              "",
              !selection
                ? "The result could not be claimed safely; the automatic parent handoff remains authoritative."
                : owner === "handoff"
                  ? "The result is already being delivered through the automatic parent handoff; no duplicate result is included here."
                  : "The result was already delivered; no duplicate result is included here.",
            ].join("\n"),
          }
        }
        markedDelivered = selection.accepted
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
