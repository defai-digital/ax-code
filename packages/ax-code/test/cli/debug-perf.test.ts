import { describe, expect, test } from "bun:test"

import { buildIndexReport } from "../../src/cli/cmd/index-graph"
import { stat, summarize } from "../../src/cli/cmd/debug/perf"

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
  })
})
