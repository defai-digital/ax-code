import { describe, expect, test } from "vitest"
import {
  applyAxTrustPromptCacheHeader,
  AX_TRUST_PROMPT_CACHE_HEADER,
  shouldSendAxTrustPromptCacheKey,
} from "../../src/provider/ax-trust-cache"

describe("shouldSendAxTrustPromptCacheKey", () => {
  test("sends for legacy AX Trust provider IDs without an option", () => {
    expect(shouldSendAxTrustPromptCacheKey({ providerID: "ax-trust" })).toBe(true)
    expect(shouldSendAxTrustPromptCacheKey({ providerID: "ax-trust-defai-digital" })).toBe(true)
  })

  test("sends when management is ax-trust even for a hostname id", () => {
    expect(
      shouldSendAxTrustPromptCacheKey({
        providerID: "defai-01-ax-trust-com",
        management: "ax-trust",
      }),
    ).toBe(true)
  })

  test("opts out when axTrust is false", () => {
    expect(
      shouldSendAxTrustPromptCacheKey({
        providerID: "ax-trust-defai-digital",
        management: "ax-trust",
        axTrust: false,
      }),
    ).toBe(false)
  })

  test("opts a generic provider in only when axTrust is true", () => {
    expect(shouldSendAxTrustPromptCacheKey({ providerID: "openrouter" })).toBe(false)
    expect(shouldSendAxTrustPromptCacheKey({ providerID: "openrouter", axTrust: false })).toBe(false)
    expect(shouldSendAxTrustPromptCacheKey({ providerID: "openrouter", axTrust: true })).toBe(true)
  })

  test("ignores unrelated management values", () => {
    expect(
      shouldSendAxTrustPromptCacheKey({
        providerID: "my-gateway",
        management: "custom-api",
      }),
    ).toBe(false)
  })
})

describe("applyAxTrustPromptCacheHeader", () => {
  test("sets the canonical header and replaces a stale configured key", () => {
    const headers = applyAxTrustPromptCacheHeader(
      { Authorization: "Bearer test", "x-ax-prompt-cache-key": "stale" },
      "ses_example",
    )
    expect(headers[AX_TRUST_PROMPT_CACHE_HEADER]).toBe("ses_example")
    expect(headers["x-ax-prompt-cache-key"]).toBeUndefined()
    expect(headers.Authorization).toBe("Bearer test")
  })
})
