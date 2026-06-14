import { describe, expect, test } from "bun:test"
import {
  CLI_BINARIES,
  CLI_PROVIDERS,
  providerDialogCategory,
  providerDialogConnected,
  providerDialogProviders,
  providerModelSelectable,
} from "../../../src/cli/cmd/tui/component/dialog-provider-options"

function provider(id: string, name = id) {
  return { id, name } as any
}

describe("provider dialog options", () => {
  test("uses available providers when the provider list bootstrap succeeds", () => {
    expect(
      providerDialogProviders({
        available: [provider("openai", "OpenAI")],
        configured: [provider("xai", "xAI")],
      }).map((item) => item.id),
    ).toEqual(["openai"])
  })

  test("falls back to configured providers when provider list bootstrap is empty", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [provider("xai", "xAI"), provider("zai-coding-plan", "Z.AI Coding Plan")],
      }).map((item) => item.id),
    ).toEqual(["zai-coding-plan", "xai"])
  })

  test("keeps hidden providers out of the connect dialog fallback", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [
          provider("google", "Google"),
          provider("github-copilot", "GitHub Copilot"),
          provider("xai", "xAI"),
        ],
      }).map((item) => item.id),
    ).toEqual(["xai"])
  })

  test("treats configured fallback providers as connected", () => {
    expect(
      providerDialogConnected({
        providerID: "xai",
        connected: [],
        configured: [provider("xai", "xAI")],
      }),
    ).toBe(true)
    expect(
      providerDialogConnected({
        providerID: "openai",
        connected: ["openai"],
        configured: [],
      }),
    ).toBe(true)
  })

  test("includes Grok Build CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("grok-build-cli")).toBe(true)
    expect(CLI_BINARIES["grok-build-cli"]).toBe("grok")
  })

  test("separates API, CLI, and local provider categories", () => {
    expect(providerDialogCategory("xai")).toBe("API plan")
    expect(providerDialogCategory("grok-build-cli")).toBe("CLI plan")
    expect(providerDialogCategory("ollama")).toBe("Local runtime")
  })

  test("allows ax-engine models in the selector even without tool calling", () => {
    expect(providerModelSelectable({ providerID: "ax-engine", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "grok-build-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "xai", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "xai", toolcall: true })).toBe(true)
  })
})
