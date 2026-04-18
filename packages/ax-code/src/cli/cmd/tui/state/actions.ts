import type {
  Event,
  Message,
  Part,
  Path,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  VcsInfo,
} from "@ax-code/sdk/v2"
import type { AppState, TuiEventQueueState } from "./app-state"

export type AppStateBootstrap = Partial<
  Pick<
    AppState,
    | "workspaceList"
    | "path"
    | "session"
    | "sessionStatus"
    | "message"
    | "part"
    | "permission"
    | "question"
    | "vcs"
    | "prompt"
    | "route"
  >
>

export type Action =
  | {
      type: "bootstrap.hydrated"
      data: AppStateBootstrap
    }
  | {
      type: "workspace.list.synced"
      workspaceList: string[]
    }
  | {
      type: "workspace.selected"
      workspaceID?: string
    }
  | {
      type: "route.session.selected"
      sessionID?: string
    }
  | {
      type: "path.synced"
      path: Path
    }
  | {
      type: "session.upserted"
      session: Session
    }
  | {
      type: "session.deleted"
      sessionID: string
    }
  | {
      type: "session.status.synced"
      sessionID: string
      status: SessionStatus
    }
  | {
      type: "message.upserted"
      message: Message
    }
  | {
      type: "message.deleted"
      sessionID: string
      messageID: string
    }
  | {
      type: "part.upserted"
      part: Part
    }
  | {
      type: "part.delta.received"
      sessionID: string
      messageID: string
      partID: string
      field: string
      delta: string
    }
  | {
      type: "part.deleted"
      messageID: string
      partID: string
    }
  | {
      type: "permission.asked"
      request: PermissionRequest
    }
  | {
      type: "permission.resolved"
      sessionID: string
      requestID: string
    }
  | {
      type: "question.asked"
      request: QuestionRequest
    }
  | {
      type: "question.resolved"
      sessionID: string
      requestID: string
    }
  | {
      type: "prompt.appended"
      text: string
    }
  | {
      type: "prompt.changed"
      value: string
    }
  | {
      type: "vcs.synced"
      vcs: VcsInfo | undefined
    }
  | {
      type: "queue.measured"
      metrics: TuiEventQueueState
    }

export type EventDrivenAction = Extract<Action, { type: `${string}.${string}` }>

export function isQueuedAction(action: Action): action is Extract<Action, { type: "part.delta.received" }> {
  return action.type === "part.delta.received"
}

export type EventMapper = (event: Event) => Action[]
