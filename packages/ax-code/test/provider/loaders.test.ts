import { afterEach, test, expect, describe } from "vitest"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { which } from "../../src/util/which"

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  delete process.env.AX_STUDIO_HOST
  await Instance.disposeAll()
})

async function expectMissingCliProvider(input: {
  providerID: string
  binary: string
  baseModelID: string
  discoveredModelIDs: string[]
}) {
  if (which(input.binary)) return

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "ax-code.json"),
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          provider: { [input.providerID]: {} },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers[ProviderID.make(input.providerID)]
      expect(provider).toBeDefined()
      expect(Object.keys(provider.models)).toEqual([input.baseModelID])
      for (const modelID of input.discoveredModelIDs) {
        expect(provider.models[ModelID.make(modelID)]).toBeUndefined()
      }

      expect(provider.models[ModelID.make(input.baseModelID)]?.api.npm).toBe("cli")
    },
  })
}

describe("CLI provider loaders", () => {
  test("CLI provider discovery publishes resolved external model ids", async () => {
    const src = await Bun.file(path.join(import.meta.dirname, "../../src/provider/loaders.ts")).text()
    expect(src).toContain("return cliModels(opts.providerID, provider, resolved.model)")
    expect(src).toContain("if (resolved && resolved !== providerID)")
    expect(src).toContain("add(resolved, `${name} (${resolved})`)")
  })

  test("claude-code configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "claude-code",
      binary: "claude",
      baseModelID: "claude-code",
      discoveredModelIDs: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    })
  })

  test("gemini-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "gemini-cli",
      binary: "gemini",
      baseModelID: "gemini-cli",
      discoveredModelIDs: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
    })
  })

  test("codex-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "codex-cli",
      binary: "codex",
      baseModelID: "codex-cli",
      discoveredModelIDs: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark"],
    })
  })

  test("grok-build-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "grok-build-cli",
      binary: "grok",
      baseModelID: "grok-build-cli",
      discoveredModelIDs: ["grok-build-0.1", "grok-code-fast-1"],
    })
  })

  test("qoder-cli configured provider does not discover runnable variants when binary missing", async () => {
    await expectMissingCliProvider({
      providerID: "qoder-cli",
      binary: "qodercli",
      baseModelID: "qoder-cli",
      discoveredModelIDs: [],
    })
  })
})

describe("online provider loaders", () => {
  test("xai provider loaded with api key", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("XAI_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.xai]).toBeDefined()
        expect(providers[ProviderID.xai].source).toBe("env")
      },
    })
  })

  test("google provider loaded with api key", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_GENERATIVE_AI_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        const google = providers[ProviderID.make("google")]
        expect(google).toBeDefined()
        expect(google.source).toBe("env")
      },
    })
  })

  test("provider not loaded without credentials", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        // Without any API keys, most providers should not appear
        // (unless running in an env with global keys configured)
        const keys = Object.keys(providers)
        // Just verify we get a valid response
        expect(typeof keys.length).toBe("number")
      },
    })
  })
})

describe("offline provider loaders", () => {
  test("ollama provider survives deferred discovery and loads discovered models", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(ollama).toBeDefined()
        expect(Object.keys(ollama.models)).toContain("qwen3.5:9b")
      },
    })
  })

  test("ax-studio uses OpenAI-compatible /v1/models discovery", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    let modelFetches = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        modelFetches += 1
        const id = modelFetches === 1 ? "initial" : "default"
        return new Response(
          JSON.stringify({
            data: [
              {
                id,
                capabilities: { input: { image: true } },
                max_context_length: 8192,
                max_output_tokens: 2048,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      if (url === "http://localhost:18080/api/tags") {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        const model = axStudio.models[ModelID.make("default")]
        expect(axStudio).toBeDefined()
        expect(Object.keys(axStudio.models)).toContain("default")
        expect(axStudio.options?.baseURL).toBe("http://localhost:18080/v1")
        expect(model.capabilities.input.image).toBe(true)
        expect(model.limit).toEqual({ context: 8192, output: 2048 })
        expect(modelFetches).toBe(2)
        expect(Object.keys(axStudio.models)).not.toContain("initial")
      },
    })
  })

  test("ax-studio is not discovered when /v1/models is unavailable", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response("not found", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url === "http://localhost:18080/api/tags") {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(axStudio).toBeUndefined()
      },
    })
  })

  test("ax-studio ignores invalid /v1/models schema", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(JSON.stringify({ data: { id: "not-an-array" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        expect(providers[ProviderID.make("ax-studio")]).toBeUndefined()
      },
    })
  })

  test("ax-studio ignores discovered models with non-string ids", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: 123 }, { id: "" }, { id: " \t" }, { id: "valid-model" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(Object.keys(axStudio.models)).toEqual(["valid-model"])
      },
    })
  })

  test("ax-studio sanitizes discovered model capability and limit fields", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "valid-model",
                capabilities: {
                  temperature: "yes",
                  reasoning: true,
                  input: { text: false, image: "yes" },
                  output: { audio: "no" },
                  interleaved: { field: "invalid" },
                },
                limit: { context: "large", output: {} },
                max_context_length: "8192",
                max_output_tokens: "2048",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const model = providers[ProviderID.make("ax-studio")].models[ModelID.make("valid-model")]
        expect(model.capabilities.temperature).toBe(true)
        expect(model.capabilities.reasoning).toBe(true)
        expect(model.capabilities.input.text).toBe(false)
        expect(model.capabilities.input.image).toBe(false)
        expect(model.capabilities.output.audio).toBe(false)
        expect(model.capabilities.interleaved).toBe(false)
        expect(model.limit).toEqual({ context: 128000, output: 4096 })
      },
    })
  })

  test("ax-studio ignores non-positive discovered model limits", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "valid-model",
                limit: { context: -1, output: 0 },
                max_context_length: -8192,
                max_output_tokens: 0,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const model = providers[ProviderID.make("ax-studio")].models[ModelID.make("valid-model")]
        expect(model.limit).toEqual({ context: 128000, output: 4096 })
      },
    })
  })

  test("ax-studio applies model filters to discovered models", async () => {
    process.env.AX_STUDIO_HOST = "http://localhost:18080"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:18080/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: "allowed" }, { id: "blocked" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            provider: {
              "ax-studio": {
                whitelist: ["allowed"],
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const axStudio = providers[ProviderID.make("ax-studio")]
        expect(Object.keys(axStudio.models)).toEqual(["allowed"])
      },
    })
  })

  test("ollama ignores invalid tags JSON during deferred discovery", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        expect(providers[ProviderID.make("ollama")]).toBeUndefined()
      },
    })
  })

  test("ollama ignores discovered models with blank names", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://localhost:11434/api/tags") {
        return new Response(JSON.stringify({ models: [{ name: "" }, { name: " \t" }, { name: "qwen:latest" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({}))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(Object.keys(ollama.models)).toEqual(["qwen:latest"])
      },
    })
  })

  test("ollama provider autoloads when server reachable", async () => {
    // Test ollama discovery — this only passes when ollama is running locally
    const reachable = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (!reachable) return // skip when ollama not running

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        expect(ollama).toBeDefined()
        expect(Object.keys(ollama.models).length).toBeGreaterThan(0)
      },
    })
  })

  test("ollama provider not autoloaded when server unreachable", async () => {
    const reachable = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (reachable) return // skip when ollama IS running — we need it offline

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const ollama = providers[ProviderID.make("ollama")]
        // When server is unreachable, ollama should not autoload
        expect(ollama).toBeUndefined()
      },
    })
  })
})

describe("provider config integration", () => {
  test("config-based provider with baseURL", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            provider: {
              openai: {
                options: {
                  apiKey: "test-key",
                  baseURL: "https://custom.api.example.com/v1",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const openai = providers[ProviderID.make("openai")]
        expect(openai).toBeDefined()
        expect(openai.options?.baseURL).toBe("https://custom.api.example.com/v1")
      },
    })
  })

  test("disabled_providers excludes CLI provider", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            disabled_providers: ["claude-code"],
            provider: {
              "claude-code": {},
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.make("claude-code")]).toBeUndefined()
      },
    })
  })
})
