import { describe, expect, test } from "vitest"
import { wikiStatusExitCode } from "../../src/cli/cmd/wiki"

describe("wiki status exit code", () => {
  test("treats a missing wiki as a successful status report", () => {
    expect(wikiStatusExitCode({ exists: false, healthy: false, freshness: "unknown" })).toBe(0)
  })

  test("fails when a present wiki is stale or unhealthy", () => {
    expect(wikiStatusExitCode({ exists: true, healthy: true, freshness: "stale" })).toBe(1)
    expect(wikiStatusExitCode({ exists: true, healthy: false, freshness: "unknown" })).toBe(1)
  })

  test("succeeds when a present wiki is healthy and fresh", () => {
    expect(wikiStatusExitCode({ exists: true, healthy: true, freshness: "fresh" })).toBe(0)
  })
})
