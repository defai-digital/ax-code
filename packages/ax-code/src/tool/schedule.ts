import z from "zod"
import { ScheduledTask } from "@/session/scheduled-task"
import { ScheduledTaskID } from "@/session/schema"
import { Tool } from "./tool"

// Conversational scheduling (PRD-2026-07-25 G1b, Kimi CLI parity): let the
// agent create and manage durable scheduled tasks from ordinary requests
// like "remind me at 14:30 to check the deployment" or "summarize CI
// failures every weekday at 9am". These tools are a thin surface over the
// existing ScheduledTask engine — all schedule validation, atomic due
// claiming, and execution (TaskQueue / workflow start) stay there; the
// tools never execute anything themselves.

function taskSummary(task: ScheduledTask.Info) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    schedule: task.schedule,
    prompt: task.prompt,
    agent: task.agent,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    error: task.error,
  }
}

function taskOutput(task: ScheduledTask.Info) {
  return JSON.stringify({ task: taskSummary(task) }, null, 2)
}

// InvalidSchedule is a NamedError: its .message is the error name, and the
// human-readable reason lives in .data.message. The model needs the reason
// to correct its input, so unwrap before rethrowing.
async function withReadableScheduleErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ScheduledTask.InvalidSchedule) {
      throw new Error(error.data.message)
    }
    throw error
  }
}

// Mirrors ScheduledTask.Schedule, restated here so the model sees concrete
// parameter docs instead of an opaque union reference.
const ScheduleParameter = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("once"),
      runAt: z.number().int().positive().describe("Epoch milliseconds for a one-time run."),
    }),
    z.object({
      type: z.literal("daily"),
      time: z.string().describe('Time of day as "HH:MM" (24h).'),
      timezone: z.string().optional().describe("IANA timezone, e.g. Asia/Taipei. Defaults to the machine timezone."),
    }),
    z.object({
      type: z.literal("weekly"),
      day: z.number().int().min(0).max(6).describe("Day of week, 0 = Sunday … 6 = Saturday."),
      time: z.string().describe('Time of day as "HH:MM" (24h).'),
      timezone: z.string().optional().describe("IANA timezone. Defaults to the machine timezone."),
    }),
    z.object({
      type: z.literal("cron"),
      expression: z.string().describe("Standard 5-field cron expression (minute hour day-of-month month day-of-week)."),
      timezone: z.string().optional().describe("IANA timezone. Defaults to the machine timezone."),
    }),
  ])
  .describe("When the task runs. Translate natural-language times into this shape using the user's timezone.")

export const ScheduleTaskTool = Tool.define("schedule_task", {
  description:
    "Create a durable scheduled task that runs a prompt in this project at a future time — one-time reminders " +
    '("remind me at 14:30 to check the deployment") or recurring checks ("every weekday at 9am, summarize CI failures"). ' +
    "Translate the user's natural-language time into the schedule parameter, using their timezone for daily/weekly/cron " +
    "schedules and epoch milliseconds for one-time runs. Tasks persist in the project database and fire even after this " +
    "conversation ends (while an ax-code backend for this project is running). Only create tasks the user asked for.",
  parameters: z.object({
    title: z.string().min(1).max(200).describe("Short human-readable name shown in task lists."),
    prompt: z
      .string()
      .min(1)
      .max(20_000)
      .describe("The prompt to run when the task fires. Write it self-contained — it runs without this conversation."),
    schedule: ScheduleParameter,
    agent: z.string().optional().describe("Optional agent to run the prompt with. Defaults to the standard agent."),
  }),
  async execute(params) {
    const task = await withReadableScheduleErrors(() =>
      ScheduledTask.create({
        title: params.title,
        prompt: params.prompt,
        schedule: params.schedule,
        agent: params.agent,
      }),
    )
    return {
      title: `Scheduled: ${task.title}`,
      output: taskOutput(task),
      metadata: { task: taskSummary(task) },
    }
  },
})

export const ListScheduledTasksTool = Tool.define("list_scheduled_tasks", {
  description:
    "List this project's scheduled tasks with status, schedule, next/last run time, and any last-run error. " +
    "Use before creating a task the user may already have, and to find ids for manage_scheduled_task.",
  parameters: z.object({
    status: z.enum(["active", "paused", "disabled"]).optional().describe("Filter by status. Omit for all tasks."),
  }),
  async execute(params) {
    const tasks = await ScheduledTask.list({ status: params.status })
    return {
      title: `${tasks.length} scheduled task(s)`,
      output: JSON.stringify({ tasks: tasks.map(taskSummary) }, null, 2),
      metadata: { count: tasks.length },
    }
  },
})

export const ManageScheduledTaskTool = Tool.define("manage_scheduled_task", {
  description:
    "Pause, resume, or delete a scheduled task by id (from list_scheduled_tasks). " +
    "Pause keeps the task but stops it firing; resume re-activates it; delete removes it permanently. " +
    "Only manage tasks when the user asks.",
  parameters: z.object({
    id: z.string().min(1).describe("The scheduled task id."),
    action: z.enum(["pause", "resume", "delete"]),
  }),
  async execute(params) {
    const id = ScheduledTaskID.zod.parse(params.id)
    type ManageMetadata = { deleted?: string; task?: ReturnType<typeof taskSummary> }
    if (params.action === "delete") {
      await ScheduledTask.remove(id)
      return {
        title: "Deleted scheduled task",
        output: JSON.stringify({ deleted: id }, null, 2),
        metadata: { deleted: id } as ManageMetadata,
      }
    }
    const task = await withReadableScheduleErrors(() =>
      ScheduledTask.update({
        id,
        status: params.action === "pause" ? "paused" : "active",
      }),
    )
    return {
      title: `${params.action === "pause" ? "Paused" : "Resumed"}: ${task.title}`,
      output: taskOutput(task),
      metadata: { task: taskSummary(task) } as ManageMetadata,
    }
  },
})
