import { createContext, useContext } from "solid-js"
import type { useSync } from "@tui/context/sync"
import type { useTuiConfig } from "../../context/tui-config"

export type SessionRouteContextValue = {
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  userMetadataPreference: () => "auto" | "full" | "compact"
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}

export const SessionRouteContext = createContext<SessionRouteContextValue>()

export function useSessionRouteContext() {
  const ctx = useContext(SessionRouteContext)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
