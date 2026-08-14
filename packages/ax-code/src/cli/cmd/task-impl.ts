import { EOL } from "os"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { TaskQueue } from "../../session/task-queue"
import { TaskQueueExecutor } from "../../session/task-queue-executor"
import { SessionID, TaskQueueID } from "../../session/schema"

type JsonOption = {
  json?: boolean
}

export function formatTaskList(items: TaskQueue.Info[]) {
  if (items.length === 0) return `No tasks found.${EOL}`
  const header = ["status".padEnd(18), "delivery".padEnd(10), "kind".padEnd(12), "id".padEnd(30), "title"].join(" ")
  const lines = items.map((item) => {
    const delivery = deliveryStatus(item).padEnd(10)
    return `${item.status.padEnd(18)} ${delivery} ${item.kind.padEnd(12)} ${item.id.padEnd(30)} ${item.title}`
  })
  return [header, ...lines].join(EOL) + EOL
}

export function formatTaskShow(item: TaskQueue.Info) {
  const lines = [
    `Task ${item.id}`,
    `status: ${item.status}`,
    `delivery: ${deliveryStatus(item)}`,
    `kind: ${item.kind}`,
    `title: ${item.title}`,
    `session: ${item.sessionID ?? "-"}`,
    `agent: ${item.agent ?? "-"}`,
    `priority: ${item.priority}`,
    `created: ${formatTime(item.time.created)}`,
    `started: ${formatTime(item.time.started)}`,
    `completed: ${formatTime(item.time.completed)}`,
  ]
  if (item.error) lines.push(`error: ${item.error}`)
  const deliveryError = payloadString(item, "deliveryError")
  if (deliveryError) lines.push(`deliveryError: ${deliveryError}`)
  const parent = payloadString(item, "parentSessionID")
  if (parent) lines.push(`parentSession: ${parent}`)
  const source = payloadString(item, "source")
  if (source) lines.push(`source: ${source}`)
  const subagentType = payloadString(item, "subagentType")
  if (subagentType) lines.push(`subagentType: ${subagentType}`)
  if (item.payload["deliveryEmpty"] === true) lines.push("deliveryEmpty: true")
  return lines.join(EOL) + EOL
}

function deliveryStatus(item: TaskQueue.Info) {
  const value = item.payload["deliveryStatus"]
  return typeof value === "string" && value.length > 0 ? value : "-"
}

function payloadString(item: TaskQueue.Info, key: string) {
  const value = item.payload[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function formatTime(value: number | undefined) {
  if (!value) return "-"
  return new Date(value).toISOString()
}

function parseStatus(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined
  const parsed = TaskQueue.Status.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Unknown task status "${value}". Expected one of: ${TaskQueue.Status.options.join(", ")}`)
  }
  return parsed.data
}

function jsonOption() {
  return {
    type: "boolean" as const,
    describe: "output machine-readable JSON",
  }
}

function writeJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + EOL)
}

async function withProject<T>(fn: () => Promise<T>) {
  return bootstrap(process.cwd(), fn)
}

const TaskListCommand = cmd({
  command: "list",
  describe: "list project task queue items",
  builder: (yargs: Argv) =>
    yargs
      .option("status", {
        type: "string",
        describe: "filter by queue status",
      })
      .option("session", {
        type: "string",
        describe: "filter by session id",
      })
      .option("limit", {
        type: "number",
        describe: "maximum number of items to show",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const items = await TaskQueue.list({
        status: parseStatus(args.status),
        sessionID: typeof args.session === "string" ? SessionID.make(args.session) : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      })
      if (args.json) {
        writeJson(items)
        return
      }
      process.stdout.write(formatTaskList(items))
    })
  },
})

const TaskShowCommand = cmd({
  command: "show <taskID>",
  describe: "show one task queue item",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", {
        type: "string",
        demandOption: true,
        describe: "task queue id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const item = await TaskQueue.get(TaskQueueID.make(args.taskID))
      if (args.json) {
        writeJson(item)
        return
      }
      process.stdout.write(formatTaskShow(item))
    })
  },
})

const TaskCancelCommand = cmd({
  command: "cancel <taskID>",
  describe: "stop a queued or running task",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", {
        type: "string",
        demandOption: true,
        describe: "task queue id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const item = await TaskQueue.stop(TaskQueueID.make(args.taskID))
      if (args.json) {
        writeJson(item)
        return
      }
      process.stdout.write(formatTaskShow(item))
    })
  },
})

const TaskRetryCommand = cmd({
  command: "retry <taskID>",
  describe: "requeue a failed or cancelled task and start it",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", {
        type: "string",
        demandOption: true,
        describe: "task queue id",
      })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const retried = await TaskQueue.retry(TaskQueueID.make(args.taskID))
      const started = await TaskQueueExecutor.start(retried)
      if (args.json) {
        writeJson(started)
        return
      }
      process.stdout.write(formatTaskShow(started))
    })
  },
})

export const TaskCommand = cmd({
  command: "task",
  describe: "inspect and control the durable task queue",
  builder: (yargs: Argv) =>
    yargs.command(TaskListCommand).command(TaskShowCommand).command(TaskCancelCommand).command(TaskRetryCommand).demandCommand(),
  async handler() {},
})
