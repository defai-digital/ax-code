import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@ax-code/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { createEffect, on, onMount, onCleanup } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@ax-code/sdk"
import { withTimeout } from "@/util/timeout"
import { Flag } from "@/flag/flag"
import { createTuiStartupSpan, recordTuiStartupOnce } from "@tui/util/startup-trace"
import { createBootstrapController } from "./sync-bootstrap-controller"
import { createStoreBackedRuntimeSyncActions } from "./sync-runtime-adapter"
import { createStoreBackedSessionSyncController } from "./sync-session-sync"
import { createStoreBackedBootstrapTasks } from "./sync-bootstrap-assembly"
import { createInitialSyncState, type SyncStoreState } from "./sync-state"
import { createSyncStartupCoordinator } from "./sync-startup"
import { createSyncBootstrapFlow } from "./sync-bootstrap-flow"
import { createSyncContextValue } from "./sync-result"
import { subscribeStoreBackedSyncEvents } from "./sync-subscription"
import { registerSyncLifecycle } from "./sync-lifecycle"
import { parseSyncedSessionRisk } from "./sync-session-risk"
import { createRuntimeSyncProbeScheduler } from "./sync-runtime-event"
import { DiagnosticLog } from "@/debug/diagnostic-log"

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000
const SESSION_SYNC_REQUEST_TIMEOUT_MS = 10_000
const MAX_SESSION_MESSAGES = 100

function withSyncTimeout<T>(label: string, promise: Promise<T>, timeoutMs = BOOTSTRAP_REQUEST_TIMEOUT_MS) {
  return withTimeout(promise, timeoutMs, `${label} timed out after ${timeoutMs}ms`)
}

function sessionRiskURL(input: { baseUrl: string; sessionID: string; directory?: string }) {
  const url = new URL(`${input.baseUrl}/session/${encodeURIComponent(input.sessionID)}/risk`)
  url.searchParams.set("quality", "true")
  url.searchParams.set("findings", "true")
  url.searchParams.set("envelopes", "true")
  url.searchParams.set("debug", "true")
  if (input.directory) url.searchParams.set("directory", input.directory)
  return url.toString()
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
      syncAutonomous,
      syncSmartLlm,
      syncIsolation,
    } = createStoreBackedRuntimeSyncActions({
      url: sdk.url,
      directory: sdk.directory,
      fetch: sdk.fetch,
      client: sdk.client,
      debugEngineEnabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
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
      fetchMessages: (sessionID) => sdk.client.session.messages({ sessionID, limit: 100 }),
      fetchTodo: (sessionID) => sdk.client.session.todo({ sessionID }),
      fetchDiff: (sessionID) => sdk.client.session.diff({ sessionID }),
      fetchRisk: async (sessionID) => {
        const response = await sdk.fetch(
          sessionRiskURL({
            baseUrl: sdk.url,
            sessionID,
            directory: sdk.directory,
          }),
        )
        if (!response.ok) throw new Error(`session risk request failed: ${response.status}`)
        return { data: parseSyncedSessionRisk(await response.json()) }
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
      client: sdk.client,
      syncIsolation,
      syncAutonomous,
      syncWorkspaces,
      syncDebugEngine,
      syncSmartLlm,
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
      run: bootstrapFlow.run,
    })
    const bootstrap = bootstrapController.run
    const startupCoordinator = createSyncStartupCoordinator({
      runBootstrapInBackground: () => bootstrapController.runInBackground(),
      debugEngineEnabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      pollDebugEngine: () => {
        void syncDebugEngine()
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
      scheduleRuntimeProbe: runtimeProbeScheduler.schedule,
      bootstrap,
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
      workspaceSync: syncWorkspaces,
      bootstrap,
    })
  },
})
