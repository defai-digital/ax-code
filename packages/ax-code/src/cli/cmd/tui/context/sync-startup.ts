import { createReconnectRecoveryGate } from "../util/reconnect-recovery"

type IntervalHandle = ReturnType<typeof setInterval>

export interface SyncStartupCoordinator {
  start: () => void
  stop: () => void
  onConnectionChange: (connected: boolean) => void
}

type ReconnectGate = {
  onConnectionChange: (connected: boolean) => void
  dispose?: () => void
}

export function createSyncStartupCoordinator(input: {
  runBootstrapInBackground: () => void
  debugEngineEnabled: boolean
  workflowRuntimeEnabled?: boolean
  pollDebugEngine: () => void
  pollWorkflowDashboard?: () => void
  recoverBootstrap: () => Promise<void> | void
  pollIntervalMs?: number
  setIntervalFn?: (handler: () => void, timeout: number) => IntervalHandle
  clearIntervalFn?: (handle: IntervalHandle) => void
  createReconnectGate?: (input: { recover: () => Promise<void> | void }) => ReconnectGate
}): SyncStartupCoordinator {
  const setIntervalFn = input.setIntervalFn ?? setInterval
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval
  const createReconnectGate = input.createReconnectGate ?? createReconnectRecoveryGate
  const pollIntervalMs = input.pollIntervalMs ?? 10_000

  let runtimePoll: IntervalHandle | undefined
  let reconnectGate: ReconnectGate | undefined
  let started = false
  let stopped = false

  function ensureReconnectGate() {
    reconnectGate ??= createReconnectGate({ recover: input.recoverBootstrap })
    return reconnectGate
  }

  return {
    start() {
      if (started) return
      started = true
      stopped = false
      ensureReconnectGate()
      input.runBootstrapInBackground()
      if (!input.debugEngineEnabled && !input.workflowRuntimeEnabled) return
      runtimePoll = setIntervalFn(() => {
        if (input.debugEngineEnabled) input.pollDebugEngine()
        if (input.workflowRuntimeEnabled) input.pollWorkflowDashboard?.()
      }, pollIntervalMs)
    },
    stop() {
      started = false
      stopped = true
      reconnectGate?.dispose?.()
      reconnectGate = undefined
      if (runtimePoll === undefined) return
      clearIntervalFn(runtimePoll)
      runtimePoll = undefined
    },
    onConnectionChange(connected) {
      if (stopped) return
      ensureReconnectGate().onConnectionChange(connected)
    },
  }
}
