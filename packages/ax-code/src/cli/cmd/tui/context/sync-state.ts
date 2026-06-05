import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@ax-code/sdk/v2"
import type { Path } from "@ax-code/sdk"
import type { SessionGoal } from "@/session/goal"
import type { Snapshot } from "@/snapshot"
import { Flag } from "@/flag/flag"
import type { SyncedSessionRisk } from "./sync-session-risk"
import { emptyWorkflowDashboardState, type WorkflowDashboardState } from "./sync-runtime-store"

type SyncTaskQueueItem = { id: string; sessionID?: string } & Record<string, unknown>

export interface SyncStoreState {
  status: "loading" | "partial" | "complete"
  session_loaded: boolean
  provider: Provider[]
  provider_loaded: boolean
  provider_failed: boolean
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: Agent[]
  command: Command[]
  stream_health: "fixture" | "connecting" | "connected" | "unavailable" | "error"
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  config: Config
  session: Session[]
  session_status: Record<string, SessionStatus>
  session_error: Record<string, unknown>
  session_risk: Record<string, SyncedSessionRisk>
  session_goal: Record<string, SessionGoal.PublicInfo | null>
  task_queue: SyncTaskQueueItem[]
  session_diff: Record<string, Snapshot.FileDiff[]>
  todo: Record<string, Todo[]>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  lsp: LspStatus[]
  debugEngine: {
    pendingPlans: number
    plans: Array<{
      planId: string
      kind: string
      risk: string
      summary: string
      affectedFileCount: number
      affectedSymbolCount: number
      timeCreated: number
    }>
    toolCount: number
    graph: {
      nodeCount: number
      edgeCount: number
      lastIndexedAt: number | null
      state: "idle" | "indexing" | "failed"
      completed: number
      total: number
      error: string | null
    }
  }
  workflowDashboard: WorkflowDashboardState
  isolation: {
    mode: "read-only" | "workspace-write" | "full-access"
    network: boolean
  }
  autonomous: boolean
  smartLlm: boolean
  superLong: boolean
  mcp: Record<string, McpStatus>
  mcp_resource: Record<string, McpResource>
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
  path: Path
  workspaceList: string[]
}

export function createInitialSyncState(): SyncStoreState {
  return {
    provider_next: {
      all: [],
      default: {},
      connected: [],
    },
    session_loaded: false,
    provider_loaded: false,
    provider_failed: false,
    provider_auth: {},
    config: {},
    status: "loading",
    agent: [],
    stream_health: "connecting",
    permission: {},
    question: {},
    command: [],
    provider: [],
    provider_default: {},
    session: [],
    session_status: {},
    session_error: {},
    session_risk: {},
    session_goal: {},
    task_queue: [],
    session_diff: {},
    todo: {},
    message: {},
    part: {},
    lsp: [],
    debugEngine: {
      pendingPlans: 0,
      plans: [],
      toolCount: 0,
      graph: {
        nodeCount: 0,
        edgeCount: 0,
        lastIndexedAt: null,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      },
    },
    workflowDashboard: emptyWorkflowDashboardState(),
    isolation: {
      mode: Flag.AX_CODE_ISOLATION_MODE ?? "workspace-write",
      network: Flag.AX_CODE_ISOLATION_NETWORK ?? false,
    },
    autonomous: true,
    smartLlm: false,
    superLong: false,
    mcp: {},
    mcp_resource: {},
    formatter: [],
    vcs: undefined,
    path: { home: "", state: "", config: "", worktree: "", directory: "" },
    workspaceList: [],
  }
}
