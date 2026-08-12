import { describe, expect, test } from "vitest"
import {
  AX_ENGINE_DEFAULT_ATTACH_API_KEY,
  CLI_BINARIES,
  CLI_PROVIDERS,
  DEDICATED_PRIVATE_GPU_PROVIDERS,
  PRIVATE_GPU_PROVIDERS,
  axEngineAttachApiKeyPreset,
  axEngineAttachBaseURLPreset,
  axEngineAttachProviderConfig,
  axEngineConnectModeFromConfig,
  axEngineEndpointsMayAlias,
  axEngineManagedProviderConfig,
  configUpdateParams,
  normalizeAxEngineEndpointBaseURL,
  normalizeConfiguredProvidersPayload,
  normalizeProviderListPayload,
  providerDialogCategory,
  providerDialogConnected,
  providerDialogProviders,
  providerModelSelectable,
  selectableProviderDefaultModelID,
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

  test("includes Kimi Code CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("kimi-cli")).toBe(true)
    expect(CLI_BINARIES["kimi-cli"]).toBe("kimi")
  })

  test("hides Gemini CLI and Antigravity CLI from the connect dialog", () => {
    expect(
      providerDialogProviders({
        available: [
          provider("gemini-cli", "Google (Gemini CLI)"),
          provider("antigravity-cli", "Google (Antigravity CLI)"),
          provider("kimi-cli", "Kimi Code CLI"),
        ],
        configured: [],
      }).map((item) => item.id),
    ).toEqual(["kimi-cli"])
  })

  test("separates API, CLI, local, and private GPU provider categories", () => {
    expect(providerDialogCategory("xai")).toBe("API plan")
    expect(providerDialogCategory("grok-build-cli")).toBe("CLI plan")
    expect(providerDialogCategory("qoder-cli")).toBe("CLI plan")
    expect(providerDialogCategory("antigravity-cli")).toBe("CLI plan")
    expect(providerDialogCategory("kimi-cli")).toBe("CLI plan")
    expect(providerDialogCategory("ollama")).toBe("Local runtime")
    expect(providerDialogCategory("alibaba-pai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("runpod")).toBe("Private GPU cloud")
    expect(providerDialogCategory("fireworks-ai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("togetherai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("huggingface")).toBe("API plan")
    expect(providerDialogCategory("huggingface-endpoints")).toBe("Private GPU cloud")
    expect(PRIVATE_GPU_PROVIDERS.has("alibaba-pai")).toBe(true)
    expect(PRIVATE_GPU_PROVIDERS.has("huggingface")).toBe(false)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("runpod")).toBe(true)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("huggingface")).toBe(false)
  })

  test("sorts private GPU cloud after local runtime and before CLI/API plans", () => {
    expect(
      providerDialogProviders({
        available: [
          provider("xai", "xAI"),
          provider("alibaba-pai", "Alibaba PAI-EAS"),
          provider("grok-build-cli", "Grok Build CLI"),
          provider("ax-engine", "AX Engine (Local)"),
        ],
        configured: [],
      }).map((item) => item.id),
    ).toEqual(["ax-engine", "alibaba-pai", "grok-build-cli", "xai"])
  })

  test("requires normal tool-call capability for local runtime models", () => {
    expect(providerModelSelectable({ providerID: "ax-engine", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "grok-build-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "qoder-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "antigravity-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "kimi-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "xai", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "xai", toolcall: true })).toBe(true)
  })

  test("selects the configured default model when it is fully selectable", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "xai",
        defaultModel: "default",
        models: {
          default: { id: "default", capabilities: { toolcall: true } },
          fallback: { id: "fallback", capabilities: { toolcall: true } },
        },
      }),
    ).toBe("default")
  })

  test("skips memory-blocked local defaults when selecting a connected provider model", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "ax-engine",
        defaultModel: "huge",
        models: {
          huge: {
            id: "huge",
            capabilities: { toolcall: true },
            options: { minMemoryBytes: Number.MAX_SAFE_INTEGER },
          },
          small: { id: "small", capabilities: { toolcall: true } },
        },
      }),
    ).toBe("small")
  })

  test("returns undefined when no provider model is selectable", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "xai",
        defaultModel: "text",
        models: {
          text: { id: "text", capabilities: { toolcall: false } },
        },
      }),
    ).toBeUndefined()
  })

  test("normalizes ax-engine attach endpoints and rejects non-local hosts", () => {
    expect(normalizeAxEngineEndpointBaseURL("127.0.0.1:31418")).toBe("http://127.0.0.1:31418/v1")
    expect(normalizeAxEngineEndpointBaseURL("http://localhost:31418/v1")).toBe("http://localhost:31418/v1")
    expect(() => normalizeAxEngineEndpointBaseURL("https://api.example.com/v1")).toThrow(/local host/i)
    expect(() => normalizeAxEngineEndpointBaseURL("http://0.0.0.0:31418")).toThrow(/local host/i)
    expect(() => normalizeAxEngineEndpointBaseURL("ftp://localhost/model")).toThrow(/http/i)
    expect(() => normalizeAxEngineEndpointBaseURL("http://user:secret@localhost:31418")).toThrow(/credentials/i)
    expect(() => normalizeAxEngineEndpointBaseURL("")).toThrow(/required/i)
  })

  test("detects ax-engine managed vs attach from config and env", () => {
    const previousHost = process.env.AX_ENGINE_HOST
    delete process.env.AX_ENGINE_HOST
    try {
      expect(axEngineConnectModeFromConfig({})).toBe("managed")
      expect(
        axEngineConnectModeFromConfig({
          provider: { "ax-engine": { options: { baseURL: "http://127.0.0.1:31418/v1" } } },
        }),
      ).toBe("attach")
      process.env.AX_ENGINE_HOST = "http://127.0.0.1:31419"
      expect(axEngineConnectModeFromConfig({})).toBe("attach")
      expect(
        axEngineConnectModeFromConfig({
          provider: {
            "ax-engine": {
              options: {
                connectionMode: "managed",
                baseURL: "http://127.0.0.1:31418/v1",
              },
            },
          },
        }),
      ).toBe("managed")
    } finally {
      if (previousHost === undefined) delete process.env.AX_ENGINE_HOST
      else process.env.AX_ENGINE_HOST = previousHost
    }
  })

  test("detects common loopback aliases for the same managed endpoint", () => {
    expect(axEngineEndpointsMayAlias("http://127.0.0.1:31418/v1", "http://localhost:31418")).toBe(true)
    expect(axEngineEndpointsMayAlias("http://127.0.0.2:31418/v1", "http://localhost:31418/v1")).toBe(false)
    expect(axEngineEndpointsMayAlias("http://localhost:31418/v1", "http://localhost:31419/v1")).toBe(false)
  })

  test("builds managed and attach ax-engine provider config patches", () => {
    expect(axEngineManagedProviderConfig("AX Engine (Local)")).toEqual({
      "ax-engine": {
        name: "AX Engine (Local)",
        options: { connectionMode: "managed", baseURL: "", apiKey: "" },
      },
    })
    expect(
      axEngineAttachProviderConfig({
        providerName: "AX Engine (Local)",
        baseURL: "http://127.0.0.1:31418",
        apiKey: "secret",
      }),
    ).toEqual({
      "ax-engine": {
        name: "AX Engine (Local)",
        options: {
          connectionMode: "attach",
          baseURL: "http://127.0.0.1:31418/v1",
          apiKey: "",
        },
      },
    })
    expect(
      axEngineAttachProviderConfig({
        providerName: "AX Engine (Local)",
        baseURL: "http://127.0.0.1:31418/v1",
        apiKey: "  ",
      })["ax-engine"].options.apiKey,
    ).toBe("")
  })

  test("presets attach baseURL and api key from config", () => {
    const previousHost = process.env.AX_ENGINE_HOST
    const previousKey = process.env.AX_ENGINE_API_KEY
    delete process.env.AX_ENGINE_HOST
    delete process.env.AX_ENGINE_API_KEY
    try {
      expect(axEngineAttachBaseURLPreset({})).toBe("http://127.0.0.1:31418/v1")
      expect(axEngineAttachApiKeyPreset({})).toBe(AX_ENGINE_DEFAULT_ATTACH_API_KEY)
      expect(
        axEngineAttachBaseURLPreset({
          provider: { "ax-engine": { options: { baseURL: "http://127.0.0.1:9/v1", apiKey: "k" } } },
        }),
      ).toBe("http://127.0.0.1:9/v1")
      expect(
        axEngineAttachApiKeyPreset({
          provider: { "ax-engine": { options: { apiKey: "k" } } },
        }),
      ).toBe("k")
    } finally {
      if (previousHost === undefined) delete process.env.AX_ENGINE_HOST
      else process.env.AX_ENGINE_HOST = previousHost
      if (previousKey === undefined) delete process.env.AX_ENGINE_API_KEY
      else process.env.AX_ENGINE_API_KEY = previousKey
    }
  })
})
