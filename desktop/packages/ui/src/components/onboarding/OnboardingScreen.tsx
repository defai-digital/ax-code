import React from "react"
import { ChooserScreen } from "./ChooserScreen"
import { LocalSetupScreen } from "./LocalSetupScreen"
import { RecoveryScreen } from "./RecoveryScreen"
import type { RecoveryVariant } from "./DesktopConnectionRecovery"

export type OnboardingScreenMode = "first-launch" | "local-setup" | "recovery"

type OnboardingScreenProps = {
  /** Callback when user goes back from local-setup */
  onBack?: () => void
  /** Callback when CLI becomes available */
  onCliAvailable?: () => void
  /** Screen mode to render */
  mode?: OnboardingScreenMode
  /** Recovery variant (only used when mode is 'recovery') */
  recoveryVariant?: RecoveryVariant
  /** Host URL for recovery context */
  recoveryHostUrl?: string
  /** Host label for recovery context */
  recoveryHostLabel?: string
  /** Callback when user enters local setup from recovery */
  onEnterLocalSetup?: () => void
}

export function OnboardingScreen({
  onBack,
  onCliAvailable,
  mode = "first-launch",
  recoveryVariant = "missing-default-host",
  recoveryHostUrl,
  recoveryHostLabel,
  onEnterLocalSetup,
}: OnboardingScreenProps) {
  const [recoveryEnteredLocalSetup, setRecoveryEnteredLocalSetup] = React.useState(false)

  // Reset transient recovery state when the flow identity changes.
  React.useEffect(() => {
    setRecoveryEnteredLocalSetup(false)
  }, [mode, recoveryVariant, recoveryHostUrl, recoveryHostLabel])

  // Derive the effective mode: recovery → local-setup can fall through to the
  // existing local-setup branch instead of getting stuck behind the early return.
  const effectiveMode = recoveryEnteredLocalSetup ? "local-setup" : mode

  // Recovery mode
  if (effectiveMode === "recovery") {
    return (
      <RecoveryScreen
        variant={recoveryVariant}
        hostUrl={recoveryHostUrl}
        hostLabel={recoveryHostLabel}
        onEnterLocalSetup={() => {
          setRecoveryEnteredLocalSetup(true)
          onEnterLocalSetup?.()
        }}
      />
    )
  }

  // Local-setup mode
  if (effectiveMode === "local-setup") {
    return (
      <LocalSetupScreen
        onBack={() => {
          if (recoveryEnteredLocalSetup) {
            setRecoveryEnteredLocalSetup(false)
          } else {
            onBack?.()
          }
        }}
        onCliAvailable={onCliAvailable}
      />
    )
  }

  // First-launch mode (default)
  return <ChooserScreen onCliAvailable={onCliAvailable} />
}
