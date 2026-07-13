import type { Message, Provider, Session, Part, Todo, SessionStatus } from "@ax-code/sdk/v2"
import { createStore, produce } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { createEffect, on, onMount, onCleanup } from "solid-js"
import { Log } from "@/util/log"
import type { SessionGoal } from "@/session/goal"
import { withTimeout } from "@/util/timeout"
import { Flag } from "@/flag/flag"
import { createTuiStartupSpan, recordTuiStartupOnce } from "@tui/util/startup-trace"
import { createBootstrapController } from "./sync-bootstrap-controller"
import { createStoreBackedRuntimeSyncActions } from "./sync-runtime-adapter"
import { createStoreBackedSessionSyncController } from "./sync-session-sync"
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
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { sessionDerivedRequestHeaders, sessionGoalURL, sessionRiskURL } from "./sync-session-urls"

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000
const SESSION_SYNC_REQUEST_TIMEOUT_MS = 10_000
const MAX_SESSION_MESSAGES = 100

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
      fetchMessages: (sessionID) => sdk.client.session.messages({ sessionID, limit: 100 }, { throwOnError: true }),
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
        return { data: (await response.json()) as SessionGoal.PublicInfo | null }
      },
      onMissingSnapshot(sessionID) {
        Log.Default.warn("session sync returned no session data", { sessionID })
      },
    })

    const exit = useExit()
    const args = useArgs()
    const bootstrapFlow = createSyncBootstrapFlow({
      store,
      setStatus: (status) => setStore("status", status),
      setSessionLoaded: (loaded) => setStore("session_loaded", loaded),
      resetSessionSync: sessionSync.reset,
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
      createTasks(requests, onProvidersReady) {
        return createStoreBackedBootstrapTasks({
          continueFromArgs: !!args.continue,
          store,
          setStore,
          requests,
          onProvidersReady,
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
      async onFailure(error) {
        Log.Default.error("tui bootstrap failed", { error })
        await exit(error)
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
      getAutoReplyRequests: () => store.superLong,
      setStore,
      clearSessionSyncState: sessionSync.clear,
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
        const response = await sdk.client.config.providers({}, { throwOnError: true })
        const data = normalizeProviderBootstrapPayload<Provider>(response.data)
        setStore(
          produce((draft) => {
            applyProviderBootstrapState(draft, createProviderBootstrapSuccess(data))
          }),
        )
      },
      onWarn(label, error) {
        Log.Default.warn(label, { error })
      },
      maxSessionMessages: MAX_SESSION_MESSAGES,
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

    return createSyncContextValue({
      store,
      setStore,
      sessionSync: sessionSync.sync,
      sessionClear: sessionSync.clear,
      workspaceSync: syncWorkspaces,
      runtime: {
        syncSuperLong,
      },
      bootstrap,
    })
  },
})
