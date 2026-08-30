import { useConfigStore } from "@/stores/useConfigStore"
import { useConnectionStore } from "@/lib/event-stream/connection-state"

export function useAxCodeReadiness() {
  const isInitialized = useConfigStore((s) => s.isInitialized)
  const initializationError = useConfigStore((s) => s.initializationError)
  const connectionPhase = useConnectionStore((s) => s.phase)
  const isUnavailable = !isInitialized && initializationError === "init_error"

  return {
    isReady: isInitialized,
    isLoading: !isInitialized && !isUnavailable,
    isUnavailable,
    connectionPhase,
  }
}
