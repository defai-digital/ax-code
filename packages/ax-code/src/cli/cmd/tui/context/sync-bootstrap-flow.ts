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
// Keep non-critical runtime status probes off the first interactive turn.
// Packaged installs run the TUI backend as a stdio child process, so eager
// LSP/MCP/VCS/workspace probes can otherwise compete with the first prompt.
export const DEFAULT_DEFERRED_BOOTSTRAP_DELAY_MS = 2_000
export const DEFAULT_DEFERRED_BOOTSTRAP_CONCURRENCY = 1
export const AX_CODE_TUI_DEFERRED_BOOTSTRAP_DELAY_MS = "AX_CODE_TUI_DEFERRED_BOOTSTRAP_DELAY_MS"
export const AX_CODE_TUI_DEFERRED_BOOTSTRAP_CONCURRENCY = "AX_CODE_TUI_DEFERRED_BOOTSTRAP_CONCURRENCY"

function parseIntegerEnv(input: {
  env: Record<string, string | undefined>
  name: string
  fallback: number
  min: number
}) {
  const value = input.env[input.name]
  if (!value) return input.fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= input.min ? parsed : input.fallback
}

export function tuiDeferredBootstrapDelayMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: AX_CODE_TUI_DEFERRED_BOOTSTRAP_DELAY_MS,
    fallback: DEFAULT_DEFERRED_BOOTSTRAP_DELAY_MS,
    min: 0,
  })
}

export function tuiDeferredBootstrapConcurrency(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: AX_CODE_TUI_DEFERRED_BOOTSTRAP_CONCURRENCY,
    fallback: DEFAULT_DEFERRED_BOOTSTRAP_CONCURRENCY,
    min: 1,
  })
}

export type BootstrapBackgroundRun = () => Promise<unknown>

export function createLatestBootstrapBackgroundScheduler(input: { onCoalesced?: () => void } = {}) {
  let inFlight = false
  let queued: BootstrapBackgroundRun | undefined

  const execute = (run: BootstrapBackgroundRun) => {
    inFlight = true
    void Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .finally(() => {
        const next = queued
        queued = undefined
        if (next) {
          execute(next)
          return
        }
        inFlight = false
      })
  }

  return (run: BootstrapBackgroundRun) => {
    if (inFlight) {
      queued = run
      input.onCoalesced?.()
      return
    }
    execute(run)
  }
}

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
  deferredDelayMs?: number
  deferredConcurrency?: number
  deferredBackground?: boolean
  now?: () => number
  createPhaseSequence?: (input: {
    blockingTasks: BootstrapTask[]
    coreTasks: BootstrapTask[]
    deferredTasks: BootstrapTask[]
    deferredDelayMs?: number
    deferredConcurrency?: number
    deferredBackground?: boolean
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
  const scheduleBackground = createLatestBootstrapBackgroundScheduler({
    onCoalesced() {
      input.recordStartup("tui.startup.bootstrapDeferredCoalesced")
    },
  })

  return {
    async run() {
      const isStartupBootstrap = input.store.status === "loading"
      const bootstrapLifecycle = createBootstrapLifecycle({
        isStartupBootstrap,
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

        const sequence = createPhaseSequence({
          blockingTasks,
          coreTasks,
          deferredTasks,
          deferredDelayMs: isStartupBootstrap ? (input.deferredDelayMs ?? tuiDeferredBootstrapDelayMs()) : 0,
          deferredConcurrency: input.deferredConcurrency ?? tuiDeferredBootstrapConcurrency(),
          deferredBackground: input.deferredBackground ?? true,
          getStatus: () => input.store.status,
          setStatus: input.setStatus,
          finishCoreSpan: finishCoreBootstrap,
          finishDeferredSpan: finishDeferredBootstrap,
          finishStartup: () => bootstrapLifecycle.finishStartup(),
          logWarn: input.logWarn,
          logError: input.logError,
          recordStartup: input.recordStartup,
        })
        await runBootstrapPhaseSequence(sequence, { scheduleBackground })
      } catch (error) {
        await bootstrapLifecycle.fail(error, finishDeferredBootstrap, finishCoreBootstrap)
      }
    },
  }
}
