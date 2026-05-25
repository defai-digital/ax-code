import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { LSPCache } from "../../src/lsp/cache"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let upsertSpy: ReturnType<typeof spyOn> | undefined
let nowSpy: ReturnType<typeof spyOn> | undefined
let randomSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  upsertSpy?.mockRestore()
  nowSpy?.mockRestore()
  randomSpy?.mockRestore()
  upsertSpy = undefined
  nowSpy = undefined
  randomSpy = undefined
})

describe("LSPCache", () => {
  test("writes only enabled full envelopes", () => {
    const full = { data: [], completeness: "full" as const, serverIDs: ["typescript"] }

    expect(LSPCache.shouldWrite(full, true)).toBe(true)
    expect(LSPCache.shouldWrite(full, false)).toBe(false)
    expect(LSPCache.shouldWrite({ ...full, completeness: "partial" }, true)).toBe(false)
    expect(LSPCache.shouldWrite({ ...full, completeness: "empty" }, true)).toBe(false)
  })

  test("writes cache entries with a 24-hour freshness window", async () => {
    await using tmp = await tmpdir({ git: true })

    const now = 1_700_000_000_000
    let captured: CodeGraphQuery.LspCacheInsert | undefined
    nowSpy = spyOn(Date, "now").mockReturnValue(now)
    randomSpy = spyOn(Math, "random").mockReturnValue(1)
    upsertSpy = spyOn(CodeGraphQuery, "upsertLspCache").mockImplementation((row) => {
      captured = row
      return "code_intel_lsp_cache_test" as never
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        LSPCache.write({
          operation: "documentSymbol",
          filePath: "src/demo.ts",
          contentHash: "hash",
          line: 1,
          character: 2,
          envelope: { data: [], completeness: "full", serverIDs: ["typescript"] },
          enabled: true,
        })
      },
    })

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(captured?.expiresAt).toBe(now + 24 * 60 * 60 * 1000)
  })
})
