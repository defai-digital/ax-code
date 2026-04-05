import { describe, expect, test } from "bun:test"
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

function seedSymbol(
  projectID: ProjectID,
  opts: { name: string; kind?: "function" | "class"; file?: string; signature?: string },
) {
  const t = Date.now()
  const id = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id,
    project_id: projectID,
    kind: opts.kind ?? "function",
    name: opts.name,
    qualified_name: opts.name,
    file: opts.file ?? "/tmp/t.ts",
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
    path: opts.file ?? "/tmp/t.ts",
    sha: "seed",
    size: 0,
    lang: "typescript",
    indexed_at: t,
    completeness: "full",
    time_created: t,
    time_updated: t,
  })
  return id
}

describe("tool.code_intelligence", () => {
  test("findSymbol returns formatted symbol line", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, { name: "handleRequest", signature: "(req: Request) => Promise<Response>" })

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
        seedSymbol(projectID, { name: "Foo", kind: "class", file: "/tmp/a.ts" })
        seedSymbol(projectID, { name: "Foo", kind: "function", file: "/tmp/b.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findSymbol", name: "Foo", kind: "class" }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("/tmp/a.ts")
        expect(result.output).not.toContain("/tmp/b.ts")

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
        seedSymbol(projectID, { name: "handleRequest" })
        seedSymbol(projectID, { name: "handleResponse" })
        seedSymbol(projectID, { name: "processPayment" })

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
        seedSymbol(projectID, { name: "a", file: "/tmp/x.ts" })
        seedSymbol(projectID, { name: "b", file: "/tmp/x.ts" })
        seedSymbol(projectID, { name: "c", file: "/tmp/y.ts" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "symbolsInFile", file: "/tmp/x.ts" }, ctx)
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

        const callerId = seedSymbol(projectID, { name: "handleRequest", file: "/tmp/server.ts" })
        const calleeId = seedSymbol(projectID, { name: "processPayment", file: "/tmp/pay.ts" })
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

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findCallers", symbolID: calleeId }, ctx)
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
        const id = seedSymbol(projectID, { name: "orphan" })

        const tool = await CodeIntelligenceTool.init()
        const result = await tool.execute({ operation: "findReferences", symbolID: id }, ctx)
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
        await expect(
          tool.execute({ operation: "findReferences" } as never, ctx),
        ).rejects.toThrow("findReferences requires `symbolID`")
      },
    })
  })
})
