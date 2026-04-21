export const RECONNECT_STABILIZE_MS = 2_000

export function createReconnectRecoveryGate(input: {
  recover: () => void | Promise<void>
}) {
  let hasConnectedOnce = false
  let connected = false
  let disposed = false
  let inFlight: Promise<void> | undefined
  let pendingError: unknown | undefined
  let pendingReconnect = false
  let stabilizeTimer: ReturnType<typeof setTimeout> | undefined

  const runRecovery = () => {
    if (disposed || !connected || !pendingReconnect || inFlight) return inFlight
    pendingReconnect = false
    inFlight = Promise.resolve()
      .then(input.recover)
      .catch((error) => {
        pendingError = error
      })
      .finally(() => {
        inFlight = undefined
        runRecovery()
      })
    return inFlight
  }

  return {
    onConnectionChange(nextConnected: boolean) {
      if (disposed) return
      connected = nextConnected
      if (!connected) {
        // Connection dropped — cancel any pending stabilization so we
        // don't trigger recovery on a stale reconnect.
        if (stabilizeTimer) {
          clearTimeout(stabilizeTimer)
          stabilizeTimer = undefined
        }
        return
      }
      if (!hasConnectedOnce) {
        hasConnectedOnce = true
        return
      }
      // Wait for connection to stabilize before triggering recovery.
      // Prevents rapid reconnect cycles from network flaps (e.g.
      // laptop switching between WiFi and cellular during travel).
      if (stabilizeTimer) clearTimeout(stabilizeTimer)
      stabilizeTimer = setTimeout(() => {
        stabilizeTimer = undefined
        if (!connected) return
        pendingReconnect = true
        void runRecovery()
      }, RECONNECT_STABILIZE_MS)
    },
    dispose() {
      disposed = true
      connected = false
      pendingReconnect = false
      if (stabilizeTimer) {
        clearTimeout(stabilizeTimer)
        stabilizeTimer = undefined
      }
    },
    async waitForIdle() {
      while (inFlight) {
        await inFlight
      }
      if (pendingError !== undefined) {
        const error = pendingError
        pendingError = undefined
        throw error
      }
    },
  }
}
