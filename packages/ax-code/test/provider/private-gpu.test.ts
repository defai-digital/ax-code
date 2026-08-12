import { afterEach, describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import {
  connectPrivateGpu,
  disconnectPrivateGpu,
  normalizePrivateGpuBaseURL,
  reservedOutputTokens,
  requireDedicatedPrivateGpuVendor,
} from "../../src/provider/private-gpu"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
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
    expect(normalizePrivateGpuBaseURL("https://ark.cn-beijing.volces.com/api/v3/models", vendor.pathStyle, vendor.name)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    )
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
  test("persists then removes auth and the global baseURL", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input) === "http://127.0.0.1:18110/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "kimi-k3" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return originalFetch(input)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await connectPrivateGpu({
          providerID: "alibaba-pai",
          baseURL: "http://127.0.0.1:18110",
          apiKey: "eas-token",
        })
        expect(result).toEqual({
          providerID: "alibaba-pai",
          baseURL: "http://127.0.0.1:18110/v1",
          models: ["kimi-k3"],
        })
        expect(await Auth.get("alibaba-pai")).toEqual({ type: "api", key: "eas-token" })
        expect((await Config.getGlobal()).provider?.["alibaba-pai"]?.options?.baseURL).toBe("http://127.0.0.1:18110/v1")

        await disconnectPrivateGpu("alibaba-pai")
        expect(await Auth.get("alibaba-pai")).toBeUndefined()
        expect((await Config.getGlobal()).provider?.["alibaba-pai"]).toBeUndefined()
      },
    })
  })
})
