import { describe, expect, test } from "vitest"
import { Pricing } from "../../src/provider/pricing"

describe("provider.pricing matching", () => {
  test("exact model matches without a provider", () => {
    expect(Pricing.ratesFor("deepseek-chat", undefined)).toMatchObject({ input: 0.27, output: 1.1 })
  })

  test("family prefixes match and the longest prefix wins", () => {
    // gemini-2.5-flash is more specific than a hypothetical shorter rule.
    const flash = Pricing.ratesFor("gemini-2.5-flash-001", "google")
    expect(flash).toMatchObject({ input: 0.3, output: 2.5 })
    const pro = Pricing.ratesFor("gemini-2.5-pro-002", "google")
    expect(pro).toMatchObject({ input: 1.25, output: 10 })
    // Prefix must actually be a prefix.
    expect(Pricing.ratesFor("gemini-9-nano", "google")).toBeUndefined()
  })

  test("provider-qualified entries beat model-only entries at equal length", () => {
    // gpt-5 under the openai provider is priced; an unrelated provider
    // re-serving the same model id with its own entry would win, but a
    // passthrough provider without an entry still matches the model-only
    // rule.
    const viaProxy = Pricing.ratesFor("gpt-5.6-sol", "some-gateway")
    expect(viaProxy).toMatchObject({ input: 1.25, output: 10 })
  })

  test("unknown models return undefined, never a zero guess", () => {
    expect(Pricing.ratesFor("totally-unknown-model", "anthropic")).toBeUndefined()
    expect(Pricing.estimateCost("totally-unknown-model", { input: 1_000_000, output: 1_000_000 })).toBeUndefined()
  })
})

describe("provider.pricing estimateCost math", () => {
  test("prices input, output, reasoning-as-output, and cache rates", () => {
    const cost = Pricing.estimateCost(
      "claude-sonnet-4-5",
      {
        input: 2_000_000,
        output: 500_000,
        reasoning: 100_000,
        cache: { read: 4_000_000, write: 1_000_000 },
      },
      "anthropic",
    )
    // 2M * 3 + 0.6M * 15 + 4M * 0.3 + 1M * 3.75, all per 1M tokens
    expect(cost).toBeDefined()
    expect(cost!.usd).toBeCloseTo(6 + 9 + 1.2 + 3.75, 6)
  })

  test("missing cache rates fall back to the input rate", () => {
    // gemini-3 entries omit cache rates: cache read/write price as input.
    const cost = Pricing.estimateCost(
      "gemini-3-pro",
      { input: 1_000_000, output: 0, cache: { read: 1_000_000, write: 1_000_000 } },
      "google",
    )
    expect(cost!.usd).toBeCloseTo(2 + 2 + 2, 6)
  })

  test("zero-token usage on a priced model estimates as zero dollars", () => {
    const cost = Pricing.estimateCost("grok-4.6", { input: 0, output: 0 }, "xai")
    expect(cost).toMatchObject({ usd: 0 })
  })
})
