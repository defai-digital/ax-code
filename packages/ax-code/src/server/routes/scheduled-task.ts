import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ScheduledTask } from "@/session/scheduled-task"
import { ScheduledTaskID } from "@/session/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const SCHEDULED_TASK_ID_PARAM = z.object({ scheduledTaskID: ScheduledTaskID.zod })

const ScheduledTaskListQuery = z.object({
  status: ScheduledTask.Status.optional(),
  dueBefore: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const ScheduledTaskRunDueQuery = z.object({
  now: z.coerce.number().int().positive().optional(),
})

const ScheduledTaskUpdateBody = ScheduledTask.UpdateInput.omit({ id: true })

function scheduledTaskID(c: { req: { valid: (input: "param") => { scheduledTaskID: ScheduledTaskID } } }) {
  return c.req.valid("param").scheduledTaskID
}

export const ScheduledTaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List scheduled tasks",
        description: "Return project-scoped scheduled automation tasks.",
        operationId: "scheduledTask.list",
        responses: {
          200: {
            description: "Project scheduled tasks.",
            content: {
              "application/json": {
                schema: resolver(ScheduledTask.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", ScheduledTaskListQuery),
      async (c) => c.json(await ScheduledTask.list(c.req.valid("query"))),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create scheduled task",
        description: "Create a project-scoped scheduled automation task.",
        operationId: "scheduledTask.create",
        responses: {
          200: {
            description: "Created scheduled task.",
            content: { "application/json": { schema: resolver(ScheduledTask.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", ScheduledTask.CreateInput),
      async (c) => c.json(await ScheduledTask.create(c.req.valid("json"))),
    )
    .get(
      "/:scheduledTaskID",
      describeRoute({
        summary: "Get scheduled task",
        description: "Return one scheduled automation task.",
        operationId: "scheduledTask.get",
        responses: {
          200: {
            description: "Scheduled task.",
            content: { "application/json": { schema: resolver(ScheduledTask.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      async (c) => c.json(await ScheduledTask.get(scheduledTaskID(c))),
    )
    .post(
      "/:scheduledTaskID/update",
      describeRoute({
        summary: "Update scheduled task",
        description: "Update a scheduled automation task.",
        operationId: "scheduledTask.update",
        responses: {
          200: {
            description: "Updated scheduled task.",
            content: { "application/json": { schema: resolver(ScheduledTask.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      validator("json", ScheduledTaskUpdateBody),
      async (c) => c.json(await ScheduledTask.update({ id: scheduledTaskID(c), ...c.req.valid("json") })),
    )
    .post(
      "/:scheduledTaskID/pause",
      describeRoute({
        summary: "Pause scheduled task",
        description: "Pause a scheduled automation task.",
        operationId: "scheduledTask.pause",
        responses: {
          200: {
            description: "Paused scheduled task.",
            content: { "application/json": { schema: resolver(ScheduledTask.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      async (c) => c.json(await ScheduledTask.pause(scheduledTaskID(c))),
    )
    .post(
      "/:scheduledTaskID/resume",
      describeRoute({
        summary: "Resume scheduled task",
        description: "Resume a scheduled automation task.",
        operationId: "scheduledTask.resume",
        responses: {
          200: {
            description: "Resumed scheduled task.",
            content: { "application/json": { schema: resolver(ScheduledTask.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      async (c) => c.json(await ScheduledTask.resume(scheduledTaskID(c))),
    )
    .post(
      "/:scheduledTaskID/run-now",
      describeRoute({
        summary: "Run scheduled task now",
        description:
          "Run a scheduled task immediately. Prompt tasks create a server-owned automation queue item; workflow tasks create and start a workflow run.",
        operationId: "scheduledTask.run_now",
        responses: {
          200: {
            description: "Run-now result with the updated scheduled task and either a queue item or workflow run.",
            content: { "application/json": { schema: resolver(ScheduledTask.RunNowResult) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      async (c) => c.json(await ScheduledTask.runNow(scheduledTaskID(c))),
    )
    .post(
      "/run-due",
      describeRoute({
        summary: "Run due scheduled tasks",
        description: "Run due active scheduled tasks, creating automation queue items or workflow runs as configured.",
        operationId: "scheduledTask.run_due",
        responses: {
          200: {
            description: "Run-now results.",
            content: { "application/json": { schema: resolver(ScheduledTask.RunNowResult.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", ScheduledTaskRunDueQuery),
      async (c) => c.json(await ScheduledTask.runDue(c.req.valid("query").now)),
    )
    .delete(
      "/:scheduledTaskID",
      describeRoute({
        summary: "Delete scheduled task",
        description: "Delete a scheduled automation task.",
        operationId: "scheduledTask.delete",
        responses: {
          200: {
            description: "Scheduled task deleted.",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", SCHEDULED_TASK_ID_PARAM),
      async (c) => c.json(await ScheduledTask.remove(scheduledTaskID(c))),
    ),
)
