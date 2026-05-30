import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { WorkflowRun } from "@/workflow/run"
import { WorkflowScheduler } from "@/workflow/scheduler"
import { WorkflowSpecV1, isWorkflowRuntimeEnabled } from "@/workflow/spec"
import { WorkflowTemplate } from "@/workflow/template"
import {
  WorkflowArtifactEventRecord,
  WorkflowBudgetLedgerEventEntry,
  WorkflowChildEventRecord,
  WorkflowPhaseEventRecord,
  WorkflowRun as WorkflowRunState,
  WorkflowRunEventRecord,
  type WorkflowRunID,
} from "@/workflow/state"
import type { SessionID } from "@/session/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const WorkflowTemplateIDSchema = z.string().min(1).max(120).regex(/^(builtin|user|project):[a-z][a-z0-9-]*$/)
const WORKFLOW_RUN_ID_PARAM = z.object({ runID: z.string().min(1) })
const WORKFLOW_TEMPLATE_ID_PARAM = z.object({ templateID: WorkflowTemplateIDSchema })

const WorkflowRunListQuery = z.object({
  parentSessionID: z.string().min(1).optional(),
  status: WorkflowRunState.Status.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const WorkflowRunCreateBody = z
  .object({
    parentSessionID: z.string().min(1).optional(),
    sourceTemplateID: z.string().trim().min(1).optional(),
    templateID: WorkflowTemplateIDSchema.optional(),
    spec: WorkflowSpecV1.optional(),
  })
  .refine((input) => (input.templateID ? 1 : 0) + (input.spec ? 1 : 0) === 1, {
    message: "Exactly one of templateID or spec is required",
  })

const WorkflowArtifactListQuery = z.object({
  phaseID: z.string().min(1).optional(),
  childID: z.string().min(1).optional(),
  kind: WorkflowRunState.ArtifactKind.optional(),
  includePayload: z.enum(["true", "false"]).optional(),
})

const WorkflowTemplateSaveBody = z.object({
  scope: z.enum(["user", "project"]),
  trust: WorkflowTemplate.Trust.optional(),
  spec: WorkflowSpecV1,
})

const WorkflowRunResponse = WorkflowRunEventRecord
const WorkflowRunDetailResponse = WorkflowRunEventRecord.extend({
  phases: z.array(WorkflowPhaseEventRecord),
  children: z.array(WorkflowChildEventRecord),
  artifacts: z.array(WorkflowArtifactEventRecord),
  budgetLedger: z.array(WorkflowBudgetLedgerEventEntry),
})

const WorkflowTemplateResponse = z.object({
  id: z.string(),
  source: z.enum(["builtin", "user", "project"]),
  trust: WorkflowTemplate.Trust,
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  spec: WorkflowSpecV1,
  path: z.string().optional(),
  time: z
    .object({
      created: z.number(),
      updated: z.number(),
    })
    .optional(),
})

function runID(c: { req: { valid: (input: "param") => { runID: string } } }) {
  return c.req.valid("param").runID as WorkflowRunID
}

function templateID(c: { req: { valid: (input: "param") => { templateID: string } } }) {
  return c.req.valid("param").templateID as WorkflowTemplate.ID
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
            content: { "application/json": { schema: resolver(WorkflowRunResponse.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", WorkflowRunListQuery),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          await WorkflowRun.list({
            ...query,
            parentSessionID: query.parentSessionID as SessionID | undefined,
          }),
        )
      },
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
            content: { "application/json": { schema: resolver(WorkflowRunResponse) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", WorkflowRunCreateBody),
      async (c) => {
        const body = c.req.valid("json")
        if (body.templateID) {
          return c.json(
            await WorkflowTemplate.createRun({
              templateID: body.templateID as WorkflowTemplate.ID,
              parentSessionID: body.parentSessionID as SessionID | undefined,
            }),
          )
        }
        return c.json(
          await WorkflowRun.create({
            parentSessionID: body.parentSessionID as SessionID | undefined,
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      async (c) => c.json(await WorkflowRun.getDetail(runID(c))),
    )
    .get(
      "/:runID/artifacts",
      describeRoute({
        summary: "List workflow run artifacts",
        description: "Return workflow artifacts for a run, with optional phase, child, kind, and compact filters.",
        operationId: "workflowRun.artifacts",
        responses: {
          200: {
            description: "Workflow run artifacts.",
            content: { "application/json": { schema: resolver(WorkflowArtifactEventRecord.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      validator("query", WorkflowArtifactListQuery),
      async (c) => {
        const query = c.req.valid("query")
        const detail = await WorkflowRun.getDetail(runID(c))
        const artifacts = detail.artifacts
          .filter((artifact) => (query.phaseID ? artifact.phaseID === query.phaseID : true))
          .filter((artifact) => (query.childID ? artifact.childID === query.childID : true))
          .filter((artifact) => (query.kind ? artifact.kind === query.kind : true))
          .map((artifact) => {
            if (query.includePayload !== "false") return artifact
            const { payload: _payload, ...compact } = artifact
            return compact
          })
        return c.json(artifacts)
      },
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
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
            content: { "application/json": { schema: resolver(WorkflowRunDetailResponse) } },
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
            content: { "application/json": { schema: resolver(WorkflowTemplateResponse.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => c.json(await WorkflowTemplate.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Save workflow template",
        description: "Save a user-local or project-local workflow template candidate or trusted template.",
        operationId: "workflowTemplate.save",
        responses: {
          200: {
            description: "Saved workflow template.",
            content: { "application/json": { schema: resolver(WorkflowTemplateResponse) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", WorkflowTemplateSaveBody),
      async (c) => c.json(await WorkflowTemplate.save(c.req.valid("json"))),
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
            content: { "application/json": { schema: resolver(WorkflowTemplateResponse) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_TEMPLATE_ID_PARAM),
      async (c) => c.json(await WorkflowTemplate.get(templateID(c))),
    )
    .post(
      "/:templateID/promote",
      describeRoute({
        summary: "Promote workflow template",
        description: "Promote a saved user-local or project-local workflow template candidate to trusted.",
        operationId: "workflowTemplate.promote",
        responses: {
          200: {
            description: "Promoted workflow template.",
            content: { "application/json": { schema: resolver(WorkflowTemplateResponse) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WORKFLOW_TEMPLATE_ID_PARAM),
      async (c) => c.json(await WorkflowTemplate.promote(templateID(c))),
    ),
)
