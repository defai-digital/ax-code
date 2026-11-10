import { describe, expect, test } from "vitest"
import { applyDefaultContextWindow, defaultContextWindow } from "../../src/provider/context-defaults"
import { isMiniMaxThinkingForcedOn, resolveProtocolProfile } from "../../src/provider/protocol-profile"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform as T } from "../../src/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const model = (providerID: string, id: string, url: string, npm: string): any => ({
  id,
  providerID,
  name: id,
  api: { id, url, npm },
  capabilities: {
    reasoning: true,
    toolcall: true,
    temperature: true,
    attachment: false,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 1_000_000, output: 524_288 },
  options: {},
  headers: {},
  status: "active",
  release_date: "",
  family: "minimax",
})
const router = (id: string) =>
  model("defai-01-ax-trust-com", id, "https://defai-01.ax-trust.com/v1", "@ai-sdk/openai-compatible")
const official = (id: string) => model("minimax", id, "https://api.minimax.io/anthropic/v1", "@ai-sdk/anthropic")

describe("MiniMax M3 family", () => {
  test.each(["MiniMax-M3", "MiniMax-M3.1-Flash", "MiniMax-M3.1", "MiniMax-M3.2-Flash", "minimax-m3.1-flash"])(
    "%s resolves to the minimax-m3 chat family on an OpenAI-compatible route",
    (id) => {
      expect(resolveProtocolProfile(router(id)).reasoningFamily).toBe("minimax-m3")
    },
  )

  test.each(["MiniMaxAI/MiniMax-M3", "MiniMax-M30", "MiniMax-M3.1-Flash-FP8", "MiniMax-M2.5"])(
    "%s does not get the native chat family",
    (id) => {
      expect(resolveProtocolProfile(router(id)).reasoningFamily).toBeUndefined()
    },
  )

  test("M3.1 and later always think; M3 does not", () => {
    for (const id of [
      "MiniMax-M3.1-Flash",
      "MiniMax-M3.1",
      "MiniMax-M3.2",
      "minimax/MiniMax-M3.1-Flash",
      "MiniMax-M3.1-Flash-FP8",
      // Gateway spellings from the catalog (empiriolabs/venice, fireworks).
      "minimax-m3-1-flash",
      "accounts/fireworks/models/minimax-m3p1-flash",
      "MiniMax-M3.1-Flash-Preview",
    ])
      expect(isMiniMaxThinkingForcedOn(id), id).toBe(true)
    for (const id of [
      "MiniMax-M3",
      "MiniMax-M3-MXFP8",
      "MiniMax-M2.7",
      "MiniMax-M3.0",
      "minimax-m3-free",
      "minimax-m3-preview",
      "MiniMax-M3-0601",
    ])
      expect(isMiniMaxThinkingForcedOn(id), id).toBe(false)
  })

  test("M3.1-Flash never sends the rejected disabled-thinking shape", () => {
    for (const m of [router("MiniMax-M3.1-Flash"), official("MiniMax-M3.1-Flash")]) {
      expect(T.variants(m), m.providerID).toEqual({})
      const small = T.sanitizeOptions(m, T.applySmallOverrides(m, T.smallOptions(m), {}))
      expect(small.thinking, m.providerID).toBeUndefined()
      // A configured or policy-supplied disable is dropped instead of 400ing.
      expect(T.sanitizeOptions(m, { thinking: { type: "disabled" } }), m.providerID).toEqual({})
    }
    expect(T.smallOptions(router("MiniMax-M3.1-Flash"))).toEqual({ reasoning_split: true })
    expect(T.options({ model: router("MiniMax-M3.1-Flash"), sessionID: "s" })).toEqual({ reasoning_split: true })
  })

  test("gateway M3.1 spellings get no disabled-thinking variant", () => {
    // Regression: `minimax-m3-1-flash` and `minimax-m3p1-flash` were read as
    // M3 and offered a `none` variant that M3.1 rejects.
    for (const id of ["minimax-m3-1-flash", "accounts/fireworks/models/minimax-m3p1-flash"]) {
      const m = model("empiriolabs", id, "https://api.example.com/v1", "@ai-sdk/openai-compatible")
      expect(T.variants(m), id).toEqual({})
      expect(T.sanitizeOptions(m, { thinking: { type: "disabled" } }), id).toEqual({})
    }
  })

  test("M3 keeps its switchable thinking controls", () => {
    expect(T.variants(router("MiniMax-M3")).none).toEqual({ thinking: { type: "disabled" } })
    expect(T.smallOptions(router("MiniMax-M3"))).toEqual({ thinking: { type: "disabled" }, reasoning_split: true })
    expect(T.sanitizeOptions(router("MiniMax-M3"), { thinking: { type: "disabled" } })).toEqual({
      thinking: { type: "disabled" },
    })
  })
})

describe("MiniMax M3 default context window", () => {
  test("defaults the M3 family to the vendor 512k window on every route", () => {
    for (const m of [router("MiniMax-M3"), router("MiniMax-M3.1-Flash"), official("MiniMax-M3.1-Flash")]) {
      expect(defaultContextWindow(m)).toBe(512_000)
      applyDefaultContextWindow(m, false)
      expect(m.limit.context).toBe(512_000)
      expect(m.limit.output).toBe(524_288)
    }
    expect(defaultContextWindow(router("MiniMax-M2.7"))).toBeUndefined()
  })

  test("keeps an explicit window and never raises a smaller one", () => {
    const explicit = router("MiniMax-M3.1-Flash")
    applyDefaultContextWindow(explicit, true)
    expect(explicit.limit.context).toBe(1_000_000)
    const small = router("MiniMax-M3")
    small.limit = { context: 200_000, output: 8192 }
    applyDefaultContextWindow(small, false)
    expect(small.limit.context).toBe(200_000)
  })

  test("a hand-written limit.context in config opts into the 1M window", async () => {
    const providerID = ProviderID.make("my-minimax")
    await using tmp = await tmpdir({
      config: {
        enabled_providers: [providerID],
        provider: {
          [providerID]: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://minimax.example/v1", apiKey: "test" },
            models: {
              "MiniMax-M3.1-Flash": {
                name: "M3.1 Flash",
                tool_call: true,
                limit: { context: 1_000_000, output: 131072 },
              },
              "MiniMax-M3": { name: "M3", tool_call: true },
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Provider.getModel(providerID, ModelID.make("MiniMax-M3.1-Flash"))).limit.context).toBe(1_000_000)
        const defaulted = await Provider.getModel(providerID, ModelID.make("MiniMax-M3"))
        expect(defaulted.limit.context).toBeLessThanOrEqual(512_000)
      },
    })
  })
})
