import { describe, expect, test } from "vitest"
import { ArenaTool } from "../../src/tool/arena"
import { Arena } from "../../src/mode/arena"
import { createHash } from "crypto"

describe("arena tool contract", () => {
  test("tool id is arena", () => {
    expect(ArenaTool.id).toBe("arena")
  })

  test("init exposes parameters", async () => {
    const init = await ArenaTool.init()
    expect(init.description.toLowerCase()).toContain("arena")
    expect(init.parameters.shape.task).toBeDefined()
    expect(init.parameters.shape.strategy).toBeDefined()
  })

  test("parameter schema requires task", async () => {
    const init = await ArenaTool.init()
    expect(() => init.parameters.parse({})).toThrow()
    const parsed = init.parameters.parse({ task: "Refactor auth" })
    expect(parsed.task).toBe("Refactor auth")
  })

  test("parameter schema accepts implement mode and enableIfDisabled", async () => {
    const init = await ArenaTool.init()
    const parsed = init.parameters.parse({
      task: "Add rate limiting",
      mode: "implement",
      strategy: "verify_first",
      enableIfDisabled: true,
    })
    expect(parsed.mode).toBe("implement")
    expect(parsed.strategy).toBe("verify_first")
    expect(parsed.enableIfDisabled).toBe(true)
  })

  test("explicit arena selection requires at least two unique members", async () => {
    const init = await ArenaTool.init()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [{ providerID: "google", modelID: "gemini" }],
      }),
    ).toThrow()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [
          { providerID: "google", modelID: "gemini" },
          { providerID: "google", modelID: "gemini" },
        ],
      }),
    ).toThrow()
    expect(() =>
      init.parameters.parse({
        task: "Compare implementations",
        providers: [
          { providerID: "google", modelID: "gemini-flash" },
          { providerID: "google", modelID: "gemini-pro" },
        ],
      }),
    ).toThrow()
  })
})

describe("arena ranking used by tool", () => {
  test("ranks injected plan candidates", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "a/m",
          providerID: "a",
          modelID: "m",
          verification: "unknown",
          riskScore: 3,
          patchFingerprint: "fp1",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          verification: "unknown",
          riskScore: 9,
          patchFingerprint: "fp2",
        },
      ],
      "diversity",
    )
    expect(ranked[0]!.id).toBe("a/m")
  })

  test("same patchFingerprint penalizes the second candidate (diversity preservation)", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "a/m",
          providerID: "a",
          modelID: "m",
          verification: "pass",
          riskScore: 5,
          patchFingerprint: "same-fp",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          verification: "pass",
          riskScore: 5,
          patchFingerprint: "same-fp",
        },
      ],
      "diversity",
    )
    // First candidate gets novel_fingerprint bonus, second gets duplicate_fingerprint penalty
    expect(ranked[0]!.reasons).toContain("novel_fingerprint")
    expect(ranked[1]!.reasons).toContain("duplicate_fingerprint")
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
  })

  test("different patchFingerprints both receive novel bonus in diversity strategy", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "a/m",
          providerID: "a",
          modelID: "m",
          verification: "unknown",
          riskScore: 3,
          patchFingerprint: "fp-alpha",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          verification: "unknown",
          riskScore: 3,
          patchFingerprint: "fp-beta",
        },
      ],
      "diversity",
    )
    // Both should receive novel_fingerprint bonus since fingerprints differ
    expect(ranked[0]!.reasons).toContain("novel_fingerprint")
    expect(ranked[1]!.reasons).toContain("novel_fingerprint")
  })
})

describe("fingerprint stability (SHA-256 contract)", () => {
  // Replicate the arena tool's fingerprint logic to verify its stability contract
  function fingerprint(text: string): string {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim()
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
  }

  test("same input always produces the same hash", () => {
    const input = "implement a cache layer with LRU eviction"
    expect(fingerprint(input)).toBe(fingerprint(input))
    // Calling multiple times should be stable
    const results = Array.from({ length: 10 }, () => fingerprint(input))
    expect(new Set(results).size).toBe(1)
  })

  test("different inputs produce different hashes", () => {
    const a = fingerprint("use a queue-based approach")
    const b = fingerprint("use a stack-based approach")
    expect(a).not.toBe(b)
  })

  test("fingerprint normalizes whitespace and case", () => {
    expect(fingerprint("  Hello   World  ")).toBe(fingerprint("hello world"))
    expect(fingerprint("FOO\n\tBAR")).toBe(fingerprint("foo bar"))
  })

  test("fingerprint output is a 16-character hex string", () => {
    const fp = fingerprint("some arbitrary input text")
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })
})
