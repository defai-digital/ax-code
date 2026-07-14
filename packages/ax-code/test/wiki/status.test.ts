import { describe, expect, test } from "vitest"
import { buildRecommendations, isHealthy, type WikiDetectResult } from "../../src/wiki"

function base(partial: Partial<WikiDetectResult> = {}): WikiDetectResult {
  return {
    root: "/tmp/proj",
    wikiDir: "/tmp/proj/openwiki",
    wikiDirRelative: "openwiki",
    wikiExists: false,
    hasIndex: false,
    binary: { found: false, command: "openwiki" },
    ...partial,
  }
}

describe("wiki/status", () => {
  test("unhealthy when wiki missing", () => {
    const det = base()
    expect(isHealthy(det)).toBe(false)
    const recs = buildRecommendations(det)
    expect(recs.some((r) => r.includes("wiki generate"))).toBe(true)
    expect(recs.some((r) => r.includes("not found") || r.includes("Install OpenWiki"))).toBe(true)
  })

  test("stale extra adds update recommendation", () => {
    const det = base({
      wikiExists: true,
      hasIndex: true,
      binary: { found: true, command: "openwiki", path: "/bin/openwiki" },
    })
    const recs = buildRecommendations(det, { stale: true })
    expect(recs.some((r) => r.includes("stale"))).toBe(true)
  })

  test("healthy when wiki + index present even without binary", () => {
    const det = base({
      wikiExists: true,
      hasIndex: true,
      indexRelative: "openwiki/quickstart.md",
      binary: { found: false, command: "openwiki" },
    })
    expect(isHealthy(det)).toBe(true)
    const recs = buildRecommendations(det)
    expect(recs.some((r) => r.includes("Agent routing"))).toBe(true)
  })

  test("recommends update when binary and wiki present", () => {
    const det = base({
      wikiExists: true,
      hasIndex: true,
      binary: { found: true, command: "openwiki", path: "/usr/local/bin/openwiki" },
    })
    expect(isHealthy(det)).toBe(true)
    expect(buildRecommendations(det).some((r) => r.includes("wiki update"))).toBe(true)
  })
})
