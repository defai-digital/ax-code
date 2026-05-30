import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { compactWorkflowArtifact } from "@/workflow/artifact"
import { WorkflowEvalBaseline, WorkflowEvalSummary, evaluateWorkflowRun } from "@/workflow/eval"
import {
  WorkflowEvalCase,
  WorkflowEvalCaseID,
  WorkflowEvalCaseRunSummary,
  evaluateWorkflowEvalCaseRun,
  listWorkflowEvalCases,
} from "@/workflow/eval-corpus"
import { WorkflowRunProjection, summarizeWorkflowRunDetail } from "@/workflow/projection"
import { WorkflowRoutineDisabledError, WorkflowRoutineNotFoundError, WorkflowRoutineTrigger } from "@/workflow/routine"
import { WorkflowRun } from "@/workflow/run"
import { WorkflowScheduler } from "@/workflow/scheduler"
import {
  WorkflowInputValues,
  WorkflowModelPolicyOverride,
  WorkflowSpecV1,
  applyWorkflowModelPolicyOverride,
  isWorkflowRuntimeEnabled,
} from "@/workflow/spec"
import { WorkflowTemplate } from "@/workflow/template"
import {
  WorkflowArtifactEventRecord,
  WorkflowBudgetLedgerEventEntry,
  WorkflowChildEventRecord,
  WorkflowPhaseEventRecord,
  WorkflowRun as WorkflowRunState,
  WorkflowRunEventRecord,
  type WorkflowPhaseID,
  type WorkflowRunID,
} from "@/workflow/state"
import type { SessionID } from "@/session/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const WorkflowTemplateIDSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^(builtin|user|project):[a-z][a-z0-9-]*$/)
const WORKFLOW_RUN_ID_PARAM = z.object({ runID: z.string().min(1) })
const WORKFLOW_TEMPLATE_ID_PARAM = z.object({ templateID: WorkflowTemplateIDSchema })

const WorkflowRunListQuery = z.object({
  parentSessionID: z.string().min(1).optional(),
  status: WorkflowRunState.Status.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const WorkflowRunDashboardQuery = WorkflowRunListQuery.extend({
  now: z.coerce.number().int().min(0).optional(),
})

const WorkflowRunCreateBody = z
  .object({
    parentSessionID: z.string().min(1).optional(),
    sourceTemplateID: z.string().trim().min(1).optional(),
    sourceTaskID: z.string().trim().min(1).optional(),
    templateID: WorkflowTemplateIDSchema.optional(),
    spec: WorkflowSpecV1.optional(),
    modelPolicy: WorkflowModelPolicyOverride.optional(),
    inputValues: WorkflowInputValues,
  })
  .refine((input) => (input.templateID ? 1 : 0) + (input.spec ? 1 : 0) === 1, {
    message: "Exactly one of templateID or spec is required",
  })

const WorkflowArtifactListQuery = z.object({
  artifactID: z.string().min(1).optional(),
  phaseID: z.string().min(1).optional(),
  childID: z.string().min(1).optional(),
  kind: WorkflowRunState.ArtifactKind.optional(),
  includePayload: z.enum(["true", "false"]).optional(),
})

const WorkflowEvalSummaryBody = z
  .object({
    baseline: WorkflowEvalBaseline.optional(),
    now: z.number().int().min(0).optional(),
  })
  .optional()

const WorkflowEvalCaseRunBody = z.object({
  caseID: WorkflowEvalCaseID.default("verified-bug-sweep-seeded"),
  now: z.number().int().min(0).optional(),
})

const WorkflowTemplateSaveBody = z.object({
  scope: z.enum(["user", "project"]),
  spec: WorkflowSpecV1,
})

const WorkflowTemplateSaveFromRunBody = z.object({
  scope: z.enum(["user", "project"]),
})

const WorkflowRoutineRunBody = z.object({
  route: z.string().trim().min(1),
  parentSessionID: z.string().min(1).optional(),
  modelPolicy: WorkflowModelPolicyOverride.optional(),
  inputValues: WorkflowInputValues,
  startOptions: WorkflowScheduler.StartOptions.partial().optional(),
})
const WorkflowRoutineCreateBody = WorkflowRoutineTrigger.CreateInput

const WorkflowRetryQuery = z.object({
  phaseID: z.string().min(1).optional(),
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
  specHash: z.string(),
  spec: WorkflowSpecV1,
  path: z.string().optional(),
  time: z
    .object({
      created: z.number(),
      updated: z.number(),
    })
    .optional(),
})

const WorkflowRoutineRunResponse = z.object({
  routine: WorkflowRoutineTrigger.Info,
  template: WorkflowTemplateResponse,
  run: WorkflowRunDetailResponse,
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
              sourceTaskID: body.sourceTaskID,
              modelPolicy: body.modelPolicy,
              inputValues: body.inputValues,
            }),
          )
        }
        return c.json(
          await WorkflowRun.create({
            parentSessionID: body.parentSessionID as SessionID | undefined,
            sourceTemplateID: body.sourceTemplateID,
            sourceTaskID: body.sourceTaskID,
            spec: applyWorkflowModelPolicyOverride(body.spec!, body.modelPolicy),
            inputValues: body.inputValues,
          }),
        )
      },
    )
    .get(
      "/dashboard",
      describeRoute({
        summary: "List workflow dashboard summaries",
        description: "Return compact workflow run projections for TUI and desktop supervision surfaces.",
        operationId: "workflowRun.dashboard",
        responses: {
          200: {
            description: "Compact workflow dashboard summaries.",
            content: { "application/json": { schema: resolver(WorkflowRunProjection.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", WorkflowRunDashboardQuery),
      async (c) => {
        const query = c.req.valid("query")
        const runs = await WorkflowRun.list({
          parentSessionID: query.parentSessionID as SessionID | undefined,
          status: query.status,
          limit: query.limit,
        })
        const summaries = await Promise.all(
          runs.map(async (run) => summarizeWorkflowRunDetail(await WorkflowRun.getDetail(run.id), query.now)),
        )
        return c.json(summaries)
      },
    )
    .get(
      "/eval-cases",
      describeRoute({
        summary: "List workflow evaluation cases",
        description: "Return built-in local workflow evaluation cases used for preview promotion gates.",
        operationId: "workflowRun.eval_cases",
        responses: {
          200: {
            description: "Workflow evaluation cases.",
            content: { "application/json": { schema: resolver(WorkflowEvalCase.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => c.json(listWorkflowEvalCases()),
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
      async (c) => c.json(compactWorkflowRunDetail(await WorkflowRun.getDetail(runID(c)))),
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
          .filter((artifact) => (query.artifactID ? artifact.id === query.artifactID : true))
          .filter((artifact) => (query.phaseID ? artifact.phaseID === query.phaseID : true))
          .filter((artifact) => (query.childID ? artifact.childID === query.childID : true))
          .filter((artifact) => (query.kind ? artifact.kind === query.kind : true))
          .map((artifact) => {
            if (query.includePayload === "true") return artifact
            return compactWorkflowArtifact(artifact)
          })
        return c.json(artifacts)
      },
    )
    .post(
      "/:runID/eval-summary",
      describeRoute({
        summary: "Evaluate workflow run",
        description: "Compare a workflow run against optional baseline metrics and return its preview promotion gate.",
        operationId: "workflowRun.eval_summary",
        responses: {
          200: {
            description: "Workflow evaluation summary.",
            content: { "application/json": { schema: resolver(WorkflowEvalSummary) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      validator("json", WorkflowEvalSummaryBody),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const detail = await WorkflowRun.getDetail(runID(c))
        return c.json(evaluateWorkflowRun({ run: detail, baseline: body.baseline, now: body.now }))
      },
    )
    .post(
      "/:runID/eval-case",
      describeRoute({
        summary: "Evaluate workflow run against a local case",
        description: "Compare a workflow run against a seeded local eval case and single-agent baseline.",
        operationId: "workflowRun.eval_case",
        responses: {
          200: {
            description: "Workflow evaluation case result.",
            content: { "application/json": { schema: resolver(WorkflowEvalCaseRunSummary) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      validator("json", WorkflowEvalCaseRunBody),
      async (c) => {
        const body = c.req.valid("json")
        const detail = await WorkflowRun.getDetail(runID(c))
        return c.json(evaluateWorkflowEvalCaseRun({ run: detail, caseID: body.caseID, now: body.now }))
      },
    )
    .post(
      "/:runID/save-template",
      describeRoute({
        summary: "Save workflow run as template",
        description: "Save a workflow run spec snapshot as a candidate user-local or project-local template.",
        operationId: "workflowRun.save_template",
        responses: {
          200: {
            description: "Saved workflow template candidate.",
            content: { "application/json": { schema: resolver(WorkflowTemplateResponse) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WORKFLOW_RUN_ID_PARAM),
      validator("json", WorkflowTemplateSaveFromRunBody),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await WorkflowTemplate.saveFromRun({ runID: runID(c), scope: body.scope }))
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
      async (c) =>
        c.json(compactWorkflowRunDetail(await WorkflowScheduler.start(runID(c), c.req.valid("json") ?? {}))),
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
      async (c) => c.json(compactWorkflowRunDetail(await WorkflowScheduler.pause(runID(c)))),
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
      async (c) => c.json(compactWorkflowRunDetail(await WorkflowScheduler.resume(runID(c)))),
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
      async (c) => c.json(compactWorkflowRunDetail(await WorkflowScheduler.cancel(runID(c)))),
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
      validator("query", WorkflowRetryQuery),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          compactWorkflowRunDetail(
            query.phaseID
              ? await WorkflowScheduler.retryPhase(runID(c), query.phaseID as WorkflowPhaseID)
              : await WorkflowScheduler.retry(runID(c)),
          ),
        )
      },
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
        description: "Save a user-local or project-local workflow template candidate. Promote after review to trust it.",
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
      async (c) => c.json(await WorkflowTemplate.save({ ...c.req.valid("json"), trust: "candidate" })),
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

export const WorkflowRoutineRoutes = lazy(() =>
  new Hono()
    .use(async (_c, next) => {
      assertWorkflowRoutesEnabled()
      await next()
    })
    .get(
      "/",
      describeRoute({
        summary: "List workflow routines",
        description: "Return workflow templates that declare local routine trigger metadata.",
        operationId: "workflowRoutine.list",
        responses: {
          200: {
            description: "Workflow routines.",
            content: { "application/json": { schema: resolver(WorkflowRoutineTrigger.Info.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => c.json(await WorkflowRoutineTrigger.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create workflow routine",
        description:
          "Create a user-local or project-local routine trigger from an existing workflow template. API routines can be run directly; scheduled routines are listed as reusable trigger metadata.",
        operationId: "workflowRoutine.create",
        responses: {
          200: {
            description: "Created workflow routine.",
            content: { "application/json": { schema: resolver(WorkflowRoutineTrigger.Info) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("json", WorkflowRoutineCreateBody),
      async (c) => c.json(await WorkflowRoutineTrigger.create(c.req.valid("json"))),
    )
    .post(
      "/run",
      describeRoute({
        summary: "Run workflow routine",
        description: "Run a trusted enabled local API workflow routine by route.",
        operationId: "workflowRoutine.run",
        responses: {
          200: {
            description: "Started workflow routine run.",
            content: { "application/json": { schema: resolver(WorkflowRoutineRunResponse) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("json", WorkflowRoutineRunBody),
      async (c) => {
        try {
          const result = await WorkflowRoutineTrigger.run(c.req.valid("json"))
          return c.json({
            ...result,
            run: compactWorkflowRunDetail(result.run),
          })
        } catch (error) {
          if (error instanceof WorkflowRoutineNotFoundError) throw new HTTPException(404, { message: error.message })
          if (error instanceof WorkflowRoutineDisabledError) throw new HTTPException(409, { message: error.message })
          throw error
        }
      },
    ),
)

function compactWorkflowRunDetail(detail: Awaited<ReturnType<typeof WorkflowRun.getDetail>>) {
  return {
    ...detail,
    artifacts: detail.artifacts.map((artifact) => compactWorkflowArtifact(artifact)),
  }
}
