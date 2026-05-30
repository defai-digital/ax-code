import { createHeadlessClient } from "./headless/client.js"
import type {
  HeadlessClientOptions,
  HeadlessCreateSessionInput,
  HeadlessSessionEvidenceInput,
} from "./headless/client.js"
import type {
  HeadlessCommandBody,
  HeadlessPermissionReplyBody,
  HeadlessPromptBody,
  HeadlessQuestionReplyBody,
  HeadlessRuntimeCommand,
  HeadlessRuntimeCommandResult,
  HeadlessShellBody,
} from "./headless/command.js"

export const AX_CODE_GRPC_SERVICE = "axcode.v1.AxCodeHeadless"
export const AX_CODE_GRPC_PROTO_PATH = "ax_code/v1/headless.proto"

export const AX_CODE_GRPC_METHOD = {
  Health: `/${AX_CODE_GRPC_SERVICE}/Health`,
  CreateSession: `/${AX_CODE_GRPC_SERVICE}/CreateSession`,
  SendRuntimeCommand: `/${AX_CODE_GRPC_SERVICE}/SendRuntimeCommand`,
  LoadBootstrap: `/${AX_CODE_GRPC_SERVICE}/LoadBootstrap`,
  LoadSessionEvidence: `/${AX_CODE_GRPC_SERVICE}/LoadSessionEvidence`,
  ListTaskQueue: `/${AX_CODE_GRPC_SERVICE}/ListTaskQueue`,
  EnqueueTaskQueue: `/${AX_CODE_GRPC_SERVICE}/EnqueueTaskQueue`,
  EditTaskQueue: `/${AX_CODE_GRPC_SERVICE}/EditTaskQueue`,
  TaskQueueCommand: `/${AX_CODE_GRPC_SERVICE}/TaskQueueCommand`,
  ReorderTaskQueue: `/${AX_CODE_GRPC_SERVICE}/ReorderTaskQueue`,
  RemoveTaskQueue: `/${AX_CODE_GRPC_SERVICE}/RemoveTaskQueue`,
  ListScheduledTasks: `/${AX_CODE_GRPC_SERVICE}/ListScheduledTasks`,
  CreateScheduledTask: `/${AX_CODE_GRPC_SERVICE}/CreateScheduledTask`,
  UpdateScheduledTask: `/${AX_CODE_GRPC_SERVICE}/UpdateScheduledTask`,
  ScheduledTaskCommand: `/${AX_CODE_GRPC_SERVICE}/ScheduledTaskCommand`,
  RunScheduledTaskNow: `/${AX_CODE_GRPC_SERVICE}/RunScheduledTaskNow`,
  RemoveScheduledTask: `/${AX_CODE_GRPC_SERVICE}/RemoveScheduledTask`,
  ListWorkflowTemplates: `/${AX_CODE_GRPC_SERVICE}/ListWorkflowTemplates`,
  GetWorkflowTemplate: `/${AX_CODE_GRPC_SERVICE}/GetWorkflowTemplate`,
  SaveWorkflowTemplate: `/${AX_CODE_GRPC_SERVICE}/SaveWorkflowTemplate`,
  PromoteWorkflowTemplate: `/${AX_CODE_GRPC_SERVICE}/PromoteWorkflowTemplate`,
  ListWorkflowRuns: `/${AX_CODE_GRPC_SERVICE}/ListWorkflowRuns`,
  CreateWorkflowRun: `/${AX_CODE_GRPC_SERVICE}/CreateWorkflowRun`,
  GetWorkflowRun: `/${AX_CODE_GRPC_SERVICE}/GetWorkflowRun`,
  WorkflowRunArtifacts: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunArtifacts`,
  WorkflowRunEvalSummary: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunEvalSummary`,
  SaveWorkflowRunTemplate: `/${AX_CODE_GRPC_SERVICE}/SaveWorkflowRunTemplate`,
  WorkflowRunCommand: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunCommand`,
  ListWorkflowRoutines: `/${AX_CODE_GRPC_SERVICE}/ListWorkflowRoutines`,
  RunWorkflowRoutine: `/${AX_CODE_GRPC_SERVICE}/RunWorkflowRoutine`,
  SubscribeEvents: `/${AX_CODE_GRPC_SERVICE}/SubscribeEvents`,
} as const

type HeadlessHttpClient = ReturnType<typeof createHeadlessClient>
type GrpcMethodMap = typeof AX_CODE_GRPC_METHOD

export type AxCodeGrpcMethod = GrpcMethodMap[keyof GrpcMethodMap]
export type AxCodeGrpcUnaryMethod = Exclude<AxCodeGrpcMethod, typeof AX_CODE_GRPC_METHOD.SubscribeEvents>
export type AxCodeGrpcStreamingMethod = typeof AX_CODE_GRPC_METHOD.SubscribeEvents
export type AxCodeGrpcMetadata = Record<string, string>
export type AxCodeGrpcJsonResponse<T = unknown> = { value: T }
export type AxCodeGrpcRuntimeEvent = { type: string; properties?: unknown }

export type AxCodeGrpcCallOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  metadata?: AxCodeGrpcMetadata
}

export type AxCodeGrpcTransport = {
  unary<TRequest, TResponse>(
    method: AxCodeGrpcUnaryMethod,
    request: TRequest,
    options?: AxCodeGrpcCallOptions,
  ): Promise<TResponse>
  serverStream<TRequest, TResponse>(
    method: AxCodeGrpcStreamingMethod,
    request: TRequest,
    options?: AxCodeGrpcCallOptions,
  ): AsyncIterable<TResponse>
}

export type AxCodeGrpcHealthResponse = {
  status: "SERVING"
  transport?: "http-bridge" | "grpc"
}

export type AxCodeGrpcCreateSessionRequest = {
  session?: HeadlessCreateSessionInput
}

export type AxCodeGrpcLoadSessionEvidenceRequest = {
  sessionID: string
  parameters?: HeadlessSessionEvidenceInput
}

export type AxCodeGrpcBootstrapField =
  | "sessions"
  | "providers"
  | "providerList"
  | "agents"
  | "config"
  | "commands"
  | "permissions"
  | "questions"
  | "sessionStatus"
  | "providerAuth"
  | "path"
  | "lsp"
  | "mcp"
  | "resources"
  | "formatter"
  | "vcs"

export type AxCodeGrpcBootstrapRequest = {
  include?: Partial<Record<AxCodeGrpcBootstrapField, boolean>>
  sessionListStart?: number
}

export type AxCodeGrpcBootstrapResponse = Partial<Record<AxCodeGrpcBootstrapField, unknown>> & {
  errors: Array<{
    source: AxCodeGrpcBootstrapField
    message: string
  }>
}

export type AxCodeGrpcTaskQueueCommandRequest = {
  id: string
  command: "pause" | "resume" | "cancel" | "retry" | "send-now"
}

export type AxCodeGrpcScheduledTaskCommandRequest = {
  id: string
  command: "pause" | "resume"
}

export type AxCodeGrpcWorkflowRunCommandRequest = {
  runID: string
  command: "start" | "pause" | "resume" | "cancel" | "retry"
  body?: Parameters<HeadlessHttpClient["workflowRun"]["start"]>[1]
}

export type AxCodeGrpcClientOptions = {
  transport: AxCodeGrpcTransport
}

export function createAxCodeGrpcClient(input: AxCodeGrpcClientOptions) {
  const unary = <TRequest, TResponse>(
    method: AxCodeGrpcUnaryMethod,
    request: TRequest,
    options?: AxCodeGrpcCallOptions,
  ) => input.transport.unary<TRequest, TResponse>(method, request, options)

  const send = (command: HeadlessRuntimeCommand, options?: AxCodeGrpcCallOptions) =>
    unary<{ command: HeadlessRuntimeCommand }, HeadlessRuntimeCommandResult>(
      AX_CODE_GRPC_METHOD.SendRuntimeCommand,
      { command },
      options,
    )

  const value = async <TRequest, TResponse>(
    method: AxCodeGrpcUnaryMethod,
    request: TRequest,
    options?: AxCodeGrpcCallOptions,
  ) => {
    const response = await unary<TRequest, AxCodeGrpcJsonResponse<TResponse>>(method, request, options)
    return response.value
  }
  const taskQueueCommand = (
    id: string,
    command: AxCodeGrpcTaskQueueCommandRequest["command"],
    options?: AxCodeGrpcCallOptions,
  ) => value<AxCodeGrpcTaskQueueCommandRequest, unknown>(AX_CODE_GRPC_METHOD.TaskQueueCommand, { id, command }, options)
  const scheduledTaskCommand = (
    id: string,
    command: AxCodeGrpcScheduledTaskCommandRequest["command"],
    options?: AxCodeGrpcCallOptions,
  ) =>
    value<AxCodeGrpcScheduledTaskCommandRequest, unknown>(
      AX_CODE_GRPC_METHOD.ScheduledTaskCommand,
      { id, command },
      options,
    )
  const workflowRunCommand = (
    runID: string,
    command: AxCodeGrpcWorkflowRunCommandRequest["command"],
    body?: AxCodeGrpcWorkflowRunCommandRequest["body"],
    options?: AxCodeGrpcCallOptions,
  ) =>
    value<AxCodeGrpcWorkflowRunCommandRequest, unknown>(
      AX_CODE_GRPC_METHOD.WorkflowRunCommand,
      { runID, command, body },
      options,
    )

  return {
    health(options?: AxCodeGrpcCallOptions) {
      return unary<Record<string, never>, AxCodeGrpcHealthResponse>(AX_CODE_GRPC_METHOD.Health, {}, options)
    },
    createSession(session?: HeadlessCreateSessionInput, options?: AxCodeGrpcCallOptions) {
      return value<AxCodeGrpcCreateSessionRequest, unknown>(AX_CODE_GRPC_METHOD.CreateSession, { session }, options)
    },
    send,
    sendPrompt(
      sessionID: string,
      body: HeadlessPromptBody,
      options?: AxCodeGrpcCallOptions & { mode?: "sync" | "async" },
    ) {
      return send({ type: "session.prompt", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    sendCommand(
      sessionID: string,
      body: HeadlessCommandBody,
      options?: AxCodeGrpcCallOptions & { mode?: "sync" | "async" },
    ) {
      return send({ type: "session.command", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    sendShell(
      sessionID: string,
      body: HeadlessShellBody,
      options?: AxCodeGrpcCallOptions & { mode?: "sync" | "async" },
    ) {
      return send({ type: "session.shell", mode: options?.mode ?? "async", sessionID, body }, options)
    },
    abort(sessionID: string, options?: AxCodeGrpcCallOptions) {
      return send({ type: "session.abort", sessionID }, options)
    },
    replyPermission(body: HeadlessPermissionReplyBody, options?: AxCodeGrpcCallOptions) {
      return send({ type: "permission.reply", body }, options)
    },
    replyQuestion(body: HeadlessQuestionReplyBody, options?: AxCodeGrpcCallOptions) {
      return send({ type: "question.reply", body }, options)
    },
    bootstrap: {
      load(request: AxCodeGrpcBootstrapRequest = {}, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcBootstrapRequest, AxCodeGrpcBootstrapResponse>(
          AX_CODE_GRPC_METHOD.LoadBootstrap,
          request,
          options,
        )
      },
    },
    sessionEvidence: {
      load(sessionID: string, parameters?: HeadlessSessionEvidenceInput, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcLoadSessionEvidenceRequest, unknown>(
          AX_CODE_GRPC_METHOD.LoadSessionEvidence,
          { sessionID, parameters },
          options,
        )
      },
    },
    taskQueue: {
      list(parameters?: Parameters<HeadlessHttpClient["taskQueue"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListTaskQueue, { parameters }, options)
      },
      enqueue(body: Parameters<HeadlessHttpClient["taskQueue"]["enqueue"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.EnqueueTaskQueue, { body }, options)
      },
      edit(id: string, body: Parameters<HeadlessHttpClient["taskQueue"]["edit"]>[1], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.EditTaskQueue, { id, body }, options)
      },
      command(id: string, command: AxCodeGrpcTaskQueueCommandRequest["command"], options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, command, options)
      },
      pause(id: string, options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, "pause", options)
      },
      resume(id: string, options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, "resume", options)
      },
      cancel(id: string, options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, "cancel", options)
      },
      retry(id: string, options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, "retry", options)
      },
      sendNow(id: string, options?: AxCodeGrpcCallOptions) {
        return taskQueueCommand(id, "send-now", options)
      },
      reorder(id: string, position: number, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ReorderTaskQueue, { id, position }, options)
      },
      remove(id: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RemoveTaskQueue, { id }, options)
      },
    },
    scheduledTask: {
      list(parameters?: Parameters<HeadlessHttpClient["scheduledTask"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListScheduledTasks, { parameters }, options)
      },
      create(body: Parameters<HeadlessHttpClient["scheduledTask"]["create"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.CreateScheduledTask, { body }, options)
      },
      update(
        id: string,
        body: Parameters<HeadlessHttpClient["scheduledTask"]["update"]>[1],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.UpdateScheduledTask, { id, body }, options)
      },
      command(id: string, command: AxCodeGrpcScheduledTaskCommandRequest["command"], options?: AxCodeGrpcCallOptions) {
        return scheduledTaskCommand(id, command, options)
      },
      pause(id: string, options?: AxCodeGrpcCallOptions) {
        return scheduledTaskCommand(id, "pause", options)
      },
      resume(id: string, options?: AxCodeGrpcCallOptions) {
        return scheduledTaskCommand(id, "resume", options)
      },
      runNow(id: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RunScheduledTaskNow, { id }, options)
      },
      remove(id: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RemoveScheduledTask, { id }, options)
      },
    },
    workflowTemplate: {
      list(options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListWorkflowTemplates, {}, options)
      },
      get(templateID: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetWorkflowTemplate, { templateID }, options)
      },
      save(body: Parameters<HeadlessHttpClient["workflowTemplate"]["save"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.SaveWorkflowTemplate, { body }, options)
      },
      promote(templateID: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.PromoteWorkflowTemplate, { templateID }, options)
      },
    },
    workflowRun: {
      list(parameters?: Parameters<HeadlessHttpClient["workflowRun"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListWorkflowRuns, { parameters }, options)
      },
      create(body: Parameters<HeadlessHttpClient["workflowRun"]["create"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.CreateWorkflowRun, { body }, options)
      },
      get(runID: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetWorkflowRun, { runID }, options)
      },
      artifacts(
        runID: string,
        parameters?: Parameters<HeadlessHttpClient["workflowRun"]["artifacts"]>[1],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.WorkflowRunArtifacts, { runID, parameters }, options)
      },
      evalSummary(
        runID: string,
        body?: Parameters<HeadlessHttpClient["workflowRun"]["evalSummary"]>[1],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.WorkflowRunEvalSummary, { runID, body }, options)
      },
      saveTemplate(
        runID: string,
        body: Parameters<HeadlessHttpClient["workflowRun"]["saveTemplate"]>[1],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.SaveWorkflowRunTemplate, { runID, body }, options)
      },
      command(
        runID: string,
        command: AxCodeGrpcWorkflowRunCommandRequest["command"],
        body?: AxCodeGrpcWorkflowRunCommandRequest["body"],
        options?: AxCodeGrpcCallOptions,
      ) {
        return workflowRunCommand(runID, command, body, options)
      },
      start(runID: string, body?: AxCodeGrpcWorkflowRunCommandRequest["body"], options?: AxCodeGrpcCallOptions) {
        return workflowRunCommand(runID, "start", body, options)
      },
      pause(runID: string, options?: AxCodeGrpcCallOptions) {
        return workflowRunCommand(runID, "pause", undefined, options)
      },
      resume(runID: string, options?: AxCodeGrpcCallOptions) {
        return workflowRunCommand(runID, "resume", undefined, options)
      },
      cancel(runID: string, options?: AxCodeGrpcCallOptions) {
        return workflowRunCommand(runID, "cancel", undefined, options)
      },
      retry(runID: string, options?: AxCodeGrpcCallOptions) {
        return workflowRunCommand(runID, "retry", undefined, options)
      },
    },
    workflowRoutine: {
      list(options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListWorkflowRoutines, {}, options)
      },
      run(body: Parameters<HeadlessHttpClient["workflowRoutine"]["run"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RunWorkflowRoutine, { body }, options)
      },
    },
    subscribeEvents(options?: AxCodeGrpcCallOptions): AsyncIterable<AxCodeGrpcRuntimeEvent> {
      return input.transport.serverStream<Record<string, never>, AxCodeGrpcRuntimeEvent>(
        AX_CODE_GRPC_METHOD.SubscribeEvents,
        {},
        options,
      )
    },
  }
}

export function createAxCodeGrpcHttpBridge(input: HeadlessClientOptions): AxCodeGrpcTransport {
  const clientFor = (options?: AxCodeGrpcCallOptions) =>
    createHeadlessClient({
      ...input,
      headers: mergeHeaders(input.headers, options?.metadata),
    })

  return {
    unary<TRequest, TResponse>(method: AxCodeGrpcUnaryMethod, request: TRequest, options?: AxCodeGrpcCallOptions) {
      return withCallOptions(handleHttpBridgeUnary(clientFor(options), method, request), options) as Promise<TResponse>
    },
    async *serverStream<TRequest, TResponse>(
      method: AxCodeGrpcStreamingMethod,
      _request: TRequest,
      options?: AxCodeGrpcCallOptions,
    ) {
      if (method !== AX_CODE_GRPC_METHOD.SubscribeEvents) throw new Error(`Unsupported AX Code gRPC stream: ${method}`)
      const client = clientFor(options)
      for await (const event of client.subscribe({ signal: options?.signal })) {
        yield event as TResponse
      }
    },
  }
}

export function createAxCodeGrpcClientFromHttp(input: HeadlessClientOptions) {
  return createAxCodeGrpcClient({ transport: createAxCodeGrpcHttpBridge(input) })
}

export const createAxCodeGrpcHeadlessClient = createAxCodeGrpcClient

async function handleHttpBridgeUnary(
  client: HeadlessHttpClient,
  method: AxCodeGrpcUnaryMethod,
  request: unknown,
): Promise<unknown> {
  const body = request as Record<string, any>
  switch (method) {
    case AX_CODE_GRPC_METHOD.Health:
      return { status: "SERVING", transport: "http-bridge" } satisfies AxCodeGrpcHealthResponse
    case AX_CODE_GRPC_METHOD.CreateSession:
      return wrap(await client.createSession(body.session))
    case AX_CODE_GRPC_METHOD.SendRuntimeCommand:
      return client.send(body.command)
    case AX_CODE_GRPC_METHOD.LoadBootstrap:
      return wrap(await loadBootstrap(client, body))
    case AX_CODE_GRPC_METHOD.LoadSessionEvidence:
      return wrap(await client.sessionEvidence.load(body.sessionID, body.parameters))
    case AX_CODE_GRPC_METHOD.ListTaskQueue:
      return wrap(await client.taskQueue.list(body.parameters))
    case AX_CODE_GRPC_METHOD.EnqueueTaskQueue:
      return wrap(await client.taskQueue.enqueue(body.body))
    case AX_CODE_GRPC_METHOD.EditTaskQueue:
      return wrap(await client.taskQueue.edit(body.id, body.body))
    case AX_CODE_GRPC_METHOD.TaskQueueCommand:
      return wrap(await callTaskQueueCommand(client, body.id, body.command))
    case AX_CODE_GRPC_METHOD.ReorderTaskQueue:
      return wrap(await client.taskQueue.reorder(body.id, body.position))
    case AX_CODE_GRPC_METHOD.RemoveTaskQueue:
      return wrap(await client.taskQueue.remove(body.id))
    case AX_CODE_GRPC_METHOD.ListScheduledTasks:
      return wrap(await client.scheduledTask.list(body.parameters))
    case AX_CODE_GRPC_METHOD.CreateScheduledTask:
      return wrap(await client.scheduledTask.create(body.body))
    case AX_CODE_GRPC_METHOD.UpdateScheduledTask:
      return wrap(await client.scheduledTask.update(body.id, body.body))
    case AX_CODE_GRPC_METHOD.ScheduledTaskCommand:
      return wrap(await callScheduledTaskCommand(client, body.id, body.command))
    case AX_CODE_GRPC_METHOD.RunScheduledTaskNow:
      return wrap(await client.scheduledTask.runNow(body.id))
    case AX_CODE_GRPC_METHOD.RemoveScheduledTask:
      return wrap(await client.scheduledTask.remove(body.id))
    case AX_CODE_GRPC_METHOD.ListWorkflowTemplates:
      return wrap(await client.workflowTemplate.list())
    case AX_CODE_GRPC_METHOD.GetWorkflowTemplate:
      return wrap(await client.workflowTemplate.get(body.templateID))
    case AX_CODE_GRPC_METHOD.SaveWorkflowTemplate:
      return wrap(await client.workflowTemplate.save(body.body))
    case AX_CODE_GRPC_METHOD.PromoteWorkflowTemplate:
      return wrap(await client.workflowTemplate.promote(body.templateID))
    case AX_CODE_GRPC_METHOD.ListWorkflowRuns:
      return wrap(await client.workflowRun.list(body.parameters))
    case AX_CODE_GRPC_METHOD.CreateWorkflowRun:
      return wrap(await client.workflowRun.create(body.body))
    case AX_CODE_GRPC_METHOD.GetWorkflowRun:
      return wrap(await client.workflowRun.get(body.runID))
    case AX_CODE_GRPC_METHOD.WorkflowRunArtifacts:
      return wrap(await client.workflowRun.artifacts(body.runID, body.parameters))
    case AX_CODE_GRPC_METHOD.WorkflowRunEvalSummary:
      return wrap(await client.workflowRun.evalSummary(body.runID, body.body))
    case AX_CODE_GRPC_METHOD.SaveWorkflowRunTemplate:
      return wrap(await client.workflowRun.saveTemplate(body.runID, body.body))
    case AX_CODE_GRPC_METHOD.WorkflowRunCommand:
      return wrap(await callWorkflowRunCommand(client, body.runID, body.command, body.body))
    case AX_CODE_GRPC_METHOD.ListWorkflowRoutines:
      return wrap(await client.workflowRoutine.list())
    case AX_CODE_GRPC_METHOD.RunWorkflowRoutine:
      return wrap(await client.workflowRoutine.run(body.body))
  }
}

async function loadBootstrap(
  client: HeadlessHttpClient,
  request: AxCodeGrpcBootstrapRequest = {},
): Promise<AxCodeGrpcBootstrapResponse> {
  const out: AxCodeGrpcBootstrapResponse = { errors: [] }
  const api = client.client as any
  const calls: Array<Promise<void>> = []
  const add = (field: AxCodeGrpcBootstrapField, run: () => Promise<unknown>) => {
    if (request.include && request.include[field] !== true) return
    calls.push(
      Promise.resolve()
        .then(run)
        .then((value) => {
          out[field] = unwrapHttpSdkResponse(value)
        })
        .catch((error) => {
          out.errors.push({ source: field, message: errorMessage(error) })
        }),
    )
  }

  add("sessions", async () => {
    const response = await api.session.list({ start: request.sessionListStart })
    const sessions = unwrapHttpSdkResponse(response)
    if (!Array.isArray(sessions)) return sessions
    return [...sessions].sort((a: { id?: unknown }, b: { id?: unknown }) =>
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
    )
  })
  add("providers", () => api.config.providers({}, { throwOnError: true }))
  add("providerList", () => api.provider.list({}, { throwOnError: true }))
  add("agents", () => api.app.agents({}, { throwOnError: true }))
  add("config", () => api.config.get({}, { throwOnError: true }))
  add("commands", () => api.command.list())
  add("permissions", () => api.permission.list())
  add("questions", () => api.question.list())
  add("sessionStatus", () => api.session.status())
  add("providerAuth", () => api.provider.auth())
  add("path", () => api.path.get())
  add("lsp", () => api.lsp.status())
  add("mcp", () => api.mcp.status())
  add("resources", () => api.experimental.resource.list())
  add("formatter", () => api.formatter.status())
  add("vcs", () => api.vcs.get())

  await Promise.all(calls)
  return out
}

function callTaskQueueCommand(
  client: HeadlessHttpClient,
  id: string,
  command: AxCodeGrpcTaskQueueCommandRequest["command"],
) {
  switch (command) {
    case "pause":
      return client.taskQueue.pause(id)
    case "resume":
      return client.taskQueue.resume(id)
    case "cancel":
      return client.taskQueue.cancel(id)
    case "retry":
      return client.taskQueue.retry(id)
    case "send-now":
      return client.taskQueue.sendNow(id)
  }
}

function callScheduledTaskCommand(
  client: HeadlessHttpClient,
  id: string,
  command: AxCodeGrpcScheduledTaskCommandRequest["command"],
) {
  switch (command) {
    case "pause":
      return client.scheduledTask.pause(id)
    case "resume":
      return client.scheduledTask.resume(id)
  }
}

function callWorkflowRunCommand(
  client: HeadlessHttpClient,
  runID: string,
  command: AxCodeGrpcWorkflowRunCommandRequest["command"],
  body?: AxCodeGrpcWorkflowRunCommandRequest["body"],
) {
  switch (command) {
    case "start":
      return client.workflowRun.start(runID, body)
    case "pause":
      return client.workflowRun.pause(runID)
    case "resume":
      return client.workflowRun.resume(runID)
    case "cancel":
      return client.workflowRun.cancel(runID)
    case "retry":
      return client.workflowRun.retry(runID)
  }
}

function wrap<T>(value: T): AxCodeGrpcJsonResponse<T> {
  return { value }
}

function unwrapHttpSdkResponse(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) return (value as { data: unknown }).data
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function mergeHeaders(headers: RequestInit["headers"] | undefined, metadata: AxCodeGrpcMetadata | undefined) {
  return {
    ...headersToRecord(headers),
    ...metadata,
  }
}

function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

function withCallOptions<T>(promise: Promise<T>, options: AxCodeGrpcCallOptions | undefined): Promise<T> {
  if (!options?.signal && !options?.timeoutMs) return promise

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      options?.signal?.removeEventListener("abort", onAbort)
    }
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onAbort = () => {
      settle(() => reject(new Error("AX Code gRPC call aborted")))
    }

    if (options?.signal) {
      if (options.signal.aborted) {
        onAbort()
        return
      }
      options.signal.addEventListener("abort", onAbort, { once: true })
    }
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        settle(() => reject(new Error(`AX Code gRPC call timed out after ${options.timeoutMs}ms`)))
      }, options.timeoutMs)
    }

    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    )
  })
}
