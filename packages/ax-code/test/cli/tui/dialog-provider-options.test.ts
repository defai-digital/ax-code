import { describe, expect, test } from "vitest"
import {
  AX_TRUST_PROVIDER_OPTION_ID,
  CLI_BINARIES,
  axEngineRuntimeDialogActions,
  CLI_PROVIDERS,
  DEDICATED_PRIVATE_GPU_PROVIDERS,
  PRIVATE_GPU_PROVIDERS,
  configUpdateParams,
  CUSTOM_API_PROVIDER_OPTION_ID,
  normalizeConfiguredProvidersPayload,
  normalizeProviderListPayload,
  OFFLINE_PROVIDERS,
  PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
  providerDialogCategory,
  providerDialogCategoryOverrides,
  providerDialogConnected,
  providerDialogOptionsForType,
  providerDialogProviders,
  providerDialogProvidersForType,
  providerDialogTypeOptions,
  providerModelSelectable,
  selectableProviderDefaultModelID,
  withCustomApiProviderDialogEntry,
  withAxTrustProviderDialogEntry,
} from "../../../src/cli/cmd/tui/component/dialog-provider-options"

function provider(id: string, name = id) {
  return { id, name, models: {} } as any
}

describe("provider dialog options", () => {
  test("adds one synthetic custom API provider entry", () => {
    const result = withCustomApiProviderDialogEntry([provider("openai", "OpenAI")])
    expect(result.map((item) => item.id)).toContain(CUSTOM_API_PROVIDER_OPTION_ID)
    expect(
      withCustomApiProviderDialogEntry(result).filter((item) => item.id === CUSTOM_API_PROVIDER_OPTION_ID),
    ).toHaveLength(1)
  })

  test("keeps AX Trust setup last and saved gateways in that category without changing IDs", () => {
    const categoryOverrides = providerDialogCategoryOverrides({
      provider: { "company-gateway": { management: "ax-trust" }, openai: { management: "custom-api" } },
    })
    const result = withAxTrustProviderDialogEntry(
      providerDialogProviders({
        available: [provider("company-gateway"), provider("runpod"), provider("openai")],
        configured: [],
        categoryOverrides,
      }),
      categoryOverrides,
    )
    expect(
      providerDialogTypeOptions(
        result.map((item) => item.id),
        categoryOverrides,
      ).map((item) => item.value),
    ).toEqual(["api", "private-gpu", "ax-trust"])
    expect(
      withAxTrustProviderDialogEntry(result, categoryOverrides).filter(
        (item) => item.id === AX_TRUST_PROVIDER_OPTION_ID,
      ),
    ).toHaveLength(1)
    const options = result.map((item) => ({ title: item.name, value: item.id }))
    expect(providerDialogOptionsForType(options, "ax-trust", categoryOverrides).map((item) => item.value)).toEqual([
      AX_TRUST_PROVIDER_OPTION_ID,
      "company-gateway",
      PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
    ])
    expect(providerDialogOptionsForType(options, "api", categoryOverrides).map((item) => item.value)).toEqual([
      "openai",
      PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
    ])
    expect(providerDialogCategory("company-gateway", categoryOverrides)).toBe("AX Trust")
    expect(providerDialogCategoryOverrides(null)).toEqual({})
  })

  test("uses available providers when the provider list bootstrap succeeds", () => {
    expect(
      providerDialogProviders({
        available: [provider("openai", "OpenAI")],
        configured: [provider("groq", "GroqCloud")],
      }).map((item) => item.id),
    ).toEqual(["openai"])
  })

  test("falls back to configured providers when provider list bootstrap is empty", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [provider("groq", "GroqCloud"), provider("zai-coding-plan", "Z.AI Coding Plan")],
      }).map((item) => item.id),
    ).toEqual(["groq", "zai-coding-plan"])
  })

  test("keeps hidden providers out of the connect dialog fallback", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [
          provider("google", "Google"),
          provider("github-copilot", "GitHub Copilot"),
          provider("groq", "GroqCloud"),
        ],
      }).map((item) => item.id),
    ).toEqual(["groq"])
  })

  test("treats configured fallback providers as connected", () => {
    expect(
      providerDialogConnected({
        providerID: "groq",
        connected: [],
        configured: [provider("groq", "GroqCloud")],
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

  test("excludes retired CLI providers", () => {
    expect(CLI_PROVIDERS.has("qoder-cli")).toBe(false)
    expect(CLI_BINARIES["qoder-cli"]).toBeUndefined()
  })

  test("includes Kimi Code CLI as a CLI provider", () => {
    expect(CLI_PROVIDERS.has("kimi-cli")).toBe(true)
    expect(CLI_BINARIES["kimi-cli"]).toBe("kimi")
  })

  test("hides suppressed providers from the connect dialog", () => {
    expect(
      providerDialogProviders({
        available: [
          provider("google", "Google"),
          provider("github-copilot", "GitHub Copilot"),
          provider("kimi-cli", "Kimi Code CLI"),
        ],
        configured: [],
      }).map((item) => item.id),
    ).toEqual(["kimi-cli"])
  })

  test("separates API, CLI, local, and private GPU provider categories", () => {
    expect(providerDialogCategory("groq")).toBe("API Cloud Provider")
    expect(providerDialogCategory("grok-build-cli")).toBe("CLI Provider")
    expect(providerDialogCategory("qoder-cli")).not.toBe("CLI Provider")
    expect(providerDialogCategory("kimi-cli")).toBe("CLI Provider")
    expect(providerDialogCategory("ax-engine")).toBe("AX-Engine runtime")
    expect(providerDialogCategory("ollama")).toBe("Local LLM runtime")
    expect(providerDialogCategory("lmstudio")).toBe("Local LLM runtime")
    expect(providerDialogCategory("local-llm")).toBe("Local LLM runtime")
    expect(providerDialogCategory("alibaba-pai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("custom-private-gpu")).toBe("Private GPU cloud")
    expect(providerDialogCategory("runpod")).toBe("Private GPU cloud")
    expect(providerDialogCategory("nebius")).toBe("Private GPU cloud")
    expect(providerDialogCategory("fireworks-ai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("togetherai")).toBe("Private GPU cloud")
    expect(providerDialogCategory("huggingface")).toBe("API Cloud Provider")
    expect(providerDialogCategory("huggingface-endpoints")).toBe("Private GPU cloud")
    expect(PRIVATE_GPU_PROVIDERS.has("alibaba-pai")).toBe(true)
    expect(PRIVATE_GPU_PROVIDERS.has("nebius")).toBe(true)
    expect(PRIVATE_GPU_PROVIDERS.has("huggingface")).toBe(false)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("runpod")).toBe(true)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("custom-private-gpu")).toBe(true)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("nebius")).toBe(false)
    expect(DEDICATED_PRIVATE_GPU_PROVIDERS.has("huggingface")).toBe(false)
  })

  test("builds type-first connect options and filters the provider list", () => {
    expect(
      providerDialogTypeOptions(["ax-engine", "ollama", "openai", "grok-build-cli", "nebius"]).map(
        (item) => item.value,
      ),
    ).toEqual(["api", "cli", "ax-engine", "local", "private-gpu"])
    expect(providerDialogTypeOptions(["openai", "groq"])).toEqual([
      {
        title: "API Cloud Provider",
        value: "api",
        description: "2 providers",
        hint: "Hosted API key",
      },
    ])
    expect(
      providerDialogProvidersForType([provider("openai"), provider("ollama"), provider("nebius")], "private-gpu").map(
        (item) => item.id,
      ),
    ).toEqual(["nebius"])
    expect(
      providerDialogOptionsForType(
        [
          { title: "OpenAI", value: "openai", category: "API Cloud Provider" },
          { title: "Ollama", value: "ollama", category: "Local LLM runtime" },
        ],
        "local",
      ).map((item) => item.value),
    ).toEqual(["ollama", PROVIDER_DIALOG_CHANGE_TYPE_VALUE])
  })

  test.each([
    { providerID: "openai", category: "api" },
    { providerID: "ax-trust-defai-digital", category: "ax-trust" },
  ])("excludes setup actions from $category provider counts", ({ providerID, category }) => {
    const choices = withAxTrustProviderDialogEntry(withCustomApiProviderDialogEntry([provider(providerID)]))
    expect(
      providerDialogTypeOptions(choices.map((item) => item.id)).find((item) => item.value === category),
    ).toMatchObject({
      description: "1 provider",
    })
  })

  test("keeps setup-only categories reachable without counting their actions as providers", () => {
    const providers = providerDialogProviders({ available: [], configured: [] })
    const choices = withAxTrustProviderDialogEntry(withCustomApiProviderDialogEntry(providers))
    expect(
      providerDialogTypeOptions(choices.map((item) => item.id)).map(({ value, description }) => ({
        value,
        description,
      })),
    ).toEqual([
      { value: "api", description: "0 providers" },
      { value: "ax-trust", description: "0 providers" },
    ])
    const options = choices.map((item) => ({ title: item.name, value: item.id }))
    expect(providerDialogOptionsForType(options, "api").map((item) => item.value)).toEqual([
      CUSTOM_API_PROVIDER_OPTION_ID,
      PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
    ])
    expect(providerDialogOptionsForType(options, "ax-trust").map((item) => item.value)).toEqual([
      AX_TRUST_PROVIDER_OPTION_ID,
      PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
    ])
  })

  test.each(["available", "configured"] as const)(
    "counts real providers in every category from the %s list",
    (source) => {
      const categoryOverrides = providerDialogCategoryOverrides({
        provider: { "company-gateway": { management: "ax-trust" } },
      })
      const providers = [
        "openai",
        "groq",
        "google",
        "github-copilot",
        ...CLI_PROVIDERS,
        ...OFFLINE_PROVIDERS,
        ...PRIVATE_GPU_PROVIDERS,
        "ax-trust-defai-digital",
        "company-gateway",
      ].map((id) => provider(id))
      const choices = withAxTrustProviderDialogEntry(
        withCustomApiProviderDialogEntry(
          providerDialogProviders({
            available: source === "available" ? providers : [],
            configured: source === "configured" ? providers : [],
            categoryOverrides,
          }),
          categoryOverrides,
        ),
        categoryOverrides,
      )
      expect(
        providerDialogTypeOptions(
          choices.map((item) => item.id),
          categoryOverrides,
        ).map(({ value, description }) => ({
          value,
          description,
        })),
      ).toEqual([
        { value: "api", description: "2 providers" },
        { value: "cli", description: "4 providers" },
        { value: "ax-engine", description: "1 provider" },
        { value: "local", description: "4 providers" },
        { value: "private-gpu", description: "14 providers" },
        { value: "ax-trust", description: "2 providers" },
      ])
    },
  )

  test("separates AX Engine and orders all four external local runtime choices", () => {
    const choices = providerDialogProviders({
      available: [
        provider("local-llm", "Other local LLM"),
        provider("ax-studio", "AX Studio"),
        provider("lmstudio", "LM Studio"),
        provider("ollama", "Ollama"),
        provider("ax-engine", "AX Engine (Local)"),
      ],
      configured: [],
    })
    expect(choices.map((item) => item.id)).toEqual(["ax-engine", "ollama", "lmstudio", "ax-studio", "local-llm"])
    expect(providerDialogTypeOptions(choices.map((item) => item.id))).toEqual([
      {
        title: "AX-Engine runtime",
        value: "ax-engine",
        description: "1 provider",
        hint: "Run models on this machine",
      },
      {
        title: "Local LLM runtime",
        value: "local",
        description: "4 providers",
        hint: "Ollama, LMStudio, AX-Studio, Others",
      },
    ])
    expect(
      providerDialogOptionsForType(
        choices.map((item) => ({ title: item.name, value: item.id })),
        "local",
      ).map((item) => item.value),
    ).toEqual(["ollama", "lmstudio", "ax-studio", "local-llm", PROVIDER_DIALOG_CHANGE_TYPE_VALUE])
  })

  test("sorts API, CLI, AX Engine, local LLM, and private GPU providers in menu order", () => {
    expect(
      providerDialogProviders({
        available: [
          provider("groq", "GroqCloud"),
          provider("alibaba-pai", "Alibaba PAI-EAS"),
          provider("grok-build-cli", "Grok Build CLI"),
          provider("ax-engine", "AX Engine (Local)"),
          provider("ollama", "Ollama"),
        ],
        configured: [],
      }).map((item) => item.id),
    ).toEqual(["groq", "grok-build-cli", "ax-engine", "ollama", "alibaba-pai"])
  })

  test("requires normal tool-call capability for local runtime models", () => {
    expect(providerModelSelectable({ providerID: "ax-engine", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "grok-build-cli", toolcall: false })).toBe(true)
    expect(providerModelSelectable({ providerID: "qoder-cli", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "kimi-cli", toolcall: false })).toBe(true)
    // Retired CLI providers no longer get the non-toolcall exemption.
    expect(providerModelSelectable({ providerID: "antigravity-cli", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "groq", toolcall: false })).toBe(false)
    expect(providerModelSelectable({ providerID: "groq", toolcall: true })).toBe(true)
  })

  test("selects the configured default model when it is fully selectable", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "groq",
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
    ).toBeUndefined()
  })

  test("does not auto-select an AX Engine model", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "ax-engine",
        models: {
          "qwen3.8-27b-axq-6bit": { id: "qwen3.8-27b-axq-6bit", capabilities: { toolcall: true } },
        },
      }),
    ).toBeUndefined()
  })

  test("defaults Z.AI to glm-5.3-flash", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "zai",
        defaultModel: "glm-5.3",
        models: {
          "glm-5.3": { id: "glm-5.3", capabilities: { toolcall: true } },
          "glm-5.3-flash": { id: "glm-5.3-flash", capabilities: { toolcall: true } },
        },
      }),
    ).toBe("glm-5.3-flash")
  })

  test("defaults Groq to openai/gpt-oss-20b", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "groq",
        defaultModel: "qwen/qwen3.8-27b",
        models: {
          "openai/gpt-oss-20b": { id: "openai/gpt-oss-20b", capabilities: { toolcall: true } },
          "qwen/qwen3.8-27b": { id: "qwen/qwen3.8-27b", capabilities: { toolcall: true } },
        },
      }),
    ).toBe("openai/gpt-oss-20b")
  })

  test("defaults Alibaba Coding Plan to qwen3-coder-plus", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "alibaba-coding-plan",
        defaultModel: "qwen3.7-plus",
        models: {
          "qwen3-coder-plus": { id: "qwen3-coder-plus", capabilities: { toolcall: true } },
          "qwen3.7-plus": { id: "qwen3.7-plus", capabilities: { toolcall: true } },
        },
      }),
    ).toBe("qwen3-coder-plus")
  })

  test("returns undefined when no provider model is selectable", () => {
    expect(
      selectableProviderDefaultModelID({
        providerID: "groq",
        defaultModel: "text",
        models: {
          text: { id: "text", capabilities: { toolcall: false } },
        },
      }),
    ).toBeUndefined()
  })

  test("offers only local runtime actions before AX Engine setup", () => {
    expect(axEngineRuntimeDialogActions().map((item) => item.value)).toEqual(["use", "status", "disable"])
  })

  test("offers stop only when the local AX Engine process is running", () => {
    expect(axEngineRuntimeDialogActions({ serverRunning: false }).map((item) => item.value)).toEqual([
      "use",
      "status",
      "disable",
    ])
    expect(axEngineRuntimeDialogActions({ serverRunning: true }).map((item) => item.value)).toEqual([
      "use",
      "status",
      "stop",
      "disable",
    ])
  })

  test("shows local readiness and setup blockers without an endpoint", () => {
    expect(axEngineRuntimeDialogActions({ serverReady: true }).find((item) => item.value === "status")).toMatchObject({
      description: "Local runtime is ready",
    })
    expect(
      axEngineRuntimeDialogActions({ statusBlocker: "Install AX Engine first" }).find(
        (item) => item.value === "status",
      ),
    ).toMatchObject({
      description: "Install AX Engine first",
    })
  })
})
