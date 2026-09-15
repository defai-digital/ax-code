import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

export function useConnected() {
  const sync = useSync()
  return createMemo(() => sync.data.provider_next.connected.some((id) => id !== "opencode"))
}
