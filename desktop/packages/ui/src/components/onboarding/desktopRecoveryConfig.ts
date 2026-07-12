import { redactSensitiveUrl } from "@/lib/desktopHosts"

export type RecoveryVariant =
  | "local-unavailable"
  | "remote-unreachable"
  | "remote-wrong-service"
  | "remote-missing"
  | "missing-default-host"

export type DesktopRecoveryConfig = {
  title: string
  description: string
  titleKey: string
  descriptionKey: string
  descriptionParams?: Record<string, string>
  iconKey: "local" | "remote"
  showRetry: boolean
  retryLabel?: string
  retryLabelKey?: string
  showUseLocal: boolean
  /** Label for the "use local" primary action button */
  useLocalLabel: string
  useLocalLabelKey: string
}

function formatHostDisplay(hostLabel?: string, hostUrl?: string): string | undefined {
  if (hostLabel?.trim()) return redactSensitiveUrl(hostLabel.trim())
  if (hostUrl) return redactSensitiveUrl(hostUrl)
  return undefined
}

export function getDesktopRecoveryConfig(
  variant: RecoveryVariant,
  hostLabel?: string,
  hostUrl?: string,
): DesktopRecoveryConfig {
  switch (variant) {
    case "local-unavailable":
      return {
        title: "Local ax-code Unavailable",
        description: "AX Code CLI could not be started or is not installed. Install AX Code to continue locally.",
        titleKey: "onboarding.desktopRecovery.localUnavailable.title",
        descriptionKey: "onboarding.desktopRecovery.localUnavailable.description",
        iconKey: "local",
        showRetry: true,
        retryLabel: "Retry Local",
        retryLabelKey: "onboarding.desktopRecovery.localUnavailable.retry",
        showUseLocal: true,
        useLocalLabel: "Set Up Local",
        useLocalLabelKey: "onboarding.desktopRecovery.localUnavailable.useLocal",
      }

    case "remote-missing":
      return {
        title: "No Default Connection",
        description: "Your saved default connection could not be found. Choose how you want to connect.",
        titleKey: "onboarding.desktopRecovery.noDefaultConnection.title",
        descriptionKey: "onboarding.desktopRecovery.noDefaultConnection.description",
        iconKey: "local",
        showRetry: false,
        showUseLocal: true,
        useLocalLabel: "Use Local",
        useLocalLabelKey: "onboarding.desktopRecovery.common.useLocal",
      }

    case "remote-unreachable": {
      const host = formatHostDisplay(hostLabel, hostUrl)
      return {
        title: "Remote Server Unreachable",
        description: `Could not connect to "${host || "the remote server"}". Check your network connection and verify the server address.`,
        titleKey: "onboarding.desktopRecovery.remoteUnreachable.title",
        descriptionKey: "onboarding.desktopRecovery.remoteUnreachable.description",
        descriptionParams: host ? { host } : undefined,
        iconKey: "remote",
        showRetry: false,
        showUseLocal: true,
        useLocalLabel: "Use Local",
        useLocalLabelKey: "onboarding.desktopRecovery.common.useLocal",
      }
    }

    case "remote-wrong-service": {
      const host = formatHostDisplay(hostLabel, hostUrl)
      return {
        title: "Incompatible Server",
        description: `The server at "${host || "unknown"}" is not running AX Code. Verify the address points to an AX Code server.`,
        titleKey: "onboarding.desktopRecovery.incompatibleServer.title",
        descriptionKey: "onboarding.desktopRecovery.incompatibleServer.description",
        descriptionParams: host ? { host } : undefined,
        iconKey: "remote",
        showRetry: false,
        showUseLocal: true,
        useLocalLabel: "Use Local",
        useLocalLabelKey: "onboarding.desktopRecovery.common.useLocal",
      }
    }

    case "missing-default-host":
      return {
        title: "No Default Connection",
        description: "Your saved default connection could not be found. Choose how you want to connect.",
        titleKey: "onboarding.desktopRecovery.noDefaultConnection.title",
        descriptionKey: "onboarding.desktopRecovery.noDefaultConnection.description",
        iconKey: "local",
        showRetry: false,
        showUseLocal: true,
        useLocalLabel: "Use Local",
        useLocalLabelKey: "onboarding.desktopRecovery.common.useLocal",
      }

    default: {
      // TypeScript exhaustive check - this should never be reached
      const exhaustive: never = variant
      throw new Error(`Unknown recovery variant: ${exhaustive}`)
    }
  }
}
