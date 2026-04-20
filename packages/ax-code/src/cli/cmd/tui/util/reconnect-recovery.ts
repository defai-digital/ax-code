export function createReconnectRecoveryGate(input: {
  recover: () => void | Promise<void>
}) {
  let hasConnectedOnce = false
  let connected = false
  let inFlight: Promise<void> | undefined
  let pendingReconnect = false

  const runRecovery = () => {
    if (!connected || !pendingReconnect || inFlight) return inFlight
    pendingReconnect = false
    inFlight = Promise.resolve(input.recover()).finally(() => {
      inFlight = undefined
      runRecovery()
    })
    return inFlight
  }

  return {
    onConnectionChange(nextConnected: boolean) {
      connected = nextConnected
      if (!connected) return
      if (!hasConnectedOnce) {
        hasConnectedOnce = true
        return
      }
      pendingReconnect = true
      void runRecovery()
    },
    async waitForIdle() {
      while (inFlight) {
        await inFlight
      }
    },
  }
}
