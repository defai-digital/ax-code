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
export const AX_CODE_GRPC_PROTO_PACKAGE_PATH = `proto/${AX_CODE_GRPC_PROTO_PATH}`

export const AX_CODE_GRPC_METHOD = {
  Health: `/${AX_CODE_GRPC_SERVICE}/Health`,
  CreateSession: `/${AX_CODE_GRPC_SERVICE}/CreateSession`,
  SendRuntimeCommand: `/${AX_CODE_GRPC_SERVICE}/SendRuntimeCommand`,
  LoadBootstrap: `/${AX_CODE_GRPC_SERVICE}/LoadBootstrap`,
  LoadSessionEvidence: `/${AX_CODE_GRPC_SERVICE}/LoadSessionEvidence`,
  ListSessions: `/${AX_CODE_GRPC_SERVICE}/ListSessions`,
  GetSessionStatus: `/${AX_CODE_GRPC_SERVICE}/GetSessionStatus`,
  GetSession: `/${AX_CODE_GRPC_SERVICE}/GetSession`,
  UpdateSession: `/${AX_CODE_GRPC_SERVICE}/UpdateSession`,
  DeleteSession: `/${AX_CODE_GRPC_SERVICE}/DeleteSession`,
  ListSessionMessages: `/${AX_CODE_GRPC_SERVICE}/ListSessionMessages`,
  GetSessionMessage: `/${AX_CODE_GRPC_SERVICE}/GetSessionMessage`,
  DeleteSessionMessage: `/${AX_CODE_GRPC_SERVICE}/DeleteSessionMessage`,
  ListSessionChildren: `/${AX_CODE_GRPC_SERVICE}/ListSessionChildren`,
  GetSessionGoal: `/${AX_CODE_GRPC_SERVICE}/GetSessionGoal`,
  GetSessionTodo: `/${AX_CODE_GRPC_SERVICE}/GetSessionTodo`,
  GetSessionDiff: `/${AX_CODE_GRPC_SERVICE}/GetSessionDiff`,
  ForkSession: `/${AX_CODE_GRPC_SERVICE}/ForkSession`,
  ShareSession: `/${AX_CODE_GRPC_SERVICE}/ShareSession`,
  UnshareSession: `/${AX_CODE_GRPC_SERVICE}/UnshareSession`,
  SummarizeSession: `/${AX_CODE_GRPC_SERVICE}/SummarizeSession`,
  ListAgents: `/${AX_CODE_GRPC_SERVICE}/ListAgents`,
  ListSkills: `/${AX_CODE_GRPC_SERVICE}/ListSkills`,
  WriteAppLog: `/${AX_CODE_GRPC_SERVICE}/WriteAppLog`,
  DisposeInstance: `/${AX_CODE_GRPC_SERVICE}/DisposeInstance`,
  RestartInstance: `/${AX_CODE_GRPC_SERVICE}/RestartInstance`,
  ListProjects: `/${AX_CODE_GRPC_SERVICE}/ListProjects`,
  GetCurrentProject: `/${AX_CODE_GRPC_SERVICE}/GetCurrentProject`,
  GetPath: `/${AX_CODE_GRPC_SERVICE}/GetPath`,
  GetVcs: `/${AX_CODE_GRPC_SERVICE}/GetVcs`,
  ListCommands: `/${AX_CODE_GRPC_SERVICE}/ListCommands`,
  GetProjectContext: `/${AX_CODE_GRPC_SERVICE}/GetProjectContext`,
  CreateProjectContextTemplate: `/${AX_CODE_GRPC_SERVICE}/CreateProjectContextTemplate`,
  WarmupProjectMemory: `/${AX_CODE_GRPC_SERVICE}/WarmupProjectMemory`,
  ClearProjectMemory: `/${AX_CODE_GRPC_SERVICE}/ClearProjectMemory`,
  GetDebugEnginePendingPlans: `/${AX_CODE_GRPC_SERVICE}/GetDebugEnginePendingPlans`,
  ListFiles: `/${AX_CODE_GRPC_SERVICE}/ListFiles`,
  ReadFile: `/${AX_CODE_GRPC_SERVICE}/ReadFile`,
  GetFileStatus: `/${AX_CODE_GRPC_SERVICE}/GetFileStatus`,
  FindText: `/${AX_CODE_GRPC_SERVICE}/FindText`,
  FindFiles: `/${AX_CODE_GRPC_SERVICE}/FindFiles`,
  FindSymbols: `/${AX_CODE_GRPC_SERVICE}/FindSymbols`,
  ListToolIDs: `/${AX_CODE_GRPC_SERVICE}/ListToolIDs`,
  ListTools: `/${AX_CODE_GRPC_SERVICE}/ListTools`,
  ListPermissions: `/${AX_CODE_GRPC_SERVICE}/ListPermissions`,
  ReplyPermission: `/${AX_CODE_GRPC_SERVICE}/ReplyPermission`,
  ListQuestions: `/${AX_CODE_GRPC_SERVICE}/ListQuestions`,
  ReplyQuestion: `/${AX_CODE_GRPC_SERVICE}/ReplyQuestion`,
  RejectQuestion: `/${AX_CODE_GRPC_SERVICE}/RejectQuestion`,
  GetConfig: `/${AX_CODE_GRPC_SERVICE}/GetConfig`,
  UpdateConfig: `/${AX_CODE_GRPC_SERVICE}/UpdateConfig`,
  ListConfigProviders: `/${AX_CODE_GRPC_SERVICE}/ListConfigProviders`,
  GetAutonomousMode: `/${AX_CODE_GRPC_SERVICE}/GetAutonomousMode`,
  SetAutonomousMode: `/${AX_CODE_GRPC_SERVICE}/SetAutonomousMode`,
  GetIsolationMode: `/${AX_CODE_GRPC_SERVICE}/GetIsolationMode`,
  SetIsolationMode: `/${AX_CODE_GRPC_SERVICE}/SetIsolationMode`,
  GetSmartLlmRouting: `/${AX_CODE_GRPC_SERVICE}/GetSmartLlmRouting`,
  SetSmartLlmRouting: `/${AX_CODE_GRPC_SERVICE}/SetSmartLlmRouting`,
  GetMcpStatus: `/${AX_CODE_GRPC_SERVICE}/GetMcpStatus`,
  ListMcpResources: `/${AX_CODE_GRPC_SERVICE}/ListMcpResources`,
  AddMcpServer: `/${AX_CODE_GRPC_SERVICE}/AddMcpServer`,
  StartMcpAuth: `/${AX_CODE_GRPC_SERVICE}/StartMcpAuth`,
  CompleteMcpAuth: `/${AX_CODE_GRPC_SERVICE}/CompleteMcpAuth`,
  AuthenticateMcp: `/${AX_CODE_GRPC_SERVICE}/AuthenticateMcp`,
  RemoveMcpAuth: `/${AX_CODE_GRPC_SERVICE}/RemoveMcpAuth`,
  ConnectMcp: `/${AX_CODE_GRPC_SERVICE}/ConnectMcp`,
  DisconnectMcp: `/${AX_CODE_GRPC_SERVICE}/DisconnectMcp`,
  ListProviders: `/${AX_CODE_GRPC_SERVICE}/ListProviders`,
  GetProviderAuth: `/${AX_CODE_GRPC_SERVICE}/GetProviderAuth`,
  SetAuth: `/${AX_CODE_GRPC_SERVICE}/SetAuth`,
  RemoveAuth: `/${AX_CODE_GRPC_SERVICE}/RemoveAuth`,
  ProviderOauthAuthorize: `/${AX_CODE_GRPC_SERVICE}/ProviderOauthAuthorize`,
  ProviderOauthCallback: `/${AX_CODE_GRPC_SERVICE}/ProviderOauthCallback`,
  GetLspStatus: `/${AX_CODE_GRPC_SERVICE}/GetLspStatus`,
  GetFormatterStatus: `/${AX_CODE_GRPC_SERVICE}/GetFormatterStatus`,
  ListPty: `/${AX_CODE_GRPC_SERVICE}/ListPty`,
  CreatePty: `/${AX_CODE_GRPC_SERVICE}/CreatePty`,
  GetPty: `/${AX_CODE_GRPC_SERVICE}/GetPty`,
  UpdatePty: `/${AX_CODE_GRPC_SERVICE}/UpdatePty`,
  RemovePty: `/${AX_CODE_GRPC_SERVICE}/RemovePty`,
  ConnectPty: `/${AX_CODE_GRPC_SERVICE}/ConnectPty`,
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
  WorkflowRunDashboard: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunDashboard`,
  WorkflowRunEvalCases: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunEvalCases`,
  CreateWorkflowRun: `/${AX_CODE_GRPC_SERVICE}/CreateWorkflowRun`,
  GetWorkflowRun: `/${AX_CODE_GRPC_SERVICE}/GetWorkflowRun`,
  WorkflowRunArtifacts: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunArtifacts`,
  WorkflowRunEvalSummary: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunEvalSummary`,
  WorkflowRunEvalCase: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunEvalCase`,
  SaveWorkflowRunTemplate: `/${AX_CODE_GRPC_SERVICE}/SaveWorkflowRunTemplate`,
  WorkflowRunCommand: `/${AX_CODE_GRPC_SERVICE}/WorkflowRunCommand`,
  ListWorkflowRoutines: `/${AX_CODE_GRPC_SERVICE}/ListWorkflowRoutines`,
  RunWorkflowRoutine: `/${AX_CODE_GRPC_SERVICE}/RunWorkflowRoutine`,
  SubscribeEvents: `/${AX_CODE_GRPC_SERVICE}/SubscribeEvents`,
} as const

type HeadlessHttpClient = ReturnType<typeof createHeadlessClient>
type GrpcMethodMap = typeof AX_CODE_GRPC_METHOD

export type AxCodeGrpcMethod = GrpcMethodMap[keyof GrpcMethodMap]
export type AxCodeGrpcUnaryMethod = Exclude<
  AxCodeGrpcMethod,
  typeof AX_CODE_GRPC_METHOD.SubscribeEvents | typeof AX_CODE_GRPC_METHOD.ConnectPty
>
export type AxCodeGrpcStreamingMethod = typeof AX_CODE_GRPC_METHOD.SubscribeEvents
export type AxCodeGrpcBidirectionalStreamingMethod = typeof AX_CODE_GRPC_METHOD.ConnectPty
export type AxCodeGrpcMetadata = Record<string, string>
export type AxCodeGrpcJsonResponse<T = unknown> = { value: T }
export type AxCodeGrpcRuntimeEvent = { type: string; properties?: unknown }

export type AxCodeGrpcCallOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  metadata?: AxCodeGrpcMetadata
}

export type AxCodeGrpcSubscribeEventsRequest = {
  types?: string[]
  sessionID?: string
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
  bidiStream?<TRequest, TInput, TResponse>(
    method: AxCodeGrpcBidirectionalStreamingMethod,
    request: TRequest,
    input: AsyncIterable<TInput>,
    options?: AxCodeGrpcCallOptions,
  ): AsyncIterable<TResponse>
}

export type AxCodeGrpcNativeUnaryCall<TRequest = unknown> = {
  method: AxCodeGrpcUnaryMethod
  request: TRequest
  metadata?: AxCodeGrpcMetadata
  signal?: AbortSignal
  timeoutMs?: number
}

export type AxCodeGrpcNativeServerStreamCall<TRequest = unknown> = {
  method: AxCodeGrpcStreamingMethod
  request: TRequest
  metadata?: AxCodeGrpcMetadata
  signal?: AbortSignal
  timeoutMs?: number
}

export type AxCodeGrpcNativeBidiStreamCall<TRequest = unknown, TInput = unknown> = {
  method: AxCodeGrpcBidirectionalStreamingMethod
  request: TRequest
  input: AsyncIterable<TInput>
  metadata?: AxCodeGrpcMetadata
  signal?: AbortSignal
  timeoutMs?: number
}

export type AxCodeGrpcNativeBridge = {
  unary<TRequest, TResponse>(call: AxCodeGrpcNativeUnaryCall<TRequest>): Promise<TResponse>
  serverStream?<TRequest, TResponse>(call: AxCodeGrpcNativeServerStreamCall<TRequest>): AsyncIterable<TResponse>
  bidiStream?<TRequest, TInput, TResponse>(
    call: AxCodeGrpcNativeBidiStreamCall<TRequest, TInput>,
  ): AsyncIterable<TResponse>
}

export type AxCodeGrpcNativeHandlerContext<TMethod extends AxCodeGrpcMethod = AxCodeGrpcMethod> =
  AxCodeGrpcCallOptions & {
    method: TMethod
  }

export type AxCodeGrpcNativeUnaryHandler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
  context: AxCodeGrpcNativeHandlerContext<AxCodeGrpcUnaryMethod>,
) => TResponse | Promise<TResponse>

export type AxCodeGrpcNativeServerStreamHandler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
  context: AxCodeGrpcNativeHandlerContext<AxCodeGrpcStreamingMethod>,
) => AsyncIterable<TResponse>

export type AxCodeGrpcNativeBidiStreamHandler<TRequest = unknown, TInput = unknown, TResponse = unknown> = (
  request: TRequest,
  input: AsyncIterable<TInput>,
  context: AxCodeGrpcNativeHandlerContext<AxCodeGrpcBidirectionalStreamingMethod>,
) => AsyncIterable<TResponse>

export type AxCodeGrpcNativeHandlerMap = {
  unary?: Partial<Record<AxCodeGrpcUnaryMethod, AxCodeGrpcNativeUnaryHandler>>
  serverStream?: Partial<Record<AxCodeGrpcStreamingMethod, AxCodeGrpcNativeServerStreamHandler>>
  bidiStream?: Partial<Record<AxCodeGrpcBidirectionalStreamingMethod, AxCodeGrpcNativeBidiStreamHandler>>
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

export type AxCodeGrpcSessionRequest<TParameters = unknown> = {
  sessionID: string
  parameters?: TParameters
}

export type AxCodeGrpcSessionBodyRequest<TBody = unknown> = {
  sessionID: string
  body?: TBody
}

export type AxCodeGrpcSessionMessageRequest = {
  sessionID: string
  messageID: string
}

export type AxCodeGrpcRequestIDRequest = {
  requestID: string
}

export type AxCodeGrpcRequestBodyRequest<TBody = unknown> = {
  requestID: string
  body?: TBody
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

export type AxCodeGrpcPtyConnectRequest = {
  id: string
  cursor?: number
}

export type AxCodeGrpcPtyClientEvent =
  | string
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close"; code?: number; reason?: string }

export type AxCodeGrpcPtyServerEvent =
  | { type: "output"; data: string }
  | { type: "replay"; cursor: number; from?: number; gap?: { requested: number; available: number } }
  | { type: "closed"; code?: number; reason?: string }

export type AxCodeGrpcTaskQueueCommandRequest = {
  id: string
  command: "pause" | "resume" | "cancel" | "retry" | "send-now"
}

export type AxCodeGrpcScheduledTaskCommandRequest = {
  id: string
  command: "pause" | "resume"
}

export type AxCodeGrpcNamedRequest = {
  name: string
}

export type AxCodeGrpcMcpAddRequest = {
  name: string
  config?: NonNullable<Parameters<HeadlessHttpClient["client"]["mcp"]["add"]>[0]>["config"]
}

export type AxCodeGrpcMcpAuthCallbackRequest = AxCodeGrpcNamedRequest & {
  code?: string
}

export type AxCodeGrpcWorkflowRunCommandRequest = {
  runID: string
  command: "start" | "pause" | "resume" | "cancel" | "retry"
  body?: Parameters<HeadlessHttpClient["workflowRun"]["start"]>[1]
}

export type AxCodeGrpcClientOptions = {
  transport: AxCodeGrpcTransport
}

export type AxCodeGrpcWebSocketLike = {
  readyState: number
  binaryType?: BinaryType
  send(data: string | Uint8Array | ArrayBuffer): void
  close(code?: number, reason?: string): void
  addEventListener?: (type: string, listener: (event: any) => void, options?: boolean | AddEventListenerOptions) => void
  removeEventListener?: (type: string, listener: (event: any) => void, options?: boolean | EventListenerOptions) => void
  onopen?: ((event: unknown) => void) | null
  onmessage?: ((event: { data: unknown }) => void) | null
  onerror?: ((event: unknown) => void) | null
  onclose?: ((event: { code?: number; reason?: string }) => void) | null
}

export type AxCodeGrpcHttpBridgeOptions = HeadlessClientOptions & {
  webSocketFactory?: (url: string) => AxCodeGrpcWebSocketLike
  /**
   * The HTTP bridge is a desktop compatibility fallback, not the preferred privileged GUI boundary.
   * Keep it loopback-only unless the caller explicitly owns and secures the remote server.
   */
  allowRemoteHttpBridge?: boolean
}

export function createAxCodeGrpcNativeBridgeTransport(bridge: AxCodeGrpcNativeBridge): AxCodeGrpcTransport {
  return {
    unary<TRequest, TResponse>(method: AxCodeGrpcUnaryMethod, request: TRequest, options?: AxCodeGrpcCallOptions) {
      return bridge.unary<TRequest, TResponse>({
        method,
        request,
        metadata: options?.metadata,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      })
    },
    serverStream<TRequest, TResponse>(
      method: AxCodeGrpcStreamingMethod,
      request: TRequest,
      options?: AxCodeGrpcCallOptions,
    ) {
      if (!bridge.serverStream) throw new Error("AX Code native bridge does not support server streaming")
      return bridge.serverStream<TRequest, TResponse>({
        method,
        request,
        metadata: options?.metadata,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      })
    },
    bidiStream<TRequest, TInput, TResponse>(
      method: AxCodeGrpcBidirectionalStreamingMethod,
      request: TRequest,
      input: AsyncIterable<TInput>,
      options?: AxCodeGrpcCallOptions,
    ) {
      if (!bridge.bidiStream) throw new Error("AX Code native bridge does not support bidirectional streaming")
      return bridge.bidiStream<TRequest, TInput, TResponse>({
        method,
        request,
        input,
        metadata: options?.metadata,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      })
    },
  }
}

export function createAxCodeGrpcNativeBridgeFromHandlers(handlers: AxCodeGrpcNativeHandlerMap): AxCodeGrpcNativeBridge {
  return {
    async unary<TRequest, TResponse>(call: AxCodeGrpcNativeUnaryCall<TRequest>): Promise<TResponse> {
      const handler = handlers.unary?.[call.method]
      if (!handler) throw missingNativeHandler("unary", call.method)
      return handler(call.request, nativeHandlerContext(call)) as Promise<TResponse>
    },
    serverStream<TRequest, TResponse>(call: AxCodeGrpcNativeServerStreamCall<TRequest>): AsyncIterable<TResponse> {
      const handler = handlers.serverStream?.[call.method]
      if (!handler) throw missingNativeHandler("server stream", call.method)
      return handler(call.request, nativeHandlerContext(call)) as AsyncIterable<TResponse>
    },
    bidiStream<TRequest, TInput, TResponse>(
      call: AxCodeGrpcNativeBidiStreamCall<TRequest, TInput>,
    ): AsyncIterable<TResponse> {
      const handler = handlers.bidiStream?.[call.method]
      if (!handler) throw missingNativeHandler("bidirectional stream", call.method)
      return handler(call.request, call.input, nativeHandlerContext(call)) as AsyncIterable<TResponse>
    },
  }
}

export function createAxCodeGrpcClientFromNativeBridge(bridge: AxCodeGrpcNativeBridge) {
  return createAxCodeGrpcClient({ transport: createAxCodeGrpcNativeBridgeTransport(bridge) })
}

export function createAxCodeGrpcClientFromNativeHandlers(handlers: AxCodeGrpcNativeHandlerMap) {
  return createAxCodeGrpcClientFromNativeBridge(createAxCodeGrpcNativeBridgeFromHandlers(handlers))
}

export function createAxCodeGrpcClient(input: AxCodeGrpcClientOptions) {
  const transport = input.transport
  const unary = <TRequest, TResponse>(
    method: AxCodeGrpcUnaryMethod,
    request: TRequest,
    options?: AxCodeGrpcCallOptions,
  ) => transport.unary<TRequest, TResponse>(method, request, options)

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
    session: {
      list(parameters?: Parameters<HeadlessHttpClient["client"]["session"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListSessions, { parameters }, options)
      },
      create(session?: HeadlessCreateSessionInput, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcCreateSessionRequest, unknown>(AX_CODE_GRPC_METHOD.CreateSession, { session }, options)
      },
      status(parameters?: Parameters<HeadlessHttpClient["client"]["session"]["status"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetSessionStatus, { parameters }, options)
      },
      get(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.GetSession, { sessionID }, options)
      },
      update(
        sessionID: string,
        body: Omit<Parameters<HeadlessHttpClient["client"]["session"]["update"]>[0], "sessionID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.UpdateSession, { sessionID, body }, options)
      },
      delete(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.DeleteSession, { sessionID }, options)
      },
      messages(
        sessionID: string,
        parameters?: Omit<Parameters<HeadlessHttpClient["client"]["session"]["messages"]>[0], "sessionID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListSessionMessages, { sessionID, parameters }, options)
      },
      message(sessionID: string, messageID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionMessageRequest, unknown>(
          AX_CODE_GRPC_METHOD.GetSessionMessage,
          { sessionID, messageID },
          options,
        )
      },
      deleteMessage(sessionID: string, messageID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionMessageRequest, unknown>(
          AX_CODE_GRPC_METHOD.DeleteSessionMessage,
          { sessionID, messageID },
          options,
        )
      },
      children(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.ListSessionChildren, { sessionID }, options)
      },
      goal(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.GetSessionGoal, { sessionID }, options)
      },
      todo(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.GetSessionTodo, { sessionID }, options)
      },
      diff(
        sessionID: string,
        parameters?: Omit<Parameters<HeadlessHttpClient["client"]["session"]["diff"]>[0], "sessionID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.GetSessionDiff, { sessionID, parameters }, options)
      },
      fork(
        sessionID: string,
        body?: Omit<Parameters<HeadlessHttpClient["client"]["session"]["fork"]>[0], "sessionID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ForkSession, { sessionID, body }, options)
      },
      share(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.ShareSession, { sessionID }, options)
      },
      unshare(sessionID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcSessionRequest, unknown>(AX_CODE_GRPC_METHOD.UnshareSession, { sessionID }, options)
      },
      summarize(
        sessionID: string,
        body?: Omit<Parameters<HeadlessHttpClient["client"]["session"]["summarize"]>[0], "sessionID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.SummarizeSession, { sessionID, body }, options)
      },
    },
    app: {
      agents(parameters?: Parameters<HeadlessHttpClient["client"]["app"]["agents"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListAgents, { parameters }, options)
      },
      skills(parameters?: Parameters<HeadlessHttpClient["client"]["app"]["skills"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListSkills, { parameters }, options)
      },
      log(
        body: Omit<NonNullable<Parameters<HeadlessHttpClient["client"]["app"]["log"]>[0]>, "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.WriteAppLog, { body }, options)
      },
    },
    instance: {
      dispose(options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.DisposeInstance, {}, options)
      },
      restart(options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RestartInstance, {}, options)
      },
    },
    project: {
      list(parameters?: Parameters<HeadlessHttpClient["client"]["project"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListProjects, { parameters }, options)
      },
      current(
        parameters?: Parameters<HeadlessHttpClient["client"]["project"]["current"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.GetCurrentProject, { parameters }, options)
      },
    },
    path: {
      get(parameters?: Parameters<HeadlessHttpClient["client"]["path"]["get"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetPath, { parameters }, options)
      },
    },
    vcs: {
      get(parameters?: Parameters<HeadlessHttpClient["client"]["vcs"]["get"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetVcs, { parameters }, options)
      },
    },
    command: {
      list(parameters?: Parameters<HeadlessHttpClient["client"]["command"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListCommands, { parameters }, options)
      },
    },
    context: {
      get(parameters?: Parameters<HeadlessHttpClient["client"]["app"]["context"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetProjectContext, { parameters }, options)
      },
      createTemplate(
        key: NonNullable<Parameters<HeadlessHttpClient["client"]["app"]["contextTemplateCreate"]>[0]>["key"],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.CreateProjectContextTemplate, { body: { key } }, options)
      },
      memory: {
        warmup(options?: AxCodeGrpcCallOptions) {
          return value(AX_CODE_GRPC_METHOD.WarmupProjectMemory, {}, options)
        },
        clear(options?: AxCodeGrpcCallOptions) {
          return value(AX_CODE_GRPC_METHOD.ClearProjectMemory, {}, options)
        },
      },
    },
    debugEngine: {
      pendingPlans(
        parameters?: Parameters<HeadlessHttpClient["client"]["debugEngine"]["pendingPlans"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.GetDebugEnginePendingPlans, { parameters }, options)
      },
    },
    file: {
      list(path: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListFiles, { parameters: { path } }, options)
      },
      read(path: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ReadFile, { parameters: { path } }, options)
      },
      status(parameters?: Parameters<HeadlessHttpClient["client"]["file"]["status"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetFileStatus, { parameters }, options)
      },
    },
    find: {
      text(pattern: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.FindText, { parameters: { pattern } }, options)
      },
      files(
        query: string,
        parameters?: Omit<Parameters<HeadlessHttpClient["client"]["find"]["files"]>[0], "query" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.FindFiles, { parameters: { query, ...parameters } }, options)
      },
      symbols(query: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.FindSymbols, { parameters: { query } }, options)
      },
    },
    tool: {
      ids(parameters?: Parameters<HeadlessHttpClient["client"]["tool"]["ids"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListToolIDs, { parameters }, options)
      },
      list(
        provider: string,
        model: string,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListTools, { parameters: { provider, model } }, options)
      },
    },
    permission: {
      list(
        parameters?: Parameters<HeadlessHttpClient["client"]["permission"]["list"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListPermissions, { parameters }, options)
      },
      reply(
        requestID: string,
        body?: Omit<HeadlessPermissionReplyBody, "requestID">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value<AxCodeGrpcRequestBodyRequest<Omit<HeadlessPermissionReplyBody, "requestID">>, unknown>(
          AX_CODE_GRPC_METHOD.ReplyPermission,
          { requestID, body },
          options,
        )
      },
    },
    question: {
      list(
        parameters?: Parameters<HeadlessHttpClient["client"]["question"]["list"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListQuestions, { parameters }, options)
      },
      reply(
        requestID: string,
        body: Omit<HeadlessQuestionReplyBody, "requestID">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value<AxCodeGrpcRequestBodyRequest<Omit<HeadlessQuestionReplyBody, "requestID">>, unknown>(
          AX_CODE_GRPC_METHOD.ReplyQuestion,
          { requestID, body },
          options,
        )
      },
      reject(requestID: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcRequestIDRequest, unknown>(AX_CODE_GRPC_METHOD.RejectQuestion, { requestID }, options)
      },
    },
    config: {
      get(parameters?: Parameters<HeadlessHttpClient["client"]["config"]["get"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetConfig, { parameters }, options)
      },
      update(
        config: NonNullable<Parameters<HeadlessHttpClient["client"]["config"]["update"]>[0]>["config"],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.UpdateConfig, { body: { config } }, options)
      },
      providers(
        parameters?: Parameters<HeadlessHttpClient["client"]["config"]["providers"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListConfigProviders, { parameters }, options)
      },
    },
    runtime: {
      autonomous: {
        get(
          parameters?: Parameters<HeadlessHttpClient["client"]["autonomous"]["get"]>[0],
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.GetAutonomousMode, { parameters }, options)
        },
        set(enabled: boolean, options?: AxCodeGrpcCallOptions) {
          return value(AX_CODE_GRPC_METHOD.SetAutonomousMode, { body: { enabled } }, options)
        },
      },
      isolation: {
        get(
          parameters?: Parameters<HeadlessHttpClient["client"]["isolation"]["get"]>[0],
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.GetIsolationMode, { parameters }, options)
        },
        set(
          mode: NonNullable<Parameters<HeadlessHttpClient["client"]["isolation"]["set"]>[0]>["mode"],
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.SetIsolationMode, { body: { mode } }, options)
        },
      },
      smartLlm: {
        get(
          parameters?: Parameters<HeadlessHttpClient["client"]["smartLlm"]["get"]>[0],
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.GetSmartLlmRouting, { parameters }, options)
        },
        set(enabled: boolean, options?: AxCodeGrpcCallOptions) {
          return value(AX_CODE_GRPC_METHOD.SetSmartLlmRouting, { body: { enabled } }, options)
        },
      },
    },
    mcp: {
      status(parameters?: Parameters<HeadlessHttpClient["client"]["mcp"]["status"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetMcpStatus, { parameters }, options)
      },
      resources(
        parameters?: Parameters<HeadlessHttpClient["client"]["experimental"]["resource"]["list"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.ListMcpResources, { parameters }, options)
      },
      add(
        name: string,
        config: AxCodeGrpcMcpAddRequest["config"],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value<AxCodeGrpcMcpAddRequest, unknown>(AX_CODE_GRPC_METHOD.AddMcpServer, { name, config }, options)
      },
      connect(name: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcNamedRequest, unknown>(AX_CODE_GRPC_METHOD.ConnectMcp, { name }, options)
      },
      disconnect(name: string, options?: AxCodeGrpcCallOptions) {
        return value<AxCodeGrpcNamedRequest, unknown>(AX_CODE_GRPC_METHOD.DisconnectMcp, { name }, options)
      },
      auth: {
        start(name: string, options?: AxCodeGrpcCallOptions) {
          return value<AxCodeGrpcNamedRequest, unknown>(AX_CODE_GRPC_METHOD.StartMcpAuth, { name }, options)
        },
        callback(name: string, code?: string, options?: AxCodeGrpcCallOptions) {
          return value<AxCodeGrpcMcpAuthCallbackRequest, unknown>(
            AX_CODE_GRPC_METHOD.CompleteMcpAuth,
            { name, code },
            options,
          )
        },
        authenticate(name: string, options?: AxCodeGrpcCallOptions) {
          return value<AxCodeGrpcNamedRequest, unknown>(AX_CODE_GRPC_METHOD.AuthenticateMcp, { name }, options)
        },
        remove(name: string, options?: AxCodeGrpcCallOptions) {
          return value<AxCodeGrpcNamedRequest, unknown>(AX_CODE_GRPC_METHOD.RemoveMcpAuth, { name }, options)
        },
      },
    },
    lsp: {
      status(parameters?: Parameters<HeadlessHttpClient["client"]["lsp"]["status"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetLspStatus, { parameters }, options)
      },
    },
    formatter: {
      status(
        parameters?: Parameters<HeadlessHttpClient["client"]["formatter"]["status"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.GetFormatterStatus, { parameters }, options)
      },
    },
    provider: {
      list(parameters?: Parameters<HeadlessHttpClient["client"]["provider"]["list"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListProviders, { parameters }, options)
      },
      auth(parameters?: Parameters<HeadlessHttpClient["client"]["provider"]["auth"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetProviderAuth, { parameters }, options)
      },
      oauth: {
        authorize(
          providerID: string,
          body?: Omit<Parameters<HeadlessHttpClient["client"]["provider"]["oauth"]["authorize"]>[0], "providerID" | "directory">,
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.ProviderOauthAuthorize, { providerID, body }, options)
        },
        callback(
          providerID: string,
          body?: Omit<Parameters<HeadlessHttpClient["client"]["provider"]["oauth"]["callback"]>[0], "providerID" | "directory">,
          options?: AxCodeGrpcCallOptions,
        ) {
          return value(AX_CODE_GRPC_METHOD.ProviderOauthCallback, { providerID, body }, options)
        },
      },
    },
    auth: {
      set(
        providerID: string,
        auth: NonNullable<Parameters<HeadlessHttpClient["client"]["auth"]["set"]>[0]>["auth"],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.SetAuth, { providerID, auth }, options)
      },
      remove(providerID: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RemoveAuth, { providerID }, options)
      },
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
    pty: {
      list(parameters?: { directory?: string }, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.ListPty, { parameters }, options)
      },
      create(body?: Parameters<HeadlessHttpClient["client"]["pty"]["create"]>[0], options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.CreatePty, { body }, options)
      },
      get(id: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.GetPty, { id }, options)
      },
      update(
        id: string,
        body: Omit<Parameters<HeadlessHttpClient["client"]["pty"]["update"]>[0], "ptyID" | "directory">,
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.UpdatePty, { id, body }, options)
      },
      remove(id: string, options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.RemovePty, { id }, options)
      },
      connect(
        id: string,
        events: AsyncIterable<AxCodeGrpcPtyClientEvent> = emptyAsyncIterable(),
        options?: AxCodeGrpcCallOptions & { cursor?: number },
      ) {
        if (!transport.bidiStream) throw new Error("AX Code gRPC transport does not support PTY streaming")
        return transport.bidiStream<AxCodeGrpcPtyConnectRequest, AxCodeGrpcPtyClientEvent, AxCodeGrpcPtyServerEvent>(
          AX_CODE_GRPC_METHOD.ConnectPty,
          { id, cursor: options?.cursor },
          events,
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
      dashboard(
        parameters?: Parameters<HeadlessHttpClient["workflowRun"]["dashboard"]>[0],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.WorkflowRunDashboard, { parameters }, options)
      },
      evalCases(options?: AxCodeGrpcCallOptions) {
        return value(AX_CODE_GRPC_METHOD.WorkflowRunEvalCases, {}, options)
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
      evalCase(
        runID: string,
        body?: Parameters<HeadlessHttpClient["workflowRun"]["evalCase"]>[1],
        options?: AxCodeGrpcCallOptions,
      ) {
        return value(AX_CODE_GRPC_METHOD.WorkflowRunEvalCase, { runID, body }, options)
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
    subscribeEvents(
      requestOrOptions?: AxCodeGrpcSubscribeEventsRequest | AxCodeGrpcCallOptions,
      maybeOptions?: AxCodeGrpcCallOptions,
    ): AsyncIterable<AxCodeGrpcRuntimeEvent> {
      const request = isCallOptions(requestOrOptions) ? {} : (requestOrOptions ?? {})
      const options = isCallOptions(requestOrOptions) ? requestOrOptions : maybeOptions
      return input.transport.serverStream<AxCodeGrpcSubscribeEventsRequest, AxCodeGrpcRuntimeEvent>(
        AX_CODE_GRPC_METHOD.SubscribeEvents,
        request,
        options,
      )
    },
  }
}

export function createAxCodeGrpcHttpBridge(input: AxCodeGrpcHttpBridgeOptions): AxCodeGrpcTransport {
  assertHttpBridgeBaseUrl(input)
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
      request: TRequest,
      options?: AxCodeGrpcCallOptions,
    ) {
      if (method !== AX_CODE_GRPC_METHOD.SubscribeEvents) throw new Error(`Unsupported AX Code gRPC stream: ${method}`)
      const client = clientFor(options)
      const filter = request as AxCodeGrpcSubscribeEventsRequest
      for await (const event of client.subscribe({ signal: options?.signal })) {
        if (!matchesEventSubscription(event, filter)) continue
        yield event as TResponse
      }
    },
    bidiStream<TRequest, TInput, TResponse>(
      method: AxCodeGrpcBidirectionalStreamingMethod,
      request: TRequest,
      stream: AsyncIterable<TInput>,
      options?: AxCodeGrpcCallOptions,
    ) {
      if (method !== AX_CODE_GRPC_METHOD.ConnectPty) throw new Error(`Unsupported AX Code gRPC stream: ${method}`)
      const body = request as AxCodeGrpcPtyConnectRequest
      return connectPtyOverWebSocket(input, clientFor(options), body, stream as AsyncIterable<AxCodeGrpcPtyClientEvent>, options) as AsyncIterable<TResponse>
    },
  }
}

export function createAxCodeGrpcClientFromHttp(input: AxCodeGrpcHttpBridgeOptions) {
  return createAxCodeGrpcClient({ transport: createAxCodeGrpcHttpBridge(input) })
}

export const createAxCodeGrpcHeadlessClient = createAxCodeGrpcClient

export function resolveAxCodeGrpcProtoUrl(baseUrl: string | URL = import.meta.url): URL {
  const moduleUrl = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl
  const relativePath = moduleUrl.pathname.includes("/dist/")
    ? `./${AX_CODE_GRPC_PROTO_PACKAGE_PATH}`
    : `../../${AX_CODE_GRPC_PROTO_PACKAGE_PATH}`
  return new URL(relativePath, moduleUrl)
}

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
    case AX_CODE_GRPC_METHOD.ListSessions:
      return wrap(unwrapHttpSdkResponse(await client.client.session.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetSessionStatus:
      return wrap(unwrapHttpSdkResponse(await client.client.session.status(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetSession:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.get({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.UpdateSession:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.session.update({ sessionID: body.sessionID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.DeleteSession:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.delete({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.ListSessionMessages:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.messages({ sessionID: body.sessionID, ...body.parameters })),
      )
    case AX_CODE_GRPC_METHOD.GetSessionMessage:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.session.message(
            { sessionID: body.sessionID, messageID: body.messageID },
            { throwOnError: true },
          ),
        ),
      )
    case AX_CODE_GRPC_METHOD.DeleteSessionMessage:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.session.deleteMessage(
            { sessionID: body.sessionID, messageID: body.messageID },
            { throwOnError: true },
          ),
        ),
      )
    case AX_CODE_GRPC_METHOD.ListSessionChildren:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.children({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.GetSessionGoal:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.goal({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.GetSessionTodo:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.todo({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.GetSessionDiff:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.diff({ sessionID: body.sessionID, ...body.parameters })),
      )
    case AX_CODE_GRPC_METHOD.ForkSession:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.session.fork({ sessionID: body.sessionID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.ShareSession:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.share({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.UnshareSession:
      return wrap(
        unwrapHttpSdkResponse(await client.client.session.unshare({ sessionID: body.sessionID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.SummarizeSession:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.session.summarize({ sessionID: body.sessionID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.ListAgents:
      return wrap(unwrapHttpSdkResponse(await client.client.app.agents(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListSkills:
      return wrap(unwrapHttpSdkResponse(await client.client.app.skills(body.parameters)))
    case AX_CODE_GRPC_METHOD.WriteAppLog:
      return wrap(unwrapHttpSdkResponse(await client.client.app.log(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.DisposeInstance:
      return wrap(unwrapHttpSdkResponse(await client.client.instance.dispose(undefined, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.RestartInstance:
      return wrap(unwrapHttpSdkResponse(await client.client.instance.restart(undefined, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ListProjects:
      return wrap(unwrapHttpSdkResponse(await client.client.project.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetCurrentProject:
      return wrap(unwrapHttpSdkResponse(await client.client.project.current(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetPath:
      return wrap(unwrapHttpSdkResponse(await client.client.path.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetVcs:
      return wrap(unwrapHttpSdkResponse(await client.client.vcs.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListCommands:
      return wrap(unwrapHttpSdkResponse(await client.client.command.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetProjectContext:
      return wrap(unwrapHttpSdkResponse(await client.client.app.context(body.parameters)))
    case AX_CODE_GRPC_METHOD.CreateProjectContextTemplate:
      return wrap(
        unwrapHttpSdkResponse(await client.client.app.contextTemplateCreate(body.body, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.WarmupProjectMemory:
      return wrap(unwrapHttpSdkResponse(await client.client.app.contextMemoryWarmup(undefined, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ClearProjectMemory:
      return wrap(unwrapHttpSdkResponse(await client.client.app.contextMemoryClear(undefined, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetDebugEnginePendingPlans:
      return wrap(unwrapHttpSdkResponse(await client.client.debugEngine.pendingPlans(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListFiles:
      return wrap(unwrapHttpSdkResponse(await client.client.file.list(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ReadFile:
      return wrap(unwrapHttpSdkResponse(await client.client.file.read(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetFileStatus:
      return wrap(unwrapHttpSdkResponse(await client.client.file.status(body.parameters)))
    case AX_CODE_GRPC_METHOD.FindText:
      return wrap(unwrapHttpSdkResponse(await client.client.find.text(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.FindFiles:
      return wrap(unwrapHttpSdkResponse(await client.client.find.files(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.FindSymbols:
      return wrap(unwrapHttpSdkResponse(await client.client.find.symbols(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ListToolIDs:
      return wrap(unwrapHttpSdkResponse(await client.client.tool.ids(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListTools:
      return wrap(unwrapHttpSdkResponse(await client.client.tool.list(body.parameters, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ListPermissions:
      return wrap(unwrapHttpSdkResponse(await client.client.permission.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.ReplyPermission:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.permission.reply({ requestID: body.requestID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.ListQuestions:
      return wrap(unwrapHttpSdkResponse(await client.client.question.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.ReplyQuestion:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.question.reply({ requestID: body.requestID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.RejectQuestion:
      return wrap(
        unwrapHttpSdkResponse(await client.client.question.reject({ requestID: body.requestID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.GetConfig:
      return wrap(unwrapHttpSdkResponse(await client.client.config.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.UpdateConfig:
      return wrap(unwrapHttpSdkResponse(await client.client.config.update(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.ListConfigProviders:
      return wrap(unwrapHttpSdkResponse(await client.client.config.providers(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetAutonomousMode:
      return wrap(unwrapHttpSdkResponse(await client.client.autonomous.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.SetAutonomousMode:
      return wrap(unwrapHttpSdkResponse(await client.client.autonomous.set(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetIsolationMode:
      return wrap(unwrapHttpSdkResponse(await client.client.isolation.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.SetIsolationMode:
      return wrap(unwrapHttpSdkResponse(await client.client.isolation.set(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetSmartLlmRouting:
      return wrap(unwrapHttpSdkResponse(await client.client.smartLlm.get(body.parameters)))
    case AX_CODE_GRPC_METHOD.SetSmartLlmRouting:
      return wrap(unwrapHttpSdkResponse(await client.client.smartLlm.set(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetMcpStatus:
      return wrap(unwrapHttpSdkResponse(await client.client.mcp.status(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListMcpResources:
      return wrap(unwrapHttpSdkResponse(await client.client.experimental.resource.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.AddMcpServer:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.mcp.add({ name: body.name, config: body.config }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.StartMcpAuth:
      return wrap(
        unwrapHttpSdkResponse(await client.client.mcp.auth.start({ name: body.name }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.CompleteMcpAuth:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.mcp.auth.callback({ name: body.name, code: body.code }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.AuthenticateMcp:
      return wrap(
        unwrapHttpSdkResponse(await client.client.mcp.auth.authenticate({ name: body.name }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.RemoveMcpAuth:
      return wrap(
        unwrapHttpSdkResponse(await client.client.mcp.auth.remove({ name: body.name }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.ConnectMcp:
      return wrap(
        unwrapHttpSdkResponse(await client.client.mcp.connect({ name: body.name }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.DisconnectMcp:
      return wrap(
        unwrapHttpSdkResponse(await client.client.mcp.disconnect({ name: body.name }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.ListProviders:
      return wrap(unwrapHttpSdkResponse(await client.client.provider.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetProviderAuth:
      return wrap(unwrapHttpSdkResponse(await client.client.provider.auth(body.parameters)))
    case AX_CODE_GRPC_METHOD.SetAuth:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.auth.set({ providerID: body.providerID, auth: body.auth }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.RemoveAuth:
      return wrap(
        unwrapHttpSdkResponse(await client.client.auth.remove({ providerID: body.providerID }, { throwOnError: true })),
      )
    case AX_CODE_GRPC_METHOD.ProviderOauthAuthorize:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.provider.oauth.authorize(
            { providerID: body.providerID, ...body.body },
            { throwOnError: true },
          ),
        ),
      )
    case AX_CODE_GRPC_METHOD.ProviderOauthCallback:
      return wrap(
        unwrapHttpSdkResponse(
          await client.client.provider.oauth.callback({ providerID: body.providerID, ...body.body }, { throwOnError: true }),
        ),
      )
    case AX_CODE_GRPC_METHOD.GetLspStatus:
      return wrap(unwrapHttpSdkResponse(await client.client.lsp.status(body.parameters)))
    case AX_CODE_GRPC_METHOD.GetFormatterStatus:
      return wrap(unwrapHttpSdkResponse(await client.client.formatter.status(body.parameters)))
    case AX_CODE_GRPC_METHOD.ListPty:
      return wrap(unwrapHttpSdkResponse(await client.client.pty.list(body.parameters)))
    case AX_CODE_GRPC_METHOD.CreatePty:
      return wrap(unwrapHttpSdkResponse(await client.client.pty.create(body.body, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.GetPty:
      return wrap(unwrapHttpSdkResponse(await client.client.pty.get({ ptyID: body.id }, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.UpdatePty:
      return wrap(unwrapHttpSdkResponse(await client.client.pty.update({ ptyID: body.id, ...body.body }, { throwOnError: true })))
    case AX_CODE_GRPC_METHOD.RemovePty:
      return wrap(unwrapHttpSdkResponse(await client.client.pty.remove({ ptyID: body.id }, { throwOnError: true })))
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
    case AX_CODE_GRPC_METHOD.WorkflowRunDashboard:
      return wrap(await client.workflowRun.dashboard(body.parameters))
    case AX_CODE_GRPC_METHOD.WorkflowRunEvalCases:
      return wrap(await client.workflowRun.evalCases())
    case AX_CODE_GRPC_METHOD.CreateWorkflowRun:
      return wrap(await client.workflowRun.create(body.body))
    case AX_CODE_GRPC_METHOD.GetWorkflowRun:
      return wrap(await client.workflowRun.get(body.runID))
    case AX_CODE_GRPC_METHOD.WorkflowRunArtifacts:
      return wrap(await client.workflowRun.artifacts(body.runID, body.parameters))
    case AX_CODE_GRPC_METHOD.WorkflowRunEvalSummary:
      return wrap(await client.workflowRun.evalSummary(body.runID, body.body))
    case AX_CODE_GRPC_METHOD.WorkflowRunEvalCase:
      return wrap(await client.workflowRun.evalCase(body.runID, body.body))
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

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {}

function assertHttpBridgeBaseUrl(input: AxCodeGrpcHttpBridgeOptions) {
  if (input.allowRemoteHttpBridge) return
  const url = new URL(input.baseUrl)
  if (!isLoopbackHttpUrl(url)) {
    throw new Error(
      "AX Code gRPC HTTP bridge only accepts loopback HTTP base URLs by default. " +
        "Use a native bridge for desktop hosts, or set allowRemoteHttpBridge: true only for a trusted remote server.",
    )
  }
}

function isLoopbackHttpUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  return isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return normalized === "localhost" || normalized === "::1" || isIpv4Loopback(normalized)
}

function isIpv4Loopback(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function isCallOptions(input: AxCodeGrpcSubscribeEventsRequest | AxCodeGrpcCallOptions | undefined): input is AxCodeGrpcCallOptions {
  if (!input || typeof input !== "object") return false
  return "metadata" in input || "signal" in input || "timeoutMs" in input
}

function matchesEventSubscription(event: AxCodeGrpcRuntimeEvent, request: AxCodeGrpcSubscribeEventsRequest = {}) {
  if (request.types?.length && !request.types.includes(event.type)) return false
  if (!request.sessionID) return true
  if (event.type === "server.connected" || event.type === "server.heartbeat" || event.type === "server.instance.disposed") {
    return true
  }
  return eventSessionID(event) === request.sessionID
}

function eventSessionID(event: AxCodeGrpcRuntimeEvent) {
  const properties = event.properties
  if (!properties || typeof properties !== "object") return undefined
  if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID
  if ("info" in properties && properties.info && typeof properties.info === "object" && "sessionID" in properties.info) {
    const sessionID = properties.info.sessionID
    return typeof sessionID === "string" ? sessionID : undefined
  }
  if ("info" in properties && properties.info && typeof properties.info === "object" && "id" in properties.info) {
    const id = properties.info.id
    return typeof id === "string" ? id : undefined
  }
  if ("item" in properties && properties.item && typeof properties.item === "object" && "sessionID" in properties.item) {
    const sessionID = properties.item.sessionID
    return typeof sessionID === "string" ? sessionID : undefined
  }
  return undefined
}

function nativeHandlerContext<TMethod extends AxCodeGrpcMethod>(
  call: {
    method: TMethod
    metadata?: AxCodeGrpcMetadata
    signal?: AbortSignal
    timeoutMs?: number
  },
): AxCodeGrpcNativeHandlerContext<TMethod> {
  return {
    method: call.method,
    metadata: call.metadata,
    signal: call.signal,
    timeoutMs: call.timeoutMs,
  }
}

function missingNativeHandler(kind: string, method: AxCodeGrpcMethod) {
  return new Error(`Unsupported AX Code gRPC ${kind} method: ${method}`)
}

function connectPtyOverWebSocket(
  input: AxCodeGrpcHttpBridgeOptions,
  client: HeadlessHttpClient,
  request: AxCodeGrpcPtyConnectRequest,
  stream: AsyncIterable<AxCodeGrpcPtyClientEvent>,
  options: AxCodeGrpcCallOptions | undefined,
): AsyncIterable<AxCodeGrpcPtyServerEvent> {
  const queue = createAsyncQueue<AxCodeGrpcPtyServerEvent>()
  const socket = createPtyWebSocket(input, request)
  socket.binaryType = "arraybuffer"
  let opened = false
  let closed = false

  const close = (code?: number, reason?: string) => {
    if (closed) return
    closed = true
    try {
      socket.close(code, reason)
    } catch {}
    queue.close()
  }
  const onAbort = () => close(1000, "aborted")
  options?.signal?.addEventListener("abort", onAbort, { once: true })
  if (options?.signal?.aborted) onAbort()

  setSocketHandler(socket, "open", () => {
    opened = true
    void pumpPtyClientEvents(client, request.id, socket, stream, options).catch((error) => {
      queue.fail(error)
      close(1011, "client stream failed")
    })
  })
  setSocketHandler(socket, "message", (event) => {
    const parsed = parsePtyServerEvent(event.data)
    if (parsed) queue.push(parsed)
  })
  setSocketHandler(socket, "error", () => {
    queue.fail(new Error("AX Code PTY WebSocket failed"))
    close(1011, "websocket failed")
  })
  setSocketHandler(socket, "close", (event) => {
    if (!opened) queue.fail(new Error("AX Code PTY WebSocket closed before opening"))
    queue.push({ type: "closed", code: event.code, reason: event.reason })
    options?.signal?.removeEventListener("abort", onAbort)
    queue.close()
  })

  return queue.iterable
}

function createPtyWebSocket(input: AxCodeGrpcHttpBridgeOptions, request: AxCodeGrpcPtyConnectRequest) {
  const url = new URL(`/pty/${encodeURIComponent(request.id)}/connect`, input.baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (request.cursor !== undefined) url.searchParams.set("cursor", String(request.cursor))
  applyBasicAuthUserInfo(url, input.headers)
  const factory = input.webSocketFactory ?? defaultWebSocketFactory
  return factory(url.toString())
}

async function pumpPtyClientEvents(
  client: HeadlessHttpClient,
  ptyID: string,
  socket: AxCodeGrpcWebSocketLike,
  stream: AsyncIterable<AxCodeGrpcPtyClientEvent>,
  options: AxCodeGrpcCallOptions | undefined,
) {
  for await (const event of stream) {
    if (options?.signal?.aborted) return
    if (typeof event === "string") {
      socket.send(event)
      continue
    }
    switch (event.type) {
      case "input":
        socket.send(event.data)
        break
      case "resize":
        await client.client.pty.update({ ptyID, size: { cols: event.cols, rows: event.rows } }, { throwOnError: true })
        break
      case "close":
        socket.close(event.code, event.reason)
        return
    }
  }
}

function parsePtyServerEvent(data: unknown): AxCodeGrpcPtyServerEvent | undefined {
  if (typeof data === "string") return { type: "output", data }
  const bytes = bytesFromPtyMessage(data)
  if (!bytes) return
  if (bytes[0] === 0) {
    const json = new TextDecoder().decode(bytes.slice(1))
    return { type: "replay", ...(JSON.parse(json) as Omit<Extract<AxCodeGrpcPtyServerEvent, { type: "replay" }>, "type">) }
  }
  return { type: "output", data: new TextDecoder().decode(bytes) }
}

function bytesFromPtyMessage(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

function setSocketHandler(
  socket: AxCodeGrpcWebSocketLike,
  type: "open" | "message" | "error" | "close",
  listener: (event: any) => void,
) {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener)
    return
  }
  switch (type) {
    case "open":
      socket.onopen = listener
      break
    case "message":
      socket.onmessage = listener
      break
    case "error":
      socket.onerror = listener
      break
    case "close":
      socket.onclose = listener
      break
  }
}

function defaultWebSocketFactory(url: string): AxCodeGrpcWebSocketLike {
  const ctor = globalThis.WebSocket
  if (!ctor) throw new Error("AX Code PTY streaming requires a WebSocket implementation")
  return new ctor(url) as unknown as AxCodeGrpcWebSocketLike
}

function applyBasicAuthUserInfo(url: URL, headers: RequestInit["headers"] | undefined) {
  const auth = headerValue(headers, "authorization")
  if (!auth?.toLowerCase().startsWith("basic ")) return
  const decoded = decodeBase64(auth.slice("basic ".length).trim())
  const split = decoded?.indexOf(":") ?? -1
  if (!decoded || split < 0) return
  url.username = decoded.slice(0, split)
  url.password = decoded.slice(split + 1)
}

function decodeBase64(value: string) {
  try {
    return atob(value)
  } catch {
    return undefined
  }
}

function headerValue(headers: RequestInit["headers"] | undefined, name: string) {
  if (!headers) return
  const lower = name.toLowerCase()
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === lower)?.[1]
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lower)?.[1]
}

function createAsyncQueue<T>() {
  const values: T[] = []
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  let closed = false
  let failure: unknown

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length) return Promise.resolve({ value: values.shift() as T, done: false })
    if (failure) return Promise.reject(failure)
    if (closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
  }

  const flush = () => {
    while (waiters.length && values.length) {
      waiters.shift()!.resolve({ value: values.shift() as T, done: false })
    }
    if (failure) {
      while (waiters.length) waiters.shift()!.reject(failure)
      return
    }
    if (closed) {
      while (waiters.length) waiters.shift()!.resolve({ value: undefined, done: true })
    }
  }

  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return { next }
      },
    } satisfies AsyncIterable<T>,
    push(value: T) {
      if (closed || failure) return
      values.push(value)
      flush()
    },
    close() {
      closed = true
      flush()
    },
    fail(error: unknown) {
      failure = error
      flush()
    },
  }
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
