import { describe, expect, test } from "bun:test"
import { BuiltinServerProfiles } from "../../src/lsp/server-profile"

describe("BuiltinServerProfiles", () => {
  test("marks lint servers as auxiliary and unsupported for semantic navigation", () => {
    for (const id of ["eslint", "oxlint", "biome"] as const) {
      const profile = BuiltinServerProfiles[id]
      expect(profile?.semantic).toBe(false)
      expect(profile?.priority).toBeLessThan(0)
      expect(profile?.concurrency).toBe(1)
      expect(profile?.capabilityHints?.hover).toBe(false)
      expect(profile?.capabilityHints?.definition).toBe(false)
      expect(profile?.capabilityHints?.references).toBe(false)
      expect(profile?.capabilityHints?.implementation).toBe(false)
      expect(profile?.capabilityHints?.documentSymbol).toBe(false)
      expect(profile?.capabilityHints?.workspaceSymbol).toBe(false)
      expect(profile?.capabilityHints?.callHierarchy).toBe(false)
    }
  })

  test("assigns positive priority to primary semantic servers", () => {
    for (const id of ["typescript", "deno", "gopls", "pyright", "ty", "rust"] as const) {
      const profile = BuiltinServerProfiles[id]
      expect(profile?.priority).toBeGreaterThan(0)
      expect(profile?.concurrency).toBeGreaterThan(0)
    }
  })

  test("caps heavyweight built-in servers to single-flight concurrency by default", () => {
    for (const id of ["clangd", "jdtls", "kotlin-ls", "sourcekit-lsp", "csharp", "fsharp", "julials"] as const) {
      const profile = BuiltinServerProfiles[id]
      expect(profile?.priority).toBeGreaterThan(0)
      expect(profile?.concurrency).toBe(1)
    }
  })
})
