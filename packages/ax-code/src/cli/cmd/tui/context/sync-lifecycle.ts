export interface SyncLifecycleCoordinator {
  start: () => void
  stop: () => void
  onConnectionChange: (connected: boolean) => void
}

export function registerSyncLifecycle(input: {
  onMount: (callback: () => void) => void
  onCleanup: (callback: () => void) => void
  watchConnection: (source: () => boolean, onChange: (connected: boolean) => void) => void
  unsubscribeEvents: () => void
  sseConnected: () => boolean
  startupCoordinator: SyncLifecycleCoordinator
}) {
  let stopped = false
  const stopOnce = () => {
    if (stopped) return
    stopped = true
    input.startupCoordinator.stop()
  }

  input.onCleanup(() => {
    stopOnce()
    input.unsubscribeEvents()
  })
  input.onMount(() => {
    stopped = false
    input.startupCoordinator.start()
    input.onCleanup(() => {
      stopOnce()
    })
  })
  input.watchConnection(input.sseConnected, (connected) => {
    input.startupCoordinator.onConnectionChange(connected)
  })
}
