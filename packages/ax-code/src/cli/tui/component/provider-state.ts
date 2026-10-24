import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

export function hasConnectedProvider(connectedIds: readonly string[]) {
  return connectedIds.length > 0
}

export function useConnected() {
  const sync = useSync()
  return createMemo(() => hasConnectedProvider(sync.data.provider_next.connected))
}
