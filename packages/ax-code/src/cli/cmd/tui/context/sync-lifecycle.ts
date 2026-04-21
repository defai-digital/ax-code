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
  input.onCleanup(() => {
    input.startupCoordinator.stop()
    input.unsubscribeEvents()
  })
  input.onMount(() => {
    input.startupCoordinator.start()
    input.onCleanup(() => input.startupCoordinator.stop())
  })
  input.watchConnection(input.sseConnected, (connected) => {
    input.startupCoordinator.onConnectionChange(connected)
  })
}
