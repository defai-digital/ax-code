import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { TaskQueue } from "@/session/task-queue"
import { TaskQueueID, SessionID } from "@/session/schema"
import { TaskQueueExecutor } from "@/session/task-queue-executor"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const TASK_QUEUE_ID_PARAM = z.object({ taskID: TaskQueueID.zod })

const TaskQueueListQuery = z.object({
  sessionID: SessionID.zod.optional(),
  status: TaskQueue.Status.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const TaskQueueEnqueueBody = TaskQueue.EnqueueInput
const TaskQueueEditBody = TaskQueue.EditBody
const TaskQueueStatusBody = z.object({
  status: TaskQueue.Status,
  error: z.string().optional(),
})
const INTERNAL_LIFECYCLE_HEADER = "x-ax-code-internal-task-queue-lifecycle"
const INTERNAL_LIFECYCLE_VALUE = "1"
const TaskQueueStatusHeaders = z.object({
  [INTERNAL_LIFECYCLE_HEADER]: z.literal(INTERNAL_LIFECYCLE_VALUE),
})
const TaskQueueReorderBody = z.object({
  position: z.number().int().min(0),
})

function taskID(c: { req: { valid: (input: "param") => { taskID: TaskQueueID } } }) {
  return c.req.valid("param").taskID
}

export const TaskQueueRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List task queue items",
        description: "Return server-owned task queue items scoped to the current project.",
        operationId: "taskQueue.list",
        responses: {
          200: {
            description: "Project-scoped task queue items.",
            content: {
              "application/json": {
                schema: resolver(TaskQueue.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", TaskQueueListQuery),
      async (c) => {
        return c.json(await TaskQueue.list(c.req.valid("query")))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Enqueue task",
        description: "Add a durable server-owned task queue item for the current project.",
        operationId: "taskQueue.enqueue",
        responses: {
          200: {
            description: "Created task queue item.",
            content: {
              "application/json": {
                schema: resolver(TaskQueue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", TaskQueueEnqueueBody),
      async (c) => {
        return c.json(await TaskQueue.enqueue(c.req.valid("json")))
      },
    )
    .get(
      "/:taskID",
      describeRoute({
        summary: "Get task queue item",
        description: "Return a single task queue item scoped to the current project.",
        operationId: "taskQueue.get",
        responses: {
          200: {
            description: "Task queue item.",
            content: {
              "application/json": {
                schema: resolver(TaskQueue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => {
        return c.json(await TaskQueue.get(taskID(c)))
      },
    )
    .post(
      "/:taskID/status",
      describeRoute({
        summary: "Update task queue status",
        description:
          "Internal lifecycle hook for server-owned queue execution. App clients should use action routes instead.",
        operationId: "taskQueue.status",
        responses: {
          200: {
            description: "Updated task queue item.",
            content: {
              "application/json": {
                schema: resolver(TaskQueue.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      validator("header", TaskQueueStatusHeaders),
      validator("json", TaskQueueStatusBody),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TaskQueue.setStatus({ id: taskID(c), status: body.status, error: body.error }))
      },
    )
    .post(
      "/:taskID/edit",
      describeRoute({
        summary: "Edit queued task",
        description: "Edit mutable task queue fields before the task is actively running or completed.",
        operationId: "taskQueue.edit",
        responses: {
          200: {
            description: "Edited task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      validator("json", TaskQueueEditBody),
      async (c) => c.json(await TaskQueue.edit({ id: taskID(c), ...c.req.valid("json") })),
    )
    .post(
      "/:taskID/pause",
      describeRoute({
        summary: "Pause queued task",
        description: "Mark a task queue item as paused.",
        operationId: "taskQueue.pause",
        responses: {
          200: {
            description: "Paused task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => c.json(await TaskQueue.pause(taskID(c))),
    )
    .post(
      "/:taskID/resume",
      describeRoute({
        summary: "Resume paused task",
        description: "Return a paused task queue item to queued state.",
        operationId: "taskQueue.resume",
        responses: {
          200: {
            description: "Resumed task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => c.json(await TaskQueue.resume(taskID(c))),
    )
    .post(
      "/:taskID/cancel",
      describeRoute({
        summary: "Cancel task",
        description: "Mark a task queue item as cancelled.",
        operationId: "taskQueue.cancel",
        responses: {
          200: {
            description: "Cancelled task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => c.json(await TaskQueue.cancel(taskID(c))),
    )
    .post(
      "/:taskID/retry",
      describeRoute({
        summary: "Retry task",
        description: "Return a failed or cancelled task queue item to queued state.",
        operationId: "taskQueue.retry",
        responses: {
          200: {
            description: "Retried task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => c.json(await TaskQueue.retry(taskID(c))),
    )
    .post(
      "/:taskID/send-now",
      describeRoute({
        summary: "Send task now",
        description:
          "Move a task queue item to the front of the queue. Executable prompt, command, shell, or workflow subagent items start immediately when the target session is idle; non-executable items remain queued.",
        operationId: "taskQueue.send_now",
        responses: {
          200: {
            description: "Prioritized or started task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => {
        return c.json(await TaskQueueExecutor.sendNow(taskID(c)))
      },
    )
    .post(
      "/:taskID/reorder",
      describeRoute({
        summary: "Reorder task",
        description: "Set the queue position for a task queue item.",
        operationId: "taskQueue.reorder",
        responses: {
          200: {
            description: "Reordered task queue item.",
            content: { "application/json": { schema: resolver(TaskQueue.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      validator("json", TaskQueueReorderBody),
      async (c) => {
        return c.json(await TaskQueue.reorder({ id: taskID(c), position: c.req.valid("json").position }))
      },
    )
    .delete(
      "/:taskID",
      describeRoute({
        summary: "Remove task queue item",
        description: "Delete a task queue item from the current project queue.",
        operationId: "taskQueue.delete",
        responses: {
          200: {
            description: "Task queue item deleted.",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", TASK_QUEUE_ID_PARAM),
      async (c) => c.json(await TaskQueue.remove(taskID(c))),
    ),
)
