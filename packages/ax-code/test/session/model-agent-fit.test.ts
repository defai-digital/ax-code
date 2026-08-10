import { describe, expect, test } from "vitest"
import {
  DEFAULT_CORE_AGENT_FIXED_TOKENS_ESTIMATE,
  DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE,
  fixedTokensEstimateForProvider,
  modelFitsAgentToolSetup,
  usableInputTokens,
} from "../../src/session/model-agent-fit"

describe("model agent/tool fit (#379)", () => {
  test("computes usable input from explicit input limit", () => {
    expect(usableInputTokens({ context: 65536, input: 14745, output: 4096 })).toBe(14745)
  })

  test("falls back to context minus output when input is missing", () => {
    expect(usableInputTokens({ context: 16384, output: 1639 })).toBe(16384 - 1639)
  })

  test("blocks models whose usable budget cannot fit fixed agent overhead", () => {
    const blocked = modelFitsAgentToolSetup({
      usableTokens: 14745,
      fixedTokensEstimate: 38799,
      modelLabel: "Qwen3.6 27B (AX Engine Local)",
    })
    expect(blocked.fits).toBe(false)
    if (blocked.fits) throw new Error("expected block")
    expect(blocked.message).toContain("cannot fit the current AX Code agent/tool setup")
    expect(blocked.message).toContain("38799")
    expect(blocked.message).toContain("14745")
  })

  test("allows models with enough usable budget", () => {
    expect(
      modelFitsAgentToolSetup({
        usableTokens: 50_000,
        fixedTokensEstimate: DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE,
      }).fits,
    ).toBe(true)
  })

  test("uses the full-agent fixed estimate for every provider including ax-engine (#379)", () => {
    // Selection preflight must not under-estimate ax-engine: runtime still
    // needs ~38.8k fixed tokens for the default agent/tool setup.
    expect(fixedTokensEstimateForProvider("ax-engine")).toBe(DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE)
    expect(fixedTokensEstimateForProvider("openai")).toBe(DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE)
    expect(fixedTokensEstimateForProvider(undefined)).toBe(DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE)
    // Core constant remains documented but is not used for selection preflight.
    expect(DEFAULT_CORE_AGENT_FIXED_TOKENS_ESTIMATE).toBeLessThan(DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE)
  })

  test("blocks the reported AX Engine Qwen usable budget against the full-agent estimate", () => {
    const usable = usableInputTokens({ context: 16384, input: 14745, output: 1639 })
    expect(usable).toBe(14745)
    const fixed = fixedTokensEstimateForProvider("ax-engine")
    expect(fixed).toBe(DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE)
    const decision = modelFitsAgentToolSetup({
      usableTokens: usable,
      fixedTokensEstimate: fixed,
      modelLabel: "Qwen3.6 27B (AX Engine Local)",
    })
    expect(decision.fits).toBe(false)
  })
})
