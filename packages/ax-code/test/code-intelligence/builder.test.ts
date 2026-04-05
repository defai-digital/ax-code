import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { __lookupCallerKind } from "../../src/code-intelligence/builder"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests cover the builder's decision logic in isolation from LSP.
// The full indexing pipeline requires a running LSP server and is covered
// by live smoke-testing against real codebases; here we lock down the
// pure units that previously had zero regression coverage.

function seedNode(
  projectID: ProjectID,
  opts: { name: string; kind?: "function" | "method" | "class" | "module"; file: string },
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
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 10,
    range_end_char: 0,
    signature: null,
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
    size: 0,
    lang: "typescript",
    indexed_at: t,
    completeness: "full",
    time_created: t,
    time_updated: t,
  })
  return id
}

describe("builder.__lookupCallerKind", () => {
  // Regression: the pre-fix builder only consulted the in-memory
  // refBookmarks to decide whether a caller was callable. Cross-file
  // callers were never in refBookmarks (those bookmarks only cover the
  // file being currently indexed), so every cross-file call site was
  // silently downgraded to a plain "references" edge and findCallers
  // returned 0 on any real-scale index. This test locks in the fix.

  test("returns the kind from refBookmarks for same-file callers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const callerId = CodeNodeID.ascending()
        const bookmarks = [{ nodeId: callerId, kind: "function" as const }]

        const kind = __lookupCallerKind(projectID, callerId, true, bookmarks)
        expect(kind).toBe("function")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("returns the kind from the DB for cross-file callers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Node lives in a different file from the one being indexed.
        // Simulates: builder is currently indexing file A, found a
        // reference in file B, and needs to look up file B's caller
        // kind from what's already in the DB.
        const callerId = seedNode(projectID, { name: "doThing", kind: "function", file: "/tmp/b.ts" })

        // refBookmarks is empty — it only contains the file currently
        // being indexed, which is not where the caller lives.
        const kind = __lookupCallerKind(projectID, callerId, false, [])
        expect(kind).toBe("function")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("returns undefined when the caller is not in the DB", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const phantomId = CodeNodeID.ascending()
        const kind = __lookupCallerKind(projectID, phantomId, false, [])
        expect(kind).toBeUndefined()

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("cross-file lookup finds method kind (not just function)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const callerId = seedNode(projectID, { name: "process", kind: "method", file: "/tmp/klass.ts" })
        const kind = __lookupCallerKind(projectID, callerId, false, [])
        // Methods are callable — the isCallable check downstream will
        // accept this and emit a calls edge. If this regresses to only
        // "function", we'd drop every method-to-method call edge.
        expect(kind).toBe("method")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("cross-file lookup ignores the refBookmarks argument", async () => {
    // Sanity: when sameFile=false, the bookmark array is not consulted
    // even if it happens to contain the target id. We want the DB to
    // be the source of truth for cross-file so stale bookmarks (e.g.
    // from a previous indexing batch that left them attached) can't
    // shadow the real answer.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const id = seedNode(projectID, { name: "real", kind: "method", file: "/tmp/a.ts" })
        // Bookmark claims the node is a class — but we should trust
        // the DB, which knows it's a method.
        const bookmarks = [{ nodeId: id, kind: "class" as const }]
        const kind = __lookupCallerKind(projectID, id, false, bookmarks)
        expect(kind).toBe("method")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
