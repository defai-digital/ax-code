import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Provider } from "../../src/provider/provider"
import { RoutePolicy } from "../../src/provider/route-policy"
import { chooseFallbackModel } from "../../src/session/prompt/prompt-provider-fallback"
import { providerFallbackLookupDecision } from "../../src/session/prompt/prompt-loop-decisions"
import { handlePromptLoopError } from "../../src/session/prompt/prompt-loop-errors"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionID } from "../../src/session/schema"
import { Flag } from "../../src/flag/flag"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const primary = { providerID: ProviderID.make("gateway"), modelID: ModelID.make("openai/gpt-oss-120b") }
const second = { providerID: ProviderID.make("gateway"), modelID: ModelID.make("other-model") }
const third = { providerID: ProviderID.make("other"), modelID: ModelID.make("third") }
const originalConfig = Flag.AX_CODE_CONFIG
afterEach(() => {
  vi.unstubAllEnvs()
  Object.assign(Flag, { AX_CODE_CONFIG: originalConfig })
})

describe("explicit model recovery policy", () => {
  test("defaults to no fallback and distinguishes same-gateway models", () => {
    expect(RoutePolicy.next({ current: primary, candidates: [] })).toBeUndefined()
    expect(RoutePolicy.next({ current: primary, candidates: [primary, second, third] })).toEqual(second)
    expect(
      RoutePolicy.next({ current: second, candidates: [primary, second, third], failed: [RoutePolicy.key(primary)] }),
    ).toEqual(third)
    expect(
      RoutePolicy.next({
        current: third,
        candidates: [primary, second, third],
        failed: [RoutePolicy.key(primary), RoutePolicy.key(second)],
      }),
    ).toBeUndefined()
  })

  test("rejects duplicates, malformed targets and unbounded lists", () => {
    for (const fallback of [
      [primary, primary],
      [{ providerID: "", modelID: "x" }],
      Array.from({ length: 9 }, (_, i) => ({ providerID: "p", modelID: String(i) })),
    ]) {
      expect(RoutePolicy.Configuration.safeParse({ fallback }).success).toBe(false)
    }
    expect(RoutePolicy.Configuration.parse({ fallback: [primary, second] }).fallback).toEqual([primary, second])
    expect(RoutePolicy.key({ providerID: "a/b", modelID: "c" })).not.toBe(
      RoutePolicy.key({ providerID: "a", modelID: "b/c" }),
    )
  })

  test("restrictions preserve owner order and cannot add targets", () => {
    expect(RoutePolicy.narrow({ fallback: [primary, second] }, { fallback: [third, second, primary] })).toEqual({
      fallback: [primary, second],
    })
    expect(RoutePolicy.narrow(undefined, { fallback: [third] })).toEqual({ fallback: [] })
    expect(RoutePolicy.narrow({ fallback: [primary] }, {})).toEqual({ fallback: [primary] })
    expect(RoutePolicy.narrow({ fallback: [primary] }, { fallback: [] })).toEqual({ fallback: [] })
  })

  test("catalog ordering cannot grant or reorder recovery targets", () => {
    const entries = [
      [
        "gateway",
        {
          id: "gateway",
          models: { [primary.modelID]: { id: primary.modelID }, [second.modelID]: { id: second.modelID } },
        },
      ],
      ["other", { id: "other", models: { third: { id: third.modelID } } }],
    ] as const
    for (const ordered of [entries, [...entries].reverse()]) {
      const providers = Object.fromEntries(ordered) as Parameters<typeof chooseFallbackModel>[0]
      expect(
        chooseFallbackModel(providers, { failedProviderID: primary.providerID, preferredModelID: primary.modelID }),
      ).toBeUndefined()
      expect(
        chooseFallbackModel(providers, {
          failedProviderID: primary.providerID,
          preferredModelID: primary.modelID,
          candidates: [second, third],
        }),
      ).toEqual(second)
      expect(
        chooseFallbackModel(providers, {
          failedProviderID: primary.providerID,
          candidates: [{ providerID: "missing", modelID: "missing" }, third],
        }),
      ).toBeUndefined()
    }
  })

  test("typed retry exhaustion permits transient recovery at the first outer error", () => {
    for (const statusCode of [429, 500, 502, 503, 504]) {
      expect(
        providerFallbackLookupDecision({
          consecutiveErrors: 1,
          error: {
            name: "APIError",
            data: {
              statusCode,
              message: "temporary overload",
              isRetryable: false,
              metadata: { retryExhausted: "true" },
            },
          },
        }),
      ).toMatchObject({ action: "lookup" })
    }
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 5,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "insufficient_quota", metadata: { retryExhausted: "true" } },
        },
      }),
    ).toEqual({ action: "skip" })
  })

  test.each([401, 402, 403])("permanent HTTP %s never invokes a candidate resolver", async (statusCode) => {
    const findFallback = vi.fn(async () => third)
    const result = await handlePromptLoopError(
      {
        sessionID: SessionID.descending(),
        currentModel: primary,
        error: { name: "APIError", data: { statusCode, message: "denied", isRetryable: true } },
        consecutiveErrors: 1,
        step: 1,
      },
      { findFallback, publishError() {}, warn() {} },
    )
    expect(result.action).toBe("stop")
    expect(findFallback).not.toHaveBeenCalled()
  })

  test("committed output stops both same-target outer retry and fallback", async () => {
    const findFallback = vi.fn(async () => third)
    const result = await handlePromptLoopError(
      {
        sessionID: SessionID.descending(),
        currentModel: primary,
        recoverySafe: false,
        error: { name: "APIError", data: { statusCode: 503, message: "temporary overload", isRetryable: true } },
        consecutiveErrors: 2,
        step: 1,
      },
      { findFallback, publishError() {}, warn() {} },
    )
    expect(result.action).toBe("stop")
    expect(findFallback).not.toHaveBeenCalled()
  })

  test("unknown and invalid request errors never authorize a model change", () => {
    for (const statusCode of [undefined, 400, 404, 422, 501]) {
      expect(
        providerFallbackLookupDecision({
          consecutiveErrors: 5,
          error: { name: "APIError", data: { statusCode, message: "failure", metadata: { retryExhausted: "true" } } },
        }),
      ).toEqual({ action: "skip" })
    }
  })

  test("a direct SDK non-retryable failure cannot change models", () => {
    expect(
      providerFallbackLookupDecision({
        consecutiveErrors: 5,
        error: { name: "AI_APICallError", statusCode: 503, message: "do not retry", isRetryable: false },
      }),
    ).toEqual({ action: "skip" })
  })

  test("local primary cannot send auxiliary work to a remote provider", async () => {
    await expect(Provider.assertLocalRoute(ProviderID.make("ax-engine"), third.providerID)).rejects.toThrow(
      "cannot leave local provider",
    )
    await expect(
      Provider.assertLocalRoute(ProviderID.make("ax-engine"), ProviderID.make("ax-engine")),
    ).resolves.toBeUndefined()
  })

  test("mapped-loopback primary stops recovery before resolving a remote candidate", async () => {
    const findFallback = vi.fn(async () => third)
    const result = await handlePromptLoopError(
      {
        sessionID: SessionID.descending(),
        currentModel: primary,
        error: {
          name: "APIError",
          data: {
            statusCode: 503,
            message: "temporary overload",
            isRetryable: false,
            metadata: { retryExhausted: "true" },
          },
        },
        consecutiveErrors: 1,
        step: 1,
        fallbackOptions: { candidates: [third] },
      },
      {
        isLocal: async () => RoutePolicy.isLoopbackBaseURL("http://[::ffff:127.0.0.1]:8080/v1"),
        findFallback,
        publishError() {},
        warn() {},
      },
    )
    expect(result.action).toBe("stop")
    expect(findFallback).not.toHaveBeenCalled()
  })

  test("project config narrows an owner route without adding or reordering", async () => {
    await using owner = await tmpdir()
    const file = path.join(owner.path, "user.json")
    await fs.writeFile(file, JSON.stringify({ llm_routing: { fallback: [primary, second] } }))
    Object.assign(Flag, { AX_CODE_CONFIG: file })
    await using project = await tmpdir({ config: { llm_routing: { fallback: [third, second] } } })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect((await Config.get()).llm_routing?.fallback).toEqual([second])
      },
    })
  })

  test("even a trusted repository cannot grant fallback targets", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using project = await tmpdir({ config: { llm_routing: { fallback: [third] } } })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect((await Config.get()).llm_routing?.fallback).toEqual([])
      },
    })
  })
})
