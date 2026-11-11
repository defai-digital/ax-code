import { describe, expect, test } from "vitest"
import path from "path"
import { pathToFileURL } from "url"
import { defaultModel, modelVariantsFromProviders, parseModelSelection, parseUri } from "../../src/acp/agent-adapter"
import { ModelID, ProviderID } from "../../src/provider/schema"

function configWithProviders(providers: Array<{ id: string; models: Record<string, unknown> }>) {
  return {
    sdk: {
      config: {
        get: async () => ({ data: {} }),
        providers: async () => ({ data: { providers } }),
      },
    },
  } as any
}

describe("ACP agent adapter", () => {
  test("decodes file URI escapes when deriving attachment filenames", () => {
    const file = path.join("/tmp", "space # name.ts")
    const uri = pathToFileURL(file).href

    expect(parseUri(uri)).toEqual({
      type: "file",
      url: uri,
      filename: "space # name.ts",
      mime: "text/plain",
    })
  })

  test("decodes file URIs case-insensitively", () => {
    const file = path.join("/tmp", "space # name.ts")
    const uri = pathToFileURL(file).href.replace(/^file:/, "FILE:")

    expect(parseUri(uri)).toEqual({
      type: "file",
      url: uri,
      filename: "space # name.ts",
      mime: "text/plain",
    })
  })

  test("decodes zed URIs case-insensitively", () => {
    expect(parseUri("ZED://open?path=/tmp/space%20name.ts")).toEqual({
      type: "file",
      url: pathToFileURL("/tmp/space name.ts").href,
      filename: "space name.ts",
      mime: "text/plain",
    })
  })

  test("chooses a model within the first connected provider without cross-provider model priority", async () => {
    const model = await defaultModel(
      configWithProviders([
        {
          id: "alibaba-token-plan",
          models: { "qwen3.8-max": { id: "qwen3.8-max", providerID: "alibaba-token-plan" } },
        },
        {
          id: "openai",
          models: { "gpt-5": { id: "gpt-5", providerID: "openai" } },
        },
      ]),
    )

    expect(model).toEqual({ providerID: "alibaba-token-plan", modelID: "qwen3.8-max" })
  })

  test("fails clearly instead of inventing a stale fallback when no provider is connected", async () => {
    await expect(defaultModel(configWithProviders([]))).rejects.toThrow("No connected provider has an available model")
  })

  test("follows a configured model to the connected provider that serves the same SKU", async () => {
    const model = await defaultModel({
      sdk: {
        config: {
          get: async () => ({ data: { model: "deepseek/deepseek-v4-pro" } }),
          providers: async () => ({
            data: {
              providers: [
                {
                  id: "127-0-0-1",
                  models: {
                    "glm-5.3": { id: "glm-5.3", tool_call: true },
                    "deepseek-v4-pro": { id: "deepseek-v4-pro", tool_call: true },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any)

    expect(model).toEqual({ providerID: "127-0-0-1", modelID: "deepseek-v4-pro" })
  })

  test("keeps a model pinned to a CLI provider instead of moving it to a gateway", async () => {
    const gateway = {
      id: "127-0-0-1",
      models: {
        "kimi-k3-256k": { id: "kimi-k3-256k", tool_call: true },
        "kimi-k3": { id: "kimi-k3", tool_call: true },
      },
    }
    const resolve = (model: string, providers: unknown[]) =>
      defaultModel({
        sdk: { config: { get: async () => ({ data: { model } }), providers: async () => ({ data: { providers } }) } },
      } as any)

    // Before the bridge's discovery probe, or while it is signed out, it is
    // absent from the connected list.
    expect(await resolve("kimi-cli/kimi-k3", [gateway])).toEqual({
      providerID: "kimi-cli",
      modelID: "kimi-k3",
    })
    // Connected, but it does not list the model.
    const bridge = { id: "kimi-cli", models: { "kimi-k3": { id: "kimi-k3" } } }
    expect(await resolve("kimi-cli/kimi-k3-256k", [bridge, gateway])).toEqual({
      providerID: "kimi-cli",
      modelID: "kimi-k3-256k",
    })
  })

  test("parses advertised models and variants", () => {
    const providers = [
      {
        id: "openai",
        models: {
          "gpt-5": { variants: { fast: {} } },
        },
      },
    ]

    expect(parseModelSelection("openai/gpt-5", providers as any)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: undefined,
    })
    expect(parseModelSelection("openai/gpt-5/fast", providers as any)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "fast",
    })
  })

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "rejects an unadvertised inherited model or variant named %s",
    (name) => {
      const providers = [{ id: "openai", models: { "gpt-5": { variants: { high: {} } } } }]
      expect(() => parseModelSelection(`openai/${name}`, providers)).toThrow("Unknown model in ACP model selection")
      expect(() => parseModelSelection(`openai/gpt-5/${name}`, providers)).toThrow(
        "Unknown model in ACP model selection",
      )
    },
  )

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "default model selection ignores an unadvertised pin named %s",
    async (modelID) => {
      const config = configWithProviders([{ id: "openai", models: { "gpt-5": { id: "gpt-5" } } }])
      config.sdk.config.get = async () => ({ data: { model: `openai/${modelID}` } })
      expect(await defaultModel(config)).toEqual({ providerID: "openai", modelID: "gpt-5" })
    },
  )

  test("does not list variants of an inherited model", () => {
    const providers = [{ id: "openai", models: Object.create({ phantom: { variants: { high: {} } } }) }]
    expect(
      modelVariantsFromProviders(providers, {
        providerID: ProviderID.make("openai"),
        modelID: ModelID.make("phantom"),
      }),
    ).toEqual([])
    expect(() => parseModelSelection("openai/phantom/high", providers)).toThrow("Unknown model in ACP model selection")
  })

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "accepts explicitly advertised models and variants named %s",
    async (name) => {
      const providers = [{ id: "openai", models: { [name]: { id: name, variants: { [name]: {} } } } }]
      const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make(name) }
      expect(parseModelSelection(`openai/${name}`, providers)).toEqual({ model, variant: undefined })
      expect(parseModelSelection(`openai/${name}/${name}`, providers)).toEqual({ model, variant: name })
      expect(modelVariantsFromProviders(providers, model)).toEqual([name])
      const config = configWithProviders(providers)
      config.sdk.config.get = async () => ({ data: { model: `openai/${name}` } })
      expect(await defaultModel(config)).toEqual(model)
    },
  )

  test("rejects a variant inherited from a custom prototype", () => {
    const providers = [{ id: "openai", models: { "gpt-5": { variants: Object.create({ phantom: {} }) } } }]
    expect(() => parseModelSelection("openai/gpt-5/phantom", providers)).toThrow("Unknown model in ACP model selection")
  })

  test("rejects providers and models that were not advertised", () => {
    const providers = [{ id: "openai", models: { "gpt-5": {} } }]

    expect(() => parseModelSelection("missing/model", providers as any)).toThrow(
      "Unknown provider in ACP model selection: missing",
    )
    expect(() => parseModelSelection("openai/missing", providers as any)).toThrow(
      "Unknown model in ACP model selection: openai/missing",
    )
  })
})
