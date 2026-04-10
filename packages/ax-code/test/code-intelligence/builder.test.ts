import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import {
  CodeGraphBuilder,
  __lookupCallerKind,
  __resolveContainingNodeFromDbForTests as resolveContainingNodeFromDb,
} from "../../src/code-intelligence/builder"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests cover the builder's decision logic in isolation from LSP.
// The full indexing pipeline requires a running LSP server and is covered
// by live smoke-testing against real codebases; here we lock down the
// pure units that previously had zero regression coverage.

function seedNode(
  projectID: ProjectID,
  opts: {
    name: string
    kind?: "function" | "method" | "class" | "module"
    file: string
    startLine?: number
    endLine?: number
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
    range_end_line: opts.endLine ?? 10,
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

describe("builder.resolveContainingNodeFromDb (name-based filtering)", () => {
  // When tsserver emits an anonymous arrow function inside a named method,
  // it reports two nested symbols: the outer named method (e.g. "execute")
  // and an inner symbol called literally "<function>". The pre-fix resolver
  // picked the tighter anonymous one, so findCallers reported calls as
  // "called by <function>" — useless for navigation. The fix skips
  // anonymous containers so the resolver falls through to the enclosing
  // named symbol.

  test("prefers an enclosing named method over a nested anonymous function", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/nested.ts"
        // Outer method spans lines 10-100. Inner anonymous function spans
        // 20-80. Both contain line 50, but the resolver must pick the
        // outer method because the inner one is anonymous.
        const methodId = seedNode(projectID, {
          name: "execute",
          kind: "method",
          file,
          startLine: 10,
          endLine: 100,
        })
        seedNode(projectID, {
          name: "<function>",
          kind: "function",
          file,
          startLine: 20,
          endLine: 80,
        })

        const resolved = resolveContainingNodeFromDb(projectID, file, 50, 5)
        expect(resolved).toBe(methodId)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("still picks the innermost when all candidates are named", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/nested.ts"
        seedNode(projectID, {
          name: "OuterClass",
          kind: "class",
          file,
          startLine: 0,
          endLine: 200,
        })
        const innerId = seedNode(projectID, {
          name: "innerMethod",
          kind: "method",
          file,
          startLine: 50,
          endLine: 80,
        })

        const resolved = resolveContainingNodeFromDb(projectID, file, 60, 0)
        expect(resolved).toBe(innerId)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("returns undefined when the only enclosing symbol is anonymous", async () => {
    // Degenerate case: the only symbol covering the position is a
    // <function>. We'd rather skip the reference edge entirely than
    // point users at an unnavigable anonymous container.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/orphan.ts"
        seedNode(projectID, {
          name: "<function>",
          kind: "function",
          file,
          startLine: 0,
          endLine: 50,
        })

        const resolved = resolveContainingNodeFromDb(projectID, file, 10, 0)
        expect(resolved).toBeUndefined()

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("also skips <unknown> containers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/unknown.ts"
        const outerId = seedNode(projectID, {
          name: "topLevel",
          kind: "function",
          file,
          startLine: 0,
          endLine: 100,
        })
        // <unknown> containers don't match CONTAINER_KINDS in production
        // (they're "variable"), but we test with "function" kind to be
        // sure the name filter catches them even if LSP mis-classifies.
        seedNode(projectID, {
          name: "<unknown>",
          kind: "function",
          file,
          startLine: 10,
          endLine: 90,
        })

        const resolved = resolveContainingNodeFromDb(projectID, file, 50, 0)
        expect(resolved).toBe(outerId)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

// Pre-seed a code_file row for `filePath` whose sha and size match the
// on-disk file. Returns the computed sha so tests can mutate it
// afterwards if they want to break the match. Completeness defaults to
// "full" (which is the only value that triggers the hash-skip fast
// path).
async function writeAndSeedFile(
  projectID: ProjectID,
  filePath: string,
  content: string,
  completeness: "full" | "partial" | "lsp-only" = "full",
): Promise<string> {
  await Bun.write(filePath, content)
  const sha = Bun.hash(content).toString()
  const t = Date.now()
  CodeGraphQuery.upsertFile({
    id: CodeFileID.ascending(),
    project_id: projectID,
    path: filePath,
    sha,
    size: content.length,
    lang: "typescript",
    indexed_at: t,
    completeness,
    time_created: t,
    time_updated: t,
  })
  return sha
}

describe("builder.indexFile hash-skip fast path", () => {
  // These tests exercise the "unchanged" return variant without
  // requiring a live LSP server: they seed a `code_file` row whose
  // sha matches the on-disk file, then confirm the builder short-
  // circuits BEFORE touching LSP. The `timings.lspTouch === 0` check
  // is the load-bearing assertion — if LSP had run, that phase would
  // show non-zero wall clock.

  test("returns unchanged when sha, size, and completeness all match", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "a.ts")
        await writeAndSeedFile(projectID, filePath, "export const foo = 1\n", "full")

        const result = await CodeGraphBuilder.indexFile(projectID, filePath)
        expect(result.completeness).toBe("unchanged")
        expect(result.nodes).toBe(0)
        expect(result.edges).toBe(0)
        // Load-bearing: the fast path must not touch LSP.
        expect(result.timings.lspTouch).toBe(0)
        expect(result.timings.lspDocumentSymbol).toBe(0)
        expect(result.timings.lspReferences).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("does NOT skip files previously indexed with partial completeness", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "partial.ts")
        await writeAndSeedFile(projectID, filePath, "export const x = 2\n", "partial")

        const result = await CodeGraphBuilder.indexFile(projectID, filePath)
        // We don't care what the real completeness ends up as here
        // (it depends on whether an LSP server is available in the
        // test env); we only care that the fast path did NOT fire.
        expect(result.completeness).not.toBe("unchanged")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("does NOT skip files previously indexed with lsp-only completeness", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "lsponly.ts")
        await writeAndSeedFile(projectID, filePath, "export const y = 3\n", "lsp-only")

        const result = await CodeGraphBuilder.indexFile(projectID, filePath)
        expect(result.completeness).not.toBe("unchanged")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("does NOT skip when the stored sha differs from the file content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "drift.ts")
        await Bun.write(filePath, "export const real = 4\n")
        // Seed with a deliberately wrong sha to simulate a file that
        // changed on disk since the last index run.
        const t = Date.now()
        CodeGraphQuery.upsertFile({
          id: CodeFileID.ascending(),
          project_id: projectID,
          path: filePath,
          sha: "stalehash",
          size: 999,
          lang: "typescript",
          indexed_at: t,
          completeness: "full",
          time_created: t,
          time_updated: t,
        })

        const result = await CodeGraphBuilder.indexFile(projectID, filePath)
        expect(result.completeness).not.toBe("unchanged")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("does NOT skip when there is no pre-existing code_file row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "fresh.ts")
        await Bun.write(filePath, "export const z = 5\n")

        const result = await CodeGraphBuilder.indexFile(projectID, filePath)
        expect(result.completeness).not.toBe("unchanged")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("does NOT skip when force is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "force.ts")
        await writeAndSeedFile(projectID, filePath, "export const force = 1\n", "full")

        const result = await CodeGraphBuilder.indexFile(projectID, filePath, { force: true })
        expect(result.completeness).not.toBe("unchanged")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("builder.indexFiles batch behavior", () => {
  test("stats separate unchanged from newly indexed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const a = path.join(tmp.path, "cached.ts")
        const b = path.join(tmp.path, "missing.ts")

        // File A exists and has a matching "full" row — will short-circuit.
        await writeAndSeedFile(projectID, a, "export const cached = 1\n", "full")
        // File B does not exist on disk — indexFileLocked returns
        // { nodes: 0, completeness: "partial" } (the "file does not
        // exist" branch), which the stat loop counts as `skipped`.

        const result = await CodeGraphBuilder.indexFiles(projectID, [a, b], { lock: "none" })
        expect(result.unchanged).toBe(1)
        expect(result.skipped).toBe(1)
        expect(result.files).toBe(0)
        expect(result.failed).toBe(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("onProgress fires once per file with the current file path", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Seed three files that will all hit the hash-skip fast path
        // so the test stays LSP-independent. Concurrency 2 so at
        // least one batch boundary is crossed — ensures the callback
        // works both inside and across batches.
        const files = [path.join(tmp.path, "p1.ts"), path.join(tmp.path, "p2.ts"), path.join(tmp.path, "p3.ts")]
        for (const f of files) await writeAndSeedFile(projectID, f, `export const _${path.basename(f)} = 1\n`, "full")

        const events: Array<{ completed: number; total: number; file?: string }> = []
        const result = await CodeGraphBuilder.indexFiles(projectID, files, {
          lock: "none",
          concurrency: 2,
          onProgress: (completed, total, file) => events.push({ completed, total, file }),
        })

        expect(result.unchanged).toBe(3)
        expect(events.length).toBe(3)
        // Completed counter is monotonic 1..N.
        expect(events.map((e) => e.completed).sort()).toEqual([1, 2, 3])
        // Total stays constant across all callbacks.
        expect(events.every((e) => e.total === 3)).toBe(true)
        // Every callback carries a valid file path from the input set.
        expect(events.every((e) => files.includes(e.file ?? ""))).toBe(true)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("pruneOrphans removes stale files when enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const live = path.join(tmp.path, "live.ts")
        const stale = path.join(tmp.path, "stale.ts")
        await writeAndSeedFile(projectID, live, "export const live = 1\n", "full")
        // Seed `stale` as if a previous run had indexed it, but do
        // NOT write the file to disk — the walker wouldn't include
        // it in `files`. This is the exact scenario prune exists for.
        const t = Date.now()
        CodeGraphQuery.upsertFile({
          id: CodeFileID.ascending(),
          project_id: projectID,
          path: stale,
          sha: "old",
          size: 1,
          lang: "typescript",
          indexed_at: t,
          completeness: "full",
          time_created: t,
          time_updated: t,
        })
        expect(CodeGraphQuery.listFiles(projectID).length).toBe(2)

        const result = await CodeGraphBuilder.indexFiles(projectID, [live], {
          lock: "none",
          pruneOrphans: true,
          pruneScopePrefix: tmp.path,
        })
        expect(result.pruned.files).toBe(1)
        expect(CodeGraphQuery.listFiles(projectID).length).toBe(1)
        expect(CodeGraphQuery.listFiles(projectID)[0].path).toBe(live)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("pruneOrphans disabled leaves stale rows in place", async () => {
    // The watcher path and the auto-indexer never set pruneOrphans.
    // Confirm that omitting it is genuinely a no-op: the watcher
    // calling indexFile on a single saved file must not nuke every
    // other file in the project.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const live = path.join(tmp.path, "live2.ts")
        const stale = path.join(tmp.path, "stale2.ts")
        await writeAndSeedFile(projectID, live, "export const live = 1\n", "full")
        const t = Date.now()
        CodeGraphQuery.upsertFile({
          id: CodeFileID.ascending(),
          project_id: projectID,
          path: stale,
          sha: "old",
          size: 1,
          lang: "typescript",
          indexed_at: t,
          completeness: "full",
          time_created: t,
          time_updated: t,
        })

        const result = await CodeGraphBuilder.indexFiles(projectID, [live], { lock: "none" })
        expect(result.pruned.files).toBe(0)
        expect(CodeGraphQuery.listFiles(projectID).length).toBe(2)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
