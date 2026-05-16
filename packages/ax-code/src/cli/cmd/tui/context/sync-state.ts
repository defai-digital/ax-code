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
import type { Snapshot } from "@/snapshot"
import type { SyncedSessionRisk } from "./sync-session-risk"

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
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  config: Config
  session: Session[]
  session_status: Record<string, SessionStatus>
  session_risk: Record<string, SyncedSessionRisk>
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
  isolation: {
    mode: "read-only" | "workspace-write" | "full-access"
    network: boolean
  }
  autonomous: boolean
  smartLlm: boolean
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
    permission: {},
    question: {},
    command: [],
    provider: [],
    provider_default: {},
    session: [],
    session_status: {},
    session_risk: {},
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
    isolation: { mode: "workspace-write", network: false },
    autonomous: true,
    smartLlm: false,
    mcp: {},
    mcp_resource: {},
    formatter: [],
    vcs: undefined,
    path: { state: "", config: "", worktree: "", directory: "" },
    workspaceList: [],
  }
}
