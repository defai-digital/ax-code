import { afterEach, describe, expect, test, beforeEach, vi, type MockInstance } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"
import {
  DiagnosticCorrelation,
  __testFindEnclosingSymbol,
  __testFindCrossFileRootCause,
  __testRenderCorrelationBlock,
} from "../../src/debug-engine/diagnostic-correlation"
import type { DebugEngine } from "../../src/debug-engine"
import { LSP } from "../../src/lsp"
import { Bus } from "../../src/bus"
import { LSPClient } from "../../src/lsp/client"

Log.init({ print: false })

let diagnosticsSpy: MockInstance | undefined
let diagnosticsAggregatedSpy: MockInstance | undefined

afterEach(() => {
  diagnosticsSpy?.mockRestore()
  diagnosticsAggregatedSpy?.mockRestore()
  diagnosticsSpy = undefined
  diagnosticsAggregatedSpy = undefined
})

// ─── Helpers (mirror debug-engine.test.ts seeding pattern) ──────────

function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "method" | "class"
    file?: string
    signature?: string | null
    startLine?: number
    endLine?: number
    visibility?: string | null
  },
) {
  const t = Date.now()
  const nodeID = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id: nodeID,
    project_id: projectID,
    kind: opts.kind ?? "function",
    name: opts.name,
    qualified_name: `${opts.file ?? "/tmp/seed.ts"}::${opts.name}`,
    file: opts.file ?? "/tmp/seed.ts",
    range_start_line: opts.startLine ?? 0,
    range_start_char: 0,
    range_end_line: opts.endLine ?? (opts.startLine ?? 0) + 5,
    range_end_char: 0,
    signature: opts.signature ?? null,
    visibility: opts.visibility ?? null,
    metadata: null,
    time_created: t,
    time_updated: t,
  })
  CodeGraphQuery.upsertFile({
    id: CodeFileID.ascending(),
    project_id: projectID,
    path: opts.file ?? "/tmp/seed.ts",
    sha: "test",
    size: 100,
    lang: "typescript",
    indexed_at: t,
    completeness: "lsp-only",
    time_created: t,
    time_updated: t,
  })
  return nodeID
}

function seedCallEdge(projectID: ProjectID, from: string, to: string, file: string) {
  const t = Date.now()
  CodeGraphQuery.insertEdge({
    id: CodeEdgeID.ascending(),
    project_id: projectID,
    kind: "calls",
    from_node: from as any,
    to_node: to as any,
    file,
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 0,
    range_end_char: 0,
    time_created: t,
    time_updated: t,
  })
}

function correlated(input: Partial<DebugEngine.CorrelatedDiagnostic> = {}): DebugEngine.CorrelatedDiagnostic {
  return {
    file: "/tmp/a.ts",
    line: 10,
    message: "Type error",
    severity: 1,
    rootCauseFile: "/tmp/b.ts",
    rootCauseSymbol: "caller",
    rootCauseChain: ["broken", "caller"],
    confidence: "high",
    lspTimestamp: 1_700_000_000_000,
    lspServerIDs: ["typescript"],
    graphQueryIds: ["q_test"],
    graphIndexedAt: 1_700_000_000_000,
    graphCompleteness: "full",
    ...input,
  }
}

// ─── findEnclosingSymbol ────────────────────────────────────────────

describe("DiagnosticCorrelation — findEnclosingSymbol", () => {
  test("returns null for empty symbol list", () => {
    expect(__testFindEnclosingSymbol([], 10)).toBeNull()
  })

  test("finds the innermost enclosing symbol", () => {
    const outer = {
      id: CodeNodeID.ascending(),
      kind: "function" as const,
      name: "outer",
      qualifiedName: "outer",
      file: "/tmp/a.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 100, character: 0 } },
      explain: { source: "code-graph" as const, indexedAt: Date.now(), completeness: "full" as const, queryId: "q1" },
    }
    const inner = {
      id: CodeNodeID.ascending(),
      kind: "function" as const,
      name: "inner",
      qualifiedName: "inner",
      file: "/tmp/a.ts",
      range: { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
      explain: { source: "code-graph" as const, indexedAt: Date.now(), completeness: "full" as const, queryId: "q2" },
    }
    const result = __testFindEnclosingSymbol([outer, inner], 15)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("inner")
  })

  test("returns outer when line is outside inner", () => {
    const outer = {
      id: CodeNodeID.ascending(),
      kind: "function" as const,
      name: "outer",
      qualifiedName: "outer",
      file: "/tmp/a.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 100, character: 0 } },
      explain: { source: "code-graph" as const, indexedAt: Date.now(), completeness: "full" as const, queryId: "q1" },
    }
    const inner = {
      id: CodeNodeID.ascending(),
      kind: "function" as const,
      name: "inner",
      qualifiedName: "inner",
      file: "/tmp/a.ts",
      range: { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
      explain: { source: "code-graph" as const, indexedAt: Date.now(), completeness: "full" as const, queryId: "q2" },
    }
    const result = __testFindEnclosingSymbol([outer, inner], 50)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("outer")
  })

  test("returns null when line is outside all symbols", () => {
    const sym = {
      id: CodeNodeID.ascending(),
      kind: "function" as const,
      name: "foo",
      qualifiedName: "foo",
      file: "/tmp/a.ts",
      range: { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
      explain: { source: "code-graph" as const, indexedAt: Date.now(), completeness: "full" as const, queryId: "q1" },
    }
    expect(__testFindEnclosingSymbol([sym], 5)).toBeNull()
  })
})

// ─── findCrossFileRootCause ─────────────────────────────────────────

describe("DiagnosticCorrelation — findCrossFileRootCause", () => {
  beforeEach(() => {
    DiagnosticCorrelation.__clearCache()
  })

  test("returns null root cause when no callers exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const fileA = path.join(tmp.path, "a.ts")
        const symId = seedSymbol(projectID, {
          name: "brokenFn",
          file: fileA,
          startLine: 10,
          endLine: 20,
        })

        const sym = CodeIntelligence.getSymbol(projectID, symId)!
        const result = __testFindCrossFileRootCause(
          projectID,
          fileA,
          15,
          "Type error",
          1,
          sym,
        )

        expect(result.rootCauseFile).toBeNull()
        expect(result.rootCauseSymbol).toBeNull()
        expect(result.confidence).toBe("low")
        expect(result.rootCauseChain).toEqual([sym.qualifiedName])
      },
    })
  })

  test("finds cross-file caller as root cause", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const fileA = path.join(tmp.path, "a.ts")
        const fileB = path.join(tmp.path, "b.ts")

        // brokenFn in a.ts has the error.
        // callerFn in b.ts calls brokenFn.
        const brokenFnId = seedSymbol(projectID, {
          name: "brokenFn",
          file: fileA,
          startLine: 10,
          endLine: 20,
        })
        const callerFnId = seedSymbol(projectID, {
          name: "callerFn",
          file: fileB,
          startLine: 5,
          endLine: 15,
        })
        seedCallEdge(projectID, callerFnId, brokenFnId, fileB)

        const sym = CodeIntelligence.getSymbol(projectID, brokenFnId)!
        const result = __testFindCrossFileRootCause(
          projectID,
          fileA,
          15,
          "Type 'string' is not assignable to type 'number'",
          1,
          sym,
        )

        expect(result.rootCauseFile).toBe(fileB)
        expect(result.rootCauseSymbol).toContain("callerFn")
        expect(result.confidence).toBe("high")
        expect(result.rootCauseChain.length).toBeGreaterThanOrEqual(2)
        expect(result.rootCauseChain[0]).toBe(sym.qualifiedName)
      },
    })
  })

  test("ignores same-file callers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const fileA = path.join(tmp.path, "a.ts")

        // Both symbols in the same file — no cross-file root cause.
        const brokenFnId = seedSymbol(projectID, {
          name: "brokenFn",
          file: fileA,
          startLine: 10,
          endLine: 20,
        })
        const sameFileCallerId = seedSymbol(projectID, {
          name: "sameFileCaller",
          file: fileA,
          startLine: 25,
          endLine: 35,
        })
        seedCallEdge(projectID, sameFileCallerId, brokenFnId, fileA)

        const sym = CodeIntelligence.getSymbol(projectID, brokenFnId)!
        const result = __testFindCrossFileRootCause(
          projectID,
          fileA,
          15,
          "Type error",
          1,
          sym,
        )

        expect(result.rootCauseFile).toBeNull()
        expect(result.confidence).toBe("low")
      },
    })
  })
})

// ─── renderCorrelationBlock ─────────────────────────────────────────

describe("DiagnosticCorrelation — renderCorrelationBlock", () => {
  test("returns empty string when no correlations", () => {
    const map = new Map<string, DebugEngine.CorrelatedDiagnostic[]>()
    expect(__testRenderCorrelationBlock("/tmp/a.ts", map)).toBe("")
  })

  test("returns empty string when all correlations are low confidence", () => {
    const map = new Map<string, DebugEngine.CorrelatedDiagnostic[]>([
      [
        "/tmp/a.ts",
        [
            correlated({ confidence: "low" }),
        ],
      ],
    ])
    expect(__testRenderCorrelationBlock("/tmp/a.ts", map)).toBe("")
  })

  test("renders correlation block for high-confidence matches", () => {
    const map = new Map<string, DebugEngine.CorrelatedDiagnostic[]>([
      [
        "/tmp/a.ts",
        [
            correlated({ rootCauseSymbol: "formatValue", rootCauseChain: ["broken", "formatValue"] }),
        ],
      ],
    ])
    const result = __testRenderCorrelationBlock("/tmp/a.ts", map)
    expect(result).toContain("<correlation")
    expect(result).toContain("formatValue")
    expect(result).toContain("/tmp/b.ts")
    expect(result).toContain("confidence: high")
  })
})

// ─── Cache behavior ─────────────────────────────────────────────────

describe("DiagnosticCorrelation — cache", () => {
  beforeEach(() => {
    DiagnosticCorrelation.__clearCache()
  })

  test("correlateDiagnostics returns empty for uncached file", () => {
    expect(DiagnosticCorrelation.correlateDiagnostics("/tmp/unknown.ts")).toEqual([])
  })

  test("__clearCache clears everything", () => {
    // This is mainly a smoke test — __clearCache is called in beforeEach
    // so we just verify it doesn't throw.
    DiagnosticCorrelation.__clearCache()
    expect(DiagnosticCorrelation.correlateDiagnostics("/tmp/a.ts")).toEqual([])
  })

  test("event subscriber correlates diagnostics and preserves LSP and graph provenance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const fileA = path.join(tmp.path, "a.ts")
        const fileB = path.join(tmp.path, "b.ts")
        const brokenFnId = seedSymbol(projectID, {
          name: "brokenFn",
          file: fileA,
          startLine: 10,
          endLine: 20,
        })
        const callerFnId = seedSymbol(projectID, {
          name: "callerFn",
          file: fileB,
          startLine: 5,
          endLine: 15,
        })
        seedCallEdge(projectID, callerFnId, brokenFnId, fileB)

        diagnosticsSpy = vi.spyOn(LSP, "diagnostics").mockResolvedValue({
          [fileA]: [
            {
              range: { start: { line: 15, character: 0 }, end: { line: 15, character: 8 } },
              severity: 1,
              message: "Type 'string' is not assignable to type 'number'",
            },
          ],
        })
        diagnosticsAggregatedSpy = vi.spyOn(LSP, "diagnosticsAggregated").mockResolvedValue({
          data: [],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: ["typescript"],
          degraded: false,
        })

        DiagnosticCorrelation.init()
        await Bus.publish(LSPClient.Event.Diagnostics, { path: fileA, serverID: "typescript" })
        await sleep(350)

        const result = DiagnosticCorrelation.correlateDiagnostics(fileA)
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          rootCauseFile: fileB,
          rootCauseSymbol: expect.stringContaining("callerFn"),
          lspTimestamp: 1_700_000_000_000,
          lspServerIDs: ["typescript"],
        })
        expect(result[0].graphQueryIds.length).toBeGreaterThan(0)
        expect(result[0].graphIndexedAt).toBeGreaterThan(0)
      },
    })
  })
})
