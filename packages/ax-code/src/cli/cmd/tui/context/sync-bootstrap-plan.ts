import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  PermissionRequest,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  SessionStatus,
  VcsInfo,
} from "@ax-code/sdk/v2"
import type { Path } from "@ax-code/sdk"
import {
  createProviderBootstrapFailure,
  createProviderBootstrapSuccess,
  mergeBootstrapSessions,
  normalizeBootstrapList,
  normalizeBootstrapRecord,
  normalizeBootstrapSessionBuckets,
  normalizeBootstrapValue,
} from "./sync-bootstrap-store"
import type { BootstrapResponse, BootstrapTask } from "./sync-bootstrap-task"
import { createBootstrapResponseTask, createBootstrapTask } from "./sync-bootstrap-task"

export interface BootstrapResponseTaskPlan<TInput, TOutput> {
  request: () => Promise<BootstrapResponse<TInput>>
  normalize: (value: TInput | undefined) => TOutput
  apply: (value: TOutput) => void
}

export function createBootstrapResponsePlanTasks<
  const TPlans extends readonly BootstrapResponseTaskPlan<any, any>[],
>(
  ...plans: TPlans
) {
  const tasks: BootstrapTask[] = []

  for (const plan of plans as readonly BootstrapResponseTaskPlan<any, any>[]) {
    tasks.push(
      createBootstrapResponseTask(
        plan.request,
        plan.normalize,
        plan.apply,
      ),
    )
  }

  return tasks
}

export function createSessionBootstrapPhaseTasks<T extends { id: string }>(input: {
  continueFromArgs: boolean
  sessionListPromise: () => Promise<T[]>
  existingSessions: T[]
  applySessions: (sessions: T[]) => void
}) {
  const task = createBootstrapTask(
    input.sessionListPromise,
    (sessions) => mergeBootstrapSessions(input.existingSessions, sessions),
    input.applySessions,
  )

  return input.continueFromArgs
    ? { blocking: [task], core: [] }
    : { blocking: [], core: [task] }
}

export function createProviderBootstrapTask<T>(input: {
  providersPromise: () => Promise<BootstrapResponse<{ providers: T[]; default: Record<string, string> }>>
  applyState: (value: ReturnType<typeof createProviderBootstrapSuccess<T>> | ReturnType<typeof createProviderBootstrapFailure>) => void
  onReady?: (failed: boolean) => void
}) {
  return () =>
    input.providersPromise()
      .then((response) => normalizeBootstrapValue(response.data, { providers: [], default: {} }))
      .then((providers) => {
        input.applyState(createProviderBootstrapSuccess(providers))
        input.onReady?.(false)
      })
      .catch((error) => {
        input.applyState(createProviderBootstrapFailure())
        input.onReady?.(true)
        throw error
      })
}

export function createCoreBootstrapPhaseTasks(input: {
  providerTask: BootstrapTask
  providerListPromise: () => Promise<BootstrapResponse<ProviderListResponse>>
  providerNextFallback: ProviderListResponse
  applyProviderNext: (value: ProviderListResponse) => void
  agentsPromise: () => Promise<BootstrapResponse<Agent[]>>
  applyAgents: (value: Agent[]) => void
  configPromise: () => Promise<BootstrapResponse<Config>>
  configFallback: Config
  applyConfig: (value: Config) => void
  commandPromise: () => Promise<BootstrapResponse<Command[]>>
  applyCommands: (value: Command[]) => void
  sessionTasks: BootstrapTask[]
  permissionPromise: () => Promise<BootstrapResponse<PermissionRequest[]>>
  applyPermission: (value: Record<string, PermissionRequest[]>) => void
  questionPromise: () => Promise<BootstrapResponse<QuestionRequest[]>>
  applyQuestion: (value: Record<string, QuestionRequest[]>) => void
  sessionStatusPromise: () => Promise<BootstrapResponse<Record<string, SessionStatus>>>
  applySessionStatus: (value: Record<string, SessionStatus>) => void
  providerAuthPromise: () => Promise<BootstrapResponse<Record<string, ProviderAuthMethod[]>>>
  applyProviderAuth: (value: Record<string, ProviderAuthMethod[]>) => void
  pathPromise: () => Promise<BootstrapResponse<Path>>
  pathFallback: Path
  applyPath: (value: Path) => void
  isolationTask: BootstrapTask
  autonomousTask: BootstrapTask
}) {
  return [
    input.providerTask,
    ...createBootstrapResponsePlanTasks(
      {
        request: input.providerListPromise,
        normalize: (data) => normalizeBootstrapValue(data, input.providerNextFallback),
        apply: input.applyProviderNext,
      },
      {
        request: input.agentsPromise,
        normalize: normalizeBootstrapList,
        apply: input.applyAgents,
      },
      {
        request: input.configPromise,
        normalize: (data) => normalizeBootstrapValue(data, input.configFallback),
        apply: input.applyConfig,
      },
      {
        request: input.commandPromise,
        normalize: normalizeBootstrapList,
        apply: input.applyCommands,
      },
    ),
    ...input.sessionTasks,
    ...createBootstrapResponsePlanTasks(
      {
        request: input.permissionPromise,
        normalize: normalizeBootstrapSessionBuckets,
        apply: input.applyPermission,
      },
      {
        request: input.questionPromise,
        normalize: normalizeBootstrapSessionBuckets,
        apply: input.applyQuestion,
      },
      {
        request: input.sessionStatusPromise,
        normalize: normalizeBootstrapRecord,
        apply: input.applySessionStatus,
      },
      {
        request: input.providerAuthPromise,
        normalize: normalizeBootstrapRecord,
        apply: input.applyProviderAuth,
      },
      {
        request: input.pathPromise,
        normalize: (data) => normalizeBootstrapValue(data, input.pathFallback),
        apply: input.applyPath,
      },
    ),
    input.isolationTask,
    input.autonomousTask,
  ]
}

export function createDeferredBootstrapPhaseTasks(input: {
  lspPromise: () => Promise<BootstrapResponse<LspStatus[]>>
  applyLsp: (value: LspStatus[]) => void
  mcpPromise: () => Promise<BootstrapResponse<Record<string, McpStatus>>>
  applyMcp: (value: Record<string, McpStatus>) => void
  resourcePromise: () => Promise<BootstrapResponse<Record<string, McpResource>>>
  applyResources: (value: Record<string, McpResource>) => void
  formatterPromise: () => Promise<BootstrapResponse<FormatterStatus[]>>
  applyFormatter: (value: FormatterStatus[]) => void
  vcsPromise: () => Promise<BootstrapResponse<VcsInfo | undefined>>
  vcsFallback: VcsInfo | undefined
  applyVcs: (value: VcsInfo | undefined) => void
  workspacesTask: BootstrapTask
  debugEngineTask: BootstrapTask
  smartLlmTask: BootstrapTask
}) {
  return [
    ...createBootstrapResponsePlanTasks(
      {
        request: input.lspPromise,
        normalize: normalizeBootstrapList,
        apply: input.applyLsp,
      },
      {
        request: input.mcpPromise,
        normalize: normalizeBootstrapRecord,
        apply: input.applyMcp,
      },
      {
        request: input.resourcePromise,
        normalize: normalizeBootstrapRecord,
        apply: input.applyResources,
      },
      {
        request: input.formatterPromise,
        normalize: normalizeBootstrapList,
        apply: input.applyFormatter,
      },
      {
        request: input.vcsPromise,
        normalize: (data) => normalizeBootstrapValue(data, input.vcsFallback),
        apply: input.applyVcs,
      },
    ),
    input.workspacesTask,
    input.debugEngineTask,
    input.smartLlmTask,
  ]
}
