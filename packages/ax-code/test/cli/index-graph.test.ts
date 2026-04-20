import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { buildIndexReport, groupFilesByLanguage, phaseRows, probeLspServers } from "../../src/cli/cmd/index-graph"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let touchFileSpy: ReturnType<typeof spyOn> | undefined
let statusSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  touchFileSpy?.mockRestore()
  statusSpy?.mockRestore()
  touchFileSpy = undefined
  statusSpy = undefined
})

// groupFilesByLanguage is the helper the LSP pre-flight probe uses to
// build its "N files in language X" readiness table. Tested here
// because the full probe path requires a running LSP server.

describe("groupFilesByLanguage", () => {
  test("groups files by detected language id", () => {
    const groups = groupFilesByLanguage(["/p/a.ts", "/p/b.ts", "/p/c.tsx", "/p/main.go", "/p/lib.rs", "/p/README.md"])

    expect(groups.get("typescript")).toEqual(["/p/a.ts", "/p/b.ts"])
    expect(groups.get("typescriptreact")).toEqual(["/p/c.tsx"])
    expect(groups.get("go")).toEqual(["/p/main.go"])
    expect(groups.get("rust")).toEqual(["/p/lib.rs"])
    expect(groups.get("markdown")).toEqual(["/p/README.md"])
  })

  test("collapses unmapped extensions into 'unknown'", () => {
    const groups = groupFilesByLanguage(["/p/weird.xyz", "/p/unknown.foobar"])
    expect(groups.get("unknown")).toEqual(["/p/weird.xyz", "/p/unknown.foobar"])
  })

  test("empty input returns empty map", () => {
    expect(groupFilesByLanguage([])).toEqual(new Map())
  })

  test("builds ordered phase rows with percentages", () => {
    const rows = phaseRows({
      readFile: 10,
      lspTouch: 20,
      lspDocumentSymbol: 30,
      symbolWalk: 40,
      lspReferences: 50,
      edgeResolve: 60,
      dbTransaction: 40,
      total: 250,
    })

    expect(rows.map((item) => item.name)).toEqual([
      "lsp.references",
      "lsp.documentSymbol",
      "lsp.touch",
      "edge.resolve",
      "db.transaction",
      "symbol.walk",
      "file.read",
    ])
    expect(rows.find((item) => item.name === "lsp.references")).toMatchObject({
      ms: 50,
      pct: 20,
    })
  })

  test("builds machine-readable index report", () => {
    const report = buildIndexReport({
      projectID: "p1",
      directory: "/repo",
      worktree: "/repo",
      concurrency: 4,
      limit: 25,
      probe: true,
      nativeProfile: true,
      files: 25,
      status: {
        nodeCount: 120,
        edgeCount: 80,
      },
      result: {
        nodes: 100,
        edges: 70,
        files: 20,
        unchanged: 3,
        skipped: 1,
        failed: 1,
        pruned: { files: 2, nodes: 10, edges: 6 },
        timings: {
          readFile: 10,
          lspTouch: 20,
          lspDocumentSymbol: 30,
          symbolWalk: 40,
          lspReferences: 50,
          edgeResolve: 60,
          dbTransaction: 70,
          total: 280,
        },
      },
      elapsedMs: 900,
      probeResult: {
        ready: ["typescript"],
        missing: { rust: 4 },
      },
      native: {
        total: {
          calls: 3,
          fails: 1,
          totalMs: 12,
          inBytes: 100,
          outBytes: 50,
        },
        rows: [
          {
            name: "fs.walkFiles",
            calls: 2,
            fails: 0,
            totalMs: 7,
            avgMs: 3.5,
            maxMs: 5,
            inBytes: 90,
            outBytes: 45,
          },
        ],
      },
      lspPerf: {
        "touch.select": {
          count: 2,
          okCount: 2,
          errorCount: 0,
          p50: 5,
          p95: 9,
          maxMs: 10,
          totalMs: 10,
        },
      },
    })

    expect(report.requested).toEqual({
      concurrency: 4,
      limit: 25,
      probe: true,
      nativeProfile: true,
    })
    expect(report.graph).toEqual({
      nodes: 120,
      edges: 80,
    })
    expect(report.run).toMatchObject({
      indexed: 20,
      unchanged: 3,
      skipped: 1,
      failed: 1,
      elapsedMs: 900,
    })
    expect(report.timings.phases[0]).toMatchObject({
      name: "lsp.references",
      ms: 50,
    })
    expect(report.native?.total.calls).toBe(3)
    expect(report.lspPerf?.["touch.select"]?.count).toBe(2)
  })

  test("probeLspServers uses successful touches as readiness", async () => {
    const groups = new Map<string, string[]>([
      ["typescript", ["/p/a.ts"]],
      ["rust", ["/p/lib.rs"]],
    ])

    touchFileSpy = spyOn(LSP, "touchFile").mockImplementation(async (file, _wait, opts) => {
      expect(opts).toEqual({ mode: "semantic", methods: ["documentSymbol", "references"] })
      if (file === "/p/a.ts") return 1
      return 0
    })
    statusSpy = spyOn(LSP, "status").mockResolvedValue([])

    const probe = await probeLspServers(groups)
    expect(probe.ready).toEqual(new Set(["typescript"]))
    expect(probe.missing).toEqual(new Map([["rust", 1]]))
  })

  test("probeLspServers probes representative files in parallel", async () => {
    const groups = new Map<string, string[]>([
      ["typescript", ["/p/a.ts"]],
      ["rust", ["/p/lib.rs"]],
    ])

    let inflight = 0
    let maxInflight = 0

    touchFileSpy = spyOn(LSP, "touchFile").mockImplementation(async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await sleep(25)
      inflight--
      return 1
    })
    statusSpy = spyOn(LSP, "status").mockResolvedValue([])

    const probe = await probeLspServers(groups)

    expect(maxInflight).toBe(2)
    expect(probe.ready).toEqual(new Set(["typescript", "rust"]))
    expect(probe.missing).toEqual(new Map())
  })
})
