import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import {
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunID,
  WorkflowScheduler,
  WorkflowSpecV1,
  WorkflowTemplate,
  isWorkflowRuntimeEnabled,
} from "@/workflow"
import { SessionID } from "@/session/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const WORKFLOW_RUN_ID_PARAM = z.object({ runID: WorkflowRunID.zod })
const WORKFLOW_TEMPLATE_ID_PARAM = z.object({ templateID: WorkflowTemplate.ID })

const WorkflowRunListQuery = z.object({
  parentSessionID: SessionID.zod.optional(),
  status: WorkflowRun.Status.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const WorkflowRunCreateBody = z
  .object({
    parentSessionID: SessionID.zod.optional(),
    sourceTemplateID: z.string().trim().min(1).optional(),
    templateID: WorkflowTemplate.ID.optional(),
    spec: WorkflowSpecV1.optional(),
  })
  .refine((input) => (input.templateID ? 1 : 0) + (input.spec ? 1 : 0) === 1, {
    message: "Exactly one of templateID or spec is required",
  })

function runID(c: { req: { valid: (input: "param") => { runID: WorkflowRunID } } }) {
  return c.req.valid("param").runID
}

function templateID(c: { req: { valid: (input: "param") => { templateID: WorkflowTemplate.ID } } }) {
  return c.req.valid("param").templateID
}

function assertWorkflowRoutesEnabled() {
  if (isWorkflowRuntimeEnabled()) return
  throw new HTTPException(404, {
    message: "Workflow runtime is disabled. Set AX_CODE_WORKFLOW_RUNTIME=1 to enable workflow routes.",
  })
}

export const WorkflowRunRoutes = lazy(() =>
  new Hono()
    .use(async (_c, next) => {
      assertWorkflowRoutesEnabled()
      await next()
    })
    .get(
      "/",
      describeRoute({
        summary: "List workflow runs",
        description: "Return durable workflow runs scoped to the current project.",
        operationId: "workflowRun.list",
        responses: {
          200: {
            description: "Project-scoped workflow runs.",
            content: { "application/json": { schema: resolver(WorkflowRun.Record.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", WorkflowRunListQuery),
      async (c) => c.json(await WorkflowRun.list(c.req.valid("query"))),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create workflow run",
        description: "Create a workflow run from a spec snapshot or a built-in workflow template.",
        operationId: "workflowRun.create",
        responses: {
          200: {
            description: "Created workflow run.",
            content: { "application/json": { schema: resolver(WorkflowRun.Record) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", WorkflowRunCreateBody),
      async (c) => {
        const body = c.req.valid("json")
        if (body.templateID) {
          return c.json(await WorkflowTemplate.createRun({ templateID: body.templateID, parentSessionID: body.parentSessionID }))
        }
        return c.json(
          await WorkflowRun.create({
            parentSessionID: body.parentSessionID,
            sourceTemplateID: body.sourceTemplateID,
            spec: body.spec!,
          }),
        )
      },
    )
    .get(
      "/:runID",
      describeRoute({
        summary: "Get workflow run detail",
        description: "Return a workflow run with phase, child, artifact, and budget state.",
        operationId: "workflowRun.get",
        responses: {
          200: {
            description: "Workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowRun.getDetail(runID(c))),
    )
    .post(
      "/:runID/start",
      describeRoute({
        summary: "Start workflow run",
        description: "Start or advance a workflow run through the scheduler.",
        operationId: "workflowRun.start",
        responses: {
          200: {
            description: "Started workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      validator("json", WorkflowScheduler.StartOptions.partial().optional()),
      async (c) => c.json(await WorkflowScheduler.start(runID(c), c.req.valid("json") ?? {})),
    )
    .post(
      "/:runID/pause",
      describeRoute({
        summary: "Pause workflow run",
        description: "Pause queued workflow children where the queue supports pausing.",
        operationId: "workflowRun.pause",
        responses: {
          200: {
            description: "Paused workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowScheduler.pause(runID(c))),
    )
    .post(
      "/:runID/resume",
      describeRoute({
        summary: "Resume workflow run",
        description: "Resume paused workflow queue children.",
        operationId: "workflowRun.resume",
        responses: {
          200: {
            description: "Resumed workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowScheduler.resume(runID(c))),
    )
    .post(
      "/:runID/cancel",
      describeRoute({
        summary: "Cancel workflow run",
        description: "Cancel queued workflow children and mark the workflow cancelled.",
        operationId: "workflowRun.cancel",
        responses: {
          200: {
            description: "Cancelled workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowScheduler.cancel(runID(c))),
    )
    .post(
      "/:runID/retry",
      describeRoute({
        summary: "Retry workflow run",
        description: "Retry failed or cancelled workflow queue children.",
        operationId: "workflowRun.retry",
        responses: {
          200: {
            description: "Retried workflow run detail.",
            content: { "application/json": { schema: resolver(WorkflowRunDetail) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowScheduler.retry(runID(c))),
    ),
)

export const WorkflowTemplateRoutes = lazy(() =>
  new Hono()
    .use(async (_c, next) => {
      assertWorkflowRoutesEnabled()
      await next()
    })
    .get(
      "/",
      describeRoute({
        summary: "List workflow templates",
        description: "Return built-in workflow templates available for the current runtime.",
        operationId: "workflowTemplate.list",
        responses: {
          200: {
            description: "Workflow templates.",
            content: { "application/json": { schema: resolver(WorkflowTemplate.Info.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => c.json(WorkflowTemplate.list()),
    )
    .get(
      "/:templateID",
      describeRoute({
        summary: "Get workflow template",
        description: "Return one workflow template by id.",
        operationId: "workflowTemplate.get",
        responses: {
          200: {
            description: "Workflow template.",
            content: { "application/json": { schema: resolver(WorkflowTemplate.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_TEMPLATE_ID_PARAM),
      async (c) => c.json(WorkflowTemplate.get(templateID(c))),
    ),
)
