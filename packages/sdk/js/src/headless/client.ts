/**
 * Headless HTTP client for AX Code — an app-oriented wrapper over the
 * generated v2 API client exposing typed session, event, permission,
 * question, workflow, and task-queue operations plus typed event
 * subscription.
 *
 * Start from `createHeadlessClient` with the URL and headers of a running
 * backend (see `@defai-digital/ax-code-sdk/headless` for lifecycle helpers).
 *
 * @module
 */

import { createAxCodeClient } from "../v2/client.js"
import type {
  Event,
  GlobalHealthResponse,
  GlobalCapabilitiesResponse,
  SessionSteeringResponse,
  SessionSteerData,
  SessionSteerResponse,
  TaskQueueSteerResponse,
  WorkflowRoutineCreateData,
  WorkflowRoutineCreateResponse,
  WorkflowRoutineListResponse,
  WorkflowRoutineRunData,
  WorkflowRoutineRunResponse,
  WorkflowTemplatePromoteResponse,
  WorkflowTemplateSaveData,
  WorkflowTemplateSaveResponse,
  WorkflowRunArtifactsData,
  WorkflowRunArtifactsResponse,
  WorkflowRunCreateData,
  WorkflowRunCreateResponse,
  WorkflowRunDashboardData,
  WorkflowRunDashboardResponse,
  WorkflowRunEvalSummaryData,
  WorkflowRunEvalSummaryResponse,
  WorkflowRunGetResponse,
  WorkflowRunListData,
  WorkflowRunListResponse,
  WorkflowRunPauseResponse,
  WorkflowRunResumeResponse,
  WorkflowRunCancelResponse,
  WorkflowRunRetryData,
  WorkflowRunRetryResponse,
  WorkflowRunSaveTemplateData,
  WorkflowRunSaveTemplateResponse,
  WorkflowRunStartResponse,
  WorkflowTemplateGetResponse,
  WorkflowTemplateListResponse,
} from "../v2/index.js"
import type {
  HeadlessCommandBody,
  HeadlessPermissionReplyBody,
  HeadlessPromptBody,
  HeadlessQuestionReplyBody,
  HeadlessShellBody,
} from "./command.js"
import { createHttpSseTransport } from "./http-transport.js"
import { runHeadlessRequest, type HeadlessRequestOptions } from "./request.js"
import { checkHeadlessRuntimeCompatibility, type HeadlessCompatibilityRequirements } from "./compatibility.js"
import type { HeadlessTransport } from "./transport.js"
import { errorMessage, parseHeadlessRuntimeJsonBody, parseHeadlessRuntimeResponseBody } from "./util.js"

/** Options for `createHeadlessClient`: base URL or custom transport, directory, and headers. */
export type HeadlessClientOptions = {
  /**
   * Base URL of the headless runtime HTTP server. Required when no custom
   * `transport` is provided; ignored when `transport` is supplied.
   */
  baseUrl?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  experimental_workspaceID?: string
  /**
   * Optional transport implementation. When omitted, an HTTP/SSE transport
   * is created from the other options. This is the integration point for
   * the local IPC transport used by Desktop.
   */
  transport?: HeadlessTransport
  /** Defaults for headless requests and commands; subscriptions and the raw generated client have separate controls. */
  requestOptions?: HeadlessRequestOptions
}

/** Options for `client.subscribe()` (currently an abort signal). */
export type HeadlessSubscribeOptions = {
  signal?: AbortSignal
}

/** Input for `client.createSession()` (optional title). */
export type HeadlessCreateSessionInput = {
  title?: string
}

/** Typed headless client: sessions, prompts, permissions, questions, workflows, and event subscribe. */
export type HeadlessClient = ReturnType<typeof createHeadlessClient>

const SESSION_SHARE_UNSUPPORTED_MESSAGE =
  "Session sharing is not supported by this headless backend; the HTTP /session/{sessionID}/share route has been removed."

/** Payload of `GET /global/health` after the backend has become ready. */
export type HeadlessGlobalHealth = GlobalHealthResponse

/** Capability catalog advertised by a headless backend for app feature detection. */
export type HeadlessRuntimeCapabilities = GlobalCapabilitiesResponse

/** Active generation and process-local steering receipts. */
export type HeadlessSteeringState = SessionSteeringResponse

/** Correction bound to the generation observed by the caller and a stable client id. */
export type HeadlessSteerInput = NonNullable<SessionSteerData["body"]>

/** Receipt of admission; applied does not guarantee provider completion. */
export type HeadlessSteerReceipt = SessionSteerResponse

/** Atomic task-queue steering outcome, including generation_not_active and the latest queue item. */
export type HeadlessTaskQueueSteerResult = TaskQueueSteerResponse

/** Kind of a task-queue item (prompt, command, shell, followup, subagent, review, automation). */
export type HeadlessTaskQueueKind = "prompt" | "command" | "shell" | "followup" | "subagent" | "review" | "automation"

/** Lifecycle status of a task-queue item. */
export type HeadlessTaskQueueStatus =
  | "queued"
  | "waiting_for_idle"
  | "running"
  | "blocked_permission"
  | "blocked_question"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled"

/** One item in the headless task queue. */
export type HeadlessTaskQueueItem = {
  id: string
  projectID: string
  directory: string
  worktree?: string
  sessionID?: string
  kind: HeadlessTaskQueueKind
  status: HeadlessTaskQueueStatus
  priority: number
  position: number
  title: string
  agent?: string
  model?: unknown
  sourceMessageID?: string
  sourceTaskID?: string
  payload: Record<string, unknown>
  error?: string
  time: {
    created: number
    updated?: number
    started?: number
    completed?: number
  }
}

/** Input for enqueueing a task-queue item. */
export type HeadlessTaskQueueEnqueueInput = {
  sessionID?: string
  kind: HeadlessTaskQueueKind
  title: string
  worktree?: string
  agent?: string
  model?: unknown
  sourceMessageID?: string
  sourceTaskID?: string
  payload?: Record<string, unknown>
  priority?: number
}

/** Input for editing a queued item. */
export type HeadlessTaskQueueEditInput = {
  title?: string
  worktree?: string | null
  agent?: string | null
  model?: unknown
  payload?: Record<string, unknown>
  priority?: number
}

/** Query for listing task-queue items. */
export type HeadlessTaskQueueListInput = {
  sessionID?: string
  status?: HeadlessTaskQueueStatus
  limit?: number
}

/** Lifecycle status of a scheduled task (`active`, `paused`, `disabled`). */
export type HeadlessScheduledTaskStatus = "active" | "paused" | "disabled"

/** Schedule expression for a scheduled task (once, daily, weekly, or cron). */
export type HeadlessScheduledTaskSchedule =
  | { type: "once"; runAt: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; day: number; time: string; timezone?: string }
  | { type: "cron"; expression: string; timezone?: string }

/** Persisted scheduled task as returned by the headless API. */
export type HeadlessScheduledTask = {
  id: string
  projectID: string
  directory: string
  title: string
  prompt: string
  schedule: HeadlessScheduledTaskSchedule
  status: HeadlessScheduledTaskStatus
  agent?: string
  model?: unknown
  workflowTemplateID?: string
  workflowStartOptions?: Record<string, unknown>
  lastQueueID?: string
  lastWorkflowRunID?: string
  error?: string
  nextRunAt?: number
  lastRunAt?: number
  time: {
    created: number
    updated?: number
  }
}

/** Input for creating a scheduled task. */
export type HeadlessScheduledTaskCreateInput = {
  title: string
  prompt: string
  schedule: HeadlessScheduledTaskSchedule
  agent?: string
  model?: unknown
  workflowTemplateID?: string
  workflowStartOptions?: Record<string, unknown>
}

/** Input for updating a scheduled task, including status. */
export type HeadlessScheduledTaskUpdateInput = Partial<HeadlessScheduledTaskCreateInput> & {
  status?: HeadlessScheduledTaskStatus
}

/** Query for listing scheduled tasks. */
export type HeadlessScheduledTaskListInput = {
  status?: HeadlessScheduledTaskStatus
  dueBefore?: number
  limit?: number
}

/** Result of triggering a scheduled task immediately. */
export type HeadlessScheduledTaskRunNowResult = {
  task: HeadlessScheduledTask
  queueItem?: HeadlessTaskQueueItem
  workflowRun?: WorkflowRunGetResponse
}

/** Query for listing workflow runs (directory is supplied by the client). */
export type HeadlessWorkflowRunListInput = Omit<NonNullable<WorkflowRunListData["query"]>, "directory">
/** Query for the workflow-run dashboard summary. */
export type HeadlessWorkflowRunDashboardInput = Omit<NonNullable<WorkflowRunDashboardData["query"]>, "directory">
/** Body for creating a workflow run. */
export type HeadlessWorkflowRunCreateInput = NonNullable<WorkflowRunCreateData["body"]>
/** Body for requesting a workflow-run eval summary. */
export type HeadlessWorkflowRunEvalSummaryInput = NonNullable<WorkflowRunEvalSummaryData["body"]>
/** Body for saving a workflow run as a template. */
export type HeadlessWorkflowRunSaveTemplateInput = NonNullable<WorkflowRunSaveTemplateData["body"]>
/** Query for listing artifacts of a workflow run. */
export type HeadlessWorkflowArtifactListInput = Omit<NonNullable<WorkflowRunArtifactsData["query"]>, "directory"> & {
  artifactID?: string
}
/** Query for retrying a workflow run. */
export type HeadlessWorkflowRunRetryInput = Omit<NonNullable<WorkflowRunRetryData["query"]>, "directory">
/** Body for saving a workflow template. */
export type HeadlessWorkflowTemplateSaveInput = NonNullable<WorkflowTemplateSaveData["body"]>
/** Body for creating a workflow routine. */
export type HeadlessWorkflowRoutineCreateInput = NonNullable<WorkflowRoutineCreateData["body"]>
/** Body for running a workflow routine. */
export type HeadlessWorkflowRoutineRunInput = NonNullable<WorkflowRoutineRunData["body"]>
/** Finding status used by workflow eval cases. */
export type HeadlessWorkflowEvalCaseFindingStatus = "confirmed" | "likely" | "rejected" | "unverified"
/** One workflow evaluation case, including seeds and baseline. */
export type HeadlessWorkflowEvalCase = {
  id: string
  name: string
  description: string
  fixtureID: string
  templateID: string
  baseline: unknown
  seeds: Array<{
    id: string
    file: string
    line: number
    expectedStatus: HeadlessWorkflowEvalCaseFindingStatus
    severity: "critical" | "high" | "medium" | "low" | "info"
    summary: string
    rationale?: string
  }>
}
/** Input for running workflow eval cases. */
export type HeadlessWorkflowEvalCaseRunInput = {
  caseID?: string
  now?: number
}
/** Summary of a workflow eval-case run, including promote/hold/rollback. */
export type HeadlessWorkflowEvalCaseRunSummary = {
  caseID: string
  templateID: string
  fixtureID: string
  decision: "promote" | "hold" | "rollback"
  reasons: string[]
  missingSeedIDs: string[]
  mismatchedSeedIDs: string[]
  summary: WorkflowRunEvalSummaryResponse
  metrics: Record<string, unknown>
}
/** Options for starting an existing workflow run. */
export type HeadlessWorkflowRunStartInput = {
  allowScaleBeyondDefaults?: boolean
  allowWriteWorkflows?: boolean
  durableChildren?: boolean
  enqueueChildren?: boolean
}

/** Aggregated session evidence (risk, DRE, semantic, rollback, optional branch rank). */
export type HeadlessSessionEvidence = {
  sessionID: string
  risk?: unknown
  dre?: unknown
  semantic?: unknown
  rollback: unknown[]
  branchRank?: unknown
  errors: Array<{
    source: "risk" | "dre" | "semantic" | "rollback" | "branch_rank"
    message: string
  }>
}

/** Options for loading session evidence (branch-rank inclusion). */
export type HeadlessSessionEvidenceInput = {
  includeBranchRank?: boolean
  deepBranchRank?: boolean
}

/** Create a typed headless client against a running AX Code backend (URL + headers, or a custom transport). */
export function createHeadlessClient(input: HeadlessClientOptions) {
  if (!input.transport && !input.baseUrl) {
    throw new Error("HeadlessClientOptions requires either baseUrl or transport")
  }
  const baseTransport = input.transport ?? createHttpSseTransport(input as { baseUrl: string } & typeof input)
  const transport: HeadlessTransport = {
    requestJson(request) {
      const options = { ...input.requestOptions, ...request }
      return runHeadlessRequest(options, (signal) => baseTransport.requestJson({ ...request, signal, timeoutMs: 0 }))
    },
    sendCommand(command, options) {
      return runHeadlessRequest({ ...input.requestOptions, ...options }, (signal) =>
        baseTransport.sendCommand(command, { signal, timeoutMs: 0 }),
      )
    },
    subscribe(options) {
      return baseTransport.subscribe(options)
    },
  }
  const client = createAxCodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    // Pass user-provided fetch only; when undefined, createAxCodeClient applies
    // its noTimeoutFetch wrapper so SSE subscriptions are not killed by Bun's
    // default connection timeout.
    ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
    headers: input.headers,
    experimental_workspaceID: input.experimental_workspaceID,
  })
  const send = transport.sendCommand

  return {
    client,
    health(options?: HeadlessRequestOptions) {
      return transport.requestJson<HeadlessGlobalHealth>({
        ...options,
        path: "/global/health",
        method: "GET",
      })
    },
    capabilities(options?: HeadlessRequestOptions) {
      return transport.requestJson<HeadlessRuntimeCapabilities>({
        ...options,
        path: "/global/capabilities",
        method: "GET",
      })
    },
    async checkCompatibility(requirements?: HeadlessCompatibilityRequirements, options?: HeadlessRequestOptions) {
      const capabilities = await transport.requestJson<unknown>({
        ...options,
        path: "/global/capabilities",
        method: "GET",
      })
      return checkHeadlessRuntimeCompatibility(capabilities, requirements)
    },
    async createSession(session?: HeadlessCreateSessionInput, options?: HeadlessRequestOptions) {
      const result = await transport.requestJson<{ id?: string }>({
        ...options,
        path: "/session",
        method: "POST",
        body: session ?? {},
      })
      if (!result.id) throw new Error("Failed to create headless session: response did not include id")
      return { id: result.id }
    },
    send,
    sendPrompt(
      sessionID: string,
      body: HeadlessPromptBody,
      options?: { mode?: "sync" | "async" } & HeadlessRequestOptions,
    ) {
      return send({ type: "session.prompt", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    sendCommand(
      sessionID: string,
      body: HeadlessCommandBody,
      options?: { mode?: "sync" | "async" } & HeadlessRequestOptions,
    ) {
      return send({ type: "session.command", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    sendShell(
      sessionID: string,
      body: HeadlessShellBody,
      options?: { mode?: "sync" | "async" } & HeadlessRequestOptions,
    ) {
      return send({ type: "session.shell", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    abort(sessionID: string, options?: HeadlessRequestOptions) {
      return send({ type: "session.abort", sessionID }, options)
    },
    shareSession(sessionID: string) {
      void sessionID
      return Promise.reject(new Error(SESSION_SHARE_UNSUPPORTED_MESSAGE))
    },
    unshareSession(sessionID: string) {
      void sessionID
      return Promise.reject(new Error(SESSION_SHARE_UNSUPPORTED_MESSAGE))
    },
    replyPermission(body: HeadlessPermissionReplyBody, options?: HeadlessRequestOptions) {
      return send({ type: "permission.reply", body }, options)
    },
    replyQuestion(body: HeadlessQuestionReplyBody, options?: HeadlessRequestOptions) {
      return send({ type: "question.reply", body }, options)
    },
    /** Read the active generation before submitting a correction. */
    steering(sessionID: string, options?: HeadlessRequestOptions) {
      return transport.requestJson<HeadlessSteeringState>({
        ...options,
        method: "GET",
        path: `/session/${encodeURIComponent(sessionID)}/steering`,
      })
    },
    /** Admit a correction at the next loop boundary. Never retries or refreshes expectedGeneration. */
    steer(sessionID: string, body: HeadlessSteerInput, options?: HeadlessRequestOptions) {
      return transport.requestJson<HeadlessSteerReceipt>({
        ...options,
        method: "POST",
        path: `/session/${encodeURIComponent(sessionID)}/steering`,
        body,
      })
    },
    sessionEvidence: {
      load(sessionID: string, parameters?: HeadlessSessionEvidenceInput) {
        return loadSessionEvidence(transport.requestJson, sessionID, parameters)
      },
    },
    workflowTemplate: {
      list() {
        return transport.requestJson<WorkflowTemplateListResponse>({
          path: "/workflow-templates",
          method: "GET",
        })
      },
      get(templateID: string) {
        return transport.requestJson<WorkflowTemplateGetResponse>({
          path: `/workflow-templates/${encodeURIComponent(templateID)}`,
          method: "GET",
        })
      },
      save(body: HeadlessWorkflowTemplateSaveInput) {
        return transport.requestJson<WorkflowTemplateSaveResponse>({
          path: "/workflow-templates",
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      promote(templateID: string) {
        return transport.requestJson<WorkflowTemplatePromoteResponse>({
          path: `/workflow-templates/${encodeURIComponent(templateID)}/promote`,
          method: "POST",
        })
      },
    },
    workflowRun: {
      list(parameters?: HeadlessWorkflowRunListInput) {
        return transport.requestJson<WorkflowRunListResponse>({
          path: "/workflow-runs",
          method: "GET",
          query: parameters,
        })
      },
      dashboard(parameters?: HeadlessWorkflowRunDashboardInput) {
        return transport.requestJson<WorkflowRunDashboardResponse>({
          path: "/workflow-runs/dashboard",
          method: "GET",
          query: parameters,
        })
      },
      evalCases() {
        return transport.requestJson<HeadlessWorkflowEvalCase[]>({
          path: "/workflow-runs/eval-cases",
          method: "GET",
        })
      },
      create(body: HeadlessWorkflowRunCreateInput) {
        return transport.requestJson<WorkflowRunCreateResponse>({
          path: "/workflow-runs",
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      get(runID: string) {
        return workflowRunCommand<WorkflowRunGetResponse>(transport.requestJson, runID, "GET")
      },
      artifacts(runID: string, parameters?: HeadlessWorkflowArtifactListInput) {
        return transport.requestJson<WorkflowRunArtifactsResponse>({
          path: `/workflow-runs/${encodeURIComponent(runID)}/artifacts`,
          method: "GET",
          query: parameters,
        })
      },
      evalSummary(runID: string, body: HeadlessWorkflowRunEvalSummaryInput = {}) {
        return transport.requestJson<WorkflowRunEvalSummaryResponse>({
          path: `/workflow-runs/${encodeURIComponent(runID)}/eval-summary`,
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      evalCase(runID: string, body: HeadlessWorkflowEvalCaseRunInput = {}) {
        return transport.requestJson<HeadlessWorkflowEvalCaseRunSummary>({
          path: `/workflow-runs/${encodeURIComponent(runID)}/eval-case`,
          method: "POST",
          body,
        })
      },
      saveTemplate(runID: string, body: HeadlessWorkflowRunSaveTemplateInput) {
        return transport.requestJson<WorkflowRunSaveTemplateResponse>({
          path: `/workflow-runs/${encodeURIComponent(runID)}/save-template`,
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      start(runID: string, body: HeadlessWorkflowRunStartInput = {}) {
        return workflowRunCommand<WorkflowRunStartResponse>(transport.requestJson, runID, "POST", "start", body)
      },
      pause(runID: string) {
        return workflowRunCommand<WorkflowRunPauseResponse>(transport.requestJson, runID, "POST", "pause")
      },
      resume(runID: string) {
        return workflowRunCommand<WorkflowRunResumeResponse>(transport.requestJson, runID, "POST", "resume")
      },
      cancel(runID: string) {
        return workflowRunCommand<WorkflowRunCancelResponse>(transport.requestJson, runID, "POST", "cancel")
      },
      retry(runID: string, parameters?: HeadlessWorkflowRunRetryInput) {
        return transport.requestJson<WorkflowRunRetryResponse>({
          path: `/workflow-runs/${encodeURIComponent(runID)}/retry`,
          method: "POST",
          query: parameters,
        })
      },
    },
    workflowRoutine: {
      create(body: HeadlessWorkflowRoutineCreateInput) {
        return transport.requestJson<WorkflowRoutineCreateResponse>({
          path: "/workflow-routines",
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      list() {
        return transport.requestJson<WorkflowRoutineListResponse>({
          path: "/workflow-routines",
          method: "GET",
        })
      },
      run(body: HeadlessWorkflowRoutineRunInput) {
        return transport.requestJson<WorkflowRoutineRunResponse>({
          path: "/workflow-routines/run",
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
    },
    taskQueue: {
      list(parameters?: HeadlessTaskQueueListInput) {
        return transport.requestJson<HeadlessTaskQueueItem[]>({
          path: "/task-queue",
          method: "GET",
          query: parameters,
        })
      },
      enqueue(body: HeadlessTaskQueueEnqueueInput) {
        return transport.requestJson<HeadlessTaskQueueItem>({
          path: "/task-queue",
          method: "POST",
          body,
        })
      },
      edit(id: string, body: HeadlessTaskQueueEditInput) {
        return transport.requestJson<HeadlessTaskQueueItem>({
          path: `/task-queue/${encodeURIComponent(id)}/edit`,
          method: "POST",
          body,
        })
      },
      pause(id: string) {
        return taskQueueCommand(transport.requestJson, id, "pause")
      },
      resume(id: string) {
        return taskQueueCommand(transport.requestJson, id, "resume")
      },
      cancel(id: string) {
        return taskQueueCommand(transport.requestJson, id, "cancel")
      },
      retry(id: string) {
        return taskQueueCommand(transport.requestJson, id, "retry")
      },
      sendNow(id: string) {
        return taskQueueCommand(transport.requestJson, id, "send-now")
      },
      /** Steer a queued text follow-up atomically; callers reconcile rejected or uncertain outcomes. */
      steer(id: string, options?: HeadlessRequestOptions) {
        return transport.requestJson<HeadlessTaskQueueSteerResult>({
          ...options,
          method: "POST",
          path: `/task-queue/${encodeURIComponent(id)}/steer`,
        })
      },
      reorder(id: string, position: number) {
        return transport.requestJson<HeadlessTaskQueueItem>({
          path: `/task-queue/${encodeURIComponent(id)}/reorder`,
          method: "POST",
          body: { position },
        })
      },
      remove(id: string) {
        return transport.requestJson<boolean>({
          path: `/task-queue/${encodeURIComponent(id)}`,
          method: "DELETE",
        })
      },
    },
    scheduledTask: {
      list(parameters?: HeadlessScheduledTaskListInput) {
        return transport.requestJson<HeadlessScheduledTask[]>({
          path: "/scheduled-task",
          method: "GET",
          query: parameters,
        })
      },
      create(body: HeadlessScheduledTaskCreateInput) {
        return transport.requestJson<HeadlessScheduledTask>({
          path: "/scheduled-task",
          method: "POST",
          body,
        })
      },
      update(id: string, body: HeadlessScheduledTaskUpdateInput) {
        return transport.requestJson<HeadlessScheduledTask>({
          path: `/scheduled-task/${encodeURIComponent(id)}/update`,
          method: "POST",
          body,
        })
      },
      pause(id: string) {
        return scheduledTaskCommand(transport.requestJson, id, "pause")
      },
      resume(id: string) {
        return scheduledTaskCommand(transport.requestJson, id, "resume")
      },
      runNow(id: string) {
        return transport.requestJson<HeadlessScheduledTaskRunNowResult>({
          path: `/scheduled-task/${encodeURIComponent(id)}/run-now`,
          method: "POST",
        })
      },
      remove(id: string) {
        return transport.requestJson<boolean>({
          path: `/scheduled-task/${encodeURIComponent(id)}`,
          method: "DELETE",
        })
      },
    },
    async *subscribe(options: HeadlessSubscribeOptions = {}): AsyncGenerator<Event> {
      yield* transport.subscribe(options)
    },
  }
}

function taskQueueCommand(
  requestJson: <TResult>(request: import("./transport.js").HeadlessTransportRequest) => Promise<TResult>,
  id: string,
  command: "pause" | "resume" | "cancel" | "retry" | "send-now",
) {
  return requestJson<HeadlessTaskQueueItem>({
    path: `/task-queue/${encodeURIComponent(id)}/${command}`,
    method: "POST",
  })
}

function workflowRunCommand<TResult>(
  requestJson: <TResult>(request: import("./transport.js").HeadlessTransportRequest) => Promise<TResult>,
  runID: string,
  method: "GET" | "POST",
  command?: "start" | "pause" | "resume" | "cancel" | "retry",
  body?: HeadlessWorkflowRunStartInput,
) {
  return requestJson<TResult>({
    path: `/workflow-runs/${encodeURIComponent(runID)}${command ? `/${command}` : ""}`,
    method,
    body: body as Record<string, unknown> | undefined,
  })
}

function scheduledTaskCommand(
  requestJson: <TResult>(request: import("./transport.js").HeadlessTransportRequest) => Promise<TResult>,
  id: string,
  command: "pause" | "resume",
) {
  return requestJson<HeadlessScheduledTask>({
    path: `/scheduled-task/${encodeURIComponent(id)}/${command}`,
    method: "POST",
  })
}

async function loadSessionEvidence(
  requestJson: <TResult>(request: import("./transport.js").HeadlessTransportRequest) => Promise<TResult>,
  sessionID: string,
  parameters: HeadlessSessionEvidenceInput = {},
): Promise<HeadlessSessionEvidence> {
  const encodedSessionID = encodeURIComponent(sessionID)
  const requests = {
    risk: requestJson<unknown>({
      path: `/session/${encodedSessionID}/risk`,
      method: "GET",
      query: {
        quality: true,
        findings: true,
        envelopes: true,
        reviewResults: true,
        debug: true,
        hints: true,
      },
    }),
    dre: requestJson<unknown>({
      path: `/session/${encodedSessionID}/dre`,
      method: "GET",
    }),
    semantic: requestJson<unknown>({
      path: `/session/${encodedSessionID}/diff/semantic`,
      method: "GET",
    }),
    rollback: requestJson<unknown[]>({
      path: `/session/${encodedSessionID}/rollback`,
      method: "GET",
    }),
    branch_rank: parameters.includeBranchRank
      ? requestJson<unknown>({
          path: `/session/${encodedSessionID}/branch/rank`,
          method: "GET",
          query: { deep: parameters.deepBranchRank },
        })
      : Promise.resolve(undefined),
  } satisfies Record<HeadlessSessionEvidence["errors"][number]["source"], Promise<unknown>>
  const entries = await Promise.all(
    Object.entries(requests).map(async ([source, request]) => {
      const result = await Promise.resolve(request).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error) => ({ status: "rejected" as const, reason: error }),
      )
      return [source, result] as const
    }),
  )
  const evidence: HeadlessSessionEvidence = {
    sessionID,
    rollback: [],
    errors: [],
  }

  for (const [source, result] of entries) {
    const typedSource = source as HeadlessSessionEvidence["errors"][number]["source"]
    if (result.status === "rejected") {
      evidence.errors.push({ source: typedSource, message: errorMessage(result.reason) })
      continue
    }
    switch (typedSource) {
      case "risk":
        evidence.risk = result.value
        break
      case "dre":
        evidence.dre = result.value
        break
      case "semantic":
        evidence.semantic = result.value
        break
      case "rollback":
        evidence.rollback = Array.isArray(result.value) ? result.value : []
        break
      case "branch_rank":
        evidence.branchRank = result.value
        break
    }
  }

  return evidence
}

export { parseHeadlessRuntimeResponseBody, parseHeadlessRuntimeJsonBody }
