import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import {
  connectPrivateGpu,
  disconnectPrivateGpu,
  discoverPrivateGpuModels,
  isDedicatedPrivateGpuProviderID,
  isPrivateGpuProviderID,
  normalizePrivateGpuBaseURL,
  privateGpuModelRecords,
  privateGpuVendor,
  reservedOutputTokens,
  requireDedicatedPrivateGpuVendor,
} from "../../src/provider/private-gpu"
import { DEFAULT_SETUP_PROVIDER_IDS } from "../../src/provider/default-setup-providers"

const originalFetch = globalThis.fetch

afterEach(async () => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  await Instance.disposeAll()
})

describe("private-gpu catalog", () => {
  test("exposes Nebius Token Factory as a hosted API-key catalog", () => {
    const vendor = privateGpuVendor("nebius")
    expect(vendor?.mode).toBe("catalog")
    expect(vendor?.envKey).toBe("NEBIUS_API_KEY")
    expect(vendor?.defaultApi).toBe("https://api.tokenfactory.nebius.com/v1")
    expect(isPrivateGpuProviderID("nebius")).toBe(true)
    expect(isDedicatedPrivateGpuProviderID("nebius")).toBe(false)
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("nebius")
    expect(() => requireDedicatedPrivateGpuVendor("nebius")).toThrow(/API key/)
  })
})

describe("private-gpu endpoint", () => {
  test("normalizes OpenAI-compatible roots to /v1", () => {
    const vendor = requireDedicatedPrivateGpuVendor("alibaba-pai")
    const root = "http://127.0.0.1:18099/api/predict/svc"
    expect(normalizePrivateGpuBaseURL(root, vendor.pathStyle, vendor.name)).toBe(`${root}/v1`)
    expect(normalizePrivateGpuBaseURL(`${root}/v1/chat/completions`, vendor.pathStyle, vendor.name)).toBe(`${root}/v1`)
  })

  test("normalizes RunPod serverless IDs to /openai/v1", () => {
    const vendor = requireDedicatedPrivateGpuVendor("runpod")
    expect(normalizePrivateGpuBaseURL("https://api.runpod.ai/v2/abc123", vendor.pathStyle, vendor.name)).toBe(
      "https://api.runpod.ai/v2/abc123/openai/v1",
    )
    expect(normalizePrivateGpuBaseURL("https://api.runpod.ai/v2/abc123/openai/v1", vendor.pathStyle, vendor.name)).toBe(
      "https://api.runpod.ai/v2/abc123/openai/v1",
    )
  })

  test("normalizes Volcengine Ark roots to /api/v3", () => {
    const vendor = requireDedicatedPrivateGpuVendor("volcengine-ark")
    expect(normalizePrivateGpuBaseURL("https://ark.cn-beijing.volces.com", vendor.pathStyle, vendor.name)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    )
    expect(
      normalizePrivateGpuBaseURL("https://ark.cn-beijing.volces.com/api/v3/models", vendor.pathStyle, vendor.name),
    ).toBe("https://ark.cn-beijing.volces.com/api/v3")
  })
})

describe("private-gpu output reservation", () => {
  test("caps fallback output at 32k and never reserves more than half the window", () => {
    expect(reservedOutputTokens(1_048_576)).toBe(32_000)
    expect(reservedOutputTokens(8_000)).toBe(2_000)
    expect(reservedOutputTokens(4_000, 32_000)).toBe(2_000)
    expect(reservedOutputTokens(128_000, 16_000)).toBe(16_000)
  })
})

describe("private-gpu model discovery", () => {
  test("keeps only chat models and preserves explicitly advertised capabilities", async () => {
    const vendor = requireDedicatedPrivateGpuVendor("custom-private-gpu")
    const discovered = await discoverPrivateGpuModels({
      vendor,
      baseURL: "http://127.0.0.1:18110",
      apiKey: "endpoint-token",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "text-embedding-3-small" },
              {
                id: "glm-5.3",
                context_length: 64_000,
                max_output_tokens: 8_192,
                capabilities: { toolcall: true, reasoning: true, temperature: true, attachment: false },
              },
              { id: "glm-5.3" },
              { id: "unqualified-chat" },
            ],
          }),
        ),
    })

    expect(discovered.models).toEqual([
      expect.objectContaining({
        id: "glm-5.3",
        context: 64_000,
        output: 8_192,
        toolCall: true,
        reasoning: true,
        temperature: true,
        attachment: false,
      }),
      expect.objectContaining({
        id: "unqualified-chat",
        toolCall: false,
        reasoning: false,
        temperature: false,
        attachment: false,
      }),
    ])

    const records = privateGpuModelRecords(discovered.models, discovered.baseURL, vendor)
    expect(records[ModelID.make("unqualified-chat")]?.capabilities).toMatchObject({
      toolcall: false,
      reasoning: false,
      interleaved: false,
    })
  })
})

describe("private-gpu connect and disconnect", () => {
  test.each(["alibaba-pai", "custom-private-gpu"])(
    "connects %s and removes its saved connection",
    async (providerID) => {
      const requests: RequestInit[] = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "http://127.0.0.1:18110/v1/models") {
          requests.push(init ?? {})
          return new Response(
            JSON.stringify({
              data: [{ id: "kimi-k3", capabilities: { toolcall: true, reasoning: true, temperature: true } }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          )
        }
        return originalFetch(input, init)
      }) as typeof fetch

      await using tmp = await tmpdir({ config: { enabled_providers: [providerID] } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const result = await connectPrivateGpu({
              providerID,
              baseURL: "http://127.0.0.1:18110",
              apiKey: "endpoint-token",
            })
            expect(result).toEqual({
              providerID,
              baseURL: "http://127.0.0.1:18110/v1",
              models: ["kimi-k3"],
            })
            expect(await Auth.get(providerID)).toEqual({ type: "api", key: "endpoint-token" })
            const saved = (await Config.getGlobal()).provider?.[providerID]
            expect(saved?.options?.baseURL).toBe("http://127.0.0.1:18110/v1")
            expect(saved?.options).not.toHaveProperty("apiKey")
            expect(saved?.models?.["kimi-k3"]?.id).toBe("kimi-k3")
            expect(saved?.models?.["kimi-k3"]?.tool_call).toBe(true)
            expect(saved?.models?.["kimi-k3"]?.reasoning).toBe(true)

            await Provider.ready()
            const loaded = (await Provider.list())[ProviderID.make(providerID)]
            expect(loaded.models[ModelID.make("kimi-k3")].api.url).toBe("http://127.0.0.1:18110/v1")
            expect(requests.length).toBeGreaterThan(0)
            expect(
              requests.every(
                (request) => new Headers(request.headers).get("authorization") === "Bearer endpoint-token",
              ),
            ).toBe(true)
          } finally {
            await disconnectPrivateGpu(providerID)
          }
          expect(await Auth.get(providerID)).toBeUndefined()
          expect((await Config.getGlobal()).provider?.[providerID]).toBeUndefined()
        },
      })
    },
  )

  test("connect deletes a plaintext apiKey left in global config", async () => {
    const providerID = "alibaba-pai"
    const inlineKey = "inline-secret-token"
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input) === "http://127.0.0.1:18110/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "kimi-k3" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return originalFetch(input)
    }) as typeof fetch

    await fs.mkdir(Global.Path.config, { recursive: true })
    const jsonc = path.join(Global.Path.config, "ax-code.jsonc")
    const globalFile = await fs
      .stat(jsonc)
      .then(() => jsonc)
      .catch(() => path.join(Global.Path.config, "ax-code.json"))
    await fs.writeFile(
      globalFile,
      JSON.stringify({
        username: "kept-name",
        provider: {
          [providerID]: {
            options: {
              baseURL: "http://old.example/v1",
              apiKey: inlineKey,
            },
          },
        },
      }),
    )

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await connectPrivateGpu({
            providerID,
            baseURL: "http://127.0.0.1:18110",
            apiKey: "endpoint-token",
          })
          expect(await Auth.get(providerID)).toEqual({ type: "api", key: "endpoint-token" })
          const saved = (await Config.getGlobal()).provider?.[providerID]
          expect(saved?.options?.baseURL).toBe("http://127.0.0.1:18110/v1")
          expect(saved?.options).not.toHaveProperty("apiKey")
          expect((await Config.getGlobal()).username).toBe("kept-name")
          const raw = await fs.readFile(globalFile, "utf-8")
          expect(raw).not.toContain(inlineKey)
          expect(raw).not.toContain("apiKey")
        } finally {
          await disconnectPrivateGpu(providerID)
        }
      },
    })
  })
})

test.each(["existing", "new", "concurrent", "rollback-failure"] as const)(
  "failed private GPU config save preserves the correct credential (%s)",
  async (mode) => {
    const providerID = "custom-private-gpu"
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input) === "http://127.0.0.1:18110/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "model" }] }), {
          headers: { "content-type": "application/json" },
        })
      }
      return originalFetch(input)
    }) as typeof fetch
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.remove(providerID)
        if (mode !== "new") await Auth.set(providerID, { type: "api", key: "previous-credential" })
        const failure = new Error("Configuration save failed")
        vi.spyOn(Config, "updateGlobal").mockImplementation(async () => {
          if (mode === "concurrent") await Auth.set(providerID, { type: "api", key: "newer-credential" })
          throw failure
        })
        const rollbackError = new Error("Credential restore failed")
        if (mode === "rollback-failure") vi.spyOn(Auth, "replaceIfUnchanged").mockRejectedValueOnce(rollbackError)
        try {
          const attempt = connectPrivateGpu({
            providerID,
            baseURL: "http://127.0.0.1:18110",
            apiKey: "attempted-credential",
          })
          if (mode === "rollback-failure") {
            await expect(attempt).rejects.toMatchObject({
              name: "AggregateError",
              errors: [failure, rollbackError],
            })
            expect(await Auth.get(providerID)).toEqual({ type: "api", key: "attempted-credential" })
            return
          }
          await expect(attempt).rejects.toBe(failure)
          expect(await Auth.get(providerID)).toEqual(
            mode === "new"
              ? undefined
              : {
                  type: "api",
                  key: mode === "concurrent" ? "newer-credential" : "previous-credential",
                },
          )
        } finally {
          await Auth.remove(providerID)
        }
      },
    })
  },
)
