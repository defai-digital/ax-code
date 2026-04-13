import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"
import { spyOn } from "bun:test"

Log.init({ print: false })

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
  LSP.perfReset()
})

describe("LSP.perfSnapshot", () => {
  test("records successful and failed operations with stable shape", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // No servers configured: workspaceSymbol short-circuits via the
        // `empty` envelope branch but still runs through `metered()`, so
        // the sampler sees one `ok` call for that operation.
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        LSP.perfReset()
        await LSP.workspaceSymbol("anything")
        await LSP.workspaceSymbol("another")

        const snap = LSP.perfSnapshot()
        expect(snap.workspaceSymbol).toBeDefined()
        expect(snap.workspaceSymbol!.count).toBe(2)
        expect(snap.workspaceSymbol!.okCount).toBe(2)
        expect(snap.workspaceSymbol!.errorCount).toBe(0)
        expect(snap.workspaceSymbol!.p50).toBeGreaterThanOrEqual(0)
        expect(snap.workspaceSymbol!.p95).toBeGreaterThanOrEqual(snap.workspaceSymbol!.p50)
        expect(snap.workspaceSymbol!.maxMs).toBeGreaterThanOrEqual(snap.workspaceSymbol!.p95)
      },
    })
  })

  test("perfReset clears all recorded samples", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        await LSP.workspaceSymbol("seed")
        expect(Object.keys(LSP.perfSnapshot()).length).toBeGreaterThan(0)

        LSP.perfReset()
        expect(LSP.perfSnapshot()).toEqual({})
      },
    })
  })

  // Direct sampler tests. These drive recordPerfSampleForTest instead of
  // going through the LSP client path — isolates the ring-buffer semantics
  // from any LSP state or I/O so edge cases are cheap to assert.
  test("empty snapshot is {} before any operation runs", () => {
    LSP.perfReset()
    expect(LSP.perfSnapshot()).toEqual({})
  })

  test("errorCount increments and p-values still report", () => {
    LSP.perfReset()
    LSP.recordPerfSampleForTest("references", 10, false)
    LSP.recordPerfSampleForTest("references", 20, false)
    LSP.recordPerfSampleForTest("references", 30, false)

    const snap = LSP.perfSnapshot()
    expect(snap.references!.count).toBe(3)
    expect(snap.references!.okCount).toBe(0)
    expect(snap.references!.errorCount).toBe(3)
    expect(snap.references!.maxMs).toBe(30)
    expect(snap.references!.totalMs).toBe(60)
  })

  test("ring wraps past PERF_SAMPLE_CAP; count keeps climbing, durations window", () => {
    LSP.perfReset()

    const cap = LSP.PERF_SAMPLE_CAP_FOR_TEST
    // Fill the ring with 1ms samples, then push cap more 100ms samples.
    // The first cap samples should have been overwritten, so max reflects
    // only the second batch.
    for (let i = 0; i < cap; i++) LSP.recordPerfSampleForTest("touch", 1, true)
    for (let i = 0; i < cap; i++) LSP.recordPerfSampleForTest("touch", 100, true)

    const snap = LSP.perfSnapshot()
    expect(snap.touch!.count).toBe(cap * 2) // monotonic, not windowed
    expect(snap.touch!.okCount).toBe(cap * 2)
    expect(snap.touch!.maxMs).toBe(100) // 1ms samples evicted
    // After full wrap with 100ms values only, p50 and p95 should both be 100.
    expect(snap.touch!.p50).toBe(100)
    expect(snap.touch!.p95).toBe(100)
  })

  test("mixed ok/error samples attribute correctly per operation", () => {
    LSP.perfReset()
    LSP.recordPerfSampleForTest("touch", 5, true)
    LSP.recordPerfSampleForTest("touch", 7, true)
    LSP.recordPerfSampleForTest("touch", 9, false)
    LSP.recordPerfSampleForTest("documentSymbol", 3, true)

    const snap = LSP.perfSnapshot()
    expect(snap.touch!.count).toBe(3)
    expect(snap.touch!.okCount).toBe(2)
    expect(snap.touch!.errorCount).toBe(1)
    expect(snap.documentSymbol!.count).toBe(1)
    expect(snap.documentSymbol!.okCount).toBe(1)
  })
})
