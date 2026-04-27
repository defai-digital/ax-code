import type { SyncBootstrapAssemblyRequests } from "./sync-bootstrap-assembly"
import { createSyncBootstrapPhaseSequence, type SyncBootstrapStatus } from "./sync-bootstrap-phase-plan"
import {
  createSyncBootstrapRequests,
  type BootstrapRequestWrap,
  type SyncBootstrapRequestClient,
} from "./sync-bootstrap-request"
import {
  createBootstrapLifecycle,
  runBootstrapPhaseSequence,
  type BootstrapPhaseSequenceStep,
  type BootstrapSpan,
} from "./sync-bootstrap-runner"
import type { BootstrapTask } from "./sync-bootstrap-task"

const BOOTSTRAP_SESSION_LIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface SyncBootstrapFlowTaskGroups {
  blockingTasks: BootstrapTask[]
  coreTasks: BootstrapTask[]
  deferredTasks: BootstrapTask[]
}

export interface SyncBootstrapFlowStoreState {
  status: SyncBootstrapStatus
}

export function createSyncBootstrapFlow<TClient extends SyncBootstrapRequestClient>(input: {
  store: SyncBootstrapFlowStoreState
  setStatus: (status: SyncBootstrapStatus) => void
  setSessionLoaded: (loaded: boolean) => void
  resetSessionSync: () => void
  wrap: BootstrapRequestWrap
  client: TClient
  syncAutonomous: () => Promise<unknown>
  syncDebugEngine: () => Promise<unknown>
  syncIsolation: () => Promise<unknown>
  syncSmartLlm: () => Promise<unknown>
  syncWorkspaces: () => Promise<unknown>
  createTasks: (
    requests: SyncBootstrapAssemblyRequests,
    onProvidersReady: (failed: boolean) => void,
  ) => SyncBootstrapFlowTaskGroups
  createSpan: (name: string) => Exclude<BootstrapSpan, undefined>
  recordStartup: (name: string, data?: Record<string, unknown>) => void
  logWarn: (label: string, data: { error: string }) => void
  logError: (label: string, data: { error: string }) => void
  onFailure: (error: unknown) => Promise<void> | void
  now?: () => number
  createPhaseSequence?: (input: {
    blockingTasks: BootstrapTask[]
    coreTasks: BootstrapTask[]
    deferredTasks: BootstrapTask[]
    getStatus: () => SyncBootstrapStatus
    setStatus: (status: SyncBootstrapStatus) => void
    finishCoreSpan?: BootstrapSpan
    finishDeferredSpan?: BootstrapSpan
    finishStartup: () => void
    logWarn: (label: string, data: { error: string }) => void
    logError: (label: string, data: { error: string }) => void
    recordStartup: (name: string, data?: Record<string, unknown>) => void
  }) => BootstrapPhaseSequenceStep[]
}) {
  const now = input.now ?? Date.now
  const createPhaseSequence = input.createPhaseSequence ?? createSyncBootstrapPhaseSequence

  return {
    async run() {
      const bootstrapLifecycle = createBootstrapLifecycle({
        isStartupBootstrap: input.store.status === "loading",
        createSpan: input.createSpan,
        onFailure: input.onFailure,
      })
      let finishCoreBootstrap = bootstrapLifecycle.createCoreSpan()
      let finishDeferredBootstrap = bootstrapLifecycle.createDeferredSpan()

      try {
        input.resetSessionSync()
        input.setSessionLoaded(false)

        const requests = createSyncBootstrapRequests({
          wrap: input.wrap,
          client: input.client,
          sessionListStart: now() - BOOTSTRAP_SESSION_LIST_WINDOW_MS,
          onSessionListSettled() {
            input.setSessionLoaded(true)
            input.recordStartup("tui.startup.sessionListReady")
          },
          syncIsolation: input.syncIsolation,
          syncAutonomous: input.syncAutonomous,
          syncWorkspaces: input.syncWorkspaces,
          syncDebugEngine: input.syncDebugEngine,
          syncSmartLlm: input.syncSmartLlm,
        })

        const { blockingTasks, coreTasks, deferredTasks } = input.createTasks(requests, (failed) => {
          input.recordStartup("tui.startup.providersReady", { failed })
        })

        await runBootstrapPhaseSequence(
          createPhaseSequence({
            blockingTasks,
            coreTasks,
            deferredTasks,
            getStatus: () => input.store.status,
            setStatus: input.setStatus,
            finishCoreSpan: finishCoreBootstrap,
            finishDeferredSpan: finishDeferredBootstrap,
            finishStartup: () => bootstrapLifecycle.finishStartup(),
            logWarn: input.logWarn,
            logError: input.logError,
            recordStartup: input.recordStartup,
          }),
        )
      } catch (error) {
        await bootstrapLifecycle.fail(error, finishDeferredBootstrap, finishCoreBootstrap)
      }
    },
  }
}
