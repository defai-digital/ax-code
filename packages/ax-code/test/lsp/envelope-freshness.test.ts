import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Semantic Trust v2 §S5: freshness is read-time computed from the
// envelope timestamp + current time. Thresholds:
//   fresh:  age < 60s
//   warm:   age < 24h
//   stale:  age >= 24h

describe("LSP.envelopeFreshness", () => {
  const now = 10_000_000_000

  test("just-published envelope is fresh", () => {
    expect(LSP.envelopeFreshness({ timestamp: now }, now)).toBe("fresh")
  })

  test("envelope seconds old is fresh", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 5_000 }, now)).toBe("fresh")
  })

  test("envelope just under 60s is fresh", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 59_999 }, now)).toBe("fresh")
  })

  test("envelope at exactly 60s is warm", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 60_000 }, now)).toBe("warm")
  })

  test("envelope one hour old is warm", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 60 * 60 * 1000 }, now)).toBe("warm")
  })

  test("envelope just under 24h is warm", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - (24 * 60 * 60 * 1000 - 1) }, now)).toBe("warm")
  })

  test("envelope at 24h is stale", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 24 * 60 * 60 * 1000 }, now)).toBe("stale")
  })

  test("envelope much older than 24h is stale", () => {
    expect(LSP.envelopeFreshness({ timestamp: now - 7 * 24 * 60 * 60 * 1000 }, now)).toBe("stale")
  })

  test("omitted `now` uses Date.now()", () => {
    // Envelope produced just now by Date.now() should be fresh.
    const current = Date.now()
    expect(LSP.envelopeFreshness({ timestamp: current })).toBe("fresh")
  })
})
