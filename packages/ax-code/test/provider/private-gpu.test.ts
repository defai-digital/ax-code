import { afterEach, describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import {
  connectPrivateGpu,
  disconnectPrivateGpu,
  isDedicatedPrivateGpuProviderID,
  isPrivateGpuProviderID,
  normalizePrivateGpuBaseURL,
  privateGpuVendor,
  reservedOutputTokens,
  requireDedicatedPrivateGpuVendor,
} from "../../src/provider/private-gpu"
import { DEFAULT_SETUP_PROVIDER_IDS } from "../../src/provider/default-setup-providers"

const originalFetch = globalThis.fetch

afterEach(async () => {
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

describe("private-gpu connect and disconnect", () => {
  test.each(["alibaba-pai", "custom-private-gpu"])(
    "connects %s and removes its saved connection",
    async (providerID) => {
      const requests: RequestInit[] = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "http://127.0.0.1:18110/v1/models") {
          requests.push(init ?? {})
          return new Response(JSON.stringify({ data: [{ id: "kimi-k3" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
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
})
