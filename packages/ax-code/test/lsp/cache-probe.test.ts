import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { LSPCache } from "../../src/lsp/cache"
import * as LSPCacheProbe from "../../src/lsp/cache-probe"
import * as LSPPerf from "../../src/lsp/perf"

let lookupSpy: MockInstance | undefined
let hashFileSpy: MockInstance | undefined
let writeSpy: MockInstance | undefined

afterEach(() => {
  lookupSpy?.mockRestore()
  hashFileSpy?.mockRestore()
  writeSpy?.mockRestore()
  lookupSpy = undefined
  hashFileSpy = undefined
  writeSpy = undefined
  LSPPerf.reset()
})

describe("LSPCacheProbe", () => {
  test("read looks up enabled cache entries and records metric samples on hit", () => {
    LSPPerf.reset()
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue({
      data: ["symbol"],
      source: "cache",
      completeness: "full",
      timestamp: 1,
      serverIDs: ["typescript"],
    } as never)

    expect(
      LSPCacheProbe.read<string[]>({
        operation: "documentSymbol",
        filePath: "/repo/src/index.ts",
        contentHash: "hash",
        line: -1,
        character: -1,
        metric: "documentSymbol.cached",
      }),
    ).toMatchObject({
      data: ["symbol"],
      source: "cache",
    })

    expect(lookupSpy).toHaveBeenCalledWith({
      operation: "documentSymbol",
      filePath: "/repo/src/index.ts",
      contentHash: "hash",
      line: -1,
      character: -1,
      enabled: true,
    })
    expect(LSPPerf.snapshot()["documentSymbol.cached"]?.count).toBe(1)
  })

  test("hashAndRead skips lookup when hashing fails", async () => {
    hashFileSpy = vi.spyOn(LSPCache, "hashFile").mockResolvedValue(undefined as never)
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue(undefined as never)

    await expect(
      LSPCacheProbe.hashAndRead<unknown[]>({
        operation: "references",
        filePath: "/repo/src/index.ts",
        line: 1,
        character: 2,
        metric: "references.cached",
      }),
    ).resolves.toBeUndefined()

    expect(hashFileSpy).toHaveBeenCalledTimes(1)
    expect(lookupSpy).not.toHaveBeenCalled()
  })

  test("run builds dedup keys, records live metrics, and writes cacheable envelopes", async () => {
    hashFileSpy = vi.spyOn(LSPCache, "hashFile").mockResolvedValue("hash" as never)
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue(undefined as never)
    writeSpy = vi.spyOn(LSPCache, "write").mockImplementation(() => undefined)

    const envelope = {
      data: ["ref"],
      source: "lsp" as const,
      completeness: "full" as const,
      timestamp: 2,
      serverIDs: ["typescript"],
    }
    const result = await LSPCacheProbe.run<string[]>({
      operation: "references",
      filePath: "/repo/src/index.ts",
      line: 1,
      character: 2,
      cache: true,
      cachedMetric: "references.cached",
      liveMetric: "references.live",
      execute: async (dedupKey) => {
        expect(dedupKey).toBe("references:/repo/src/index.ts:hash:1:2")
        return envelope
      },
    })

    expect(result).toBe(envelope)
    expect(LSPPerf.snapshot()["references.live"]?.count).toBe(1)
    expect(writeSpy).toHaveBeenCalledWith({
      operation: "references",
      filePath: "/repo/src/index.ts",
      contentHash: "hash",
      line: 1,
      character: 2,
      envelope,
      enabled: true,
    })
  })

  test("run omits position from document-wide dedup keys", async () => {
    hashFileSpy = vi.spyOn(LSPCache, "hashFile").mockResolvedValue("hash" as never)
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue(undefined as never)
    writeSpy = vi.spyOn(LSPCache, "write").mockImplementation(() => undefined)

    await LSPCacheProbe.run<string[]>({
      operation: "documentSymbol",
      filePath: "/repo/src/index.ts",
      line: -1,
      character: -1,
      cache: false,
      cachedMetric: "documentSymbol.cached",
      liveMetric: "documentSymbol.live",
      execute: async (dedupKey) => {
        expect(dedupKey).toBe("documentSymbol:/repo/src/index.ts:hash")
        return {
          data: [],
          source: "lsp",
          completeness: "empty",
          timestamp: 3,
          serverIDs: [],
        }
      },
    })

    expect(writeSpy).not.toHaveBeenCalled()
  })
})
