import { describe, expect, test } from "vitest"
import path from "path"
import { pathToFileURL } from "url"
import { defaultModel, parseModelSelection, parseUri } from "../../src/acp/agent-adapter"

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
