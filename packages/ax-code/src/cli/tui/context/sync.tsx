import type { Message, Provider, Session, Part, Todo, SessionStatus } from "@ax-code/sdk/v2"
import { createStore, produce } from "solid-js/store"
import { createSessionTreeIndex } from "../util/session-tree"
import { useSDK } from "@tui/context/sdk"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { createEffect, createMemo, on, onMount, onCleanup, batch } from "solid-js"
import { Log } from "@/util/log"
import { SessionGoal } from "@/session/goal"
import { withTimeout } from "@/util/timeout"
import { Flag } from "@/flag/flag"
import { createTuiStartupSpan, recordTuiStartupOnce } from "@tui/util/startup-trace"
import { createBootstrapController } from "./sync-bootstrap-controller"
import { createStoreBackedRuntimeSyncActions } from "./sync-runtime-adapter"
import { createStoreBackedSessionSyncController } from "./sync-session-sync"
import { applyEarlierMessagePage } from "./sync-session-store"
import {
  adoptHistoryCursor,
  MAX_LOADED_SESSION_MESSAGES,
  MAX_SESSION_MESSAGES,
  sessionMessageLimit,
} from "./sync-message-window"
import { createEarlierMessageLoader } from "./sync-earlier-messages"
import { createStoreBackedBootstrapTasks } from "./sync-bootstrap-assembly"
import {
  applyProviderBootstrapState,
  createProviderBootstrapSuccess,
  normalizeProviderBootstrapPayload,
} from "./sync-bootstrap-store"
import { createInitialSyncState, type SyncStoreState } from "./sync-state"
import { createSyncStartupCoordinator } from "./sync-startup"
import { createSyncBootstrapFlow } from "./sync-bootstrap-flow"
import { createSyncContextValue } from "./sync-result"
import { subscribeStoreBackedSyncEvents } from "./sync-subscription"
import { registerSyncLifecycle } from "./sync-lifecycle"
import { parseSyncedSessionRisk } from "./sync-session-risk"
import { createRuntimeSyncProbeScheduler } from "./sync-runtime-probe"
import { useToast } from "../ui/toast"
import { useLanguage } from "./language"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { sessionDerivedRequestHeaders, sessionGoalURL, sessionRiskURL } from "./sync-session-urls"

export { MAX_SESSION_MESSAGES, MAX_LOADED_SESSION_MESSAGES } from "./sync-message-window"

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000
const SESSION_SYNC_REQUEST_TIMEOUT_MS = 10_000
// Floor between two drift-triggered session refetches (see resyncSession).
const ELIDED_DRIFT_RESYNC_MIN_INTERVAL_MS = 5_000

function withSyncTimeout<T>(label: string, promise: Promise<T>, timeoutMs = BOOTSTRAP_REQUEST_TIMEOUT_MS) {
  return withTimeout(promise, timeoutMs, `${label} timed out after ${timeoutMs}ms`)
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<SyncStoreState>(createInitialSyncState())

    const sdk = useSDK()
    const {
      syncWorkspaces,
      syncMcpStatus,
      syncLspStatus,
      syncDebugEngine,
      syncWorkflowDashboard,
      syncAutonomous,
      syncSmartLlm,
      syncSuperLong,
      syncIsolation,
    } = createStoreBackedRuntimeSyncActions({
      url: sdk.url,
      // Live accessors: sdk.setWorkspace() swaps the client and directory when a
      // session in a different workspace is opened. Reading them per request keeps
      // runtime status (isolation, autonomous, MCP/LSP, etc.) scoped to the viewed
      // session instead of the launch directory.
      directory: () => sdk.directory,
      fetch: sdk.fetch,
      client: () => sdk.client,
      debugEngineEnabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      workflowRuntimeEnabled: Flag.AX_CODE_WORKFLOW_RUNTIME,
      setStore,
    })
    const runtimeProbeScheduler = createRuntimeSyncProbeScheduler({
      onCoalesced(key) {
        DiagnosticLog.recordProcess("tui.runtimeProbeCoalesced", { key })
      },
    })
    onCleanup(() => runtimeProbeScheduler.dispose())

    const sessionSync = createStoreBackedSessionSyncController({
      timeoutMs: SESSION_SYNC_REQUEST_TIMEOUT_MS,
      withTimeout: withSyncTimeout,
      setStore,
      fetchSession: (sessionID) => sdk.client.session.get({ sessionID }, { throwOnError: true }),
      fetchMessages: async (sessionID) => {
        const result = await sdk.client.session.messages(
          { sessionID, limit: sessionMessageLimit(store, sessionID) },
          { throwOnError: true },
        )
        return { ...result, history: { cursor: result.response.headers.get("X-Next-Cursor") || undefined } }
      },
      fetchTodo: (sessionID) => sdk.client.session.todo({ sessionID }, { throwOnError: true }),
      fetchDiff: (sessionID) => sdk.client.session.diff({ sessionID }, { throwOnError: true }),
      fetchRisk: async (sessionID) => {
        const response = await sdk.fetch(
          sessionRiskURL({
            baseUrl: sdk.url,
            sessionID,
          }),
          { headers: sessionDerivedRequestHeaders(sdk.directory) },
        )
        if (!response.ok) throw new Error(`session risk request failed: ${response.status}`)
        return { data: parseSyncedSessionRisk(await response.json()) }
      },
      fetchGoal: async (sessionID) => {
        const response = await sdk.fetch(
          sessionGoalURL({
            baseUrl: sdk.url,
            sessionID,
          }),
          { headers: sessionDerivedRequestHeaders(sdk.directory) },
        )
        if (!response.ok) throw new Error(`session goal request failed: ${response.status}`)
        const parsed = SessionGoal.PublicInfo.nullable().safeParse(await response.json())
        if (!parsed.success) {
          Log.Default.warn("session goal payload failed validation", { sessionID })
          return { data: null }
        }
        return { data: parsed.data }
      },
      onMissingSnapshot(sessionID) {
        Log.Default.warn("session sync returned no session data", { sessionID })
      },
    })

    const earlierMessages = createEarlierMessageLoader<Message, Part>({
      store,
      createFetchPage() {
        const client = sdk.client
        return (sessionID, before, limit, signal) =>
          client.session.messages({ sessionID, before, limit }, { throwOnError: true, signal })
      },
      applyPage(sessionID, page, cursor) {
        setStore(
          produce((draft) => {
            applyEarlierMessagePage(draft, sessionID, page, cursor, { maxMessages: MAX_LOADED_SESSION_MESSAGES })
          }),
        )
      },
    })
    const clearSession = (sessionID: string) => {
      earlierMessages.clear(sessionID)
      sessionSync.clear(sessionID)
    }
    onCleanup(() => earlierMessages.reset())

    const exit = useExit()
    const args = useArgs()
    // SyncProvider mounts inside ToastProvider and LanguageProvider, so the
    // recovery-failure toast below can resolve both contexts here.
    const toast = useToast()
    const uiText = useLanguage().t
    const bootstrapFlow = createSyncBootstrapFlow({
      store,
      setStatus: (status) => setStore("status", status),
      setSessionLoaded: (loaded) => setStore("session_loaded", loaded),
      resetSessionSync() {
        earlierMessages.reset()
        sessionSync.reset()
      },
      wrap: withSyncTimeout,
      // Live accessor so a bootstrap re-run after a workspace switch (reconnect
      // recovery) rebuilds its requests against the current workspace's client.
      client: () => sdk.client,
      syncIsolation,
      syncAutonomous,
      syncWorkspaces,
      syncDebugEngine,
      syncWorkflowDashboard,
      syncSmartLlm,
      syncSuperLong,
      createTasks(requests, onProvidersReady, isRequestCurrent) {
        return createStoreBackedBootstrapTasks({
          continueFromArgs: !!args.continue,
          store,
          setStore,
          requests,
          onProvidersReady,
          isRequestCurrent,
        })
      },
      createSpan: createTuiStartupSpan,
      recordStartup: recordTuiStartupOnce,
      logWarn(label, data) {
        Log.Default.warn(label, data)
      },
      logError(label, data) {
        Log.Default.error(label, data)
      },
      onFailure(error, context) {
        if (context.startup) {
          Log.Default.error("tui bootstrap failed", { error })
          return exit(error)
        }
        // A bootstrap re-run after a reconnect is a best-effort refresh of an
        // already-running TUI; a transient failure must surface as a toast
        // instead of exiting the whole session.
        Log.Default.error("tui bootstrap recovery failed", { error })
        toast.show({
          message: uiText("ui.reconnectedButRefreshingTheSessionStateFailed"),
          variant: "error",
        })
      },
    })

    const bootstrapController = createBootstrapController({
      name: "sync-bootstrap",
      run: bootstrapFlow.run,
    })
    onCleanup(() => bootstrapFlow.stop())
    const bootstrap = bootstrapController.run
    const startupCoordinator = createSyncStartupCoordinator({
      runBootstrapInBackground: () => bootstrapController.runInBackground(),
      debugEngineEnabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      workflowRuntimeEnabled: Flag.AX_CODE_WORKFLOW_RUNTIME,
      disableWorkflowDashboardPoll: Flag.AX_CODE_TUI_DISABLE_WORKFLOW_DASHBOARD_POLL,
      pollDebugEngine: () => {
        void syncDebugEngine()
      },
      pollWorkflowDashboard: () => {
        void syncWorkflowDashboard()
      },
      recoverBootstrap: bootstrap,
    })

    // `provider.updated` and `server.connected` can each trigger their own
    // refreshProviders() call in close succession (see the comment below);
    // neither awaits the other, so a slower response from the first request
    // could otherwise land after a faster, more complete response from the
    // second and clobber the store with stale provider data. Only the
    // response of the most recently issued request is applied.
    let providerRefreshGeneration = 0
    const driftResyncAt = new Map<string, number>()
    const unsubscribeEvents = subscribeStoreBackedSyncEvents<
      Session,
      Todo,
      Snapshot.FileDiff,
      SessionStatus,
      Message,
      Part,
      SyncStoreState
    >({
      listen: sdk.event.listen,
      getAutonomous: () => store.autonomous,
      getActiveSessionID: () => store.active_session,
      getTranscriptGeneration: () => store.transcript_generation,
      getAutoReplyRequests: () => store.superLong,
      batch,
      setStore,
      clearSessionSyncState: clearSession,
      replyPermission(payload) {
        return sdk.client.permission.reply(payload)
      },
      replyQuestion(payload) {
        return sdk.client.question.reply(payload)
      },
      syncMcpStatus,
      syncLspStatus,
      syncDebugEngine,
      syncWorkflowDashboard,
      scheduleRuntimeProbe: runtimeProbeScheduler.schedule,
      bootstrap,
      // Targeted provider refetch on `provider.updated` (background discovery
      // finished). Re-reads only the provider list and merges it into the
      // store so the model picker gains discovered models without re-running
      // the full bootstrap.
      async refreshProviders() {
        const requestID = ++providerRefreshGeneration
        const response = await sdk.client.config.providers({}, { throwOnError: true })
        if (requestID !== providerRefreshGeneration) return
        const data = normalizeProviderBootstrapPayload<Provider>(response.data)
        setStore(
          produce((draft) => {
            applyProviderBootstrapState(draft, createProviderBootstrapSuccess(data))
          }),
        )
      },
      // An elided part snapshot names the prefix the worker believes this
      // renderer holds; a mismatch means a delta went missing. Refetch the
      // session rather than wait for the terminal snapshot, at most once per
      // session per window so a persistent disagreement cannot loop.
      resyncSession(sessionID) {
        const now = Date.now()
        if (now - (driftResyncAt.get(sessionID) ?? 0) < ELIDED_DRIFT_RESYNC_MIN_INTERVAL_MS) return
        driftResyncAt.set(sessionID, now)
        void sessionSync.sync(sessionID, { force: true }).catch((error) => {
          Log.Default.warn("session resync after elided snapshot drift failed", { error })
        })
      },
      onWarn(label, error) {
        Log.Default.warn(label, { error })
      },
      maxSessionMessages: MAX_SESSION_MESSAGES,
      sessionMessageLimit: (sessionID) => sessionMessageLimit(store, sessionID),
      onHandlerError({ type, error }) {
        Log.Default.error("sync event handler error", { type, error })
      },
    })
    registerSyncLifecycle({
      onMount,
      onCleanup,
      watchConnection(source, onChange) {
        createEffect(on(source, onChange))
      },
      unsubscribeEvents,
      sseConnected: () => sdk.sseConnected,
      startupCoordinator,
    })

    // One tree index for every consumer that reads the full session list.
    // Iterating the store array and reading id/parentID is what the memo
    // tracks, so in-place splices and parent changes rebuild it while title
    // and status writes do not; consumers keep their own status reads.
    const sessionTree = createMemo(() => createSessionTreeIndex(store.session))
    return createSyncContextValue({
      store,
      setStore,
      sessionSync: sessionSync.sync,
      sessionClear: clearSession,
      async sessionLoadEarlier(sessionID) {
        const result = await earlierMessages.loadEarlier(sessionID)
        const loaded = store.message[sessionID]?.length ?? 0
        if (result !== "exhausted" || !store.message_truncated[sessionID] || loaded >= MAX_LOADED_SESSION_MESSAGES)
          return result
        // Truncated without a usable cursor (a live update evicted the oldest
        // loaded message): widen the window and refetch it from the newest end.
        setStore("message_window", sessionID, Math.min(loaded + MAX_SESSION_MESSAGES, MAX_LOADED_SESSION_MESSAGES))
        await sessionSync.sync(sessionID, { force: true })
        return "loaded"
      },
      sessionAdoptHistoryCursor(sessionID, cursor) {
        setStore(produce((draft) => adoptHistoryCursor(draft, sessionID, cursor)))
      },
      workspaceSync: syncWorkspaces,
      runtime: {
        syncSuperLong,
      },
      bootstrap,
      sessionTree,
    })
  },
})
