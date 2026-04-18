import type {
  Message,
  Part,
  Path,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  VcsInfo,
} from "@ax-code/sdk/v2"

export type TuiRouteState = {
  sessionID?: string
  workspaceID?: string
}

export type TuiPromptState = {
  value: string
}

export type TuiEventQueueState = {
  pending: number
  dropped: number
  coalesced: number
  maxDepth: number
}

export type AppState = {
  route: TuiRouteState
  path: Path
  workspaceList: string[]
  session: Session[]
  sessionStatus: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  vcs: VcsInfo | undefined
  prompt: TuiPromptState
  eventQueue: TuiEventQueueState
}

const DEFAULT_PATH: Path = {
  home: "",
  state: "",
  config: "",
  worktree: "",
  directory: "",
}

export function createAppState(input: Partial<AppState> = {}): AppState {
  return {
    route: {
      ...input.route,
    },
    path: {
      ...DEFAULT_PATH,
      ...input.path,
    },
    workspaceList: input.workspaceList ? [...input.workspaceList] : [],
    session: input.session ? [...input.session] : [],
    sessionStatus: {
      ...(input.sessionStatus ?? {}),
    },
    message: {
      ...(input.message ?? {}),
    },
    part: {
      ...(input.part ?? {}),
    },
    permission: {
      ...(input.permission ?? {}),
    },
    question: {
      ...(input.question ?? {}),
    },
    vcs: input.vcs,
    prompt: {
      value: input.prompt?.value ?? "",
    },
    eventQueue: {
      pending: input.eventQueue?.pending ?? 0,
      dropped: input.eventQueue?.dropped ?? 0,
      coalesced: input.eventQueue?.coalesced ?? 0,
      maxDepth: input.eventQueue?.maxDepth ?? 128,
    },
  }
}
