import { enforceTranscriptBudget, adaptiveTranscriptMaxBytes } from "@/runtime/headless/projection-retention"
import { getHeapStatistics } from "node:v8"
import { retainTranscriptEvent, transcriptEventSession } from "./sync-transcript-event"
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

// Fraction of the V8 heap limit at which the app layer is warned about heap
// pressure (the transcript budget starts shrinking well before this point).
const HEAP_PRESSURE_WARN_THRESHOLD = 0.8
// Minimum spacing between memory_pressure store writes; the dispatcher runs
// per SSE event, so an uncapped write would churn the store at stream rate.
const HEAP_PRESSURE_WARN_MIN_INTERVAL_MS = 60_000
// getHeapStatistics() walks the heap spaces; sample at most this often.
const HEAP_PRESSURE_SAMPLE_INTERVAL_MS = 2_000

function defaultHeapPressureSource(): number {
  try {
    const stats = getHeapStatistics()
    if (!stats.heap_size_limit) return 0
    return stats.used_heap_size / stats.heap_size_limit
  } catch {
    return 0
  }
}

let heapPressureSource: () => number = defaultHeapPressureSource
let heapPressureCache: { at: number; ratio: number } | undefined

/** Test hook: replace the heap pressure source (used/limit ratio, 0..1). */
export function setHeapPressureSourceForTests(source: (() => number) | undefined) {
  heapPressureSource = source ?? defaultHeapPressureSource
  heapPressureCache = undefined
}

export function currentHeapPressureRatio(now = Date.now()): number {
  if (heapPressureCache && now - heapPressureCache.at < HEAP_PRESSURE_SAMPLE_INTERVAL_MS) {
    return heapPressureCache.ratio
  }
  const ratio = Math.min(1, Math.max(0, heapPressureSource()))
  heapPressureCache = { at: now, ratio }
  return ratio
}

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
  // Durable server task-queue projection retained for the future supervision
  // panel (ADR-025); not the interactive follow-up queue (ADR-028).
  task_queue: SyncTaskQueueItem[]
  session: TSession[]
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  vcs: { branch?: string } | undefined
  // Set when the V8 heap approaches its hard limit: the transcript budget was
  // narrowed adaptively and the app layer surfaces a warning with recovery
  // guidance instead of dying silently at FatalProcessOutOfMemory.
  memory_pressure?: { ratio: number; at: number }
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
  autoReplyRequests?: boolean
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
  // Refetch just the provider list (not a full bootstrap) when the server
  // signals discovery finished via `provider.updated`. Optional so non-TUI
  // dispatch callers can omit it.
  refreshProviders?: () => Promise<void> | void
  // The worker elides the text of a mid-stream part snapshot when the deltas
  // it forwarded already cover a prefix, and says which prefix it assumed.
  // When this renderer's part disagrees, a delta went missing: refetch the
  // session instead of waiting for the terminal snapshot.
  resyncSession?: (sessionID: string, reason: string) => void
  onWarn: (label: string, error: unknown) => void
  maxSessionMessages: number
  getActiveSessionID?: () => string | undefined
}

/**
 * Compare an elided `message.part.updated` against the part this renderer
 * holds. Returns a reason when the renderer's text is not at least the prefix
 * the worker assumed. A part whose message is not in the transcript was
 * refused by retention (budget, cap), and a refetch could not restore it
 * either, so that is not drift; a part with no text whose message the
 * transcript does hold is.
 */
function elidedPartDrift(
  state: {
    message: Record<string, Array<{ id: string }>>
    part: Record<string, Array<{ id: string; text?: unknown }>>
  },
  event: { type?: string; properties?: unknown },
): { sessionID: string; reason: string } | undefined {
  if (event.type !== "message.part.updated") return undefined
  const properties = event.properties as {
    part?: { id?: unknown; messageID?: unknown; sessionID?: unknown }
    elided?: { end?: unknown; tail?: unknown }
  }
  const elided = properties.elided
  if (!elided || typeof elided.end !== "number" || typeof elided.tail !== "string") return undefined
  const part = properties.part
  if (!part || typeof part.id !== "string" || typeof part.messageID !== "string") return undefined
  const sessionID = typeof part.sessionID === "string" ? part.sessionID : ""
  const existing = state.part[part.messageID]?.find((entry) => entry.id === part.id)
  const text = typeof existing?.text === "string" ? existing.text : undefined
  if (text === undefined) {
    // Nothing to compare. While the transcript holds the message, the absence
    // of this part means the renderer lost it (a session snapshot replaced the
    // parts list mid-stream, or an eviction dropped it). The elided snapshot
    // then re-inserts the part with no text, and every later delta is skipped
    // as a gap, so it stays blank until the terminal snapshot — refetch
    // instead. A message the transcript does not hold was refused by retention,
    // which a refetch cannot change.
    if (elided.end <= 0) return undefined
    const held = Object.values(state.message).some((list) => list.some((entry) => entry.id === part.messageID))
    if (!held) return undefined
    return { sessionID, reason: `part ${part.id} is missing the ${elided.end}-char prefix the stream assumed` }
  }
  const ok =
    text.length >= elided.end && text.slice(Math.max(0, elided.end - elided.tail.length), elided.end) === elided.tail
  if (ok) return undefined
  return {
    sessionID,
    reason: `part ${part.id} holds ${text.length} chars, the stream assumed a ${elided.end}-char prefix`,
  }
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
  // Provider discovery (CLI/local model lists) finishes after startup and is
  // pushed as `provider.updated`. It is edge-triggered with no replay, so if
  // discovery completes before this client's SSE stream subscribes the event
  // is lost. Refetch the provider list on BOTH `provider.updated` and the
  // `server.connected` handshake: `server.connected` arrives exactly when the
  // subscription registers, so a refetch on it observes any discovery that
  // already finished, while the live event covers discovery that finishes
  // later. The refetch is targeted (provider list only), not a full bootstrap,
  // so an in-flight session is not disrupted. `provider.updated` carries no
  // shared projection state and returns here; `server.connected` falls through
  // to the reducer below, which still drives `stream_health`.
  if (input.event.type === "provider.updated" || input.event.type === "server.connected") {
    void Promise.resolve(input.refreshProviders?.()).catch((error) => input.onWarn("refresh providers", error))
    if (input.event.type === "provider.updated") return true
  }

  // Recheck after the coalescing window: navigation may have changed.
  if (input.getActiveSessionID && !retainTranscriptEvent(input.event, input.getActiveSessionID())) return true

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
    case "server.resync_required":
    case "server.instance.disposed": {
      let effects: HeadlessProjectionEffect[] = []
      let drift: ReturnType<typeof elidedPartDrift>
      if (input.event.type === "session.deleted") {
        input.clearSessionSyncState(input.event.properties.info.id)
      }
      setStore(
        produce((draft) => {
          drift = elidedPartDrift(draft, input.event)
          const messageSessionID =
            input.event.type === "message.updated" ? input.event.properties.info.sessionID : undefined
          effects = applyHeadlessProjectionEvent(draft, input.event, {
            autonomous: input.autonomous && input.autoReplyRequests === true,
            // Keep the recovered undo window until the revert is cleared.
            maxSessionMessages:
              messageSessionID &&
              draft.session.some(
                (session) =>
                  session.id === messageSessionID &&
                  !!(session as { revert?: { messageID?: string } }).revert?.messageID,
              )
                ? Math.max(input.maxSessionMessages, (draft.message[messageSessionID]?.length ?? 0) + 1)
                : input.maxSessionMessages,
          }).effects
          const transcriptSessionID =
            transcriptEventSession(input.event) ??
            (input.event.type === "session.updated" ? input.event.properties.info.id : undefined)
          if (input.getActiveSessionID && transcriptSessionID && transcriptSessionID === input.getActiveSessionID()) {
            const pressure = currentHeapPressureRatio()
            enforceTranscriptBudget(draft, transcriptSessionID, {
              maxMessages: input.maxSessionMessages,
              maxBytes: adaptiveTranscriptMaxBytes(pressure),
              preserve: !!draft.session.find(
                (session) => session.id === transcriptSessionID && (session as { revert?: unknown }).revert,
              ),
            })
            // Warn at most once a minute while the heap is near its hard limit,
            // so the user can /compact or restart before the process is aborted.
            if (pressure >= HEAP_PRESSURE_WARN_THRESHOLD) {
              const last = draft.memory_pressure
              const now = Date.now()
              if (!last || now - last.at >= HEAP_PRESSURE_WARN_MIN_INTERVAL_MS) {
                draft.memory_pressure = { ratio: pressure, at: now }
              }
            }
          }
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
      if (drift && drift.sessionID) {
        input.onWarn("elided part snapshot drift", drift.reason)
        input.resyncSession?.(drift.sessionID, drift.reason)
      }
      return true
    }

    default:
      return false
  }
}
