import { describe, expect, test } from "vitest"
import { resolveRecoveryNextStep } from "./desktopRecoveryRouting"
import type { RecoveryPrimaryAction, RecoveryNextStep } from "./desktopRecoveryRouting"
import type { RecoveryVariant } from "./desktopRecoveryConfig"

// ---------------------------------------------------------------------------
// Compile-time completeness: this Record must list every RecoveryVariant key
// and every RecoveryPrimaryAction key. Adding a new variant/action to the
// union without updating this table will cause a type error.
// ---------------------------------------------------------------------------
const EXPECTED_ROUTING: Record<RecoveryVariant, Record<RecoveryPrimaryAction, RecoveryNextStep["kind"]>> = {
  "local-unavailable": {
    "use-local": "local-setup",
  },
  "remote-unreachable": {
    "use-local": "switch-default-to-local",
  },
  "remote-wrong-service": {
    "use-local": "switch-default-to-local",
  },
  "remote-missing": {
    "use-local": "switch-default-to-local",
  },
  "missing-default-host": {
    "use-local": "switch-default-to-local",
  },
}

describe("resolveRecoveryNextStep", () => {
  for (const [variant, actions] of Object.entries(EXPECTED_ROUTING) as [
    RecoveryVariant,
    Record<RecoveryPrimaryAction, RecoveryNextStep["kind"]>,
  ][]) {
    for (const [action, expectedKind] of Object.entries(actions) as [
      RecoveryPrimaryAction,
      RecoveryNextStep["kind"],
    ][]) {
      test(`${variant} + ${action} -> ${expectedKind}`, () => {
        const result = resolveRecoveryNextStep(variant, action)
        expect(result).toEqual({ kind: expectedKind })
      })
    }
  }
})
