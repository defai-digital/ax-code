import { describe, expect, test } from "bun:test"
import path from "path"
import { CodeIntelligenceTool } from "../../src/tool/code-intelligence"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import { Log } from "../../src/util/log"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// Minimal tool context shared by all cases — this tool doesn't touch
// permissions, abort signals, or metadata callbacks.
const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

// The tool defaults to worktree scope, so seeded files must live
// inside the test's tmpdir or the filter will drop them. Callers
// pass the tmp base and a relative name.
function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "class"
    base: string
    relFile?: string
    signature?: string
  },
) {
  const t = Date.now()
  const id = CodeNodeID.ascending()
  const file = path.join(opts.base, opts.relFile ?? "t.ts")
  CodeGraphQuery.insertNode({
    id,
    project_id: projectID,
    kind: opts.kind ?? "function",
    name: opts.name,
    qualified_name: opts.name,
    file,
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
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
    path: file,
    sha: "seed",
    size: 0,
    lang: "typescript",
    indexed_at: t,
    completeness: "full",
    time_created: t,
    time_updated: t,
  })
  return { id, file }
}

describe("tool.code_intelligence", () => {
  test("findSymbol returns formatted symbol line", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, {
          name: "handleRequest",
          base: tmp.path,
          signature: "(req: Request) => Promise<Response>",
        })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "handleRequest" }, ctx)
        expect(result.output).toContain("handleRequest")
        expect(result.output).toContain("[function]")
        expect(result.output).toContain("(req: Request)")
        expect(result.metadata.count).toBe(1)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findSymbol with kind filter excludes other kinds", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, { name: "Foo", kind: "class", base: tmp.path, relFile: "a.ts" })
        seedSymbol(projectID, { name: "Foo", kind: "function", base: tmp.path, relFile: "b.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "Foo", kind: "class" }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("a.ts")
        expect(result.output).not.toContain("b.ts")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findSymbolByPrefix matches multiple names", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, { name: "handleRequest", base: tmp.path, relFile: "r.ts" })
        seedSymbol(projectID, { name: "handleResponse", base: tmp.path, relFile: "s.ts" })
        seedSymbol(projectID, { name: "processPayment", base: tmp.path, relFile: "p.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbolByPrefix", name: "handle" }, ctx)
        expect(result.metadata.count).toBe(2)
        expect(result.output).toContain("handleRequest")
        expect(result.output).toContain("handleResponse")
        expect(result.output).not.toContain("processPayment")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("symbolsInFile returns only symbols in the target file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const a = seedSymbol(projectID, { name: "a", base: tmp.path, relFile: "x.ts" })
        seedSymbol(projectID, { name: "b", base: tmp.path, relFile: "x.ts" })
        seedSymbol(projectID, { name: "c", base: tmp.path, relFile: "y.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "symbolsInFile", file: a.file }, ctx)
        expect(result.metadata.count).toBe(2)
        expect(result.output).toContain(" a ")
        expect(result.output).toContain(" b ")
        expect(result.output).not.toContain(" c ")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallers resolves seeded call edges", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const caller = seedSymbol(projectID, { name: "handleRequest", base: tmp.path, relFile: "server.ts" })
        const callee = seedSymbol(projectID, { name: "processPayment", base: tmp.path, relFile: "pay.ts" })
        const now = Date.now()
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: caller.id,
          to_node: callee.id,
          file: caller.file,
          range_start_line: 10,
          range_start_char: 4,
          range_end_line: 10,
          range_end_char: 20,
          time_created: now,
          time_updated: now,
        })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findCallers", symbolID: callee.id }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("handleRequest")
        expect(result.output).toContain("depth=1")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findReferences returns empty string when no edges exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const node = seedSymbol(projectID, { name: "orphan", base: tmp.path })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findReferences", symbolID: node.id }, ctx)
        expect(result.metadata.count).toBe(0)
        expect(result.output).toBe("No references found")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findSymbol for non-existent name returns friendly message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "doesNotExist" }, ctx)
        expect(result.metadata.count).toBe(0)
        expect(result.output).toContain("No symbols named")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("missing required arg throws a clear error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await CodeIntelligenceTool.init()
        await expect(tool.execute({ operation: "findReferences" } as never, ctx)).rejects.toThrow(
          "findReferences requires `symbolID`",
        )
      },
    })
  })

  // ── Policy-aware scope filter ───────────────────────────────────────
  //
  // The tool defaults to worktree scope. Files outside Instance.worktree
  // must never appear in tool results even if they exist in the graph —
  // this is the Phase 2 safety boundary that prevents the agent from
  // seeing code it shouldn't be able to touch.

  test("results outside the worktree are filtered out", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // One node inside the worktree, one outside (arbitrary /etc path).
        seedSymbol(projectID, { name: "dualHome", base: tmp.path, relFile: "inside.ts" })
        seedSymbol(projectID, { name: "dualHome", base: "/etc", relFile: "outside.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "dualHome" }, ctx)
        // Only the worktree-local node reaches the model.
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("inside.ts")
        expect(result.output).not.toContain("outside.ts")

        // Direct API call with scope: "none" must see both — proves the
        // filter is only applied by the tool layer, not the underlying
        // graph, so infrastructure callers (replay, migrations) still
        // have raw access.
        const rawSymbols = CodeIntelligence.findSymbol(projectID, "dualHome", { scope: "none" })
        expect(rawSymbols.length).toBe(2)

        // Explicit scope: "worktree" on the API matches the tool default.
        const scoped = CodeIntelligence.findSymbol(projectID, "dualHome", { scope: "worktree" })
        expect(scoped.length).toBe(1)
        expect(scoped[0].file).toContain(tmp.path)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallers drops callers from out-of-worktree files", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Target symbol lives in-worktree. One caller in-worktree, one
        // caller in /etc. The out-of-worktree caller must not leak.
        const callee = seedSymbol(projectID, { name: "target", base: tmp.path, relFile: "target.ts" })
        const goodCaller = seedSymbol(projectID, { name: "goodCaller", base: tmp.path, relFile: "good.ts" })
        const badCaller = seedSymbol(projectID, { name: "badCaller", base: "/etc", relFile: "bad.ts" })

        const now = Date.now()
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: goodCaller.id,
          to_node: callee.id,
          file: goodCaller.file,
          range_start_line: 1,
          range_start_char: 0,
          range_end_line: 1,
          range_end_char: 5,
          time_created: now,
          time_updated: now,
        })
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: badCaller.id,
          to_node: callee.id,
          file: badCaller.file,
          range_start_line: 2,
          range_start_char: 0,
          range_end_line: 2,
          range_end_char: 5,
          time_created: now,
          time_updated: now,
        })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findCallers", symbolID: callee.id }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("goodCaller")
        expect(result.output).not.toContain("badCaller")

        // Raw API sees both.
        const rawCallers = CodeIntelligence.findCallers(projectID, callee.id, { scope: "none" })
        expect(rawCallers.length).toBe(2)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findReferences drops references from out-of-worktree files", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const target = seedSymbol(projectID, { name: "Config", kind: "class", base: tmp.path, relFile: "config.ts" })
        const inside = seedSymbol(projectID, { name: "localUser", base: tmp.path, relFile: "user.ts" })
        const outside = seedSymbol(projectID, { name: "foreignUser", base: "/etc", relFile: "foreign.ts" })

        const now = Date.now()
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "references",
          from_node: inside.id,
          to_node: target.id,
          file: inside.file,
          range_start_line: 3,
          range_start_char: 0,
          range_end_line: 3,
          range_end_char: 6,
          time_created: now,
          time_updated: now,
        })
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "references",
          from_node: outside.id,
          to_node: target.id,
          file: outside.file,
          range_start_line: 4,
          range_start_char: 0,
          range_end_line: 4,
          range_end_char: 6,
          time_created: now,
          time_updated: now,
        })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findReferences", symbolID: target.id }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("user.ts")
        expect(result.output).not.toContain("foreign.ts")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

// Semantic Trust v2 §S4: every operation metadata carries an envelope
// stamped with graph provenance.
describe("CodeIntelligence tool envelope (§S4)", () => {
  test("findSymbol metadata includes graph envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, { name: "foo", base: tmp.path })
        CodeGraphQuery.upsertCursor(projectID, "abc", 1, 0)

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "foo" }, ctx)

        const envelope = result.metadata.envelope as {
          source: string
          completeness: string
          timestamp: number
          degraded: boolean
          serverIDs: string[]
        }
        expect(envelope).toBeDefined()
        expect(envelope.source).toBe("graph")
        expect(envelope.completeness).toBe("full")
        expect(envelope.degraded).toBe(false)
        expect(envelope.serverIDs).toEqual([])
        // Existing contract preserved.
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("foo")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("envelope.degraded=true when no cursor exists (interrupted index)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, { name: "bar", base: tmp.path })
        // Intentionally do NOT call upsertCursor — simulates an
        // interrupted indexing run (nodes present, cursor missing).

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "bar" }, ctx)

        const envelope = result.metadata.envelope as { degraded: boolean; source: string }
        expect(envelope.source).toBe("graph")
        expect(envelope.degraded).toBe(true)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("envelope.completeness=empty when no results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        CodeIntelligence.__clearProject(projectID)
        CodeGraphQuery.upsertCursor(projectID, null, 0, 0)

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "does-not-exist" }, ctx)

        const envelope = result.metadata.envelope as { completeness: string }
        expect(envelope.completeness).toBe("empty")
        expect(result.metadata.count).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
