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
  pollDebugEngine: () => void
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

  let debugEnginePoll: IntervalHandle | undefined
  let reconnectGate: ReconnectGate | undefined
  let started = false

  function ensureReconnectGate() {
    reconnectGate ??= createReconnectGate({ recover: input.recoverBootstrap })
    return reconnectGate
  }

  return {
    start() {
      if (started) return
      started = true
      ensureReconnectGate()
      input.runBootstrapInBackground()
      if (!input.debugEngineEnabled) return
      debugEnginePoll = setIntervalFn(() => {
        input.pollDebugEngine()
      }, pollIntervalMs)
    },
    stop() {
      started = false
      reconnectGate?.dispose?.()
      reconnectGate = undefined
      if (!debugEnginePoll) return
      clearIntervalFn(debugEnginePoll)
      debugEnginePoll = undefined
    },
    onConnectionChange(connected) {
      ensureReconnectGate().onConnectionChange(connected)
    },
  }
}
