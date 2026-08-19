import { describe, expect, test } from "vitest"
import path from "path"
import { pathToFileURL } from "url"
import { defaultModel, parseUri } from "../../src/acp/agent-adapter"

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
          id: "qoder-cli",
          models: { "qwen3.8-max": { id: "qwen3.8-max", providerID: "qoder-cli" } },
        },
        {
          id: "openai",
          models: { "gpt-5": { id: "gpt-5", providerID: "openai" } },
        },
      ]),
    )

    expect(model).toEqual({ providerID: "qoder-cli", modelID: "qwen3.8-max" })
  })

  test("fails clearly instead of inventing a stale fallback when no provider is connected", async () => {
    await expect(defaultModel(configWithProviders([]))).rejects.toThrow("No connected provider has an available model")
  })
})
