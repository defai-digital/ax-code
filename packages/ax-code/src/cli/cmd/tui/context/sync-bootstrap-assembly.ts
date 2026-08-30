import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  VcsInfo,
} from "@ax-code/sdk/v2"
import type { Path } from "@ax-code/sdk"
import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import {
  createCoreBootstrapPhaseTasks,
  createDeferredBootstrapPhaseTasks,
  createProviderBootstrapTask,
  createSessionBootstrapPhaseTasks,
} from "./sync-bootstrap-plan"
import { applyProviderBootstrapState } from "./sync-bootstrap-store"
import type { BootstrapResponse, BootstrapTask } from "./sync-bootstrap-task"
import { pruneOrphanSessionRecords } from "./sync-session-store"

export interface SyncBootstrapAssemblyStoreState {
  provider: Provider[]
  provider_loaded: boolean
  provider_failed: boolean
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: Agent[]
  command: Command[]
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  config: Config
  session: Session[]
  session_status: Record<string, SessionStatus>
  lsp: LspStatus[]
  mcp: Record<string, McpStatus>
  mcp_resource: Record<string, McpResource>
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
  path: Path
}

export interface SyncBootstrapAssemblyRequests {
  sessionListPromise: () => Promise<Session[]>
  providersPromise: () => Promise<BootstrapResponse<{ providers: Provider[]; default: Record<string, string> }>>
  providerListPromise: () => Promise<BootstrapResponse<ProviderListResponse>>
  agentsPromise: () => Promise<BootstrapResponse<Agent[]>>
  configPromise: () => Promise<BootstrapResponse<Config>>
  commandPromise: () => Promise<BootstrapResponse<Command[]>>
  permissionPromise: () => Promise<BootstrapResponse<PermissionRequest[]>>
  questionPromise: () => Promise<BootstrapResponse<QuestionRequest[]>>
  sessionStatusPromise: () => Promise<BootstrapResponse<Record<string, SessionStatus>>>
  providerAuthPromise: () => Promise<BootstrapResponse<Record<string, ProviderAuthMethod[]>>>
  pathPromise: () => Promise<BootstrapResponse<Path>>
  isolationTask: BootstrapTask
  autonomousTask: BootstrapTask
  lspPromise: () => Promise<BootstrapResponse<LspStatus[]>>
  mcpPromise: () => Promise<BootstrapResponse<Record<string, McpStatus>>>
  resourcePromise: () => Promise<BootstrapResponse<Record<string, McpResource>>>
  formatterPromise: () => Promise<BootstrapResponse<FormatterStatus[]>>
  vcsPromise: () => Promise<BootstrapResponse<VcsInfo | undefined>>
  workspacesTask: BootstrapTask
  debugEngineTask: BootstrapTask
  workflowDashboardTask: BootstrapTask
  smartLlmTask: BootstrapTask
  superLongTask: BootstrapTask
}

export function createStoreBackedBootstrapTasks<TStore extends SyncBootstrapAssemblyStoreState>(input: {
  continueFromArgs: boolean
  store: TStore
  setStore: SetStoreFunction<TStore>
  requests: SyncBootstrapAssemblyRequests
  onProvidersReady?: (failed: boolean) => void
  // Deferred tasks (lsp/mcp/resource/formatter/vcs) keep running in the
  // background after the run() that created them has already returned
  // (sync-bootstrap-flow.ts schedules them via scheduleBackground and does
  // not await them). If the user switches session/workspace in the meantime,
  // sdk.setWorkspace() swaps in a new client and a later bootstrap run
  // applies fresh data — a slow response from the old run must not then land
  // and silently revert it. Defaults to always-current for callers (tests)
  // that don't care about this race.
  isRequestCurrent?: () => boolean
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<SyncBootstrapAssemblyStoreState>
  const isRequestCurrent = input.isRequestCurrent ?? (() => true)
  function guarded<T>(apply: (value: T) => void): (value: T) => void {
    return (value) => {
      if (!isRequestCurrent()) return
      apply(value)
    }
  }

  const sessionTasks = createSessionBootstrapPhaseTasks({
    continueFromArgs: input.continueFromArgs,
    sessionListPromise: input.requests.sessionListPromise,
    getExistingSessions: () => input.store.session,
    applySessions: guarded((sessions) => {
      setStore("session", reconcile(sessions))
      // Drop projection for sessions no longer in the list so long-running
      // TUI processes do not retain unbounded message/part maps (STAB-03).
      setStore(
        produce((draft) => {
          pruneOrphanSessionRecords(draft as any)
        }),
      )
    }),
  })

  return {
    blockingTasks: sessionTasks.blocking,
    coreTasks: createCoreBootstrapPhaseTasks({
      providerTask: createProviderBootstrapTask({
        providersPromise: input.requests.providersPromise,
        applyState: guarded((next) => {
          setStore(
            produce((draft) => {
              applyProviderBootstrapState(draft, next)
            }),
          )
        }),
        onReady: input.onProvidersReady,
      }),
      providerListPromise: input.requests.providerListPromise,
      providerNextFallback: input.store.provider_next,
      applyProviderNext: guarded((value) => setStore("provider_next", reconcile(value))),
      agentsPromise: input.requests.agentsPromise,
      applyAgents: guarded((value) => setStore("agent", reconcile(value))),
      configPromise: input.requests.configPromise,
      configFallback: input.store.config,
      applyConfig: guarded((value) => setStore("config", reconcile(value))),
      commandPromise: input.requests.commandPromise,
      applyCommands: guarded((value) => setStore("command", reconcile(value))),
      sessionTasks: sessionTasks.core,
      permissionPromise: input.requests.permissionPromise,
      applyPermission: guarded((value) => setStore("permission", reconcile(value))),
      questionPromise: input.requests.questionPromise,
      applyQuestion: guarded((value) => setStore("question", reconcile(value))),
      sessionStatusPromise: input.requests.sessionStatusPromise,
      applySessionStatus: guarded((value) => setStore("session_status", reconcile(value))),
      providerAuthPromise: input.requests.providerAuthPromise,
      applyProviderAuth: guarded((value) => setStore("provider_auth", reconcile(value))),
      pathPromise: input.requests.pathPromise,
      pathFallback: input.store.path,
      applyPath: guarded((value) => setStore("path", reconcile(value))),
      isolationTask: input.requests.isolationTask,
      autonomousTask: input.requests.autonomousTask,
    }),
    deferredTasks: createDeferredBootstrapPhaseTasks({
      lspPromise: input.requests.lspPromise,
      applyLsp: guarded((value) => setStore("lsp", reconcile(value))),
      mcpPromise: input.requests.mcpPromise,
      applyMcp: guarded((value) => setStore("mcp", reconcile(value))),
      resourcePromise: input.requests.resourcePromise,
      applyResources: guarded((value) => setStore("mcp_resource", reconcile(value))),
      formatterPromise: input.requests.formatterPromise,
      applyFormatter: guarded((value) => setStore("formatter", reconcile(value))),
      vcsPromise: input.requests.vcsPromise,
      vcsFallback: input.store.vcs,
      applyVcs: guarded((value) => setStore("vcs", reconcile(value))),
      workspacesTask: input.requests.workspacesTask,
      debugEngineTask: input.requests.debugEngineTask,
      workflowDashboardTask: input.requests.workflowDashboardTask,
      smartLlmTask: input.requests.smartLlmTask,
      superLongTask: input.requests.superLongTask,
    }),
  }
}
