import { describe, expect, test } from "vitest"
import {
  CLI_BINARIES,
  CLI_PROVIDERS,
  configUpdateParams,
  normalizeConfiguredProvidersPayload,
  normalizeProviderListPayload,
  providerDialogCategory,
  providerDialogConnected,
  providerDialogProviders,
  providerModelSelectable,
} from "../../../src/cli/cmd/tui/component/dialog-provider-options"

function provider(id: string, name = id) {
  return { id, name, models: {} } as any
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

  test("does not treat transient ax-engine provider data as connected", () => {
    expect(
      providerDialogConnected({
        providerID: "ax-engine",
        connected: [],
        configured: [provider("ax-engine", "AX Engine (Local)")],
      }),
    ).toBe(false)
    expect(
      providerDialogConnected({
        providerID: "ax-engine",
        connected: ["ax-engine"],
        configured: [],
      }),
    ).toBe(true)
  })

  test("wraps config update body for the generated SDK", () => {
    expect(configUpdateParams({ provider: { "ax-engine": { name: "AX Engine (Local)" } } })).toEqual({
      config: { provider: { "ax-engine": { name: "AX Engine (Local)" } } },
    })
  })

  test("normalizes malformed configured provider payloads", () => {
    expect(normalizeConfiguredProvidersPayload(null)).toEqual({ providers: [], default: {} })
    expect(
      normalizeConfiguredProvidersPayload({
        providers: [provider("openai", "OpenAI"), { id: "missing-name" }, null],
        default: { openai: "gpt-4.1", invalid: 42 },
      }),
    ).toEqual({
      providers: [provider("openai", "OpenAI")],
      default: { openai: "gpt-4.1" },
    })
  })

  test("normalizes malformed provider list payloads", () => {
    expect(normalizeProviderListPayload(null)).toEqual({ all: [], connected: [], default: {} })
    expect(
      normalizeProviderListPayload({
        all: { id: "openai", name: "OpenAI" },
        connected: ["openai", null, 42],
        default: ["gpt-4.1"],
      }),
    ).toEqual({ all: [], connected: ["openai"], default: {} })
    expect(
      normalizeProviderListPayload({
        all: [provider("openai", "OpenAI"), { id: "missing-name" }],
        connected: "openai",
        default: { openai: "gpt-4.1", invalid: false },
      }),
    ).toEqual({
      all: [provider("openai", "OpenAI")],
      connected: [],
      default: { openai: "gpt-4.1" },
    })
  })

  test("includes Grok Build CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("grok-build-cli")).toBe(true)
    expect(CLI_BINARIES["grok-build-cli"]).toBe("grok")
  })

  test("includes Qoder CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("qoder-cli")).toBe(true)
    expect(CLI_BINARIES["qoder-cli"]).toBe("qodercli")
  })

  test("includes Antigravity CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("antigravity-cli")).toBe(true)
    expect(CLI_BINARIES["antigravity-cli"]).toBe("agy")
  })

  test("shows Antigravity as a Google CLI provider", () => {
    const [item] = providerDialogProviders({
      available: [provider("antigravity-cli", "Google (Antigravity CLI)")],
      configured: [],
    })
    expect(item).toMatchObject({ id: "antigravity-cli", name: "Google (Antigravity CLI)" })
  })

  test("separates API, CLI, and local provider categories", () => {
    expect(providerDialogCategory("xai")).toBe("API plan")
    expect(providerDialogCategory("grok-build-cli")).toBe("CLI plan")
    expect(providerDialogCategory("qoder-cli")).toBe("CLI plan")
    expect(providerDialogCategory("antigravity-cli")).toBe("CLI plan")
    expect(providerDialogCategory("ollama")).toBe("Local runtime")
  })

  test("requires normal tool-call capability for local runtime models", () => {
    expect(providerModelSelectable({ providerID: "ax-engine", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "grok-build-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "qoder-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "antigravity-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "xai", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "xai", toolcall: true })).toBe(true)
  })
})
