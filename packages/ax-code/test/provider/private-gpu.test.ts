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
  PRIVATE_GPU_LOADERS,
} from "../../src/provider/private-gpu"
import { declaredCapabilityEvidence } from "../../src/provider/capability-evidence"
import { modelSelectableForProvider } from "../../src/provider/model-selectability"
import { DEFAULT_SETUP_PROVIDER_IDS } from "../../src/provider/default-setup-providers"

const originalFetch = globalThis.fetch

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
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

test("dedicated GPU discovery qualifies a valid top-level declaration despite malformed nested metadata", async () => {
  const vendor = requireDedicatedPrivateGpuVendor("custom-private-gpu")
  const discovered = await discoverPrivateGpuModels({
    vendor,
    baseURL: "http://127.0.0.1:18110/v1",
    apiKey: "fixture-key",
    fetcher: async () =>
      Response.json({
        data: [
          { id: "qualified", capabilities: { toolcall: "unknown" }, tool_call: true },
          { id: "explicit-deny", capabilities: { toolcall: false }, tool_call: true },
          { id: "undeclared", capabilities: { toolcall: "unknown" } },
        ],
      }),
  })
  const models = privateGpuModelRecords(discovered.models, discovered.baseURL, vendor)
  expect(models.qualified.capabilities.toolcall).toBe(true)
  expect(declaredCapabilityEvidence(models.qualified.capabilities)?.toolCalling).toEqual({
    state: "supported",
    source: "deployment",
  })
  expect(modelSelectableForProvider(vendor.id, models.qualified)).toBe(true)
  expect(modelSelectableForProvider(vendor.id, models["explicit-deny"])).toBe(false)
  expect(declaredCapabilityEvidence(models.undeclared.capabilities)?.toolCalling.state).toBe("unknown")
})

describe("private-gpu loader", () => {
  test("discoverModels rejects when the endpoint fails instead of returning an empty catalog", async () => {
    const vendor = requireDedicatedPrivateGpuVendor("custom-private-gpu")
    vi.stubEnv(vendor.envKey, "endpoint-token")
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "http://127.0.0.1:18110/v1/models") return new Response("unavailable", { status: 503 })
      return originalFetch(input)
    }) as typeof fetch
    const provider = {
      id: ProviderID.make(vendor.id),
      name: vendor.id,
      source: "config",
      env: [],
      models: {},
      options: { baseURL: "http://127.0.0.1:18110" },
    } as unknown as Provider.Info
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const loader = await PRIVATE_GPU_LOADERS[vendor.id](provider)
        await expect(loader.discoverModels!(provider)).rejects.toThrow(/custom-private-gpu model discovery failed/)
      },
    })
  })
})

describe("private-gpu catalog health", () => {
  // undici's shape for a refused connection: a TypeError whose `cause`
  // carries the socket error code. A bare `Error("connect ECONNREFUSED ...")`
  // carries no code, so it does not prove the server is unreachable.
  function connectionRefused() {
    return Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:18110"), { code: "ECONNREFUSED" }),
    })
  }

  // Runs a full registry init against a dedicated endpoint whose model list
  // fails the way `respond` decides, and reports how that failure was recorded.
  async function recordFailedDiscovery(respond: () => Response) {
    const vendor = requireDedicatedPrivateGpuVendor("custom-private-gpu")
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    vi.stubEnv(vendor.envKey, "endpoint-token")
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "http://127.0.0.1:18110/v1/models") return respond()
      return originalFetch(input, init)
    }) as typeof fetch
    await using tmp = await tmpdir({
      config: {
        provider: {
          [vendor.id]: {
            options: { baseURL: "http://127.0.0.1:18110" },
            models: { saved: { name: "Saved", limit: { context: 8000, output: 2000 } } },
          },
        },
      },
    })
    // Awaited here so the temp directory outlives the registry init.
    return await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        const health = await Provider.catalogHealth()
        const snapshot = await Provider.snapshot()
        return {
          failed: health.failed.has(vendor.id),
          completed: health.completed.has(vendor.id),
          reported: snapshot.discovery.diagnostics.some((entry) => entry.source === `discovery:${vendor.id}`),
        }
      },
    })
  }

  test("an unreachable endpoint marks the catalog incomplete without a startup failure", async () => {
    // The server cannot be reached, which is an ordinary state for a dedicated
    // endpoint: incomplete for pin diagnostics, but not a startup failure.
    expect(
      await recordFailedDiscovery(() => {
        throw connectionRefused()
      }),
    ).toEqual({ failed: true, completed: false, reported: false })
  })

  test("an endpoint that answers with an HTTP error is reported as a discovery failure", async () => {
    // The server answered, so it is reachable: the failed model list is a real
    // discovery failure, not an offline state.
    expect(await recordFailedDiscovery(() => new Response("unavailable", { status: 503 }))).toEqual({
      failed: true,
      completed: false,
      reported: true,
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

test.each(["existing", "new", "concurrent", "concurrent-same", "rollback-failure"] as const)(
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
          if (mode === "concurrent-same") await Auth.set(providerID, { type: "api", key: "attempted-credential" })
          throw failure
        })
        const rollbackError = new Error("Credential restore failed")
        if (mode === "rollback-failure") {
          const setKey = Auth.setApiKeyWithRollback
          vi.spyOn(Auth, "setApiKeyWithRollback").mockImplementationOnce(async (...args) => {
            await setKey(...args)
            return async () => {
              throw rollbackError
            }
          })
        }
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
                  key:
                    mode === "concurrent"
                      ? "newer-credential"
                      : mode === "concurrent-same"
                        ? "attempted-credential"
                        : "previous-credential",
                },
          )
        } finally {
          await Auth.remove(providerID)
        }
      },
    })
  },
)
