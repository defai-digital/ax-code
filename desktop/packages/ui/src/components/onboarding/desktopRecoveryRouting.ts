import type { RecoveryVariant } from "./desktopRecoveryConfig"

export type RecoveryPrimaryAction = "use-local"

export type RecoveryNextStep = { kind: "local-setup" } | { kind: "switch-default-to-local" }

export function resolveRecoveryNextStep(variant: RecoveryVariant, action: RecoveryPrimaryAction): RecoveryNextStep {
  if (action !== "use-local") {
    throw new Error(`Unsupported local-only recovery action: ${String(action)}`)
  }

  switch (variant) {
    case "local-unavailable":
      return { kind: "local-setup" }
    case "remote-unreachable":
    case "remote-wrong-service":
    case "remote-missing":
    case "missing-default-host":
      return { kind: "switch-default-to-local" }
    default: {
      const exhaustive: never = variant
      throw new Error(`Unhandled RecoveryVariant: ${exhaustive}`)
    }
  }
}
