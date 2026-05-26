import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import { CodeIntelligence } from "../../src/code-intelligence"
import { GraphContext } from "../../src/code-intelligence/graph-context"
import { Log } from "../../src/util/log"
import type { ProjectID } from "../../src/project/schema"
import type { CodeNodeKind } from "../../src/code-intelligence/schema.sql"

Log.init({ print: false })

function seedSymbol(
  projectID: ProjectID,
  opts: {
    name: string
    file: string
    kind?: CodeNodeKind
    startLine?: number
    endLine?: number
    signature?: string
  },
) {
  const t = Date.now()
  const id = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id,
    project_id: projectID,
    kind: opts.kind ?? "function",
    name: opts.name,
    qualified_name: opts.name,
    file: opts.file,
    range_start_line: opts.startLine ?? 0,
    range_start_char: 0,
    range_end_line: opts.endLine ?? opts.startLine ?? 0,
    range_end_char: 80,
    signature: opts.signature ?? null,
    visibility: null,
    metadata: null,
    time_created: t,
    time_updated: t,
  })
  CodeGraphQuery.upsertFile({
    id: CodeFileID.ascending(),
    project_id: projectID,
    path: opts.file,
    sha: "seed",
    size: 100,
    lang: "typescript",
    indexed_at: t,
    completeness: "full",
    time_created: t,
    time_updated: t,
  })
  return id
}

function seedCall(projectID: ProjectID, from: CodeNodeID, to: CodeNodeID, file: string) {
  const t = Date.now()
  CodeGraphQuery.insertEdge({
    id: CodeEdgeID.ascending(),
    project_id: projectID,
    kind: "calls",
    from_node: from,
    to_node: to,
    file,
    range_start_line: 4,
    range_start_char: 2,
    range_end_line: 4,
    range_end_char: 24,
    time_created: t,
    time_updated: t,
  })
}

describe("GraphContext.build", () => {
  test("builds a bounded context pack with snippets and LSP provenance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const file = path.join(tmp.path, "server.ts")
        await Bun.write(
          file,
          [
            "export function processPayment() {",
            "  return true",
            "}",
            "export function handleRequest() {",
            "  return processPayment()",
            "}",
          ].join("\n"),
        )

        const callee = seedSymbol(projectID, { name: "processPayment", file, startLine: 0, endLine: 2 })
        const caller = seedSymbol(projectID, { name: "handleRequest", file, startLine: 3, endLine: 5 })
        seedCall(projectID, caller, callee, file)
        CodeGraphQuery.upsertCursor(projectID, "abc", 2, 1)

        const pack = await GraphContext.build(projectID, {
          query: "how does processPayment work",
          maxSymbols: 2,
          maxSnippets: 1,
          scope: "worktree",
        })

        expect(pack.symbols.map((s) => s.name)).toContain("processPayment")
        expect(pack.relationships.some((rel) => rel.kind === "caller" && rel.provenance.source === "lsp")).toBe(true)
        expect(pack.snippets.length).toBe(1)
        expect(pack.output).toContain("Graph Context")
        expect(pack.output).toContain("processPayment")
        expect(pack.envelope.degraded).toBe(false)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("adds framework route and heuristic callback hints with visible provenance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const file = path.join(tmp.path, "routes.ts")
        await Bun.write(
          file,
          [
            "import { router, bus } from './deps'",
            "router.post('/pay', handlePayment)",
            "bus.on('payment.created', handlePayment)",
            "export function handlePayment() {",
            "  return true",
            "}",
          ].join("\n"),
        )

        seedSymbol(projectID, { name: "handlePayment", file, startLine: 3, endLine: 5 })
        CodeGraphQuery.upsertCursor(projectID, "abc", 1, 0)

        const pack = await GraphContext.build(projectID, {
          query: "where is handlePayment route used",
          maxSymbols: 1,
          maxSnippets: 1,
          scope: "worktree",
        })

        expect(pack.frameworkBindings).toHaveLength(1)
        expect(pack.frameworkBindings[0].framework).toBe("express")
        expect(pack.frameworkBindings[0].provenance.source).toBe("framework")
        expect(pack.heuristicBindings.some((binding) => binding.provenance.source === "heuristic")).toBe(true)
        expect(pack.output).toContain("Framework Routes")
        expect(pack.output).toContain("Heuristic Signals")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("keeps out-of-worktree seeds scoped out", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const inside = path.join(tmp.path, "inside.ts")
        await Bun.write(inside, "export function localThing() {}\n")
        seedSymbol(projectID, { name: "localThing", file: inside })
        seedSymbol(projectID, { name: "localThing", file: "/etc/outside.ts" })

        const pack = await GraphContext.build(projectID, {
          query: "localThing",
          maxSymbols: 5,
          scope: "worktree",
        })

        expect(pack.symbols).toHaveLength(1)
        expect(pack.symbols[0].file).toBe(inside)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
