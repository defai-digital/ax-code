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
  smartLlmTask: BootstrapTask
}

export function createStoreBackedBootstrapTasks<TStore extends SyncBootstrapAssemblyStoreState>(input: {
  continueFromArgs: boolean
  store: TStore
  setStore: SetStoreFunction<TStore>
  requests: SyncBootstrapAssemblyRequests
  onProvidersReady?: (failed: boolean) => void
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<SyncBootstrapAssemblyStoreState>

  const sessionTasks = createSessionBootstrapPhaseTasks({
    continueFromArgs: input.continueFromArgs,
    sessionListPromise: input.requests.sessionListPromise,
    existingSessions: input.store.session,
    applySessions: (sessions) => setStore("session", reconcile(sessions)),
  })

  return {
    blockingTasks: sessionTasks.blocking,
    coreTasks: createCoreBootstrapPhaseTasks({
      providerTask: createProviderBootstrapTask({
        providersPromise: input.requests.providersPromise,
        applyState(next) {
          setStore(
            produce((draft) => {
              applyProviderBootstrapState(draft, next)
            }),
          )
        },
        onReady: input.onProvidersReady,
      }),
      providerListPromise: input.requests.providerListPromise,
      providerNextFallback: input.store.provider_next,
      applyProviderNext: (value) => setStore("provider_next", reconcile(value)),
      agentsPromise: input.requests.agentsPromise,
      applyAgents: (value) => setStore("agent", reconcile(value)),
      configPromise: input.requests.configPromise,
      configFallback: input.store.config,
      applyConfig: (value) => setStore("config", reconcile(value)),
      commandPromise: input.requests.commandPromise,
      applyCommands: (value) => setStore("command", reconcile(value)),
      sessionTasks: sessionTasks.core,
      permissionPromise: input.requests.permissionPromise,
      applyPermission: (value) => setStore("permission", reconcile(value)),
      questionPromise: input.requests.questionPromise,
      applyQuestion: (value) => setStore("question", reconcile(value)),
      sessionStatusPromise: input.requests.sessionStatusPromise,
      applySessionStatus: (value) => setStore("session_status", reconcile(value)),
      providerAuthPromise: input.requests.providerAuthPromise,
      applyProviderAuth: (value) => setStore("provider_auth", reconcile(value)),
      pathPromise: input.requests.pathPromise,
      pathFallback: input.store.path,
      applyPath: (value) => setStore("path", reconcile(value)),
      isolationTask: input.requests.isolationTask,
      autonomousTask: input.requests.autonomousTask,
    }),
    deferredTasks: createDeferredBootstrapPhaseTasks({
      lspPromise: input.requests.lspPromise,
      applyLsp: (value) => setStore("lsp", reconcile(value)),
      mcpPromise: input.requests.mcpPromise,
      applyMcp: (value) => setStore("mcp", reconcile(value)),
      resourcePromise: input.requests.resourcePromise,
      applyResources: (value) => setStore("mcp_resource", reconcile(value)),
      formatterPromise: input.requests.formatterPromise,
      applyFormatter: (value) => setStore("formatter", reconcile(value)),
      vcsPromise: input.requests.vcsPromise,
      vcsFallback: input.store.vcs,
      applyVcs: (value) => setStore("vcs", reconcile(value)),
      workspacesTask: input.requests.workspacesTask,
      debugEngineTask: input.requests.debugEngineTask,
      smartLlmTask: input.requests.smartLlmTask,
    }),
  }
}
