import { describe, expect, test } from "vitest"
import { resolveConnectedProviderID } from "../../src/mode/ensemble-shared"

describe("resolveConnectedProviderID", () => {
  const connected = ["alibaba-pai", "grok-build-cli", "deepseek"]

  test("returns an exact connected id", () => {
    expect(resolveConnectedProviderID("grok-build-cli", connected)).toBe("grok-build-cli")
  })

  test("maps colloquial grok/xai to grok-build-cli when connected", () => {
    expect(resolveConnectedProviderID("grok", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("xai", connected)).toBe("grok-build-cli")
  })

  test("does not invent a provider that is not connected", () => {
    expect(resolveConnectedProviderID("codex", connected)).toBeUndefined()
    expect(resolveConnectedProviderID("codex-cli", connected)).toBeUndefined()
  })

  test("is case-insensitive for exact ids", () => {
    expect(resolveConnectedProviderID("DeepSeek", connected)).toBe("deepseek")
  })
})
