import { describe, expect, test } from "bun:test"

import { buildIndexReport } from "../../src/cli/cmd/index-graph"
import { diagnoseLsp, stat, summarize } from "../../src/cli/cmd/debug/perf"

describe("cli.debug.perf", () => {
  test("computes stable stats", () => {
    expect(stat([30, 10, 20, 40])).toEqual({
      min: 10,
      max: 40,
      mean: 25,
      median: 25,
    })
  })

  test("summarizes repeated index reports", () => {
    const first = buildIndexReport({
      projectID: "p1",
      directory: "/repo",
      worktree: "/repo",
      concurrency: 4,
      probe: false,
      nativeProfile: true,
      files: 10,
      status: {
        nodeCount: 200,
        edgeCount: 100,
      },
      result: {
        nodes: 20,
        edges: 10,
        files: 10,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        pruned: { files: 0, nodes: 0, edges: 0 },
        timings: {
          readFile: 10,
          lspTouch: 100,
          lspDocumentSymbol: 80,
          symbolWalk: 15,
          lspReferences: 120,
          edgeResolve: 5,
          dbTransaction: 20,
          total: 350,
        },
      },
      elapsedMs: 600,
      native: {
        total: {
          calls: 2,
          fails: 0,
          totalMs: 12,
          inBytes: 100,
          outBytes: 50,
        },
        rows: [
          {
            name: "fs.walkFiles",
            calls: 2,
            fails: 0,
            totalMs: 12,
            avgMs: 6,
            maxMs: 8,
            inBytes: 100,
            outBytes: 50,
          },
        ],
      },
      lspPerf: {
        "touch.select": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 450,
          p95: 900,
          maxMs: 900,
          totalMs: 900,
        },
        "touch.select.spawned": {
          count: 1,
          okCount: 1,
          errorCount: 0,
          p50: 400,
          p95: 400,
          maxMs: 400,
          totalMs: 400,
        },
        "touch.notify": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 2,
          p95: 3,
          maxMs: 3,
          totalMs: 4,
        },
        "client.initialize": {
          count: 1,
          okCount: 1,
          errorCount: 0,
          p50: 300,
          p95: 300,
          maxMs: 300,
          totalMs: 300,
        },
        "references.select": {
          count: 5,
          okCount: 5,
          errorCount: 0,
          p50: 1,
          p95: 2,
          maxMs: 2,
          totalMs: 5,
        },
        "references.rpc": {
          count: 5,
          okCount: 5,
          errorCount: 0,
          p50: 60,
          p95: 90,
          maxMs: 100,
          totalMs: 400,
        },
        "documentSymbol.select": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 0,
          p95: 1,
          maxMs: 1,
          totalMs: 1,
        },
        "documentSymbol.rpc": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 120,
          p95: 140,
          maxMs: 140,
          totalMs: 260,
        },
      },
    })
    const second = buildIndexReport({
      projectID: "p1",
      directory: "/repo",
      worktree: "/repo",
      concurrency: 4,
      probe: false,
      nativeProfile: true,
      files: 10,
      status: {
        nodeCount: 200,
        edgeCount: 100,
      },
      result: {
        nodes: 20,
        edges: 10,
        files: 10,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        pruned: { files: 0, nodes: 0, edges: 0 },
        timings: {
          readFile: 12,
          lspTouch: 90,
          lspDocumentSymbol: 70,
          symbolWalk: 20,
          lspReferences: 100,
          edgeResolve: 10,
          dbTransaction: 18,
          total: 320,
        },
      },
      elapsedMs: 500,
      native: {
        total: {
          calls: 4,
          fails: 1,
          totalMs: 18,
          inBytes: 120,
          outBytes: 80,
        },
        rows: [
          {
            name: "fs.walkFiles",
            calls: 4,
            fails: 1,
            totalMs: 18,
            avgMs: 4.5,
            maxMs: 7,
            inBytes: 120,
            outBytes: 80,
          },
        ],
      },
      lspPerf: {
        "touch.select": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 300,
          p95: 700,
          maxMs: 700,
          totalMs: 700,
        },
        "touch.select.spawned": {
          count: 1,
          okCount: 1,
          errorCount: 0,
          p50: 350,
          p95: 350,
          maxMs: 350,
          totalMs: 350,
        },
        "touch.notify": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 1,
          p95: 2,
          maxMs: 2,
          totalMs: 3,
        },
        "client.initialize": {
          count: 1,
          okCount: 1,
          errorCount: 0,
          p50: 200,
          p95: 200,
          maxMs: 200,
          totalMs: 200,
        },
        "references.select": {
          count: 5,
          okCount: 5,
          errorCount: 0,
          p50: 1,
          p95: 2,
          maxMs: 2,
          totalMs: 4,
        },
        "references.rpc": {
          count: 5,
          okCount: 5,
          errorCount: 0,
          p50: 50,
          p95: 70,
          maxMs: 80,
          totalMs: 320,
        },
        "documentSymbol.select": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 0,
          p95: 0,
          maxMs: 0,
          totalMs: 0,
        },
        "documentSymbol.rpc": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 100,
          p95: 120,
          maxMs: 120,
          totalMs: 220,
        },
      },
    })

    const result = summarize([first, second])

    expect(result.elapsedMs).toEqual({
      min: 500,
      max: 600,
      mean: 550,
      median: 550,
    })
    expect(result.totalMs.median).toBe(335)
    expect(result.phases["lsp.references"]?.median).toBe(110)
    expect(result.native?.total.calls.median).toBe(3)
    expect(result.native?.rows["fs.walkFiles"]?.totalMs.mean).toBe(15)
    expect(result.lsp?.["touch.select"]?.p50.median).toBe(375)
    expect(result.lsp?.["client.initialize"]?.totalMs.mean).toBe(250)
    expect(result.diagnosis).toContain("Cold start dominates: client initialize 250ms, touch.select.spawned 375ms.")
    expect(result.diagnosis).toContain(
      "Concurrent files are stacking behind the same cold start: touch.select total 800ms vs spawned 375ms.",
    )
    expect(result.diagnosis).toContain("didOpen/didChange overhead is negligible: touch.notify 3.50ms.")
    expect(result.diagnosis).toContain("Steady-state references work is RPC-bound: references.rpc 360ms.")
    expect(result.diagnosis).toContain("Document symbol work is RPC-bound after selection: documentSymbol.rpc 240ms.")
  })

  test("diagnoseLsp returns empty for missing rows", () => {
    expect(diagnoseLsp(undefined)).toEqual([])
  })

  test("diagnoseLsp reports when cold start is shifted into prewarm", () => {
    expect(
      diagnoseLsp({
        prewarm: {
          count: stat([1]),
          okCount: stat([1]),
          errorCount: stat([0]),
          p50: stat([1100]),
          p95: stat([1100]),
          maxMs: stat([1100]),
          totalMs: stat([1100]),
        },
        "client.initialize": {
          count: stat([1]),
          okCount: stat([1]),
          errorCount: stat([0]),
          p50: stat([700]),
          p95: stat([700]),
          maxMs: stat([700]),
          totalMs: stat([700]),
        },
        "touch.select.spawned": {
          count: stat([0]),
          okCount: stat([0]),
          errorCount: stat([0]),
          p50: stat([0]),
          p95: stat([0]),
          maxMs: stat([0]),
          totalMs: stat([0]),
        },
      } as any),
    ).toContain(
      "Cold start was shifted into prewarm: prewarm 1100ms, client initialize 700ms, touch.select.spawned 0ms.",
    )
  })

  test("diagnoseLsp reports when repeated runs hit semantic cache", () => {
    expect(
      diagnoseLsp({
        "documentSymbol.cached": {
          count: stat([10]),
          okCount: stat([10]),
          errorCount: stat([0]),
          p50: stat([0]),
          p95: stat([0]),
          maxMs: stat([0]),
          totalMs: stat([0]),
        },
        "references.cached": {
          count: stat([213]),
          okCount: stat([213]),
          errorCount: stat([0]),
          p50: stat([0]),
          p95: stat([0]),
          maxMs: stat([0]),
          totalMs: stat([0]),
        },
      } as any),
    ).toContain(
      "Repeated semantic work is cache-accelerated: documentSymbol.cached 10 call(s), references.cached 213 call(s).",
    )
  })
})
