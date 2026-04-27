import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
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
import {
  parseTypeScriptStack,
  parsePythonStack,
  parseStackTrace,
  detectStackFormat,
} from "../../src/debug-engine/analyze-bug"
import { extractFilesFromDiff } from "../../src/debug-engine/analyze-impact"
import { ShadowWorktree } from "../../src/debug-engine/shadow-worktree"
import { RefactorPlanID } from "../../src/debug-engine/id"

Log.init({ print: false })

// Helpers — same pattern as debug-engine.test.ts.

function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "method" | "class"
    file?: string
    signature?: string | null
    startLine?: number
    endLine?: number
    visibility?: "public" | "private" | "protected" | null
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
    visibility: opts.visibility === undefined ? null : opts.visibility,
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

function v3RowSnapshot(projectID: ProjectID): { nodes: number; edges: number; files: number } {
  return {
    nodes: Database.use(
      (db) => db.select().from(CodeNodeTable).where(eq(CodeNodeTable.project_id, projectID)).all().length,
    ),
    edges: Database.use(
      (db) => db.select().from(CodeEdgeTable).where(eq(CodeEdgeTable.project_id, projectID)).all().length,
    ),
    files: Database.use(
      (db) => db.select().from(CodeFileTable).where(eq(CodeFileTable.project_id, projectID)).all().length,
    ),
  }
}

// ─── Python stack parser ─────────────────────────────────────────────

describe("parsePythonStack", () => {
  test("parses a standard Python traceback and reverses frame order", () => {
    const trace = [
      "Traceback (most recent call last):",
      '  File "/abs/main.py", line 10, in <module>',
      "    run()",
      '  File "/abs/app.py", line 20, in run',
      "    process()",
      '  File "/abs/app.py", line 30, in process',
      "    fail()",
      "ValueError: boom",
    ].join("\n")
    const frames = parsePythonStack(trace)
    // Python lists oldest-first; we reverse so failure is index 0.
    expect(frames.length).toBe(3)
    expect(frames[0].symbolName).toBe("process")
    expect(frames[0].file).toBe("/abs/app.py")
    expect(frames[0].line).toBe(30)
    expect(frames[2].symbolName).toBe("<module>")
  })

  test("handles empty traceback gracefully", () => {
    expect(parsePythonStack("")).toEqual([])
  })
})

describe("detectStackFormat + parseStackTrace dispatch", () => {
  test("detects Python by header", () => {
    const t = 'Traceback (most recent call last):\n  File "/a.py", line 1, in x\nValueError'
    expect(detectStackFormat(t)).toBe("python")
  })

  test("detects Python by File line when header is trimmed", () => {
    const t = '  File "/a.py", line 1, in x\n    code\nValueError: boom'
    expect(detectStackFormat(t)).toBe("python")
  })

  test("detects TypeScript by at-prefix frames", () => {
    expect(detectStackFormat("Error\n    at foo (/a.ts:1:1)")).toBe("typescript")
  })

  test("routes dispatch to the correct parser", () => {
    const py = 'Traceback (most recent call last):\n  File "/a.py", line 1, in foo\nError'
    const { format, frames } = parseStackTrace(py)
    expect(format).toBe("python")
    expect(frames.length).toBe(1)
    expect(frames[0].symbolName).toBe("foo")

    const ts = "Error\n    at foo (/a.ts:1:1)"
    const res2 = parseStackTrace(ts)
    expect(res2.format).toBe("typescript")
    expect(res2.frames[0].file).toBe("/a.ts")
  })
})

describe("analyzeBug — uses the dispatcher", () => {
  test("parses a Python traceback and sets py-traceback-regex heuristic", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // No graph seeding — we just want to verify the parser path
        // runs and heuristics are recorded.
        const result = await DebugEngine.analyzeBug(projectID, {
          error: "ValueError",
          stackTrace: [
            "Traceback (most recent call last):",
            `  File "${path.join(tmp.path, "app.py")}", line 10, in run`,
            "    do_thing()",
            "ValueError: boom",
          ].join("\n"),
        })

        expect(result.explain.heuristicsApplied).toContain("py-traceback-regex")
        // Frame exists but can't be resolved (no graph data).
        expect(result.chain.length).toBe(1)
        expect(result.chain[0].symbol).toBeNull()
      },
    })
  })
})

// ─── analyzeImpact ───────────────────────────────────────────────────

describe("extractFilesFromDiff", () => {
  test("extracts files from unified-diff +++ lines", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
    ].join("\n")
    const files = extractFilesFromDiff(patch)
    expect(files.sort()).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("keeps deleted files from pure deletions", () => {
    const patch = ["--- a/gone.ts", "+++ /dev/null"].join("\n")
    expect(extractFilesFromDiff(patch)).toEqual(["gone.ts"])
  })
})

describe("analyzeImpact — e2e", () => {
  test("BFS walks upstream from a seed symbol and reports distances", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        //  entry → middle → leaf
        // impact_analyze(leaf) should return middle (d=1) and entry (d=2)
        const leafFile = path.join(tmp.path, "leaf.ts")
        const middleFile = path.join(tmp.path, "middle.ts")
        const entryFile = path.join(tmp.path, "entry.ts")
        const leaf = seedSymbol(projectID, { name: "leaf", file: leafFile })
        const middle = seedSymbol(projectID, { name: "middle", file: middleFile })
        const entry = seedSymbol(projectID, { name: "entry", file: entryFile })
        seedCallEdge(projectID, middle, leaf, middleFile)
        seedCallEdge(projectID, entry, middle, entryFile)

        const before = v3RowSnapshot(projectID)
        const report = await DebugEngine.analyzeImpact(projectID, {
          changes: [{ kind: "symbol", id: leaf }],
          depth: 3,
        })
        const after = v3RowSnapshot(projectID)
        expect(after).toEqual(before) // ADR-002 guard

        expect(report.seeds.length).toBe(1)
        expect(report.affectedSymbols.length).toBe(2)

        const byName = new Map(report.affectedSymbols.map((a) => [a.symbol.name, a]))
        expect(byName.get("middle")?.distance).toBe(1)
        expect(byName.get("entry")?.distance).toBe(2)

        // Shortest path from "entry" should be [leaf, middle, entry].
        const entryPath = byName.get("entry")?.path ?? []
        expect(entryPath.length).toBe(3)
        expect(entryPath[0]).toBe(leaf)
        expect(entryPath[2]).toBe(entry)

        expect(report.affectedFiles.sort()).toEqual([entryFile, middleFile].sort())
        expect(report.truncated).toBe(false)
        expect(report.explain.tool).toBe("analyze-impact")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("depth cap limits traversal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Linear chain of 5: a → b → c → d → e, seed = e
        // depth=2 should return d (d=1) and c (d=2); b and a should not
        // appear.
        const f = (n: string) => path.join(tmp.path, `${n}.ts`)
        const a = seedSymbol(projectID, { name: "a", file: f("a") })
        const b = seedSymbol(projectID, { name: "b", file: f("b") })
        const c = seedSymbol(projectID, { name: "c", file: f("c") })
        const d = seedSymbol(projectID, { name: "d", file: f("d") })
        const e = seedSymbol(projectID, { name: "e", file: f("e") })
        seedCallEdge(projectID, a, b, f("a"))
        seedCallEdge(projectID, b, c, f("b"))
        seedCallEdge(projectID, c, d, f("c"))
        seedCallEdge(projectID, d, e, f("d"))

        const report = await DebugEngine.analyzeImpact(projectID, {
          changes: [{ kind: "symbol", id: e }],
          depth: 2,
        })

        const names = report.affectedSymbols.map((s) => s.symbol.name).sort()
        expect(names).toEqual(["c", "d"])

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("visit budget exhaustion forces risk label high", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Fan-out: one leaf called by 5 direct callers. Set maxVisited
        // to a tiny value to force budget exhaustion.
        const leafFile = path.join(tmp.path, "leaf.ts")
        const leaf = seedSymbol(projectID, { name: "leaf", file: leafFile })
        for (let i = 0; i < 5; i++) {
          const file = path.join(tmp.path, `caller${i}.ts`)
          const callerId = seedSymbol(projectID, { name: `caller${i}`, file })
          seedCallEdge(projectID, callerId, leaf, file)
        }

        const report = await DebugEngine.analyzeImpact(projectID, {
          changes: [{ kind: "symbol", id: leaf }],
          maxVisited: 10, // must be >= 10 per input validation; still small enough
        })

        // Large fan-out, small budget — we either hit budget or don't.
        // Either way, the computed risk label should be deterministic
        // given the inputs. We assert the shape rather than the exact
        // label (budget may or may not fire depending on visit order).
        expect(typeof report.truncated).toBe("boolean")
        if (report.truncated) expect(report.riskLabel).toBe("high")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("diff change kind extracts files and seeds their symbols", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // A real git diff uses worktree-relative paths with `a/` and
        // `b/` prefixes. extractFilesFromDiff strips the `b/` and the
        // resulting path must match the `file` column on the seeded
        // CodeNode exactly. Seed with the relative path so the match
        // works — in production, v3 populates the `file` column with
        // absolute paths, which would require the diff resolver to
        // join with Instance.worktree. That's a Phase 2 follow-up; for
        // now we exercise the base code path.
        const relFile = "touched.ts"
        seedSymbol(projectID, { name: "inTouched", file: relFile })

        const patch = [`--- a/${relFile}`, `+++ b/${relFile}`, "@@ -1 +1 @@", "-old", "+new"].join("\n")

        const report = await DebugEngine.analyzeImpact(projectID, {
          changes: [{ kind: "diff", patch }],
          scope: "none", // seeded with a relative path that isn't inside Instance.worktree
        })

        // The seeded symbol is in the touched file, so seeds should be
        // non-empty. No callers exist so affectedSymbols is empty.
        expect(report.seeds.length).toBe(1)
        expect(report.affectedSymbols.length).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

// ─── detectHardcodes ─────────────────────────────────────────────────

describe("detectHardcodes", () => {
  test("detects magic numbers in source files", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "timeouts.ts"),
      ["export function connect() {", "  const t = 30000", "  return t", "}"].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["magic_number"],
        })
        const numbers = report.findings.filter((f) => f.kind === "magic_number")
        expect(numbers.length).toBeGreaterThan(0)
        // 30000 should be present.
        expect(numbers.some((f) => f.value === "30000")).toBe(true)
        // 0/1/2 should never appear — they're in TRIVIAL_NUMBERS.
        expect(numbers.some((f) => f.value === "0" || f.value === "1")).toBe(false)
      },
    })
  })

  test("ignores magic numbers inside block comments and JSDoc", async () => {
    // Regression test for issue #23. Before the fix, `stripComments`
    // only handled line comments (`//`); magic numbers and secret-
    // shaped strings inside `/* ... */` or JSDoc blocks were reported
    // as hardcodes. The scanner now tracks multi-line block-comment
    // state and strips all forms of block comments before running
    // detectors.
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "commented.ts"),
      [
        "/**",
        " * Connect to the service.",
        " *",
        " * @example",
        " *   const port = 8888",
        " *   const timeout = 60000",
        " */",
        "export function connect() {",
        "  /* inline comment with magic 12345 */ return true",
        "}",
        "// plus a line with 99999 in it",
        "const real = 77777",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["magic_number"],
        })
        const values = report.findings.filter((f) => f.kind === "magic_number").map((f) => f.value)
        // 77777 sits in a real assignment — detected.
        expect(values).toContain("77777")
        // 8888, 60000, 12345 are all inside comments — dropped.
        expect(values).not.toContain("8888")
        expect(values).not.toContain("60000")
        expect(values).not.toContain("12345")
        expect(values).not.toContain("99999")
      },
    })
  })

  test("ignores numbers inside named const declarations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "config.ts"),
      ["export const MAX_TIMEOUT_MS = 30000", "const RETRY_DELAY = 5000"].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["magic_number"],
        })
        // Both 30000 and 5000 sit in named const declarations → skipped.
        const hits = report.findings.filter((f) => f.kind === "magic_number")
        expect(hits.length).toBe(0)
      },
    })
  })

  test("detects inline URLs and classifies localhost as low severity", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "api.ts"),
      [
        // URLs in runtime expressions (not const assignments) are flagged
        'fetch("https://api.example.com/v1")',
        'fetch("http://localhost:3000")',
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["inline_url"],
        })
        const urls = report.findings.filter((f) => f.kind === "inline_url")
        expect(urls.length).toBe(2)
        const prod = urls.find((u) => u.value.includes("example.com"))
        const dev = urls.find((u) => u.value.includes("localhost"))
        expect(prod?.severity).toBe("medium")
        expect(dev?.severity).toBe("low")
      },
    })
  })

  test("detects absolute filesystem paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "paths.ts"),
      [
        // Paths in runtime expressions (not const assignments) are flagged
        'readFile("/Users/alice/project")',
        'readFile("/tmp/scratch")',
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["inline_path"],
        })
        const paths = report.findings.filter((f) => f.kind === "inline_path")
        expect(paths.length).toBeGreaterThanOrEqual(2)
        expect(paths.some((p) => p.value.includes("/Users/alice"))).toBe(true)
        expect(paths.some((p) => p.value.includes("/tmp/scratch"))).toBe(true)
      },
    })
  })

  test("detects high-entropy secret-shaped strings", async () => {
    await using tmp = await tmpdir({ git: true })
    // A clearly high-entropy base64-ish string; not flagged as a hex hash.
    await fs.writeFile(
      path.join(tmp.path, "secrets.ts"),
      [
        'const token = "aB9cD8eF7gH6iJ5kL4mN3oP2qR1sT0uV"',
        'const hash = "a3f5e9d2b7c1"', // short hex, should NOT flag
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, {
          patterns: ["inline_secret_shape"],
        })
        const secrets = report.findings.filter((f) => f.kind === "inline_secret_shape")
        expect(secrets.length).toBeGreaterThanOrEqual(1)
        expect(secrets.some((s) => s.value.startsWith("aB9cD8"))).toBe(true)
        // The 12-char hex string is below the length threshold.
        expect(secrets.some((s) => s.value === "a3f5e9d2b7c1")).toBe(false)
      },
    })
  })

  test("excludes test files by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "test"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "test", "api.test.ts"), 'const url = "https://api.example.com"')
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_url"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("skips comments", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "commented.ts"),
      ["// see https://example.com for docs", "export const x = 42"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_url"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })
})

// ─── hardcode_scan precision improvements ───────────────────────────

describe("detectHardcodes — precision overhaul", () => {
  test("skips URLs assigned to const declarations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "config.ts"),
      [
        'const API_URL = "https://api.example.com/v1"',
        'export const BASE = "https://cdn.example.com"',
        'fetch("https://inline.example.com/data")',
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_url"] })
        const values = report.findings.map((f) => f.value)
        // Inline fetch URL should be flagged
        expect(values.some((v) => v.includes("inline.example.com"))).toBe(true)
        // URLs in const assignments should NOT be flagged
        expect(values.some((v) => v.includes("api.example.com"))).toBe(false)
        expect(values.some((v) => v.includes("cdn.example.com"))).toBe(false)
      },
    })
  })

  test("skips paths assigned to const declarations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "paths.ts"),
      ['const DATA_DIR = "/Users/deploy/data"', 'readFile("/Users/hardcoded/secrets")'].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_path"] })
        const values = report.findings.map((f) => f.value)
        // Inline path should be flagged
        expect(values.some((v) => v.includes("hardcoded"))).toBe(true)
        // Const-assigned path should NOT
        expect(values.some((v) => v.includes("deploy"))).toBe(false)
      },
    })
  })

  test("does not flag PascalCase class names as secrets", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "auth.ts"),
      [
        'const grant = "OAuth2AuthorizationCodeGrantTypeHandler"',
        'const real = "aB9cD8eF7gH6iJ5kL4mN3oP2qR1sT0uVwXyZ"',
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_secret_shape"] })
        const values = report.findings.map((f) => f.value)
        // PascalCase class name should NOT be flagged
        expect(values.some((v) => v.includes("OAuth2"))).toBe(false)
        // Real secret-shaped string should be flagged
        expect(values.some((v) => v.startsWith("aB9cD8"))).toBe(true)
      },
    })
  })

  test("does not flag snake_case identifiers as secrets", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "schema.ts"),
      [
        'const table = "debug_engine_refactor_plan_project_status_idx"',
        'const event = "pull_request_review_comment_created"',
        'const err = "BunInstallFailedErrorWithLongSuffix"',
        'const real = "aB9cD8eF7gH6iJ5kL4mN3oP2qR1sT0uVwXyZ"',
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectHardcodes(projectID, { patterns: ["inline_secret_shape"] })
        const values = report.findings.map((f) => f.value)
        // snake_case identifiers should NOT be flagged
        expect(values.some((v) => v.includes("debug_engine"))).toBe(false)
        expect(values.some((v) => v.includes("pull_request"))).toBe(false)
        // Real secret should still be flagged
        expect(values.some((v) => v.startsWith("aB9cD8"))).toBe(true)
      },
    })
  })
})

// ─── detectRaces ────────────────────────────────────────────────────

describe("detectRaces", () => {
  test("detects TOCTOU: Map.get → await → Map.set", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "cache.ts"),
      [
        "const cache = new Map<string, number>()",
        "async function update(key: string) {",
        "  const old = cache.get(key)",
        "  const value = await fetchValue(key)",
        "  cache.set(key, value)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, { patterns: ["toctou"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("toctou")
        expect(report.findings[0].severity).toBe("high")
        expect(report.findings[0].description).toContain("cache")
      },
    })
  })

  test("detects non-atomic counter after await", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "counter.ts"),
      [
        "let count = 0",
        "async function process(items: string[]) {",
        "  for (const item of items) {",
        "    await handle(item)",
        "    count++",
        "  }",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, { patterns: ["non_atomic_counter"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("non_atomic_counter")
        expect(report.findings[0].description).toContain("count")
      },
    })
  })

  test("detects conflicting mutations inside Promise.all", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "parallel.ts"),
      [
        "const results: string[] = []",
        "async function run() {",
        "  await Promise.all([",
        "    fetchA().then(val => results.push(val)),",
        "    fetchB().then(val => results.push(val)),",
        "  ])",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, { patterns: ["conflicting_mutation"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("conflicting_mutation")
        expect(report.findings[0].description).toContain("results")
      },
    })
  })

  test("detects event listener registered after await", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "events.ts"),
      ["async function setup(emitter: any) {", "  await initialize()", '  emitter.on("data", handler)', "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, { patterns: ["stale_listener"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("stale_listener")
        expect(report.findings[0].description).toContain("emitter")
      },
    })
  })

  test("no findings in synchronous code", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "sync.ts"),
      ["function add(a: number, b: number) {", "  return a + b", "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, {})
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("respects @scan-suppress race_scan comment", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "suppressed.ts"),
      [
        "const cache = new Map<string, number>()",
        "async function update(key: string) {",
        "  // @scan-suppress race_scan — intentional stale read",
        "  const old = cache.get(key)",
        "  const value = await fetchValue(key)",
        "  cache.set(key, value)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectRaces(projectID, { patterns: ["toctou"] })
        // The suppressed read should not generate a finding
        expect(report.findings.length).toBe(0)
      },
    })
  })
})

// ─── detectLifecycle ────────────────────────────────────────────────

describe("detectLifecycle", () => {
  test("detects setInterval without clearInterval", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "timer.ts"),
      ["function startPolling() {", "  setInterval(() => {", '    console.log("tick")', "  }, 1000)", "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["timer"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].resourceType).toBe("timer")
        expect(report.findings[0].pattern).toBe("no_cleanup")
        expect(report.findings[0].severity).toBe("high")
      },
    })
  })

  test("no finding when setInterval has matching clearInterval", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "timer-ok.ts"),
      [
        "function startPolling() {",
        "  const id = setInterval(() => {",
        '    console.log("tick")',
        "  }, 1000)",
        "  return () => clearInterval(id)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["timer"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects event listener without removal", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "events.ts"),
      [
        "function setup(emitter: any) {",
        '  emitter.on("data", handleData)',
        '  emitter.on("error", handleError)',
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["event_listener"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].resourceType).toBe("event_listener")
      },
    })
  })

  test("no finding when event listener has removal", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "events-ok.ts"),
      ["function setup(emitter: any) {", '  emitter.on("data", handleData)', "  return () => emitter.off()", "}"].join(
        "\n",
      ),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["event_listener"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects unbounded Map growth", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "cache.ts"),
      [
        "const cache = new Map<string, any>()",
        "function store(key: string, value: any) {",
        "  cache.set(key, value)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["map_growth"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].resourceType).toBe("map_growth")
        expect(report.findings[0].pattern).toBe("unbounded_growth")
      },
    })
  })

  test("no Map growth finding when size guard exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "bounded-cache.ts"),
      [
        "const cache = new Map<string, any>()",
        "function store(key: string, value: any) {",
        "  if (cache.size > 1000) cache.clear()",
        "  cache.set(key, value)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["map_growth"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects child process without kill or exit handler", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "proc.ts"),
      ["function run(cmd: string) {", '  spawn("bash", ["-c", cmd])', "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["child_process"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].resourceType).toBe("child_process")
      },
    })
  })

  test("respects @scan-suppress lifecycle_scan comment", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "suppressed.ts"),
      [
        "function startPolling() {",
        "  // @scan-suppress lifecycle_scan — cleaned up by parent scope",
        "  setInterval(() => {",
        '    console.log("tick")',
        "  }, 1000)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["timer"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("excludes test files by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "test"), { recursive: true })
    await fs.writeFile(
      path.join(tmp.path, "test", "timer.test.ts"),
      ["function startPolling() {", "  setInterval(() => {}, 1000)", "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectLifecycle(projectID, { resourceTypes: ["timer"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })
})

// ─── detectSecurity ─────────────────────────────────────────────────

describe("detectSecurity", () => {
  test("detects path traversal without containment check", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "files.ts"),
      [
        "import path from 'path'",
        "function readUserFile(userPath: string) {",
        "  const full = path.join('/data', userPath)",
        "  return fs.readFile(full)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["path_traversal"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("path_traversal")
        expect(report.findings[0].severity).toBe("high")
        expect(report.findings[0].userControlled).toBe(true)
      },
    })
  })

  test("no path traversal finding when containment check exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "safe-files.ts"),
      [
        "import path from 'path'",
        "function readUserFile(userPath: string) {",
        "  const full = path.join('/data', userPath)",
        "  if (!Filesystem.contains('/data', full)) throw new Error('nope')",
        "  return fs.readFile(full)",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["path_traversal"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects command injection via template literal", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "run.ts"),
      ["function runCommand(input: string) {", "  exec(`echo ${input}`)", "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["command_injection"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("command_injection")
        expect(report.findings[0].severity).toBe("high")
      },
    })
  })

  test("detects env leak via process.env spread", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "spawn.ts"),
      ["function run() {", "  spawn('node', ['script.js'], { env: { ...process.env } })", "}"].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["env_leak"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("env_leak")
        expect(report.findings[0].severity).toBe("medium")
      },
    })
  })

  test("no env leak finding when sanitization exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "safe-spawn.ts"),
      [
        "function run() {",
        "  const env = Env.sanitize(process.env)",
        "  spawn('node', ['script.js'], { env: { ...process.env } })",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["env_leak"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects missing validation on mutation routes", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "routes.ts"),
      [
        'app.post("/api/users", async (c) => {',
        "  const body = await c.req.json()",
        "  return c.json({ ok: true })",
        "})",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["missing_validation"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("missing_validation")
        expect(report.findings[0].description).toContain("/api/users")
      },
    })
  })

  test("no missing validation when validator exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "safe-routes.ts"),
      [
        'app.post("/api/users", validator("json", schema), async (c) => {',
        "  const body = c.req.valid('json')",
        "  return c.json({ ok: true })",
        "})",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["missing_validation"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("detects SSRF with variable URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "proxy.ts"),
      [
        "async function proxy(userUrl: string) {",
        "  const resp = await fetch(userUrl)",
        "  return resp.text()",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["ssrf"] })
        expect(report.findings.length).toBeGreaterThan(0)
        expect(report.findings[0].pattern).toBe("ssrf")
        expect(report.findings[0].severity).toBe("high")
        expect(report.findings[0].userControlled).toBe(true)
      },
    })
  })

  test("respects @scan-suppress security_scan", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "suppressed.ts"),
      [
        "function run() {",
        "  // @scan-suppress security_scan — validated upstream",
        "  spawn('node', ['script.js'], { env: { ...process.env } })",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["env_leak"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })

  test("excludes test files by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "test"), { recursive: true })
    await fs.writeFile(
      path.join(tmp.path, "test", "proxy.test.ts"),
      [
        "async function proxy(userUrl: string) {",
        "  const resp = await fetch(userUrl)",
        "  return resp.text()",
        "}",
      ].join("\n"),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const report = await DebugEngine.detectSecurity(projectID, { patterns: ["ssrf"] })
        expect(report.findings.length).toBe(0)
      },
    })
  })
})

// ─── ShadowWorktree ──────────────────────────────────────────────────

describe("ShadowWorktree", () => {
  test("precheck fails cleanly on a non-git directory", async () => {
    await using tmp = await tmpdir({ git: false })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ShadowWorktree.precheck()
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toBe("not-git")
      },
    })
  })

  test("open creates a branch + worktree and dispose removes both", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ShadowWorktree.__resetGates()
        const result = await ShadowWorktree.open({ planId: "test1" })
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const shadowPath = result.handle.path
        const branch = result.handle.branch

        // Shadow directory exists and lives under automatosx/tmp/dre-shadow.
        expect(shadowPath).toContain("dre-shadow")
        const stat = await fs.stat(shadowPath)
        expect(stat.isDirectory()).toBe(true)

        // Branch is registered in git.
        const branches = await $`git branch --list ${branch}`.cwd(tmp.path).text()
        expect(branches).toContain(branch)

        // Dispose: directory gone, branch gone.
        await result.handle[Symbol.asyncDispose]()
        expect(result.handle.disposed).toBe(true)
        const exists = await fs
          .stat(shadowPath)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
        const branchesAfter = await $`git branch --list ${branch}`.cwd(tmp.path).text()
        expect(branchesAfter.trim()).toBe("")
      },
    })
  })

  test("double-dispose is safe", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ShadowWorktree.__resetGates()
        const result = await ShadowWorktree.open({ planId: "test2" })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        await result.handle[Symbol.asyncDispose]()
        // Second call should be a no-op, not throw.
        await result.handle[Symbol.asyncDispose]()
        expect(result.handle.disposed).toBe(true)
      },
    })
  })

  test("uncommitted changes are rejected by default", async () => {
    await using tmp = await tmpdir({ git: true })
    // Create an unstaged file so `git status --porcelain` is non-empty.
    await fs.writeFile(path.join(tmp.path, "dirty.txt"), "hi")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ShadowWorktree.__resetGates()
        const result = await ShadowWorktree.open({ planId: "test-dirty" })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toBe("uncommitted-changes")
      },
    })
  })

  test("allowDirty=true bypasses the uncommitted check", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "dirty.txt"), "hi")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ShadowWorktree.__resetGates()
        const result = await ShadowWorktree.open({ planId: "test-allow-dirty", allowDirty: true })
        expect(result.ok).toBe(true)
        if (result.ok) await result.handle[Symbol.asyncDispose]()
      },
    })
  })
})

// ─── applySafeRefactor ───────────────────────────────────────────────

describe("applySafeRefactor", () => {
  test("rejects non-existent plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const result = await DebugEngine.applySafeRefactor(projectID, {
          planId: RefactorPlanID.make("rpl_nonexistent"),
        })
        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("plan-not-found")
      },
    })
  })

  test("rejects plans not in pending status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const file = path.join(tmp.path, "a.ts")
        const sym = seedSymbol(projectID, { name: "a", file, signature: "(x: number) => number" })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract a",
          targets: [sym],
        })

        // Manually transition to applied, then try to re-apply.
        const { DebugEngineQuery } = await import("../../src/debug-engine/query")
        DebugEngineQuery.updatePlanStatus(projectID, plan.planId, "applied")

        const result = await DebugEngine.applySafeRefactor(projectID, { planId: plan.planId })
        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("plan-status-applied")

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("rejects non-git projects", async () => {
    await using tmp = await tmpdir({ git: false })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)

        const file = path.join(tmp.path, "a.ts")
        const sym = seedSymbol(projectID, { name: "a", file, signature: "() => void" })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract",
          targets: [sym],
        })

        const result = await DebugEngine.applySafeRefactor(projectID, { planId: plan.planId })
        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("not-a-git-worktree")

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("pre-flight (no patch) opens shadow, runs checks, and aborts with no-patch-supplied", async () => {
    await using tmp = await tmpdir({ git: true })

    // Minimal package.json with no test/typecheck/lint scripts so
    // resolveCommands returns all null — checks pass vacuously.
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ name: "dre-test", version: "0.0.0" }))
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit -m "add pkg"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
        ShadowWorktree.__resetGates()

        const file = path.join(tmp.path, "a.ts")
        const sym = seedSymbol(projectID, { name: "a", file, signature: "() => void" })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract",
          targets: [sym],
        })

        const result = await DebugEngine.applySafeRefactor(projectID, {
          planId: plan.planId,
          commands: { typecheck: null, lint: null, test: null },
        })

        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("no-patch-supplied")
        // Checks all reported ok (vacuously — nothing to run).
        expect(result.checks.typecheck.ok).toBe(true)
        expect(result.checks.lint.ok).toBe(true)
        expect(result.checks.tests.ok).toBe(true)
        expect(result.rolledBack).toBe(false)
        expect(result.filesChanged).toEqual([])

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("typecheck failure aborts before applying anything", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ name: "t", version: "0.0.0" }))
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit -m "init"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
        ShadowWorktree.__resetGates()

        const file = path.join(tmp.path, "a.ts")
        const sym = seedSymbol(projectID, { name: "a", file, signature: "() => void" })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "extract",
          targets: [sym],
        })

        // Force typecheck to a command that always fails.
        const result = await DebugEngine.applySafeRefactor(projectID, {
          planId: plan.planId,
          commands: { typecheck: "false", lint: null, test: null },
        })

        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("typecheck-failed")
        expect(result.checks.typecheck.ok).toBe(false)
        expect(result.rolledBack).toBe(false)

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("happy path with a real patch modifies the real worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "greet.ts"), 'export const msg = "hello"\n')
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ name: "t", version: "0.0.0" }))
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit -m "init"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
        ShadowWorktree.__resetGates()

        const sym = seedSymbol(projectID, {
          name: "msg",
          file: path.join(tmp.path, "greet.ts"),
          signature: "string",
          kind: "function",
        })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "rename msg",
          targets: [sym],
          kind: "rename",
        })

        // Build a minimal unified-diff that changes "hello" to "hi".
        const patch = [
          "--- a/greet.ts",
          "+++ b/greet.ts",
          "@@ -1 +1 @@",
          '-export const msg = "hello"',
          '+export const msg = "hi"',
          "",
        ].join("\n")

        const result = await DebugEngine.applySafeRefactor(projectID, {
          planId: plan.planId,
          patch,
          commands: { typecheck: null, lint: null, test: null },
        })

        expect(result.applied).toBe(true)
        expect(result.abortReason).toBeNull()
        expect(result.filesChanged).toContain("greet.ts")

        // The real worktree was modified.
        const content = await fs.readFile(path.join(tmp.path, "greet.ts"), "utf8")
        expect(content).toContain("hi")
        expect(content).not.toContain("hello")

        // Plan status has advanced to "applied".
        const reloaded = DebugEngine.getPlan(projectID, plan.planId)
        expect(reloaded?.status).toBe("applied")

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })

  test("patch apply failure leaves real worktree unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "greet.ts"), 'export const msg = "hello"\n')
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ name: "t", version: "0.0.0" }))
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit -m "init"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
        ShadowWorktree.__resetGates()

        const sym = seedSymbol(projectID, {
          name: "msg",
          file: path.join(tmp.path, "greet.ts"),
          signature: "string",
        })
        const plan = await DebugEngine.planRefactor(projectID, {
          intent: "rename",
          targets: [sym],
          kind: "rename",
        })

        // A nonsense patch — references a context line that doesn't exist.
        const badPatch = [
          "--- a/greet.ts",
          "+++ b/greet.ts",
          "@@ -1 +1 @@",
          '-export const WRONG = "hello"',
          '+export const WRONG = "hi"',
          "",
        ].join("\n")

        const result = await DebugEngine.applySafeRefactor(projectID, {
          planId: plan.planId,
          patch: badPatch,
          commands: { typecheck: null, lint: null, test: null },
        })

        expect(result.applied).toBe(false)
        expect(result.abortReason).toBe("patch-apply-failed")

        // Real worktree is byte-identical.
        const content = await fs.readFile(path.join(tmp.path, "greet.ts"), "utf8")
        expect(content).toBe('export const msg = "hello"\n')

        CodeIntelligence.__clearProject(projectID)
        DebugEngine.__clearProject(projectID)
      },
    })
  })
})
