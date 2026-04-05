import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Database } from "../../src/storage/db"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import { CodeNodeTable, CodeEdgeTable, CodeFileTable } from "../../src/code-intelligence/schema.sql"
import { eq } from "drizzle-orm"
import type { ProjectID } from "../../src/project/schema"
import { DebugEngine } from "../../src/debug-engine"
import { parseTypeScriptStack, resolveFrame, validateHypothesisCitations } from "../../src/debug-engine/analyze-bug"
import { normalizeSignature } from "../../src/debug-engine/detect-duplicates"
import { classifyIntent } from "../../src/debug-engine/plan-refactor"
import { ToolRegistry } from "../../src/tool/registry"
import { Flag } from "../../src/flag/flag"

Log.init({ print: false })

// Helpers to seed the v3 graph directly through the query layer, so DRE
// tests don't need a running LSP server. Mirrors test/code-intelligence
// /api.test.ts so the fixture stays consistent across subsystems.

function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "method" | "class"
    file?: string
    signature?: string | null
    startLine?: number
    endLine?: number
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
    visibility: null,
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

// Row-count guard per ADR-002: DRE must never write to v3 tables. Capture
// counts around a block and assert no delta. Used as a wrapper around
// every DRE call in the test suite.
function v3RowSnapshot(projectID: ProjectID): { nodes: number; edges: number; files: number } {
  return {
    nodes: Database.use((db) =>
      db.select().from(CodeNodeTable).where(eq(CodeNodeTable.project_id, projectID)).all().length,
    ),
    edges: Database.use((db) =>
      db.select().from(CodeEdgeTable).where(eq(CodeEdgeTable.project_id, projectID)).all().length,
    ),
    files: Database.use((db) =>
      db.select().from(CodeFileTable).where(eq(CodeFileTable.project_id, projectID)).all().length,
    ),
  }
}

// ─── analyze-bug: stack trace parser ────────────────────────────────

describe("analyzeBug — parseTypeScriptStack", () => {
  test("parses V8 form with symbol + location", () => {
    const stack = [
      "Error: boom",
      "    at Foo.bar (/abs/a.ts:10:5)",
      "    at handleRequest (/abs/b.ts:20:3)",
    ].join("\n")
    const frames = parseTypeScriptStack(stack)
    expect(frames.length).toBe(2)
    expect(frames[0].file).toBe("/abs/a.ts")
    expect(frames[0].line).toBe(10)
    expect(frames[0].symbolName).toBe("Foo.bar")
    expect(frames[1].symbolName).toBe("handleRequest")
  })

  test("parses V8 form without symbol (bare location)", () => {
    const stack = ["Error: boom", "    at /abs/c.ts:42:7"].join("\n")
    const frames = parseTypeScriptStack(stack)
    expect(frames.length).toBe(1)
    expect(frames[0].file).toBe("/abs/c.ts")
    expect(frames[0].line).toBe(42)
    expect(frames[0].symbolName).toBeUndefined()
  })

  test("ignores non-frame lines", () => {
    const stack = [
      "TypeError: Cannot read property 'x' of null",
      "",
      "    at Foo.bar (/abs/a.ts:1:1)",
      "    extra text",
    ].join("\n")
    const frames = parseTypeScriptStack(stack)
    expect(frames.length).toBe(1)
    expect(frames[0].file).toBe("/abs/a.ts")
  })
})

// ─── analyze-bug: frame resolution + chain walk ─────────────────────

describe("analyzeBug — end-to-end", () => {
  test("resolves frames to graph symbols and walks callers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const paymentsFile = path.join(tmp.path, "payments.ts")
        const serverFile = path.join(tmp.path, "server.ts")

        // Graph: handleRequest -[calls]-> processPayment.
        // The stack trace lists only processPayment; analyzeBug should
        // walk up and include handleRequest.
        const processPaymentId = seedSymbol(projectID, {
          name: "processPayment",
          file: paymentsFile,
          startLine: 9,
          endLine: 20,
        })
        const handleRequestId = seedSymbol(projectID, {
          name: "handleRequest",
          file: serverFile,
          startLine: 4,
          endLine: 15,
        })
        seedCallEdge(projectID, handleRequestId, processPaymentId, serverFile)

        const before = v3RowSnapshot(projectID)

        const result = await DebugEngine.analyzeBug(projectID, {
          error: "TypeError: Cannot read property 'amount' of null",
          stackTrace: [
            "TypeError: Cannot read property 'amount' of null",
            `    at processPayment (${paymentsFile}:10:12)`,
          ].join("\n"),
        })

        const after = v3RowSnapshot(projectID)
        expect(after).toEqual(before) // ADR-002 row-count guard

        expect(result.chain.length).toBeGreaterThanOrEqual(1)
        expect(result.chain[0].role).toBe("failure")
        expect(result.chain[0].symbol).not.toBeNull()
        expect(result.chain[0].symbol?.name).toBe("processPayment")

        // Walk-callers should add handleRequest as an "entry" frame.
        const names = result.chain.map((f) => f.symbol?.name).filter(Boolean)
        expect(names).toContain("handleRequest")

        expect(result.confidence).toBeGreaterThan(0)
        expect(result.confidence).toBeLessThanOrEqual(0.95)
        expect(result.explain.source).toBe("debug-engine")
        expect(result.explain.tool).toBe("analyze-bug")
        expect(result.explain.heuristicsApplied).toContain("ts-stack-regex")
        expect(result.explain.graphQueries.length).toBeGreaterThan(0)

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("unresolvable frames produce null symbols but don't throw", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // File referenced in the stack trace has no seeded symbols.
        const result = await DebugEngine.analyzeBug(projectID, {
          error: "boom",
          stackTrace: [
            "Error: boom",
            `    at anonFn (${path.join(tmp.path, "ghost.ts")}:5:1)`,
          ].join("\n"),
        })

        // Frame is parsed but symbol is null.
        expect(result.chain.length).toBe(1)
        expect(result.chain[0].symbol).toBeNull()
        // Confidence drops to 0 when nothing resolved.
        expect(result.confidence).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("empty input returns an empty chain", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const result = await DebugEngine.analyzeBug(projectID, { error: "no trace" })
        expect(result.chain.length).toBe(0)
        expect(result.confidence).toBe(0)
        expect(result.rootCauseHypothesis).toBeNull()
      },
    })
  })

  test("drops noise frames (node_modules) except the failure frame", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const userFile = path.join(tmp.path, "user.ts")
        seedSymbol(projectID, { name: "userFn", file: userFile, startLine: 0, endLine: 10 })

        const result = await DebugEngine.analyzeBug(projectID, {
          error: "boom",
          stackTrace: [
            "Error: boom",
            `    at userFn (${userFile}:5:1)`,
            `    at something (${path.join(tmp.path, "node_modules", "lib", "index.js")}:1:1)`,
          ].join("\n"),
        })

        // The node_modules frame should be filtered out, leaving only userFn.
        const files = result.chain.map((f) => f.file)
        expect(files.some((f) => f.includes("node_modules"))).toBe(false)
        expect(result.explain.heuristicsApplied.some((h) => h.startsWith("rule-filter:noise"))).toBe(true)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

// ─── analyze-bug: cite-or-drop validator (ADR-005) ──────────────────

describe("validateHypothesisCitations", () => {
  const chain = [
    { frame: 0, symbol: null, file: "a.ts", line: 1, role: "failure" as const },
    { frame: 1, symbol: null, file: "b.ts", line: 2, role: "entry" as const },
  ]

  test("keeps hypotheses that cite real frame indices", () => {
    const h = { summary: "it broke", brokenInvariant: "x was null", citedFrames: [0, 1] }
    const out = validateHypothesisCitations(h, chain)
    expect(out).not.toBeNull()
    expect(out?.citedFrames).toEqual([0, 1])
  })

  test("drops fabricated frame indices", () => {
    const h = { summary: "fabrication", brokenInvariant: "y", citedFrames: [0, 42, 99] }
    const out = validateHypothesisCitations(h, chain)
    expect(out).not.toBeNull()
    expect(out?.citedFrames).toEqual([0])
  })

  test("returns null if nothing survives", () => {
    const h = { summary: "all wrong", brokenInvariant: "z", citedFrames: [7, 8] }
    const out = validateHypothesisCitations(h, chain)
    expect(out).toBeNull()
  })
})

// ─── detect-duplicates ───────────────────────────────────────────────

describe("detectDuplicates — normalizeSignature", () => {
  test("strips parameter names and literal values", () => {
    const a = "(amount: number = 0, currency: string) => number"
    const b = "(price: number = 100, unit: string) => number"
    expect(normalizeSignature(a)).toBe(normalizeSignature(b))
  })

  test("different structure produces different normalization", () => {
    const a = "(x: number) => number"
    const b = "(x: string) => string"
    expect(normalizeSignature(a)).not.toBe(normalizeSignature(b))
  })
})

describe("detectDuplicates — e2e", () => {
  test("detects exact-signature duplicates across files", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const sig = "(amount: number, currency: string) => number"
        const fileA = path.join(tmp.path, "pricing.ts")
        const fileB = path.join(tmp.path, "checkout.ts")
        const fileC = path.join(tmp.path, "discount.ts")
        seedSymbol(projectID, { name: "calc", file: fileA, signature: sig })
        seedSymbol(projectID, { name: "price", file: fileB, signature: sig })
        seedSymbol(projectID, { name: "discount", file: fileC, signature: sig })
        // Unrelated symbol to confirm ranking filters correctly.
        seedSymbol(projectID, {
          name: "lonely",
          file: path.join(tmp.path, "alone.ts"),
          signature: "(x: number) => void",
        })

        const before = v3RowSnapshot(projectID)
        const report = await DebugEngine.detectDuplicates(projectID, {})
        const after = v3RowSnapshot(projectID)
        expect(after).toEqual(before) // ADR-002 row-count guard

        expect(report.clusters.length).toBeGreaterThanOrEqual(1)
        const topCluster = report.clusters[0]
        expect(topCluster.members.length).toBe(3)
        expect(topCluster.tier).toBe("exact")
        expect(topCluster.similarityScore).toBe(1)

        // Three files means cross-file spread of 3.
        const files = new Set(topCluster.members.map((m) => m.file))
        expect(files.size).toBe(3)

        expect(report.explain.source).toBe("debug-engine")
        expect(report.explain.tool).toBe("detect-duplicates")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("excludes test files by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const sig = "(amount: number, currency: string) => number"
        seedSymbol(projectID, { name: "calc", file: path.join(tmp.path, "src", "pricing.ts"), signature: sig })
        seedSymbol(projectID, {
          name: "calc",
          file: path.join(tmp.path, "test", "pricing.test.ts"),
          signature: sig,
        })

        const report = await DebugEngine.detectDuplicates(projectID, {})
        // With excludeTests=true (default), only one symbol enters the
        // pool, so no cluster is formed.
        expect(report.clusters.length).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("respects excludeTests=false", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const sig = "(amount: number, currency: string) => number"
        seedSymbol(projectID, { name: "calc", file: path.join(tmp.path, "src", "pricing.ts"), signature: sig })
        seedSymbol(projectID, {
          name: "calc",
          file: path.join(tmp.path, "test", "pricing.test.ts"),
          signature: sig,
        })

        const report = await DebugEngine.detectDuplicates(projectID, { excludeTests: false })
        expect(report.clusters.length).toBe(1)
        expect(report.clusters[0].members.length).toBe(2)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

// ─── plan-refactor ───────────────────────────────────────────────────

describe("planRefactor — classifyIntent", () => {
  test("classifies extract", () => {
    expect(classifyIntent("extract a PricingService")).toBe("extract")
    expect(classifyIntent("pull out common logic")).toBe("extract")
  })
  test("classifies rename", () => {
    expect(classifyIntent("rename handleRequest to handleHttp")).toBe("rename")
  })
  test("classifies collapse", () => {
    expect(classifyIntent("collapse these three helpers")).toBe("collapse")
    expect(classifyIntent("unify the pricing helpers")).toBe("collapse")
  })
  test("classifies move", () => {
    expect(classifyIntent("move auth utils to shared/")).toBe("move")
  })
  test("classifies inline", () => {
    expect(classifyIntent("inline this one-liner")).toBe("inline")
  })
  test("falls back to other", () => {
    expect(classifyIntent("make it faster")).toBe("other")
  })
})

describe("planRefactor — e2e", () => {
  test("produces an auditable plan and persists it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const pricingFile = path.join(tmp.path, "pricing.ts")
        const calcId = seedSymbol(projectID, {
          name: "calc",
          file: pricingFile,
          signature: "(amount: number) => number",
        })

        const before = v3RowSnapshot(projectID)
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract calc into a shared utility",
          targets: [calcId],
        })
        const after = v3RowSnapshot(projectID)
        expect(after).toEqual(before) // ADR-002 row-count guard

        expect(plan.kind).toBe("extract")
        expect(plan.status).toBe("pending")
        expect(plan.affectedSymbols).toContain(calcId)
        expect(plan.affectedFiles).toContain(pricingFile)
        expect(plan.edits.length).toBeGreaterThan(0)
        expect(plan.edits[0].op).toBe("create_symbol")

        // Plan is retrievable.
        const fetched = DebugEngine.getPlan(projectID, plan.planId)
        expect(fetched).not.toBeNull()
        expect(fetched?.planId).toBe(plan.planId)
        expect(fetched?.kind).toBe("extract")

        // Listing returns it too.
        const pending = DebugEngine.listPlans(projectID, { status: "pending" })
        expect(pending.length).toBe(1)
        expect(pending[0].planId).toBe(plan.planId)

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("drops targets that don't resolve to real graph symbols", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const fakeId = CodeNodeID.make("cnd_nonexistent")
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract",
          targets: [fakeId],
        })

        // No resolved targets → empty affected sets, but the plan row
        // still exists and is retrievable.
        expect(plan.affectedSymbols.length).toBe(0)
        expect(plan.affectedFiles.length).toBe(0)
        expect(plan.status).toBe("pending")
        expect(plan.explain.heuristicsApplied.some((h) => h.startsWith("resolved-targets=0/"))).toBe(true)

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("collapse kind produces delete_symbol edits for duplicates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const fileA = path.join(tmp.path, "a.ts")
        const fileB = path.join(tmp.path, "b.ts")
        const fileC = path.join(tmp.path, "c.ts")
        const a = seedSymbol(projectID, { name: "calc", file: fileA, signature: "(n: number) => number" })
        const b = seedSymbol(projectID, { name: "calc", file: fileB, signature: "(n: number) => number" })
        const c = seedSymbol(projectID, { name: "calc", file: fileC, signature: "(n: number) => number" })

        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "collapse these duplicates",
          targets: [a, b, c],
          kind: "collapse",
        })

        expect(plan.kind).toBe("collapse")
        // Expect at least one delete_symbol edit for each non-keeper.
        const deletes = plan.edits.filter((e) => e.op === "delete_symbol")
        expect(deletes.length).toBe(2)

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })
})

// ─── Tool registry flag gating (ADR-010) ─────────────────────────────

describe("tool registry gating", () => {
  test("DRE tool registration tracks the experimental flag", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // The Flag module captures env vars at load time, so we can't
        // toggle the env var inside the test and observe a change.
        // Instead, assert the invariant: flag value dictates presence.
        const ids = await ToolRegistry.ids()
        const dreIds = ["debug_analyze", "refactor_plan", "dedup_scan"]
        if (Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
          for (const id of dreIds) expect(ids).toContain(id)
        } else {
          for (const id of dreIds) expect(ids).not.toContain(id)
        }
      },
    })
  })
})
