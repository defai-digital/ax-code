import React from "react"
import { useMessageQueueStore, type QueuedMessage } from "@/stores/messageQueueStore"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useSelectionStore } from "@/sync/selection-store"
import { useConfigStore } from "@/stores/useConfigStore"
import { useAgentsStore } from "@/stores/useAgentsStore"
import { parseAgentMentions } from "@/lib/messages/agentMentions"
import { getSyncSessionStatus } from "@/sync/sync-refs"
import { useDirectorySync } from "@/sync/sync-context"
import { useSyncNotificationStore } from "@/sync/notification-store"

type SessionStatusType = "idle" | "busy" | "retry"

const RECENT_ABORT_WINDOW_MS = 2000

const hasRecentAbort = (sessionId: string): boolean => {
  const abortRecord = useSessionUIStore.getState().sessionAbortFlags.get(sessionId)
  if (!abortRecord) {
    return false
  }
  return Date.now() - abortRecord.timestamp < RECENT_ABORT_WINDOW_MS
}

// QueuedMessageChips renders exactly this state as a red "Held" label: an
// unseen error notification means the queue is being withheld until the user
// looks at what went wrong. Auto-send must honor the same state — otherwise
// the next busy→idle edge fires the "held" message into the errored session
// while the UI claims it is parked. Manual send from the chip stays
// available, and viewing the session clears the flag (markSessionViewed).
export const isQueuedAutoSendHeld = (sessionId: string): boolean =>
  useSyncNotificationStore.getState().sessionHasError(sessionId)

export const buildQueuedAutoSendPayload = (queue: QueuedMessage[]) => {
  const queued = queue[0]
  if (!queued) {
    return null
  }

  const agents = useAgentsStore.getState().getVisibleAgents()
  const { sanitizedText, mention } = parseAgentMentions(queued.content, agents)

  return {
    queuedMessageId: queued.id,
    primaryText: sanitizedText,
    primaryAttachments: queued.attachments ?? [],
    agentMentionName: mention?.name,
    sendConfig: queued.sendConfig,
  }
}

type QueuedAutoSendPayload = NonNullable<ReturnType<typeof buildQueuedAutoSendPayload>>
type ResolvedQueuedSendConfig = {
  providerID: string
  modelID: string
  agent?: string
  variant?: string
}

export const sendQueuedAutoSendPayload = (
  sessionId: string,
  payload: QueuedAutoSendPayload,
  resolved: ResolvedQueuedSendConfig,
) => {
  return useSessionUIStore
    .getState()
    .sendMessage(
      payload.primaryText,
      resolved.providerID,
      resolved.modelID,
      resolved.agent,
      payload.primaryAttachments,
      payload.agentMentionName,
      undefined,
      resolved.variant,
      "normal",
      { sessionId },
    )
}

const resolveSessionSendConfig = (sessionId: string) => {
  const config = useConfigStore.getState()
  const selection = useSelectionStore.getState()

  const selectedAgent = selection.getSessionAgentSelection(sessionId) ?? config.currentAgentName ?? undefined

  const sessionModel = selection.getSessionModelSelection(sessionId)
  const agentModel = selectedAgent ? selection.getAgentModelForSession(sessionId, selectedAgent) : null

  const providerID =
    agentModel?.providerId ??
    sessionModel?.providerId ??
    config.currentProviderId ??
    selection.lastUsedProvider?.providerID
  const modelID =
    agentModel?.modelId ?? sessionModel?.modelId ?? config.currentModelId ?? selection.lastUsedProvider?.modelID

  const variant =
    selectedAgent && providerID && modelID
      ? selection.getAgentModelVariantForSession(sessionId, selectedAgent, providerID, modelID)
      : undefined

  return {
    providerID,
    modelID,
    agent: selectedAgent,
    variant,
  }
}

export const shouldDispatchQueuedAutoSend = (
  previousStatusType: SessionStatusType | undefined,
  currentStatusType: SessionStatusType,
): boolean => {
  return (previousStatusType === "busy" || previousStatusType === "retry") && currentStatusType === "idle"
}

type QueuedAutoSendStatusUpdate = {
  /** Baseline to store for the next tick — held sessions keep their prior (armed) status. */
  nextStatusMap: Map<string, SessionStatusType>
  /** Sessions whose busy/retry -> idle edge fired this tick and are clear to dispatch now. */
  sessionIdsToDispatch: string[]
}

/**
 * Advances the per-session status baseline used to detect a busy/retry -> idle
 * edge, without stranding sessions whose auto-send is currently deferred
 * (in-flight dispatch, recent abort, or an unseen error hold).
 *
 * A session held this tick must keep its pre-transition baseline (e.g. "busy")
 * rather than being advanced to "idle" — otherwise, once the hold lifts with
 * no further status transition to re-trigger the effect, the edge is gone and
 * the queued message never auto-sends.
 */
export const computeQueuedAutoSendStatusUpdate = (
  queuedMessages: Record<string, QueuedMessage[]>,
  statusRecord: Record<string, { type: string } | undefined>,
  previousStatusMap: Map<string, SessionStatusType>,
  isAutoSendDeferred: (sessionId: string) => boolean,
): QueuedAutoSendStatusUpdate => {
  const queueEntries = Object.entries(queuedMessages)

  const heldSessionIds = new Set<string>()
  const sessionIdsToDispatch: string[] = []
  for (const [sessionId, queue] of queueEntries) {
    if (queue.length === 0) continue
    const currentStatusType = (statusRecord[sessionId]?.type ?? "idle") as SessionStatusType
    const previousStatusType = previousStatusMap.get(sessionId)
    if (!shouldDispatchQueuedAutoSend(previousStatusType, currentStatusType)) continue

    if (isAutoSendDeferred(sessionId)) {
      heldSessionIds.add(sessionId)
    } else {
      sessionIdsToDispatch.push(sessionId)
    }
  }

  const nextStatusMap = new Map(previousStatusMap)
  for (const [sessionId, status] of Object.entries(statusRecord)) {
    if (status && !heldSessionIds.has(sessionId)) {
      nextStatusMap.set(sessionId, status.type as SessionStatusType)
    }
  }
  for (const [sessionId, queue] of queueEntries) {
    if (heldSessionIds.has(sessionId)) continue
    const currentStatusType = (statusRecord[sessionId]?.type ?? "idle") as SessionStatusType
    nextStatusMap.set(sessionId, currentStatusType)
  }

  // Prune sessions that are no longer tracked (deleted/archived/gone) so the
  // status map does not grow unbounded over a long-running app session. A
  // session that later reappears starts with no previous status, which
  // correctly prevents a spurious idle-transition auto-send.
  const activeSessionIds = new Set([...Object.keys(statusRecord), ...Object.keys(queuedMessages)])
  for (const sessionId of nextStatusMap.keys()) {
    if (!activeSessionIds.has(sessionId)) {
      nextStatusMap.delete(sessionId)
    }
  }

  return { nextStatusMap, sessionIdsToDispatch }
}

export function useQueuedMessageAutoSend(enabledOrOptions?: boolean | { enabled?: boolean }) {
  const enabled = typeof enabledOrOptions === "boolean" ? enabledOrOptions : (enabledOrOptions?.enabled ?? true)
  const queuedMessages = useMessageQueueStore((state) => state.queuedMessages)
  const sessionStatusRecord = useDirectorySync((state) => state.session_status)

  const inFlightSessionsRef = React.useRef<Set<string>>(new Set())
  const previousStatusRef = React.useRef<Map<string, SessionStatusType>>(new Map())

  React.useEffect(() => {
    if (!enabled) {
      return
    }

    // A transient hold means the busy/retry -> idle edge must stay armed rather
    // than be consumed: if we advance the status baseline while an auto-send is
    // deferred (in-flight dispatch, recent abort, or an unseen error), the head
    // is stranded once the hold lifts with no further transition to re-trigger.
    const isAutoSendDeferred = (sessionId: string): boolean =>
      inFlightSessionsRef.current.has(sessionId) || hasRecentAbort(sessionId) || isQueuedAutoSendHeld(sessionId)

    const dispatchSessionQueue = async (sessionId: string, queueSnapshot: QueuedMessage[]) => {
      if (queueSnapshot.length === 0) {
        return
      }
      if (isAutoSendDeferred(sessionId)) {
        return
      }

      const currentStatus = getSyncSessionStatus(sessionId)?.type ?? "idle"
      if (currentStatus !== "idle") {
        return
      }

      const payload = buildQueuedAutoSendPayload(queueSnapshot)
      if (!payload) {
        return
      }
      if (!payload.primaryText && payload.primaryAttachments.length === 0) {
        return
      }

      // Use send config captured at queue time; fall back to current config
      const captured = payload.sendConfig
      const resolved = captured?.providerID && captured?.modelID ? captured : resolveSessionSendConfig(sessionId)
      if (!resolved.providerID || !resolved.modelID) {
        return
      }

      inFlightSessionsRef.current.add(sessionId)

      try {
        await sendQueuedAutoSendPayload(sessionId, payload, {
          providerID: resolved.providerID,
          modelID: resolved.modelID,
          agent: resolved.agent,
          variant: resolved.variant,
        })

        const removeFromQueue = useMessageQueueStore.getState().removeFromQueue
        removeFromQueue(sessionId, payload.queuedMessageId)
      } catch (error) {
        console.warn("[queue] queued auto-send failed:", error)
      } finally {
        inFlightSessionsRef.current.delete(sessionId)
      }
    }

    const statusRecord = sessionStatusRecord ?? {}
    const { nextStatusMap, sessionIdsToDispatch } = computeQueuedAutoSendStatusUpdate(
      queuedMessages,
      statusRecord,
      previousStatusRef.current,
      isAutoSendDeferred,
    )

    for (const sessionId of sessionIdsToDispatch) {
      const queue = queuedMessages[sessionId]
      if (queue) {
        void dispatchSessionQueue(sessionId, queue)
      }
    }

    previousStatusRef.current = nextStatusMap
  }, [enabled, queuedMessages, sessionStatusRecord])
}
