/**
 * Session actions — SDK-calling operations for session management.
 * Replaces the action methods from the old useSessionStore.
 */

import type { AxCodeClient, FilePartInput, Session, Message, Part } from "@ax-code/sdk/v2/client"
import { Binary } from "./binary"
import { useSessionUIStore } from "./session-ui-store"
import { useInputStore } from "./input-store"
import type { ChildStoreManager } from "./child-store"
import { axCodeClient, ascendingId } from "@/lib/ax-code/client"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { registerSessionDirectory } from "./sync-refs"
import { isSyntheticPart } from "@/lib/messages/synthetic"
import { materializeSessionSnapshots } from "./materialization"
import { stripMessageDiffSnapshots } from "./sanitize"
import { sessionEvents } from "@/lib/sessionEvents"

const MESSAGE_REFETCH_LIMIT = 200
const MESSAGE_REFETCH_SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const UNREVERT_REFETCH_ATTEMPTS = 3
const UNREVERT_REFETCH_RETRY_MS = 150
const ACCEPTED_PROMPT_NO_OUTPUT_MS = 60_000
// How long after an async prompt is accepted we still treat the session as
// "starting up" even if an authoritative status snapshot reports it idle. The
// prompt_async endpoint returns before the turn registers as busy server-side,
// so a status poll / reconnect resync landing in that gap would otherwise see
// "no active status" and prematurely flip the optimistic busy back to idle —
// tripping the no-output watchdog. Kept comfortably above the watchdog window.
const PROMPT_ACCEPTED_BUSY_GRACE_MS = 60_000

// Reference set by SyncProvider — allows actions to access SDK and stores
let _sdk: AxCodeClient | null = null
let _childStores: ChildStoreManager | null = null
let _getDirectory: () => string = () => ""
let _optimisticAdd: ((input: { sessionID: string; message: Message; parts: Part[] }) => void) | null = null
let _optimisticRemove: ((input: { sessionID: string; messageID: string }) => void) | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Timestamp of the last successfully-accepted async prompt per session. Used to
// suppress premature idle downgrades from authoritative status snapshots while
// the turn is still spinning up. See PROMPT_ACCEPTED_BUSY_GRACE_MS.
const acceptedPromptAt = new Map<string, number>()

// Active accepted-prompt watchdog timers per session. Each optimisticSend call
// schedules a 12s watchdog that can force the session to idle if it finds a
// completed assistant reply while the status looks stuck on busy. Without
// cancellation, a stale watchdog from a PREVIOUS prompt fires during the NEXT
// prompt's turn, finds the previous turn's completed assistant reply, sees the
// current busy status (from the new prompt), and incorrectly forces idle —
// clobbering the new turn and tripping its own watchdog.
const acceptedPromptWatchdogTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>()

function markPromptAccepted(sessionId: string): void {
  acceptedPromptAt.set(sessionId, Date.now())
}

/**
 * True when a prompt for this session was accepted within the grace window.
 * The reconnect resync and status poll use this to avoid clobbering the
 * optimistic busy status with a stale "idle" before the turn starts streaming.
 */
export function wasPromptRecentlyAccepted(
  sessionId: string,
  withinMs: number = PROMPT_ACCEPTED_BUSY_GRACE_MS,
): boolean {
  const at = acceptedPromptAt.get(sessionId)
  if (at === undefined) return false
  if (Date.now() - at <= withinMs) return true
  // Expired — drop so the map doesn't grow unbounded across long-lived sessions.
  acceptedPromptAt.delete(sessionId)
  return false
}

export function setActionRefs(sdk: AxCodeClient, childStores: ChildStoreManager, getDirectory: () => string) {
  _sdk = sdk
  _childStores = childStores
  _getDirectory = getDirectory
}

export function setOptimisticRefs(
  add: (input: { sessionID: string; message: Message; parts: Part[] }) => void,
  remove: (input: { sessionID: string; messageID: string }) => void,
) {
  _optimisticAdd = add
  _optimisticRemove = remove
}

function sdk() {
  if (!_sdk) throw new Error("SDK not initialized — is SyncProvider mounted?")
  return _sdk
}

function dirStore() {
  if (!_childStores) throw new Error("Child stores not initialized")
  const d = _getDirectory()
  if (!d) throw new Error("No current directory")
  return _childStores.ensureChild(d)
}

function dir() {
  return _getDirectory() || undefined
}

function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function connectionLostError(): Error {
  const { hasEverConnected, lastDisconnectReason } = useConfigStore.getState()
  const suffix = lastDisconnectReason ? ` (${lastDisconnectReason})` : hasEverConnected ? "" : " (never connected)"
  return new Error(`Connection lost${suffix}. Please wait for reconnection.`)
}

type WatchdogStore = ReturnType<ChildStoreManager["ensureChild"]>

function findAssistantResponse(store: WatchdogStore, sessionId: string, messageID: string) {
  const messages = store.getState().message[sessionId] ?? []
  return messages.find((message) => message.role === "assistant" && message.parentID === messageID)
}

function isSessionWorking(store: WatchdogStore, sessionId: string): boolean {
  const status = store.getState().session_status?.[sessionId]
  return status?.type === "busy" || status?.type === "retry"
}

/**
 * True when a user message NEWER than `messageID` exists without its own
 * assistant reply. This means a later turn is still in progress — the current
 * watchdog is for an already-completed turn and must NOT force idle or
 * fabricate an error, as that would clobber the in-progress turn.
 *
 * Used by both watchdog branches (initial store match + post-recovery) to
 * prevent cross-turn clobbering. Without this, a stale watchdog from prompt N
 * that fires or completes its async recovery during prompt N+1's turn would
 * see the busy status from N+1 and incorrectly force idle.
 */
function hasNewerUnansweredUserMessage(messages: Message[], messageID: string): boolean {
  return messages.some(
    (m) =>
      m.role === "user" && m.id > messageID && !messages.some((am) => am.role === "assistant" && am.parentID === m.id),
  )
}

// Pull the authoritative message list from the server into the session's store.
// The watchdog uses this to recover responses whose streamed events were dropped
// (WS reconnect, coalescing, or directory mis-routing) before declaring failure.
async function recoverAcceptedPromptFromServer(
  sessionId: string,
  directory: string,
  store: WatchdogStore,
): Promise<void> {
  try {
    const client = getSessionReplyClient(sessionId)
    const result = await client.session.messages({ sessionID: sessionId, directory, limit: MESSAGE_REFETCH_LIMIT })
    const records = (result.data ?? []).filter((record: { info?: { id?: string } }) => !!record?.info?.id)
    if (records.length === 0) return
    store.setState((state) => {
      const materialized = materializeSessionSnapshots(
        state,
        sessionId,
        records.map((record: { info: Message; parts?: Part[] }) => ({
          info: stripMessageDiffSnapshots(record.info),
          parts: record.parts ?? [],
        })),
        { skipPartTypes: MESSAGE_REFETCH_SKIP_PARTS },
      )
      return { message: materialized.message, part: materialized.part }
    })
  } catch (error) {
    // Refetch failed (offline / server error) — fall through to the synthetic
    // error so the user is never left staring at a silently stalled turn.
    console.warn("[session-actions] accepted-prompt watchdog refetch failed", error)
  }
}

function scheduleAcceptedPromptWatchdog(sessionId: string, messageID: string): void {
  const stores = _childStores
  if (!stores) return
  const directory = getSessionDirectory(sessionId) || dir()
  if (!directory) return

  // Cancel any stale watchdog from a previous prompt for this session.
  // Without this, the previous prompt's watchdog fires during the next
  // prompt's turn, finds the previous turn's completed assistant reply,
  // sees the current busy status (from the new prompt), and incorrectly
  // forces idle — clobbering the new turn.
  const existingTimer = acceptedPromptWatchdogTimers.get(sessionId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const runWatchdogCheck = async () => {
    const store = stores.children.get(directory)
    if (!store) return
    const state = store.getState()
    const messages = state.message[sessionId] ?? []
    const userMessage = messages.find((message) => message.id === messageID)
    if (!userMessage) return

    const assistantResponse = messages.find((message) => message.role === "assistant" && message.parentID === messageID)
    if (assistantResponse) {
      const status = state.session_status?.[sessionId]
      const completedAt = (assistantResponse as { time?: { completed?: number } }).time?.completed
      const finish = (assistantResponse as { finish?: string }).finish
      if ((status?.type === "busy" || status?.type === "retry") && (completedAt || finish === "stop")) {
        // Don't force idle if a NEWER user message exists without its own
        // assistant reply — a later turn is still in progress and this
        // watchdog is for an already-completed turn.
        if (!hasNewerUnansweredUserMessage(messages, messageID)) {
          store.setState((current) => ({
            session_status: {
              ...current.session_status,
              [sessionId]: { type: "idle" as const },
            },
          }))
        }
      }
      return
    }

    if (isSessionWorking(store, sessionId)) return

    // No streamed assistant response and the session looks idle. Before
    // fabricating a failure, verify with the server — the turn may have
    // completed while its events were dropped in transit. If a real response
    // comes back, surface it and stop; only fabricate when the server also
    // has nothing.
    await recoverAcceptedPromptFromServer(sessionId, directory, store)
    if (findAssistantResponse(store, sessionId, messageID)) {
      // Re-read state after the async recovery — a new prompt may have
      // started during the network round-trip, setting busy and adding a
      // newer user message. Same cross-turn guard as the initial-match
      // branch: don't clobber an in-progress turn.
      const currentState = store.getState()
      const currentMessages = currentState.message[sessionId] ?? []
      const status = currentState.session_status?.[sessionId]
      if (
        (status?.type === "busy" || status?.type === "retry") &&
        !hasNewerUnansweredUserMessage(currentMessages, messageID)
      ) {
        store.setState((current) => ({
          session_status: {
            ...current.session_status,
            [sessionId]: { type: "idle" as const },
          },
        }))
      }
      return
    }

    // A late event may have flipped the session back to working during the
    // refetch — don't clobber an in-progress turn with a synthetic error.
    if (isSessionWorking(store, sessionId)) return

    // Grace-window re-arm: the prompt-accepted grace window (30s) is longer
    // than this watchdog (12s). If the prompt is STILL recently accepted, the
    // idle status we're seeing is a transient clobber from an SSE
    // session.idle / session.status event during the turn spin-up gap — NOT a
    // genuine turn death. The grace window guards the status-poll path
    // (resolveResyncedSessionStatus) but NOT the event-reducer's direct status
    // writes, so an SSE idle event can still clobber busy→idle here. Re-arm
    // to fire again once the grace window expires, so a truly dead turn is
    // still caught but a grace-window clobber does not fabricate a false error.
    if (wasPromptRecentlyAccepted(sessionId)) {
      const acceptedAt = acceptedPromptAt.get(sessionId) ?? Date.now()
      const rearmDelay = Math.max(1, acceptedAt + PROMPT_ACCEPTED_BUSY_GRACE_MS - Date.now())
      const rearmTimer = globalThis.setTimeout(runWatchdogCheck, rearmDelay)
      acceptedPromptWatchdogTimers.set(sessionId, rearmTimer)
      return
    }

    const assistantMessageID = ascendingId("msg")
    const partID = ascendingId("prt")
    const now = Date.now()
    const assistantMessage = {
      id: assistantMessageID,
      role: "assistant" as const,
      sessionID: sessionId,
      parentID: messageID,
      modelID: "",
      providerID: "",
      system: "",
      agent: "",
      model: "",
      metadata: {
        synthetic: true,
        error: true,
        source: "desktop-accepted-prompt-watchdog",
      },
      time: { created: now, completed: now },
    } as unknown as Message
    const textPart = {
      id: partID,
      type: "text",
      messageID: assistantMessageID,
      text: "The request was accepted, but no assistant response or error was produced. Please retry this message or start a new session.",
    } as unknown as Part

    store.setState((current) => ({
      message: {
        ...current.message,
        [sessionId]: [...(current.message[sessionId] ?? []), assistantMessage],
      },
      part: {
        ...current.part,
        [assistantMessageID]: [textPart],
      },
      session_status: {
        ...current.session_status,
        [sessionId]: { type: "idle" as const },
      },
    }))
  }

  const timer = globalThis.setTimeout(async () => {
    acceptedPromptWatchdogTimers.delete(sessionId)
    await runWatchdogCheck()
  }, ACCEPTED_PROMPT_NO_OUTPUT_MS)

  acceptedPromptWatchdogTimers.set(sessionId, timer)
}

// Wait briefly for the pipeline to re-establish connection before failing a
// send. Transient reconnects (heartbeat race, WS→SSE fallback, brief network
// blip) otherwise surface as a hard "Connection lost" toast even though the
// pipeline recovers within a second. While waiting, run bounded health probes
// inside the same grace window so stale disconnected state can recover quickly.
const CONNECTION_GRACE_MS = 2000
export async function waitForConnectionOrThrow(): Promise<void> {
  const deadline = Date.now() + CONNECTION_GRACE_MS
  while (Date.now() < deadline) {
    if (useConfigStore.getState().isConnected) return
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    if (await useConfigStore.getState().probeConnection({ timeoutMs: Math.min(500, remainingMs) })) return
    const sleepMs = Math.min(100, deadline - Date.now())
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
  throw connectionLostError()
}

function getSessionDirectory(sessionId: string): string | undefined {
  return useSessionUIStore.getState().getDirectoryForSession(sessionId) || dir()
}

function getDirectoryStore(directory?: string) {
  if (!_childStores) throw new Error("Child stores not initialized")
  const resolvedDirectory = directory || _getDirectory()
  if (!resolvedDirectory) throw new Error("No current directory")
  return _childStores.ensureChild(resolvedDirectory)
}

function getSessionReplyClient(sessionId?: string): AxCodeClient {
  const directory = sessionId ? useSessionUIStore.getState().getDirectoryForSession(sessionId) : null
  if (directory) {
    return axCodeClient.getScopedSdkClient(directory)
  }
  return sdk()
}

function restoreFilePartsToInput(fileParts: Array<Record<string, unknown>>): void {
  useInputStore.getState().clearAttachedFiles()
  for (const filePart of fileParts) {
    const url = typeof filePart.url === "string" ? filePart.url : ""
    const mime = typeof filePart.mime === "string" ? filePart.mime : "application/octet-stream"
    const filename = typeof filePart.filename === "string" ? filePart.filename : "attachment"
    if (url) {
      useInputStore.getState().addRestoredAttachment({ url, mimeType: mime, filename })
    }
  }
}

function resolveDirectoryForBlockingRequest(
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): string | null {
  const stores = _childStores
  if (!stores || !requestId) {
    return null
  }

  for (const [directory, store] of stores.children) {
    const state = store.getState()
    const requestMap = type === "permission" ? state.permission : state.question
    for (const requests of Object.values(requestMap) as Array<Array<{ id: string }> | undefined>) {
      if (requests?.some((request) => request.id === requestId)) {
        return directory
      }
    }
  }

  const sessionDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId)
  if (sessionDirectory) {
    return sessionDirectory
  }

  for (const [directory, store] of stores.children) {
    const state = store.getState()
    if (
      state.session.some((session) => session.id === sessionId) ||
      Object.prototype.hasOwnProperty.call(state.message, sessionId) ||
      Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionId) ||
      Object.prototype.hasOwnProperty.call(state.permission ?? {}, sessionId) ||
      Object.prototype.hasOwnProperty.call(state.question ?? {}, sessionId)
    ) {
      return directory
    }
  }

  return null
}

function getRequestReplyClient(type: "permission" | "question", sessionId: string, requestId: string): AxCodeClient {
  const requestDirectory = resolveDirectoryForBlockingRequest(type, sessionId, requestId)
  if (requestDirectory) {
    return axCodeClient.getScopedSdkClient(requestDirectory)
  }
  return getSessionReplyClient(sessionId)
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createSession(
  title?: string,
  directoryOverride?: string | null,
  parentID?: string | null,
): Promise<Session | null> {
  try {
    const directory = directoryOverride ?? dir()
    const client = directory ? axCodeClient.getScopedSdkClient(directory) : sdk()
    const result = await client.session.create({
      directory,
      title,
      parentID: parentID ?? undefined,
    })
    if (result.error) throw new Error(`Failed to create session: ${formatSdkError(result.error)}`)
    const session = result.data
    if (!session) throw new Error("Failed to create session: response did not include session data")

    const sessionDirectory = (session as { directory?: string }).directory ?? directory ?? null
    // Pre-populate routing index so SSE events arriving before session.created
    // can be routed to the correct child store
    if (sessionDirectory) {
      registerSessionDirectory(session.id, sessionDirectory)
    }
    useSessionUIStore.getState().setCurrentSession(session.id, sessionDirectory)
    useGlobalSessionsStore.getState().upsertSession(session)
    return session
  } catch (error) {
    console.error("[session-actions] createSession failed", error)
    throw error
  }
}

/** Optimistically remove a session from the child store list. Returns previous list for rollback. */
function optimisticRemoveSession(sessionId: string, directory?: string): Session[] | null {
  const store = getDirectoryStore(directory)
  const current = store.getState()
  const sessions = [...current.session]
  const result = Binary.search(sessions, sessionId, (s) => s.id)
  if (result.found) {
    const snapshot = current.session
    sessions.splice(result.index, 1)
    store.setState({ session: sessions })
    return snapshot
  }
  return null
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const sessionDirectory = getSessionDirectory(sessionId)
  // Remove from UI immediately, rollback on error
  let snapshot = optimisticRemoveSession(sessionId, sessionDirectory)
  let removedFromDir: string | null = snapshot ? (sessionDirectory ?? null) : null

  // If the session wasn't in the resolved directory (e.g. archived session
  // whose original child store was disposed), search all child stores.
  if (!snapshot && _childStores) {
    for (const [dir, store] of _childStores.children.entries()) {
      const current = store.getState()
      const sessions = [...current.session]
      const result = Binary.search(sessions, sessionId, (s) => s.id)
      if (result.found) {
        snapshot = current.session
        sessions.splice(result.index, 1)
        store.setState({ session: sessions })
        removedFromDir = dir
        break
      }
    }
  }

  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    await sdk().session.delete({ sessionID: sessionId, directory: sessionDirectory })
    useGlobalSessionsStore.getState().removeSessions([sessionId])
    return true
  } catch (error) {
    console.error("[session-actions] deleteSession failed", error)
    if (snapshot && removedFromDir) {
      try {
        getDirectoryStore(removedFromDir).setState({ session: snapshot })
      } catch {
        // child store may have been disposed since — ignore rollback
      }
    }
    return false
  }
}

/** Delete a session specifying which directory it lives in. Used by agent groups for cross-directory deletes. */
export async function deleteSessionInDirectory(sessionId: string, directory: string): Promise<boolean> {
  if (!_childStores) return false
  const store = _childStores.ensureChild(directory)
  const current = store.getState()
  const sessions = [...current.session]
  const result = Binary.search(sessions, sessionId, (s) => s.id)
  let snapshot: Session[] | null = null
  if (result.found) {
    snapshot = current.session
    sessions.splice(result.index, 1)
    store.setState({ session: sessions })
  }
  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) ui.setCurrentSession(null)
  try {
    await sdk().session.delete({ sessionID: sessionId, directory })
    useGlobalSessionsStore.getState().removeSessions([sessionId])
    return true
  } catch (error) {
    console.error("[session-actions] deleteSessionInDirectory failed", error)
    if (snapshot) store.setState({ session: snapshot })
    return false
  }
}

export async function archiveSession(sessionId: string): Promise<boolean> {
  const sessionDirectory = getSessionDirectory(sessionId)
  const snapshot = optimisticRemoveSession(sessionId, sessionDirectory)
  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    const archivedAt = Date.now()
    await sdk().session.update({ sessionID: sessionId, directory: sessionDirectory, time: { archived: archivedAt } })
    useGlobalSessionsStore.getState().archiveSessions([sessionId], archivedAt)
    return true
  } catch (error) {
    console.error("[session-actions] archiveSession failed", error)
    if (snapshot && sessionDirectory) {
      try {
        getDirectoryStore(sessionDirectory).setState({ session: snapshot })
      } catch {
        // child store may have been disposed since — ignore rollback
      }
    }
    return false
  }
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const sessionDirectory = getSessionDirectory(sessionId)
  const result = await sdk().session.update({ sessionID: sessionId, directory: sessionDirectory, title })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
}

export async function shareSession(sessionId: string): Promise<Session | null> {
  console.warn("[session-actions] shareSession is unavailable in the current AX Code SDK", { sessionId })
  return null
}

export async function unshareSession(sessionId: string): Promise<Session | null> {
  console.warn("[session-actions] unshareSession is unavailable in the current AX Code SDK", { sessionId })
  return null
}

// ---------------------------------------------------------------------------
// Optimistic message send — insert user message before API call, rollback on error
// ---------------------------------------------------------------------------

/**
 * Wraps an async send operation with optimistic user-message insertion.
 * Uses useSync()'s optimistic infrastructure — message + parts are inserted
 * into the store AND registered in the shadow Map. mergeOptimisticPage
 * handles deduplication when the server echoes back the real message.
 */
export async function optimisticSend(input: {
  sessionId: string
  content: string
  providerID: string
  modelID: string
  agent?: string
  files?: Array<Pick<FilePartInput, "type" | "mime" | "url" | "filename" | "source">>
  /** The actual API call — receives the optimistic messageID so the server can use the same ID */
  send: (messageID: string) => Promise<void>
}): Promise<void> {
  if (!_optimisticAdd || !_optimisticRemove) {
    throw new Error("Optimistic refs not set — is useSync() mounted?")
  }

  const store = dirStore()
  const messageID = ascendingId("msg")
  const textPartId = ascendingId("prt")

  const optimisticParts: Part[] = [{ id: textPartId, type: "text", text: input.content } as Part]
  if (input.files) {
    for (const f of input.files) {
      optimisticParts.push({
        id: ascendingId("prt"),
        type: "file",
        mime: f.mime,
        url: f.url,
        filename: f.filename,
        ...(f.source ? { source: f.source } : {}),
      } as Part)
    }
  }

  const optimisticMessage = {
    id: messageID,
    role: "user" as const,
    sessionID: input.sessionId,
    parentID: "",
    modelID: input.modelID,
    providerID: input.providerID,
    system: "",
    agent: input.agent ?? "",
    model: `${input.providerID}/${input.modelID}`,
    metadata: {} as Record<string, unknown>,
    time: { created: Date.now(), completed: 0 },
  } as unknown as Message

  // Insert into store + register in shadow Map (for mergeOptimisticPage cleanup)
  _optimisticAdd({
    sessionID: input.sessionId,
    message: optimisticMessage,
    parts: optimisticParts,
  })

  // Set busy status and mark the prompt accepted atomically (both synchronous)
  // so any status poll that fires during the connection wait or POST round-trip
  // sees promptRecentlyAccepted=true and preserves busy via resolveResyncedSessionStatus.
  const current = store.getState()
  store.setState({
    session_status: {
      ...current.session_status,
      [input.sessionId]: { type: "busy" as const },
    },
  })
  markPromptAccepted(input.sessionId)

  try {
    await waitForConnectionOrThrow()
    await input.send(messageID)
    scheduleAcceptedPromptWatchdog(input.sessionId, messageID)
  } catch (error) {
    // Rollback via optimistic infrastructure
    _optimisticRemove({
      sessionID: input.sessionId,
      messageID,
    })
    const s = store.getState()
    store.setState({
      session_status: {
        ...s.session_status,
        [input.sessionId]: { type: "idle" as const },
      },
    })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export async function abortCurrentOperation(sessionId: string): Promise<void> {
  try {
    await sdk().session.abort({ sessionID: sessionId, directory: dir() })
  } catch (error) {
    console.error("[session-actions] abort failed", error)
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function respondToPermission(
  sessionId: string,
  requestId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory =
    resolveDirectoryForBlockingRequest("permission", sessionId, requestId) || getSessionDirectory(sessionId) || dir()
  const result = await getRequestReplyClient("permission", sessionId, requestId).permission.reply({
    requestID: requestId,
    reply: response,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Permission reply failed")
  }
}

export async function dismissPermission(sessionId: string, requestId: string): Promise<void> {
  await waitForConnectionOrThrow()
  const directory =
    resolveDirectoryForBlockingRequest("permission", sessionId, requestId) || getSessionDirectory(sessionId) || dir()
  const result = await getRequestReplyClient("permission", sessionId, requestId).permission.reply({
    requestID: requestId,
    reply: "reject",
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Permission dismissal failed")
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function respondToQuestion(
  sessionId: string,
  requestId: string,
  answers: string[] | string[][],
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory =
    resolveDirectoryForBlockingRequest("question", sessionId, requestId) || getSessionDirectory(sessionId) || dir()
  const result = await getRequestReplyClient("question", sessionId, requestId).question.reply({
    requestID: requestId,
    answers: answers as Array<Array<string>>,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question reply failed")
  }
}

export async function rejectQuestion(sessionId: string, requestId: string): Promise<void> {
  await waitForConnectionOrThrow()
  const directory =
    resolveDirectoryForBlockingRequest("question", sessionId, requestId) || getSessionDirectory(sessionId) || dir()
  const result = await getRequestReplyClient("question", sessionId, requestId).question.reject({
    requestID: requestId,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question rejection failed")
  }
}

// ---------------------------------------------------------------------------
// Message history
// ---------------------------------------------------------------------------

/**
 * Revert to a specific user message.
 *
 * 1. Abort if session is busy
 * 2. Extract text from the target message for prompt restoration
 * 3. Optimistically set revert marker so messages hide immediately
 * 4. Call SDK session.revert() and merge returned session
 * 5. Set pendingInputText so the reverted message text appears in the input
 */
export async function revertToMessage(sessionId: string, messageId: string): Promise<void> {
  const store = dirStore()
  const state = store.getState()

  // Abort if busy before mutating session state
  const status = state.session_status[sessionId]
  if (status && status.type !== "idle") {
    try {
      await sdk().session.abort({ sessionID: sessionId, directory: dir() })
    } catch {
      // ignore abort errors
    }
  }

  // Extract message text for prompt restoration (only non-synthetic text parts —
  // the server adds file content as synthetic text parts that should not be restored)
  const messages = state.message[sessionId] ?? []
  const targetMsg = messages.find((m) => m.id === messageId)
  let messageText = ""
  let submittedFileParts: Array<Record<string, unknown>> = []
  if (targetMsg && targetMsg.role === "user") {
    const parts = state.part[messageId] ?? []
    const textParts = parts.filter((p) => p.type === "text" && !isSyntheticPart(p))
    messageText = textParts
      .map((p: Record<string, unknown>) => (p as { text?: string }).text || (p as { content?: string }).content || "")
      .join("\n")
      .trim()
    // Snapshot file parts for later restoration to the input.
    // Exclude synthetic file parts (server-generated file content that should
    // not be restored to the composer).
    submittedFileParts = parts.filter((p) => p.type === "file" && !isSyntheticPart(p)) as Array<Record<string, unknown>>
  }

  // Optimistically set only the revert marker. Keep messages and parts in the
  // local store; visible-message selectors derive the displayed timeline from
  // session.revert. This matches the server model and preserves reverted
  // messages for the restore dock without maintaining a separate shadow copy.
  const sessionIndex = Binary.search(state.session, sessionId, (s) => s.id)
  const prevRevert = sessionIndex.found
    ? (state.session[sessionIndex.index] as Session & { revert?: unknown }).revert
    : undefined
  const sessions = [...state.session]

  const patch: Record<string, unknown> = {}

  if (sessionIndex.found) {
    sessions[sessionIndex.index] = { ...sessions[sessionIndex.index], revert: { messageID: messageId } } as Session
    patch.session = sessions
  }

  store.setState(patch)

  // Save input store state before mutations — if the API fails we need to
  // roll back both text and attachments to their previous values.
  const prevInputAttachments = [...useInputStore.getState().attachedFiles]
  const prevInputText = useInputStore.getState().pendingInputText
  const prevInputMode = useInputStore.getState().pendingInputMode

  // Restore reverted message text and file attachments to input
  if (messageText) {
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  }

  // Restore file/image attachments from the target message.
  // Clear existing attachments first — previous revert's attachments
  // must not carry over, even when the current message has no files.
  restoreFilePartsToInput(submittedFileParts)

  // Call SDK and merge authoritative result into store
  try {
    const directory = dir()
    const result = await sdk().session.revert({ sessionID: sessionId, directory, messageID: messageId })
    if (result.data) {
      const current = store.getState()
      const updated = [...current.session]
      const idx = Binary.findIndex(updated, sessionId, (s) => s.id)
      if (idx >= 0) {
        updated[idx] = result.data
        store.setState({ session: updated })
      }
    }
    if (directory) {
      sessionEvents.requestGitRefresh({ directory })
    }
  } catch (err) {
    // Rollback: restore removed messages + revert marker
    const current = store.getState()
    const rollback = [...current.session]
    const idx = Binary.findIndex(rollback, sessionId, (s) => s.id)
    if (idx >= 0) {
      rollback[idx] = { ...rollback[idx], revert: prevRevert } as Session
    }
    store.setState({
      session: rollback,
    })
    // Rollback input store: restore previous text and attachments
    useInputStore.setState({
      pendingInputText: prevInputText,
      pendingInputMode: prevInputMode,
      attachedFiles: prevInputAttachments,
    })
    throw err
  }
}

export async function refetchSessionMessages(sessionId: string): Promise<void> {
  const store = dirStore()
  const result = await sdk().session.messages({ sessionID: sessionId, directory: dir(), limit: MESSAGE_REFETCH_LIMIT })
  const records = (result.data ?? []).filter((record: { info?: { id?: string } }) => !!record?.info?.id)
  if (records.length === 0) return

  store.setState((state) => {
    const materialized = materializeSessionSnapshots(
      state,
      sessionId,
      records.map((record: { info: Message; parts?: Part[] }) => ({
        info: stripMessageDiffSnapshots(record.info),
        parts: record.parts ?? [],
      })),
      { skipPartTypes: MESSAGE_REFETCH_SKIP_PARTS },
    )
    return { message: materialized.message, part: materialized.part }
  })
}

/**
 * Unrevert — restore all previously reverted messages.
 * Restore all previously reverted messages. Aborts if busy, merges result.
 */
export async function unrevertSession(sessionId: string): Promise<void> {
  const store = dirStore()
  const state = store.getState()
  const previousMessageCount = state.message[sessionId]?.length ?? 0

  // Abort if busy
  const status = state.session_status[sessionId]
  if (status && status.type !== "idle") {
    try {
      await sdk().session.abort({ sessionID: sessionId, directory: dir() })
    } catch {
      // ignore
    }
  }

  const result = await sdk().session.unrevert({ sessionID: sessionId, directory: dir() })
  if (result.data) {
    const current = store.getState()
    const sessions = [...current.session]
    const idx = Binary.findIndex(sessions, sessionId, (s) => s.id)
    if (idx >= 0) {
      sessions[idx] = result.data
      store.setState({ session: sessions })
    }
  }
  for (let attempt = 0; attempt < UNREVERT_REFETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(UNREVERT_REFETCH_RETRY_MS)
    await refetchSessionMessages(sessionId)
    const nextMessageCount = store.getState().message[sessionId]?.length ?? 0
    if (nextMessageCount > previousMessageCount) return
  }
}

/**
 * Fork from a user message.
 *
 * 1. Extract text from the message for input restoration
 * 2. Call SDK session.fork()
 * 3. Insert the new session into the child store (so sidebar updates immediately)
 * 4. Switch to new session and set pending input text
 */
export async function forkFromMessage(sessionId: string, messageId: string): Promise<void> {
  const store = dirStore()
  const state = store.getState()

  // Extract message text and file attachments for input restoration.
  // Only non-synthetic text parts — the server adds file content as synthetic
  // text parts that should not be restored. File parts (images, pasted
  // screenshots) are user-originated and must be restored.
  const parts = state.part[messageId] ?? []
  let messageText = ""
  const textParts = parts.filter((p) => p.type === "text" && !isSyntheticPart(p))
  messageText = textParts
    .map(
      (p: Part) =>
        ((p as Record<string, unknown>).text as string) || ((p as Record<string, unknown>).content as string) || "",
    )
    .join("\n")
    .trim()
  const fileParts = parts.filter((p) => p.type === "file" && !isSyntheticPart(p)) as Array<Record<string, unknown>>

  const result = await sdk().session.fork({ sessionID: sessionId, directory: dir(), messageID: messageId })
  if (!result.data) return

  const forkedSession = result.data

  // Insert new session into child store so sidebar updates immediately
  const current = store.getState()
  const sessions = [...current.session]
  const searchResult = Binary.search(sessions, forkedSession.id, (s) => s.id)
  if (!searchResult.found) {
    sessions.splice(searchResult.index, 0, forkedSession)
    store.setState({ session: sessions })
  }

  // Switch to new session
  useSessionUIStore.getState().setCurrentSession(forkedSession.id)

  // Restore forked message text and file attachments to input
  if (messageText) {
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  }
  // Clear existing attachments and restore file parts from the forked message.
  restoreFilePartsToInput(fileParts)
}
