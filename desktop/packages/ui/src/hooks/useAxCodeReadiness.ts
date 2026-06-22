import { useConfigStore } from "@/stores/useConfigStore"

export function useAxCodeReadiness() {
  const isInitialized = useConfigStore((s) => s.isInitialized)
  const connectionPhase = useConfigStore((s) => s.connectionPhase)
  const lastDisconnectReason = useConfigStore((s) => s.lastDisconnectReason)
  const isUnavailable = !isInitialized && lastDisconnectReason === "init_error"

  return {
    isReady: isInitialized,
    isLoading: !isInitialized && !isUnavailable,
    isUnavailable,
    connectionPhase,
  }
}
