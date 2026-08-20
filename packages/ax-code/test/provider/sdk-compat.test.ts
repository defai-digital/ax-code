import { describe, expect, test } from "vitest"
import semver from "semver"
import { ProviderSdkCompat } from "../../src/provider/sdk-compat"

describe("ProviderSdkCompat pin selection", () => {
  test("pins @ai-sdk/anthropic to the spec-v3 major (regression: 4.0.39 declared v4)", () => {
    const range = ProviderSdkCompat.installVersion("@ai-sdk/anthropic")
    expect(range).not.toBe("latest")
    // Verified spec-v3 release used by this repo's lockfile.
    expect(semver.satisfies("3.0.66", range)).toBe(true)
    // The poisoned cache version from the incident declared spec v4.
    expect(semver.satisfies("4.0.39", range)).toBe(false)
  })

  test("pins runtime-only providers to majors compatible with the bundled AI SDK", () => {
    expect(ProviderSdkCompat.installVersion("@ai-sdk/deepinfra")).toBe("^2.0.0")
    expect(ProviderSdkCompat.installVersion("@ai-sdk/togetherai")).toBe("^2.0.0")
    expect(ProviderSdkCompat.installVersion("@ai-sdk/vercel")).toBe("^2.0.0")
  })

  test("separates exported provider subpaths from their installable package", () => {
    expect(ProviderSdkCompat.runtimePackage("@ai-sdk/google-vertex/anthropic")).toEqual({
      name: "@ai-sdk/google-vertex",
      subpath: "anthropic",
    })
    expect(ProviderSdkCompat.runtimePackage("@ai-sdk/amazon-bedrock/mantle")).toEqual({
      name: "@ai-sdk/amazon-bedrock",
      subpath: "mantle",
    })
    expect(ProviderSdkCompat.installVersion("@ai-sdk/google-vertex/anthropic")).toBe("^4.0.0")
    expect(ProviderSdkCompat.installVersion("@ai-sdk/amazon-bedrock/mantle")).toBe("^4.0.0")
  })

  test("every mapped range is a valid semver range", () => {
    expect(Object.keys(ProviderSdkCompat.RANGES).length).toBeGreaterThan(0)
    for (const [pkg, range] of Object.entries(ProviderSdkCompat.RANGES)) {
      expect(semver.validRange(range), `${pkg} -> ${range}`).not.toBeNull()
      expect(ProviderSdkCompat.installVersion(pkg)).toBe(range)
    }
  })

  test("mapped ranges accept the lockfile-verified version of each package", () => {
    const verified: Record<string, string> = {
      "@ai-sdk/amazon-bedrock": "4.0.89",
      "@ai-sdk/anthropic": "3.0.66",
      "@ai-sdk/azure": "3.0.51",
      "@ai-sdk/cerebras": "2.0.42",
      "@ai-sdk/cohere": "3.0.28",
      "@ai-sdk/deepseek": "2.0.27",
      "@ai-sdk/deepinfra": "2.0.73",
      "@ai-sdk/fireworks": "2.0.43",
      "@ai-sdk/gateway": "3.0.88",
      "@ai-sdk/google-vertex": "4.0.102",
      "@ai-sdk/groq": "3.0.33",
      "@ai-sdk/mistral": "3.0.28",
      "@ai-sdk/perplexity": "3.0.27",
      "@ai-sdk/togetherai": "2.0.75",
      "@ai-sdk/vercel": "2.0.71",
      "@ai-sdk/xai": "3.0.77",
    }
    for (const [pkg, version] of Object.entries(verified)) {
      expect(ProviderSdkCompat.isCompatible(pkg, version), `${pkg}@${version}`).toBe(true)
    }
  })

  test("unknown packages fall back to latest", () => {
    expect(ProviderSdkCompat.installVersion("@ai-sdk/some-future-provider")).toBe("latest")
    expect(ProviderSdkCompat.installVersion("ai-gateway-provider")).toBe("latest")
    expect(ProviderSdkCompat.rangeFor("@ai-sdk/some-future-provider")).toBeUndefined()
    // Unmapped packages are never treated as incompatible.
    expect(ProviderSdkCompat.isCompatible("@ai-sdk/some-future-provider", "99.0.0")).toBe(true)
  })

  test("isCompatible rejects out-of-range and unparseable versions", () => {
    expect(ProviderSdkCompat.isCompatible("@ai-sdk/anthropic", "4.0.39")).toBe(false)
    expect(ProviderSdkCompat.isCompatible("@ai-sdk/anthropic", "not-a-version")).toBe(false)
  })
})
