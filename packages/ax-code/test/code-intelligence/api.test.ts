import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests exercise the public CodeIntelligence API by seeding the
// graph directly through the query layer, then asserting on the API's
// return shape. Builder integration tests that go through LSP live in
// a separate file because they require a running language server.

function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "class"
    file?: string
    signature?: string
  },
) {
  const t = Date.now()
  const nodeID = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id: nodeID,
    project_id: projectID,
    kind: opts.kind ?? "function",
    name: opts.name,
    qualified_name: opts.name,
    file: opts.file ?? "/tmp/seed.ts",
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
  // Seed a code_file row so buildExplain finds something meaningful.
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

describe("CodeIntelligence.findSymbol", () => {
  test("returns symbol with explain payload", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        seedSymbol(projectID, { name: "handleRequest", signature: "(req: Request) => Promise<Response>" })

        const results = CodeIntelligence.findSymbol(projectID, "handleRequest")
        expect(results.length).toBe(1)
        const symbol = results[0]
        expect(symbol.name).toBe("handleRequest")
        expect(symbol.kind).toBe("function")
        expect(symbol.signature).toBe("(req: Request) => Promise<Response>")
        expect(symbol.explain.source).toBe("code-graph")
        expect(symbol.explain.completeness).toBe("lsp-only")
        expect(symbol.explain.indexedAt).toBeGreaterThan(0)
        expect(symbol.explain.queryId).toMatch(/^q_/)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("empty result for missing symbol", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const results = CodeIntelligence.findSymbol(projectID, "doesNotExist")
        expect(results).toEqual([])

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("kind filter works via the public API", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        seedSymbol(projectID, { name: "Foo", kind: "class", file: "/tmp/a.ts" })
        seedSymbol(projectID, { name: "Foo", kind: "function", file: "/tmp/b.ts" })

        const classes = CodeIntelligence.findSymbol(projectID, "Foo", { kind: "class" })
        expect(classes.length).toBe(1)
        expect(classes[0].file).toBe("/tmp/a.ts")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("CodeIntelligence.findSymbolByPrefix", () => {
  test("returns all symbols matching the prefix", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        seedSymbol(projectID, { name: "handleRequest" })
        seedSymbol(projectID, { name: "handleResponse" })
        seedSymbol(projectID, { name: "processPayment" })

        const handlers = CodeIntelligence.findSymbolByPrefix(projectID, "handle")
        expect(handlers.length).toBe(2)
        expect(handlers.every((s) => s.name.startsWith("handle"))).toBe(true)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("CodeIntelligence.getSymbol", () => {
  test("retrieves a single symbol by id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const id = seedSymbol(projectID, { name: "getValue" })

        const symbol = CodeIntelligence.getSymbol(projectID, id)
        expect(symbol).not.toBeNull()
        expect(symbol?.name).toBe("getValue")
        expect(symbol?.id).toBe(id)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("returns null for a non-existent id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const fakeId = CodeNodeID.make("cnd_nonexistent")
        const result = CodeIntelligence.getSymbol(projectID, fakeId)
        expect(result).toBeNull()
      },
    })
  })

  test("returns null for a symbol belonging to a different project", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })

    const nodeFromA = await Instance.provide({
      directory: tmpA.path,
      fn: async () => {
        const id = Instance.project.id
        CodeIntelligence.__clearProject(id)
        return seedSymbol(id, { name: "secret" })
      },
    })

    await Instance.provide({
      directory: tmpB.path,
      fn: async () => {
        const projectB = Instance.project.id
        CodeIntelligence.__clearProject(projectB)
        // getSymbol on project B should reject a node belonging to project A.
        const result = CodeIntelligence.getSymbol(projectB, nodeFromA)
        expect(result).toBeNull()
      },
    })
  })
})

describe("CodeIntelligence.symbolsInFile", () => {
  test("returns only symbols in the requested file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        seedSymbol(projectID, { name: "a", file: "/tmp/x.ts" })
        seedSymbol(projectID, { name: "b", file: "/tmp/x.ts" })
        seedSymbol(projectID, { name: "c", file: "/tmp/y.ts" })

        const xs = CodeIntelligence.symbolsInFile(projectID, "/tmp/x.ts")
        expect(xs.length).toBe(2)
        expect(xs.map((s) => s.name).sort()).toEqual(["a", "b"])

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("CodeIntelligence edge-dependent queries", () => {
  test("findReferences returns [] when no edges exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const id = seedSymbol(projectID, { name: "foo" })
        expect(CodeIntelligence.findReferences(projectID, id)).toEqual([])
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallers returns [] when no edges exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const id = seedSymbol(projectID, { name: "foo" })
        expect(CodeIntelligence.findCallers(projectID, id)).toEqual([])
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallees returns [] when no edges exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const id = seedSymbol(projectID, { name: "foo" })
        expect(CodeIntelligence.findCallees(projectID, id)).toEqual([])
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallers returns seeded call edges with the caller symbol", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const callerId = seedSymbol(projectID, { name: "handleRequest", file: "/tmp/server.ts" })
        const calleeId = seedSymbol(projectID, { name: "processPayment", file: "/tmp/payments.ts" })

        // Seed a call edge: handleRequest -[calls]-> processPayment
        const now = Date.now()
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: callerId,
          to_node: calleeId,
          file: "/tmp/server.ts",
          range_start_line: 10,
          range_start_char: 4,
          range_end_line: 10,
          range_end_char: 20,
          time_created: now,
          time_updated: now,
        })

        const callers = CodeIntelligence.findCallers(projectID, calleeId)
        expect(callers.length).toBe(1)
        expect(callers[0].symbol.name).toBe("handleRequest")
        expect(callers[0].symbol.file).toBe("/tmp/server.ts")
        expect(callers[0].depth).toBe(1)
        expect(callers[0].symbol.explain.source).toBe("code-graph")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findCallees returns seeded call edges with the callee symbol", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const callerId = seedSymbol(projectID, { name: "main", file: "/tmp/main.ts" })
        const calleeA = seedSymbol(projectID, { name: "init", file: "/tmp/main.ts" })
        const calleeB = seedSymbol(projectID, { name: "run", file: "/tmp/main.ts" })

        const now = Date.now()
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: callerId,
          to_node: calleeA,
          file: "/tmp/main.ts",
          range_start_line: 2,
          range_start_char: 2,
          range_end_line: 2,
          range_end_char: 8,
          time_created: now,
          time_updated: now,
        })
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: callerId,
          to_node: calleeB,
          file: "/tmp/main.ts",
          range_start_line: 3,
          range_start_char: 2,
          range_end_line: 3,
          range_end_char: 7,
          time_created: now,
          time_updated: now,
        })

        const callees = CodeIntelligence.findCallees(projectID, callerId)
        expect(callees.length).toBe(2)
        const names = callees.map((c) => c.symbol.name).sort()
        expect(names).toEqual(["init", "run"])

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("findReferences returns only 'references' edges, not 'calls' edges", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const targetId = seedSymbol(projectID, { name: "Config", kind: "class" })
        const userId = seedSymbol(projectID, { name: "loadUser", file: "/tmp/user.ts" })

        const now = Date.now()
        // Seed a reference edge (non-call, e.g. type annotation)
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "references",
          from_node: userId,
          to_node: targetId,
          file: "/tmp/user.ts",
          range_start_line: 5,
          range_start_char: 10,
          range_end_line: 5,
          range_end_char: 16,
          time_created: now,
          time_updated: now,
        })
        // And a calls edge to the same target — should NOT show up in findReferences
        CodeGraphQuery.insertEdge({
          id: CodeEdgeID.ascending(),
          project_id: projectID,
          kind: "calls",
          from_node: userId,
          to_node: targetId,
          file: "/tmp/user.ts",
          range_start_line: 6,
          range_start_char: 4,
          range_end_line: 6,
          range_end_char: 10,
          time_created: now,
          time_updated: now,
        })

        const refs = CodeIntelligence.findReferences(projectID, targetId)
        expect(refs.length).toBe(1)
        expect(refs[0].edgeKind).toBe("references")
        expect(refs[0].range.start.line).toBe(5)

        // And findCallers returns the calls edge only
        const callers = CodeIntelligence.findCallers(projectID, targetId)
        expect(callers.length).toBe(1)
        expect(callers[0].symbol.name).toBe("loadUser")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("CodeIntelligence.status", () => {
  test("reports current node and edge counts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Initial status has no cursor row yet
        let s = CodeIntelligence.status(projectID)
        expect(s.nodeCount).toBe(0)
        expect(s.edgeCount).toBe(0)

        seedSymbol(projectID, { name: "a" })
        seedSymbol(projectID, { name: "b" })
        // Manually update the cursor (builder.ts does this after indexing)
        CodeGraphQuery.upsertCursor(projectID, "test-sha", 2, 0)

        s = CodeIntelligence.status(projectID)
        expect(s.nodeCount).toBe(2)
        expect(s.edgeCount).toBe(0)
        expect(s.lastCommitSha).toBe("test-sha")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
