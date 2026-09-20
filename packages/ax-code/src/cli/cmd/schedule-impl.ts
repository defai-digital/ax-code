import { EOL } from "os"
import type { Argv } from "yargs"
import { bootstrapReadonly } from "../bootstrap"
import { cmd } from "./cmd"
import { ScheduledTask } from "../../session/scheduled-task"
import { ScheduledTaskID } from "../../session/schema"
import { RuntimeRegistry } from "@/runtime/runtime-registry"
import { parseJsonResult } from "@/util/json-value"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Second-precision ISO keeps timestamp columns at 19 chars so padEnd(20) holds.
function formatTime(value: number | undefined) {
  if (!value) return "-"
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z")
}

function timezoneSuffix(timezone: string | undefined) {
  return timezone ? ` (${timezone})` : ""
}

function formatScheduleSummary(schedule: ScheduledTask.Schedule) {
  switch (schedule.type) {
    case "once":
      return `once ${formatTime(schedule.runAt)}`
    case "daily":
      return `daily ${schedule.time}${timezoneSuffix(schedule.timezone)}`
    case "weekly":
      return `weekly ${WEEKDAYS[schedule.day]} ${schedule.time}${timezoneSuffix(schedule.timezone)}`
    case "cron":
      return `cron "${schedule.expression}"${timezoneSuffix(schedule.timezone)}`
  }
}

export function formatScheduleList(items: ScheduledTask.Info[]) {
  if (items.length === 0) return `No scheduled tasks found.${EOL}`
  const header = ["status".padEnd(9), "next_run".padEnd(20), "schedule".padEnd(28), "id".padEnd(34), "title"].join(" ")
  const lines = items.map((item) => {
    const nextRun = formatTime(item.nextRunAt).padEnd(20)
    return `${item.status.padEnd(9)} ${nextRun} ${formatScheduleSummary(item.schedule).padEnd(28)} ${item.id.padEnd(34)} ${item.title}`
  })
  return [header, ...lines].join(EOL) + EOL
}

export function formatScheduleRunList(runs: ScheduledTask.RunInfo[]) {
  if (runs.length === 0) return `No runs found.${EOL}`
  const header = [
    "status".padEnd(16),
    "trigger".padEnd(9),
    "started".padEnd(20),
    "completed".padEnd(20),
    "covered".padEnd(7),
    "error",
  ].join(" ")
  const lines = runs.map((run) => {
    const covered = run.coalescedCount > 1 ? String(run.coalescedCount) : "-"
    return `${run.status.padEnd(16)} ${run.triggerType.padEnd(9)} ${formatTime(run.timeStarted).padEnd(20)} ${formatTime(run.timeCompleted).padEnd(20)} ${covered.padEnd(7)} ${run.error ?? ""}`
  })
  return [header, ...lines].join(EOL) + EOL
}

export function formatScheduleShow(task: ScheduledTask.Info, runs: ScheduledTask.RunInfo[]) {
  const lines = [
    `Scheduled task ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `schedule: ${formatScheduleSummary(task.schedule)}`,
    `nextRunAt: ${formatTime(task.nextRunAt)}`,
    `lastRunAt: ${formatTime(task.lastRunAt)}`,
    `catchUpPolicy: ${task.catchUpPolicy}`,
    `maxRunDurationMs: ${task.maxRunDurationMs ?? "-"}`,
    `agent: ${task.agent ?? "-"}`,
    `error: ${task.error ?? "-"}`,
    `created: ${formatTime(task.time.created)}`,
  ]
  return lines.join(EOL) + EOL + EOL + "Recent runs:" + EOL + formatScheduleRunList(runs)
}

function parseStatus(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined
  const parsed = ScheduledTask.Status.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Unknown task status "${value}". Expected one of: ${ScheduledTask.Status.options.join(", ")}`)
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
  return bootstrapReadonly(process.cwd(), fn)
}

function extractErrorMessage(text: string) {
  const parsed = parseJsonResult(text)
  if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null) {
    const value = parsed.value as { message?: unknown; error?: unknown }
    if (typeof value.message === "string" && value.message.length > 0) return value.message
    if (typeof value.error === "string" && value.error.length > 0) return value.error
  }
  return text.trim() || "unknown error"
}

async function liveRuntimeRecord(): Promise<RuntimeRegistry.Record | undefined> {
  const status = await RuntimeRegistry.status(process.cwd())
  return status.state === "running" && "record" in status ? status.record : undefined
}

async function runtimeFetch(record: RuntimeRegistry.Record, path: string, method: "POST" | "DELETE") {
  const response = await fetch(new URL(path, record.url), {
    method,
    headers: { ...RuntimeRegistry.headers(record), "content-type": "application/json" },
    body: method === "POST" ? "{}" : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const text = (await response.text()).slice(0, 4096)
    throw new Error(extractErrorMessage(text))
  }
  return response
}

// Mutations go through the live managed runtime when one exists so its
// scheduler sees the change immediately and attached clients receive the bus
// events. With no live runtime the shard is written directly — the next
// backend's scheduler reads task state fresh on every poll.
async function mutateScheduledTask(taskID: string, action: "pause" | "resume" | "delete") {
  const id = ScheduledTaskID.make(taskID)
  const record = await liveRuntimeRecord()
  if (record) {
    try {
      const path =
        action === "delete"
          ? `/scheduled-task/${encodeURIComponent(id)}`
          : `/scheduled-task/${encodeURIComponent(id)}/${action}`
      const response = await runtimeFetch(record, path, action === "delete" ? "DELETE" : "POST")
      if (action === "delete") {
        process.stdout.write(`Deleted ${taskID}${EOL}`)
        return
      }
      const parsed = parseJsonResult(await response.text())
      if (!parsed.ok) throw new Error("unexpected response body")
      process.stdout.write(formatScheduleList([ScheduledTask.Info.parse(parsed.value)]))
    } catch (error) {
      process.stderr.write(`${action} failed: ${error instanceof Error ? error.message : String(error)}${EOL}`)
      process.exitCode = 1
    }
    return
  }
  await withProject(async () => {
    if (action === "delete") {
      await ScheduledTask.remove(id)
      process.stdout.write(`Deleted ${taskID}${EOL}`)
      return
    }
    const updated = action === "pause" ? await ScheduledTask.pause(id) : await ScheduledTask.resume(id)
    process.stdout.write(formatScheduleList([updated]))
  })
}

const ScheduleListCommand = cmd({
  command: "list",
  describe: "list project scheduled tasks",
  builder: (yargs: Argv) =>
    yargs.option("status", { type: "string", describe: "filter by task status" }).option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const items = await ScheduledTask.list({ status: parseStatus(args.status) })
      if (args.json) {
        writeJson(items)
        return
      }
      process.stdout.write(formatScheduleList(items))
    })
  },
})

const ScheduleShowCommand = cmd({
  command: "show <taskID>",
  describe: "show one scheduled task and its recent runs",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const id = ScheduledTaskID.make(args.taskID)
      const task = await ScheduledTask.get(id)
      const runs = await ScheduledTask.listRuns({ taskID: id, limit: 5 })
      if (args.json) {
        writeJson({ task, runs })
        return
      }
      process.stdout.write(formatScheduleShow(task, runs))
    })
  },
})

const ScheduleRunsCommand = cmd({
  command: "runs <taskID>",
  describe: "list the run history for a scheduled task",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" })
      .option("limit", { type: "number", describe: "maximum number of runs to show" })
      .option("json", jsonOption()),
  async handler(args) {
    await withProject(async () => {
      const runs = await ScheduledTask.listRuns({
        taskID: ScheduledTaskID.make(args.taskID),
        limit: typeof args.limit === "number" ? args.limit : undefined,
      })
      if (args.json) {
        writeJson(runs)
        return
      }
      process.stdout.write(formatScheduleRunList(runs))
    })
  },
})

const SchedulePauseCommand = cmd({
  command: "pause <taskID>",
  describe: "pause a scheduled task",
  builder: (yargs: Argv) =>
    yargs.positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" }),
  async handler(args) {
    await mutateScheduledTask(args.taskID, "pause")
  },
})

const ScheduleResumeCommand = cmd({
  command: "resume <taskID>",
  describe: "resume a scheduled task",
  builder: (yargs: Argv) =>
    yargs.positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" }),
  async handler(args) {
    await mutateScheduledTask(args.taskID, "resume")
  },
})

const ScheduleDeleteCommand = cmd({
  command: "delete <taskID>",
  describe: "delete a scheduled task",
  builder: (yargs: Argv) =>
    yargs.positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" }),
  async handler(args) {
    await mutateScheduledTask(args.taskID, "delete")
  },
})

const ScheduleRunCommand = cmd({
  command: "run <taskID>",
  describe: "run a scheduled task now on this project's live runtime",
  builder: (yargs: Argv) =>
    yargs
      .positional("taskID", { type: "string", demandOption: true, describe: "scheduled task id" })
      .option("json", jsonOption()),
  async handler(args) {
    // Runs execute on the persistent backend only: claiming in-process and
    // exiting would orphan the run row until orphan reconciliation.
    const status = await RuntimeRegistry.status(process.cwd())
    if (status.state !== "running" || !("record" in status)) {
      process.stderr.write(
        (status.state === "unavailable"
          ? "The recorded runtime for this project is unavailable; inspect it with: ax-code runtime status"
          : "No running runtime for this project; scheduled runs execute on a live backend. Start one with: ax-code runtime start") +
          EOL,
      )
      process.exitCode = 1
      return
    }
    const id = ScheduledTaskID.make(args.taskID)
    const response = await runtimeFetch(
      status.record,
      `/scheduled-task/${encodeURIComponent(id)}/run-now`,
      "POST",
    ).catch((error: unknown) => {
      process.stderr.write(`Run failed: ${error instanceof Error ? error.message : String(error)}${EOL}`)
      process.exitCode = 1
      return undefined
    })
    if (!response) return
    const parsed = parseJsonResult(await response.text())
    if (!parsed.ok) {
      process.stderr.write(`Run failed: unexpected response body${EOL}`)
      process.exitCode = 1
      return
    }
    const result = ScheduledTask.RunNowResult.parse(parsed.value)
    if (args.json) {
      writeJson(parsed.value)
      return
    }
    if (result.queueItem) {
      process.stdout.write(`Started "${result.task.title}" (queue item ${result.queueItem.id})${EOL}`)
    } else if (result.workflowRun) {
      process.stdout.write(`Started "${result.task.title}" (workflow run ${result.workflowRun.id})${EOL}`)
    } else {
      process.stdout.write(`Started "${result.task.title}"${EOL}`)
    }
  },
})

export const ScheduleCommand = cmd({
  command: "schedule",
  describe: "inspect and control durable scheduled tasks",
  builder: (yargs: Argv) =>
    yargs
      .command(ScheduleListCommand)
      .command(ScheduleShowCommand)
      .command(ScheduleRunsCommand)
      .command(SchedulePauseCommand)
      .command(ScheduleResumeCommand)
      .command(ScheduleDeleteCommand)
      .command(ScheduleRunCommand)
      .demandCommand(),
  async handler() {},
})
