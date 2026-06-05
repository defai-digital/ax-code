import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"
import { produce, type SetStoreFunction } from "solid-js/store"
import { executeHeadlessProjectionEffects } from "@/runtime/headless/effects"
import type { HeadlessProjectionEffectHandlers } from "@/runtime/headless/effects"
import {
  applyHeadlessProjectionEvent,
  type HeadlessProjectionEffect,
  type HeadlessStreamHealth,
} from "@/runtime/headless/projection"
import type { SyncedSessionRisk } from "./sync-session-risk"
import type { SyncEvent } from "./sync-event"
import {
  runtimeSyncProbeTask,
  type RuntimeSyncProbeHandlers,
  type RuntimeSyncProbeScheduler,
} from "./sync-runtime-probe"

type HeadlessReplyPermission = NonNullable<HeadlessProjectionEffectHandlers["replyPermission"]>
type HeadlessReplyQuestion = NonNullable<HeadlessProjectionEffectHandlers["replyQuestion"]>
type SyncTaskQueueItem = { id: string; sessionID?: string } & Record<string, unknown>

export interface SyncEventStoreState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> {
  stream_health: HeadlessStreamHealth
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  todo: Record<string, TTodo[]>
  session_diff: Record<string, TDiff[]>
  session_status: Record<string, TStatus>
  session_error: Record<string, unknown>
  session_risk: Record<string, SyncedSessionRisk>
  session_goal: Record<string, unknown>
  task_queue: SyncTaskQueueItem[]
  session: TSession[]
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  vcs: { branch: string } | undefined
}

export interface DispatchStoreBackedSyncEventInput<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
> {
  event: SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
  autonomous: boolean
  setStore: SetStoreFunction<TStore>
  clearSessionSyncState: (sessionID: string) => void
  replyPermission: HeadlessReplyPermission
  replyQuestion: HeadlessReplyQuestion
  syncMcpStatus: RuntimeSyncProbeHandlers["syncMcpStatus"]
  syncLspStatus: RuntimeSyncProbeHandlers["syncLspStatus"]
  syncDebugEngine: RuntimeSyncProbeHandlers["syncDebugEngine"]
  syncWorkflowDashboard?: RuntimeSyncProbeHandlers["syncWorkflowDashboard"]
  scheduleRuntimeProbe?: RuntimeSyncProbeScheduler["schedule"]
  bootstrap: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
  maxSessionMessages: number
}

export function dispatchStoreBackedSyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
>(input: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>) {
  const setStore = input.setStore as unknown as SetStoreFunction<
    SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
  >

  return dispatchHeadlessProjectionEvent(input, setStore)
}

function dispatchHeadlessProjectionEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
>(
  input: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>,
  setStore: SetStoreFunction<SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>>,
) {
  // Route projection updates through the shared headless reducer first.
  // Runtime probes and bootstrap still have TUI adapter scheduler/lifecycle
  // wiring that needs parity work before they can move safely.
  switch (input.event.type) {
    case "permission.asked":
    case "permission.replied":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "todo.updated":
    case "session.diff":
    case "session.goal":
    case "session.status":
    case "session.error":
    case "task.queue.created":
    case "task.queue.updated":
    case "task.queue.deleted":
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "message.updated":
    case "message.removed":
    case "message.part.updated":
    case "message.part.delta":
    case "message.part.removed":
    case "server.connected":
    case "server.heartbeat":
    case "server.instance.disposed":
    case "vcs.branch.updated":
    case "mcp.tools.changed":
    case "lsp.updated":
    case "code.index.progress":
    case "code.index.state":
    case "workflow.run.created":
    case "workflow.run.updated":
    case "workflow.run.started":
    case "workflow.run.blocked":
    case "workflow.run.paused":
    case "workflow.run.resumed":
    case "workflow.run.completed":
    case "workflow.run.failed":
    case "workflow.run.cancelled":
    case "workflow.phase.updated":
    case "workflow.phase.started":
    case "workflow.phase.completed":
    case "workflow.phase.failed":
    case "workflow.child.created":
    case "workflow.child.updated":
    case "workflow.child.started":
    case "workflow.child.completed":
    case "workflow.child.failed":
    case "workflow.child.cancelled":
    case "workflow.artifact.written":
    case "workflow.budget.appended":
    case "workflow.budget.warning":
    case "workflow.budget.exceeded":
    case "workflow.verification.attached":
    case "server.connected":
    case "server.heartbeat":
    case "server.instance.disposed": {
      let effects: HeadlessProjectionEffect[] = []
      if (input.event.type === "session.deleted") {
        input.clearSessionSyncState(input.event.properties.info.id)
      }
      setStore(
        produce((draft) => {
          effects = applyHeadlessProjectionEvent(draft, input.event, {
            autonomous: input.autonomous,
            maxSessionMessages: input.maxSessionMessages,
          }).effects
        }),
      )
      executeHeadlessProjectionEffects(effects, {
        replyPermission: input.replyPermission,
        replyQuestion: input.replyQuestion,
        bootstrap: input.bootstrap,
        syncRuntimeProbe(key) {
          const task = runtimeSyncProbeTask(key, {
            syncMcpStatus: input.syncMcpStatus,
            syncLspStatus: input.syncLspStatus,
            syncDebugEngine: input.syncDebugEngine,
            syncWorkflowDashboard: input.syncWorkflowDashboard,
            onWarn: input.onWarn,
          })
          if (input.scheduleRuntimeProbe) {
            input.scheduleRuntimeProbe(task)
            return
          }
          try {
            void Promise.resolve(task.run()).catch((error) => input.onWarn(task.label, error))
          } catch (error) {
            input.onWarn(task.label, error)
          }
        },
        onWarn: input.onWarn,
      })
      return true
    }

    default:
      return false
  }
}
