import { describe, expect, test } from "bun:test"
import { LSPCache } from "../../src/lsp/cache"

describe("LSPCache", () => {
  test("writes only enabled full envelopes", () => {
    const full = { data: [], completeness: "full" as const, serverIDs: ["typescript"] }

    expect(LSPCache.shouldWrite(full, true)).toBe(true)
    expect(LSPCache.shouldWrite(full, false)).toBe(false)
    expect(LSPCache.shouldWrite({ ...full, completeness: "partial" }, true)).toBe(false)
    expect(LSPCache.shouldWrite({ ...full, completeness: "empty" }, true)).toBe(false)
  })

  test("keeps the cache freshness window explicit", () => {
    expect(LSPCache.TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})
