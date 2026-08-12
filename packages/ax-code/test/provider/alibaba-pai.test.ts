import { afterEach, describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { DEFAULT_SETUP_PROVIDER_IDS } from "../../src/provider/default-setup-providers"
import { shouldShowProviderInList } from "../../src/server/routes/provider"
import { ModelsDev } from "../../src/provider/models"
import { Env } from "../../src/env"
import {
  ALIBABA_PAI_PROVIDER_ID,
  alibabaPaiModelRecords,
  connectAlibabaPai,
  discoverAlibabaPaiModels,
  normalizeAlibabaPaiBaseURL,
} from "../../src/provider/alibaba-pai"

const originalFetch = globalThis.fetch
const EAS_URL = "http://5618677365194071.ap-southeast-1.pai-eas.aliyuncs.com/api/predict/quickstart_deploy_20260812_bn82"

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("alibaba-pai endpoint", () => {
  test("normalizes EAS access address to /v1", () => {
    expect(normalizeAlibabaPaiBaseURL(EAS_URL)).toBe(`${EAS_URL}/v1`)
    expect(normalizeAlibabaPaiBaseURL(`${EAS_URL}/`)).toBe(`${EAS_URL}/v1`)
    expect(normalizeAlibabaPaiBaseURL(`${EAS_URL}/v1`)).toBe(`${EAS_URL}/v1`)
    expect(normalizeAlibabaPaiBaseURL(`${EAS_URL}/v1/`)).toBe(`${EAS_URL}/v1`)
    expect(normalizeAlibabaPaiBaseURL(`${EAS_URL}/v1/chat/completions`)).toBe(`${EAS_URL}/v1`)
    expect(normalizeAlibabaPaiBaseURL(`${EAS_URL}/v1/models`)).toBe(`${EAS_URL}/v1`)
  })

  test("rejects empty or non-http URLs", () => {
    expect(() => normalizeAlibabaPaiBaseURL("")).toThrow(/required/)
    expect(() => normalizeAlibabaPaiBaseURL("ftp://example.com")).toThrow(/http/)
  })
})

describe("alibaba-pai discovery", () => {
  test("maps /v1/models including max_model_len and sends Bearer token", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({ url: String(input), authorization: headers.get("authorization") })
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "GLM-5.2-FP8",
              object: "model",
              owned_by: "sglang",
              max_model_len: 1048576,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    const discovered = await discoverAlibabaPaiModels({
      baseURL: EAS_URL,
      apiKey: "eas-token",
      fetcher,
    })
    expect(discovered.baseURL).toBe(`${EAS_URL}/v1`)
    expect(discovered.models).toEqual([{ id: "GLM-5.2-FP8", name: "GLM-5.2-FP8", context: 1048576, output: 32_000 }])
    expect(calls).toEqual([{ url: `${EAS_URL}/v1/models`, authorization: "Bearer eas-token" }])

    const records = alibabaPaiModelRecords(discovered.models, discovered.baseURL)
    const model = records[ModelID.make("GLM-5.2-FP8")]
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
    expect(model.limit).toEqual({ context: 1048576, input: 1048576 - 32_000, output: 32_000 })
  })

  test("fails when the service returns no models", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch
    await expect(discoverAlibabaPaiModels({ baseURL: EAS_URL, apiKey: "token", fetcher })).rejects.toThrow(/no models/)
  })
})

describe("alibaba-pai provider surface", () => {
  test("is a default setup/login provider", async () => {
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain(ALIBABA_PAI_PROVIDER_ID)
    expect(shouldShowProviderInList({ key: ALIBABA_PAI_PROVIDER_ID, disabled: new Set() })).toBe(true)
    const all = await ModelsDev.get()
    expect(all[ALIBABA_PAI_PROVIDER_ID]?.name).toBe("Alibaba PAI-EAS")
    expect(all[ALIBABA_PAI_PROVIDER_ID]?.npm).toBe("@ai-sdk/openai-compatible")
  })

  test("discovers live models after URL + token are configured", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === "http://127.0.0.1:18099/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: "MiniMax-M3-MXFP8", max_model_len: 1048576 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return originalFetch(input, init)
    }) as typeof fetch

    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ALIBABA_PAI_API_KEY", "test-token")
        Env.set("ALIBABA_PAI_BASE_URL", "http://127.0.0.1:18099/v1")
      },
      fn: async () => {
        await Provider.ready()
        const providers = await Provider.list()
        const pai = providers[ProviderID.make(ALIBABA_PAI_PROVIDER_ID)]
        expect(pai).toBeDefined()
        expect(Object.keys(pai.models)).toContain("MiniMax-M3-MXFP8")
        expect(pai.options?.baseURL).toBe("http://127.0.0.1:18099/v1")
        expect(pai.models[ModelID.make("MiniMax-M3-MXFP8")].limit.context).toBe(1048576)
        expect(pai.models[ModelID.make("MiniMax-M3-MXFP8")].limit.output).toBe(32_000)
      },
    })
  })

  test("connect persists auth and global provider baseURL", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "http://127.0.0.1:18100/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "GLM-5.2-FP8" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return originalFetch(input, init)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await connectAlibabaPai({
          baseURL: "http://127.0.0.1:18100",
          apiKey: "eas-token",
        })
        expect(result.models).toEqual(["GLM-5.2-FP8"])
        expect(result.baseURL).toBe("http://127.0.0.1:18100/v1")

        const auth = await Auth.get(ALIBABA_PAI_PROVIDER_ID)
        expect(auth).toEqual({ type: "api", key: "eas-token" })

        const global = await Config.getGlobal()
        expect(global.provider?.[ALIBABA_PAI_PROVIDER_ID]?.options?.baseURL).toBe("http://127.0.0.1:18100/v1")
      },
    })
  })
})
