import React from "react"
import { isTauriShell, restartDesktopApp } from "@/lib/desktop"
import { DesktopConnectionRecovery, type RecoveryVariant } from "./DesktopConnectionRecovery"
import { resolveRecoveryNextStep } from "./desktopRecoveryRouting"
import { desktopHostsGet, desktopHostsSet } from "@/lib/desktopHosts"
import { API_ENDPOINTS } from "@/lib/http"

type RecoveryScreenProps = {
  /** Recovery variant */
  variant: RecoveryVariant
  /** Host URL for recovery context */
  hostUrl?: string
  /** Host label for recovery context */
  hostLabel?: string
  /** Callback when user wants to retry */
  onRetry?: () => void
  /** Callback when entering local setup */
  onEnterLocalSetup?: () => void
  /** Whether retry action is in progress */
  isRetrying?: boolean
}

export function RecoveryScreen({
  variant,
  hostUrl,
  hostLabel,
  onRetry,
  onEnterLocalSetup,
  isRetrying = false,
}: RecoveryScreenProps) {
  // Keep the compatibility write local-only for older desktop shells.
  const persistLocalChoice = React.useCallback(async () => {
    if (!isTauriShell()) return

    const config = await desktopHostsGet()
    await desktopHostsSet({
      ...config,
      hosts: [],
      defaultHostId: "local",
      initialHostChoiceCompleted: true,
    })
  }, [])

  const handleRecoveryRetry = React.useCallback(async () => {
    // In desktop boot flow, always restart the entire Tauri app so Rust
    // can re-evaluate the boot outcome.
    if (isTauriShell()) {
      await restartDesktopApp()
      return
    }

    await fetch(API_ENDPOINTS.config.reload, { method: "POST" })
    onRetry?.()
  }, [onRetry])

  const handleRecoveryUseLocal = React.useCallback(async () => {
    const step = resolveRecoveryNextStep(variant, "use-local")
    if (step.kind === "local-setup") {
      // local-unavailable + local → enter local-setup subflow without reload
      onEnterLocalSetup?.()
      return
    }
    // switch-default-to-local → persist local choice and restart
    await persistLocalChoice()

    if (isTauriShell()) {
      await restartDesktopApp()
      return
    }

    window.location.reload()
  }, [variant, persistLocalChoice, onEnterLocalSetup])

  return (
    <DesktopConnectionRecovery
      variant={variant}
      hostLabel={hostLabel}
      hostUrl={hostUrl}
      onRetry={handleRecoveryRetry}
      onUseLocal={handleRecoveryUseLocal}
      isRetrying={isRetrying}
    />
  )
}
