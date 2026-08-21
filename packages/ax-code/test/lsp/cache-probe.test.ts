import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import path from "path"
import { writeFile } from "node:fs/promises"
import { LSPCache } from "@/code-intelligence/lsp-cache"
import * as LSPCacheProbe from "@ax-code/ax-code-intel/cache-probe"
import * as LSPPerf from "@ax-code/ax-code-intel/perf"
import { Flag } from "../../src/flag/flag"
import { tmpdir } from "../fixture/fixture"

let lookupSpy: MockInstance | undefined
let hashFileSpy: MockInstance | undefined
let writeSpy: MockInstance | undefined

// Flag.AX_CODE_LSP_CACHE is evaluated at module load; override per-test
// via Object.defineProperty since the export is a const.
const originalFlag = Flag.AX_CODE_LSP_CACHE
function setCacheFlag(on: boolean) {
  Object.defineProperty(Flag, "AX_CODE_LSP_CACHE", {
    value: on,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  lookupSpy?.mockRestore()
  hashFileSpy?.mockRestore()
  writeSpy?.mockRestore()
  lookupSpy = undefined
  hashFileSpy = undefined
  writeSpy = undefined
  setCacheFlag(originalFlag)
  LSPPerf.reset()
})

describe("LSPCacheProbe", () => {
  test("read looks up enabled cache entries and records metric samples on hit", () => {
    setCacheFlag(true)
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

  test("read passes the disabled flag through to the store", () => {
    setCacheFlag(false)
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue(undefined as never)

    const hit = LSPCacheProbe.read<string[]>({
      operation: "documentSymbol",
      filePath: "/repo/src/index.ts",
      contentHash: "hash",
      line: -1,
      character: -1,
      metric: "documentSymbol.cached",
    })

    expect(hit).toBeUndefined()
    expect(lookupSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  test("hashAndRead skips lookup when hashing fails", async () => {
    setCacheFlag(true)
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

  test("hashAndRead does not hash at all when the cache is disabled", async () => {
    setCacheFlag(false)
    hashFileSpy = vi.spyOn(LSPCache, "hashFile").mockResolvedValue("hash" as never)
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

    expect(hashFileSpy).not.toHaveBeenCalled()
    expect(lookupSpy).not.toHaveBeenCalled()
  })

  test("run builds dedup keys, records live metrics, and writes cacheable envelopes", async () => {
    setCacheFlag(true)
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
        // The stored hash carries the cache-context fingerprint prefix.
        expect(dedupKey).toMatch(/^references:\/repo\/src\/index\.ts:.+#hash:1:2$/)
        return envelope
      },
    })

    expect(result).toBe(envelope)
    expect(LSPPerf.snapshot()["references.live"]?.count).toBe(1)
    expect(writeSpy).toHaveBeenCalledWith({
      operation: "references",
      filePath: "/repo/src/index.ts",
      contentHash: expect.stringMatching(/#hash$/),
      line: 1,
      character: 2,
      envelope,
      enabled: true,
    })
  })

  test("run omits position from document-wide dedup keys", async () => {
    setCacheFlag(true)
    hashFileSpy = vi.spyOn(LSPCache, "hashFile").mockResolvedValue("hash" as never)
    lookupSpy = vi.spyOn(LSPCache, "lookup").mockReturnValue(undefined as never)
    writeSpy = vi.spyOn(LSPCache, "write").mockImplementation(() => undefined)

    await LSPCacheProbe.run<string[]>({
      operation: "documentSymbol",
      filePath: "/repo/src/index.ts",
      line: -1,
      character: -1,
      cache: true,
      cachedMetric: "documentSymbol.cached",
      liveMetric: "documentSymbol.live",
      execute: async (dedupKey) => {
        expect(dedupKey).toMatch(/^documentSymbol:\/repo\/src\/index\.ts:.+#hash$/)
        return {
          data: [],
          source: "lsp",
          completeness: "empty",
          timestamp: 3,
          serverIDs: [],
        }
      },
    })

    // The probe forwards every envelope; the store's shouldWrite policy is
    // what keeps empty/partial results out of the table.
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({ completeness: "empty" }),
      }),
    )
  })

  test("run skips hashing and dedups by file metadata when the cache is disabled", async () => {
    setCacheFlag(true) // flag on, but the per-call override disables the cache
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "demo.ts")
    await writeFile(file, "export const x = 1\n")

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
      filePath: file,
      line: 1,
      character: 2,
      cache: false,
      cachedMetric: "references.cached",
      liveMetric: "references.live",
      execute: async (dedupKey) => {
        // No content hash when disabled: the dedup key falls back to
        // mtime:size so concurrent identical requests still collapse.
        expect(dedupKey).toMatch(/^references:.+demo\.ts:\d+(\.\d+)?:\d+:1:2$/)
        return envelope
      },
    })

    expect(result).toBe(envelope)
    expect(hashFileSpy).not.toHaveBeenCalled()
    expect(lookupSpy).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
  })
})
