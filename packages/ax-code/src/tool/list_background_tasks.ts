import { Tool } from "./tool"
import DESCRIPTION from "./list_background_tasks.txt"
import z from "zod"
import { Session } from "../session"
import { TaskQueue } from "../session/task-queue"
import { isLiveTaskSubagent } from "../session/background-subagent-delivery"

const parameters = z.object({})

function iso(time: number | undefined) {
  return time === undefined ? "-" : new Date(time).toISOString()
}

export const ListBackgroundTasksTool = Tool.define("list_background_tasks", {
  description: DESCRIPTION,
  parameters,
  // Read-only enumeration of the ADR-055 ledger — safe to run concurrently
  // with any other tool call.
  concurrencySafe: () => true,
  async execute(_params, ctx) {
    // Background subagents are ledgered on their CHILD session (task.ts
    // enqueues with the child session id), so enumerate this session's
    // children and collect their live task-subagent queue items.
    const children = await Session.children(ctx.sessionID)
    const tasks: TaskQueue.Info[] = []
    for (const child of children) {
      const items = await TaskQueue.list({ sessionID: child.id, limit: 100 })
      for (const item of items) {
        if (isLiveTaskSubagent(item)) tasks.push(item)
      }
    }
    tasks.sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))

    if (tasks.length === 0) {
      return {
        title: "Background tasks",
        metadata: { tasks: [] },
        output: "No background tasks found for this session.",
      }
    }

    const lines = tasks.flatMap((item) => {
      const delivery = typeof item.payload["deliveryStatus"] === "string" ? item.payload["deliveryStatus"] : "pending"
      return [
        `task_id: ${item.sessionID} | queue_id: ${item.id} | agent: ${item.agent ?? "unknown"} | status: ${item.status}`,
        `  description: ${item.title}`,
        `  delivery: ${delivery}${item.error ? ` | error: ${item.error}` : ""}`,
        `  created: ${iso(item.time.created)} | started: ${iso(item.time.started)} | completed: ${iso(item.time.completed)}`,
      ]
    })

    return {
      title: `Background tasks (${tasks.length})`,
      metadata: {
        tasks: tasks.map((item) => ({
          taskID: item.sessionID,
          queueID: item.id,
          agent: item.agent,
          description: item.title,
          status: item.status,
          deliveryStatus: item.payload["deliveryStatus"],
          error: item.error,
          time: item.time,
        })),
      },
      output: [
        `Background tasks started from this session (${tasks.length}):`,
        "",
        ...lines,
        "",
        "Use waitfor with a task_id or queue_id to read a finished task's result, or message_background_task to steer a running task.",
      ].join("\n"),
    }
  },
})
