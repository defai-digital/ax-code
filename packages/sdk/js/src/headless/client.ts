import { createAxCodeClient } from "../v2/client.js"
import { AX_CODE_WORKSPACE_HEADER, LEGACY_OPENCODE_WORKSPACE_HEADER } from "../protocol.js"
import type {
  Event,
  WorkflowRunArtifactsData,
  WorkflowRunArtifactsResponse,
  WorkflowRunCreateData,
  WorkflowRunCreateResponse,
  WorkflowRunGetResponse,
  WorkflowRunListData,
  WorkflowRunListResponse,
  WorkflowRunPauseResponse,
  WorkflowRunResumeResponse,
  WorkflowRunCancelResponse,
  WorkflowRunRetryResponse,
  WorkflowRunStartResponse,
  WorkflowTemplateGetResponse,
  WorkflowTemplateListResponse,
} from "../v2/index.js"
import type {
  HeadlessCommandBody,
  HeadlessPermissionReplyBody,
  HeadlessPromptBody,
  HeadlessQuestionReplyBody,
  HeadlessRuntimeCommand,
  HeadlessRuntimeCommandResult,
  HeadlessShellBody,
} from "./command.js"

export type HeadlessClientOptions = {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  experimental_workspaceID?: string
}

export type HeadlessSubscribeOptions = {
  signal?: AbortSignal
}

export type HeadlessCreateSessionInput = {
  title?: string
}

export type HeadlessClient = ReturnType<typeof createHeadlessClient>

export type HeadlessTaskQueueKind = "prompt" | "command" | "shell" | "followup" | "subagent" | "review" | "automation"

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

export type HeadlessTaskQueueEditInput = {
  title?: string
  worktree?: string | null
  agent?: string | null
  model?: unknown
  payload?: Record<string, unknown>
  priority?: number
}

export type HeadlessTaskQueueListInput = {
  sessionID?: string
  status?: HeadlessTaskQueueStatus
  limit?: number
}

export type HeadlessScheduledTaskStatus = "active" | "paused" | "disabled"

export type HeadlessScheduledTaskSchedule =
  | { type: "once"; runAt: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; day: number; time: string; timezone?: string }
  | { type: "cron"; expression: string; timezone?: string }

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
  lastQueueID?: string
  error?: string
  nextRunAt?: number
  lastRunAt?: number
  time: {
    created: number
    updated?: number
  }
}

export type HeadlessScheduledTaskCreateInput = {
  title: string
  prompt: string
  schedule: HeadlessScheduledTaskSchedule
  agent?: string
  model?: unknown
}

export type HeadlessScheduledTaskUpdateInput = Partial<HeadlessScheduledTaskCreateInput> & {
  status?: HeadlessScheduledTaskStatus
}

export type HeadlessScheduledTaskListInput = {
  status?: HeadlessScheduledTaskStatus
  dueBefore?: number
  limit?: number
}

export type HeadlessScheduledTaskRunNowResult = {
  task: HeadlessScheduledTask
  queueItem: HeadlessTaskQueueItem
}

export type HeadlessWorkflowRunListInput = Omit<NonNullable<WorkflowRunListData["query"]>, "directory">
export type HeadlessWorkflowRunCreateInput = NonNullable<WorkflowRunCreateData["body"]>
export type HeadlessWorkflowArtifactListInput = Omit<NonNullable<WorkflowRunArtifactsData["query"]>, "directory">
export type HeadlessWorkflowRunStartInput = {
  allowScaleBeyondDefaults?: boolean
  allowWriteWorkflows?: boolean
  durableChildren?: boolean
  enqueueChildren?: boolean
}

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

export type HeadlessSessionEvidenceInput = {
  includeBranchRank?: boolean
  deepBranchRank?: boolean
}

export function createHeadlessClient(input: HeadlessClientOptions) {
  const fetchFn = input.fetch ?? fetch
  const client = createAxCodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    fetch: fetchFn,
    headers: input.headers,
    experimental_workspaceID: input.experimental_workspaceID,
  })
  const send = (command: HeadlessRuntimeCommand) =>
    sendHeadlessRuntimeCommand({
      command,
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      directory: input.directory,
      experimental_workspaceID: input.experimental_workspaceID,
      client,
    })

  return {
    client,
    async createSession(session?: HeadlessCreateSessionInput) {
      const result = await client.session.create(session ?? {})
      const created = result.data
      if (!created?.id) throw new Error("Failed to create headless session: response did not include id")
      return created
    },
    send,
    sendPrompt(sessionID: string, body: HeadlessPromptBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.prompt", mode: options?.mode ?? "async", sessionID, body })
    },
    sendCommand(sessionID: string, body: HeadlessCommandBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.command", mode: options?.mode ?? "async", sessionID, body })
    },
    sendShell(sessionID: string, body: HeadlessShellBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.shell", mode: options?.mode ?? "async", sessionID, body })
    },
    abort(sessionID: string) {
      return send({ type: "session.abort", sessionID })
    },
    replyPermission(body: HeadlessPermissionReplyBody) {
      return send({ type: "permission.reply", body })
    },
    replyQuestion(body: HeadlessQuestionReplyBody) {
      return send({ type: "question.reply", body })
    },
    sessionEvidence: {
      load(sessionID: string, parameters?: HeadlessSessionEvidenceInput) {
        return loadSessionEvidence(input, fetchFn, sessionID, parameters)
      },
    },
    workflowTemplate: {
      list() {
        return requestJson<WorkflowTemplateListResponse>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/workflow-templates",
          method: "GET",
        })
      },
      get(templateID: string) {
        return requestJson<WorkflowTemplateGetResponse>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/workflow-templates/${encodeURIComponent(templateID)}`,
          method: "GET",
        })
      },
    },
    workflowRun: {
      list(parameters?: HeadlessWorkflowRunListInput) {
        return requestJson<WorkflowRunListResponse>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/workflow-runs",
          method: "GET",
          query: parameters,
        })
      },
      create(body: HeadlessWorkflowRunCreateInput) {
        return requestJson<WorkflowRunCreateResponse>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/workflow-runs",
          method: "POST",
          body: body as Record<string, unknown>,
        })
      },
      get(runID: string) {
        return workflowRunCommand<WorkflowRunGetResponse>(input, fetchFn, runID, "GET")
      },
      artifacts(runID: string, parameters?: HeadlessWorkflowArtifactListInput) {
        return requestJson<WorkflowRunArtifactsResponse>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/workflow-runs/${encodeURIComponent(runID)}/artifacts`,
          method: "GET",
          query: parameters,
        })
      },
      start(runID: string, body: HeadlessWorkflowRunStartInput = {}) {
        return workflowRunCommand<WorkflowRunStartResponse>(input, fetchFn, runID, "POST", "start", body)
      },
      pause(runID: string) {
        return workflowRunCommand<WorkflowRunPauseResponse>(input, fetchFn, runID, "POST", "pause")
      },
      resume(runID: string) {
        return workflowRunCommand<WorkflowRunResumeResponse>(input, fetchFn, runID, "POST", "resume")
      },
      cancel(runID: string) {
        return workflowRunCommand<WorkflowRunCancelResponse>(input, fetchFn, runID, "POST", "cancel")
      },
      retry(runID: string) {
        return workflowRunCommand<WorkflowRunRetryResponse>(input, fetchFn, runID, "POST", "retry")
      },
    },
    taskQueue: {
      list(parameters?: HeadlessTaskQueueListInput) {
        return requestJson<HeadlessTaskQueueItem[]>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/task-queue",
          method: "GET",
          query: parameters,
        })
      },
      enqueue(body: HeadlessTaskQueueEnqueueInput) {
        return requestJson<HeadlessTaskQueueItem>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/task-queue",
          method: "POST",
          body,
        })
      },
      edit(id: string, body: HeadlessTaskQueueEditInput) {
        return requestJson<HeadlessTaskQueueItem>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/task-queue/${encodeURIComponent(id)}/edit`,
          method: "POST",
          body,
        })
      },
      pause(id: string) {
        return taskQueueCommand(input, fetchFn, id, "pause")
      },
      resume(id: string) {
        return taskQueueCommand(input, fetchFn, id, "resume")
      },
      cancel(id: string) {
        return taskQueueCommand(input, fetchFn, id, "cancel")
      },
      retry(id: string) {
        return taskQueueCommand(input, fetchFn, id, "retry")
      },
      sendNow(id: string) {
        return taskQueueCommand(input, fetchFn, id, "send-now")
      },
      reorder(id: string, position: number) {
        return requestJson<HeadlessTaskQueueItem>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/task-queue/${encodeURIComponent(id)}/reorder`,
          method: "POST",
          body: { position },
        })
      },
      remove(id: string) {
        return requestJson<boolean>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/task-queue/${encodeURIComponent(id)}`,
          method: "DELETE",
        })
      },
    },
    scheduledTask: {
      list(parameters?: HeadlessScheduledTaskListInput) {
        return requestJson<HeadlessScheduledTask[]>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/scheduled-task",
          method: "GET",
          query: parameters,
        })
      },
      create(body: HeadlessScheduledTaskCreateInput) {
        return requestJson<HeadlessScheduledTask>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: "/scheduled-task",
          method: "POST",
          body,
        })
      },
      update(id: string, body: HeadlessScheduledTaskUpdateInput) {
        return requestJson<HeadlessScheduledTask>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/scheduled-task/${encodeURIComponent(id)}/update`,
          method: "POST",
          body,
        })
      },
      pause(id: string) {
        return scheduledTaskCommand(input, fetchFn, id, "pause")
      },
      resume(id: string) {
        return scheduledTaskCommand(input, fetchFn, id, "resume")
      },
      runNow(id: string) {
        return requestJson<HeadlessScheduledTaskRunNowResult>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/scheduled-task/${encodeURIComponent(id)}/run-now`,
          method: "POST",
        })
      },
      remove(id: string) {
        return requestJson<boolean>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
          path: `/scheduled-task/${encodeURIComponent(id)}`,
          method: "DELETE",
        })
      },
    },
    async *subscribe(options: HeadlessSubscribeOptions = {}): AsyncGenerator<Event> {
      const subscription = await client.event.subscribe({}, { signal: options.signal })
      for await (const event of subscription.stream) {
        yield event
      }
    },
  }
}

async function sendHeadlessRuntimeCommand(input: {
  command: HeadlessRuntimeCommand
  baseUrl: string
  fetch: typeof fetch
  headers?: RequestInit["headers"]
  directory?: string
  experimental_workspaceID?: string
  client: ReturnType<typeof createAxCodeClient>
}): Promise<HeadlessRuntimeCommandResult> {
  switch (input.command.type) {
    case "session.prompt":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "message" : "prompt_async",
        body: input.command.body,
      })

    case "session.command":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "command" : "command_async",
        body: input.command.body,
      })

    case "session.shell":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "shell" : "shell_async",
        body: input.command.body,
      })

    case "session.abort":
      return postJson(input, `/session/${encodeURIComponent(input.command.sessionID)}/abort`, undefined)

    case "permission.reply":
      return { accepted: true, status: 200, body: await input.client.permission.reply(input.command.body as any) }

    case "question.reply":
      return { accepted: true, status: 200, body: await input.client.question.reply(input.command.body as any) }
  }
}

function postSessionCommand(
  input: Parameters<typeof sendHeadlessRuntimeCommand>[0],
  command: {
    sessionID: string
    route: "message" | "prompt_async" | "command" | "command_async" | "shell" | "shell_async"
    body: Record<string, unknown>
  },
) {
  return postJson(input, `/session/${encodeURIComponent(command.sessionID)}/${command.route}`, command.body)
}

function taskQueueCommand(
  input: HeadlessClientOptions,
  fetchFn: typeof fetch,
  id: string,
  command: "pause" | "resume" | "cancel" | "retry" | "send-now",
) {
  return requestJson<HeadlessTaskQueueItem>({
    baseUrl: input.baseUrl,
    fetch: fetchFn,
    headers: input.headers,
    directory: input.directory,
    experimental_workspaceID: input.experimental_workspaceID,
    path: `/task-queue/${encodeURIComponent(id)}/${command}`,
    method: "POST",
  })
}

function workflowRunCommand<TResult>(
  input: HeadlessClientOptions,
  fetchFn: typeof fetch,
  runID: string,
  method: "GET" | "POST",
  command?: "start" | "pause" | "resume" | "cancel" | "retry",
  body?: HeadlessWorkflowRunStartInput,
) {
  return requestJson<TResult>({
    baseUrl: input.baseUrl,
    fetch: fetchFn,
    headers: input.headers,
    directory: input.directory,
    experimental_workspaceID: input.experimental_workspaceID,
    path: `/workflow-runs/${encodeURIComponent(runID)}${command ? `/${command}` : ""}`,
    method,
    body: body as Record<string, unknown> | undefined,
  })
}

function scheduledTaskCommand(
  input: HeadlessClientOptions,
  fetchFn: typeof fetch,
  id: string,
  command: "pause" | "resume",
) {
  return requestJson<HeadlessScheduledTask>({
    baseUrl: input.baseUrl,
    fetch: fetchFn,
    headers: input.headers,
    directory: input.directory,
    experimental_workspaceID: input.experimental_workspaceID,
    path: `/scheduled-task/${encodeURIComponent(id)}/${command}`,
    method: "POST",
  })
}

async function loadSessionEvidence(
  input: HeadlessClientOptions,
  fetchFn: typeof fetch,
  sessionID: string,
  parameters: HeadlessSessionEvidenceInput = {},
): Promise<HeadlessSessionEvidence> {
  const encodedSessionID = encodeURIComponent(sessionID)
  const requests = {
    risk: requestJson<unknown>({
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      directory: input.directory,
      experimental_workspaceID: input.experimental_workspaceID,
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
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      directory: input.directory,
      experimental_workspaceID: input.experimental_workspaceID,
      path: `/session/${encodedSessionID}/dre`,
      method: "GET",
    }),
    semantic: requestJson<unknown>({
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      directory: input.directory,
      experimental_workspaceID: input.experimental_workspaceID,
      path: `/session/${encodedSessionID}/diff/semantic`,
      method: "GET",
    }),
    rollback: requestJson<unknown[]>({
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      directory: input.directory,
      experimental_workspaceID: input.experimental_workspaceID,
      path: `/session/${encodedSessionID}/rollback`,
      method: "GET",
    }),
    branch_rank: parameters.includeBranchRank
      ? requestJson<unknown>({
          baseUrl: input.baseUrl,
          fetch: fetchFn,
          headers: input.headers,
          directory: input.directory,
          experimental_workspaceID: input.experimental_workspaceID,
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

async function postJson(
  input: Parameters<typeof sendHeadlessRuntimeCommand>[0],
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<HeadlessRuntimeCommandResult> {
  const response = await input.fetch(new URL(path, input.baseUrl), {
    method: "POST",
    headers: {
      ...headlessHeaders(input),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Headless runtime command failed (${response.status}): ${text || response.statusText}`)
  }
  if (response.status === 202) return { accepted: true, status: 202 }
  const text = await response.text()
  return {
    accepted: true,
    status: 200,
    body: parseHeadlessRuntimeResponseBody(text),
  }
}

async function requestJson<TResult>(input: {
  baseUrl: string
  fetch: typeof fetch
  headers?: RequestInit["headers"]
  directory?: string
  experimental_workspaceID?: string
  path: string
  method: "GET" | "POST" | "DELETE"
  query?: Record<string, string | number | boolean | undefined>
  body?: Record<string, unknown>
}): Promise<TResult> {
  const url = new URL(input.path, input.baseUrl)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const response = await input.fetch(url, {
    method: input.method,
    headers: {
      ...headlessHeaders(input),
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Headless runtime request failed (${response.status}): ${text || response.statusText}`)
  }
  return parseHeadlessRuntimeResponseBody(await response.text()) as TResult
}

export function parseHeadlessRuntimeResponseBody(text: string): unknown {
  if (!text) return true
  return parseHeadlessRuntimeJsonBody(text)
}

export function parseHeadlessRuntimeJsonBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`Headless runtime returned invalid JSON: ${text.slice(0, 200)}`, { cause })
  }
}

function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

function headlessHeaders(input: {
  headers?: RequestInit["headers"]
  directory?: string
  experimental_workspaceID?: string
}): Record<string, string> {
  const headers = headersToRecord(input.headers)
  if (input.directory) {
    const encodedDirectory = /[^\x00-\x7F]/.test(input.directory)
      ? encodeURIComponent(input.directory)
      : input.directory
    headers["x-ax-code-directory"] = encodedDirectory
    headers["x-opencode-directory"] = encodedDirectory
  }
  if (input.experimental_workspaceID) {
    headers[AX_CODE_WORKSPACE_HEADER] = input.experimental_workspaceID
    headers[LEGACY_OPENCODE_WORKSPACE_HEADER] = input.experimental_workspaceID
  }
  return headers
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
