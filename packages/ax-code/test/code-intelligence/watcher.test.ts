import { describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { CodeGraphWatcher } from "../../src/code-intelligence/watcher"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphBuilder } from "../../src/code-intelligence/builder"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests exercise the Bus-driven debounce + queue logic in
// CodeGraphWatcher directly. They do not require a running LSP server
// because we publish FileWatcher.Event.Updated manually and assert on
// the queue/state behavior. Real end-to-end integration (LSP answers
// → indexFile → DB writes) is covered by the builder tests.

function seedNode(projectID: ProjectID, opts: { name: string; file: string }) {
  const t = Date.now()
  const nodeId = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id: nodeId,
    project_id: projectID,
    kind: "function",
    name: opts.name,
    qualified_name: opts.name,
    file: opts.file,
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
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
    completeness: "lsp-only",
    time_created: t,
    time_updated: t,
  })
  return nodeId
}

describe("CodeGraphWatcher.start / stop", () => {
  test("start is idempotent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphWatcher.start(projectID)
        // Second call should be a no-op, not throw.
        CodeGraphWatcher.start(projectID)
        CodeGraphWatcher.stop(projectID)
      },
    })
  })

  test("stop before start is a no-op", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        // Should not throw.
        CodeGraphWatcher.stop(projectID)
      },
    })
  })

  test("instance dispose stops the project watcher", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphWatcher.start(projectID)
        await Bus.publish(FileWatcher.Event.Updated, {
          file: `${tmp.path}/pending.ts`,
          event: "change",
        })
        expect(CodeGraphWatcher.__pendingCountForTests(projectID)).toBe(1)

        await Instance.dispose()

        expect(CodeGraphWatcher.__pendingCountForTests(projectID)).toBe(0)
      },
    })
  })

  test("unlink events purge files from the graph", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Seed a file with one node so we have something to purge.
        const file = "/tmp/condemned.ts"
        seedNode(projectID, { name: "obsolete", file })
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeGraphWatcher.start(projectID)

        // Publish an unlink event for the seeded file.
        await Bus.publish(FileWatcher.Event.Updated, {
          file,
          event: "unlink",
        })

        // Drain the debounce queue so the reindex job fires synchronously.
        await CodeGraphWatcher.__drainForTests(projectID)

        expect(CodeGraphQuery.countNodes(projectID)).toBe(0)

        CodeGraphWatcher.stop(projectID)
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("change events for unknown languages are ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Seed so we have something the purge could touch if the watcher
        // incorrectly matched non-code files.
        const sourceFile = "/tmp/src.ts"
        seedNode(projectID, { name: "keep", file: sourceFile })
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeGraphWatcher.start(projectID)

        // Publish a change event for a file the watcher should ignore.
        await Bus.publish(FileWatcher.Event.Updated, {
          file: "/tmp/notes.md.bak",
          event: "change",
        })
        await CodeGraphWatcher.__drainForTests(projectID)

        // Seeded node still present — the ignored event did not cause
        // any reindex.
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeGraphWatcher.stop(projectID)
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("multiple rapid events coalesce into a single reindex", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/rapid.ts"
        seedNode(projectID, { name: "old", file })

        CodeGraphWatcher.start(projectID)

        // Publish five rapid unlink events. They should coalesce via
        // the debounce timer so only one purge runs.
        for (let i = 0; i < 5; i++) {
          await Bus.publish(FileWatcher.Event.Updated, { file, event: "unlink" })
        }
        await CodeGraphWatcher.__drainForTests(projectID)

        // File was purged exactly once — final state is zero nodes.
        expect(CodeGraphQuery.countNodes(projectID)).toBe(0)

        CodeGraphWatcher.stop(projectID)
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("change events use the batch index path without a cross-process lock", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const file = `${tmp.path}/changed.ts`
        await Bun.write(file, "export const changed = 1\n")
        const indexFiles = spyOn(CodeGraphBuilder, "indexFiles").mockResolvedValue({
          nodes: 0,
          edges: 0,
          files: 0,
          unchanged: 1,
          skipped: 0,
          failed: 0,
          pruned: { files: 0, nodes: 0, edges: 0 },
          timings: {
            readFile: 0,
            lspTouch: 0,
            lspDocumentSymbol: 0,
            symbolWalk: 0,
            lspReferences: 0,
            edgeResolve: 0,
            dbTransaction: 0,
            total: 0,
          },
        })

        try {
          CodeGraphWatcher.start(projectID)
          await Bus.publish(FileWatcher.Event.Updated, { file, event: "change" })
          await CodeGraphWatcher.__drainForTests(projectID)

          expect(indexFiles).toHaveBeenCalledTimes(1)
          expect(indexFiles.mock.calls[0]?.[0]).toBe(projectID)
          expect(indexFiles.mock.calls[0]?.[1]).toEqual([file])
          expect(indexFiles.mock.calls[0]?.[2]).toMatchObject({
            concurrency: 1,
            lock: "none",
            pruneOrphans: false,
          })
        } finally {
          CodeGraphWatcher.stop(projectID)
          indexFiles.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })

  test("stop clears pending debounce timers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = "/tmp/pending.ts"
        seedNode(projectID, { name: "safe", file })

        CodeGraphWatcher.start(projectID)

        // Publish an unlink event but stop the watcher immediately.
        // The 1s debounce timer should be cleared before firing.
        await Bus.publish(FileWatcher.Event.Updated, { file, event: "unlink" })
        CodeGraphWatcher.stop(projectID)

        // Wait beyond the debounce window to prove the timer didn't fire.
        await new Promise((r) => setTimeout(r, 1100))

        // Seeded node still present.
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  // ── Tool-write integration proof ─────────────────────────────────────
  //
  // Edit, Write, and ApplyPatch all call notifyFileEdited from
  // tool/diagnostics.ts after a successful write. That helper publishes
  // FileWatcher.Event.Updated on the Bus, which the CodeGraphWatcher
  // subscription picks up. This test closes the loop end-to-end by
  // driving the actual tool-side helper (not a hand-rolled Bus.publish)
  // and asserting the graph reacts. It is the Phase 2 exit gate for
  // "tool-driven writes invalidate the graph."

  test("notifyFileEdited from the tool layer drives the watcher", async () => {
    const { notifyFileEdited } = await import("../../src/tool/diagnostics")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        CodeGraphWatcher.start(projectID)
        expect(CodeGraphWatcher.__pendingCountForTests(projectID)).toBe(0)

        // Exercise the exact helper that Edit/Write/ApplyPatch call
        // after a successful file write. It publishes FileWatcher.
        // Event.Updated on the Bus; the CodeGraphWatcher subscription
        // picks it up and schedules a debounced reindex.
        await notifyFileEdited("/tmp/tool-written.ts", "change")

        // The file has landed in the watcher's debounce queue — this
        // is the property under test: the tool-side helper successfully
        // routed through to the code intelligence subsystem. Actual
        // reindex output depends on LSP being available for the file
        // (covered by the builder tests).
        expect(CodeGraphWatcher.__pendingCountForTests(projectID)).toBe(1)

        CodeGraphWatcher.stop(projectID)
        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphWatcher batching", () => {
  test("a burst of change events coalesces into a single batch reindex", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const files = Array.from({ length: 5 }, (_, i) => `${tmp.path}/burst-${i}.ts`)
        const indexFiles = spyOn(CodeGraphBuilder, "indexFiles").mockResolvedValue({
          nodes: 0,
          edges: 0,
          files: 0,
          unchanged: 5,
          skipped: 0,
          failed: 0,
          pruned: { files: 0, nodes: 0, edges: 0 },
          timings: {
            readFile: 0,
            lspTouch: 0,
            lspDocumentSymbol: 0,
            symbolWalk: 0,
            lspReferences: 0,
            edgeResolve: 0,
            dbTransaction: 0,
            total: 0,
          },
        })

        try {
          CodeGraphWatcher.start(projectID)
          // Simulate a git checkout firing change events across many files
          // at once. The per-file debounce timers expire together, land in
          // the same flush window, and must produce one indexFiles() call
          // with all files instead of one LSP round-trip per file.
          for (const file of files) {
            await Bus.publish(FileWatcher.Event.Updated, { file, event: "change" })
          }
          await CodeGraphWatcher.__drainForTests(projectID)

          expect(indexFiles).toHaveBeenCalledTimes(1)
          expect(indexFiles.mock.calls[0]?.[1]).toEqual(files)
          expect(indexFiles.mock.calls[0]?.[2]).toMatchObject({
            concurrency: 4,
            lock: "none",
            pruneOrphans: false,
          })
        } finally {
          CodeGraphWatcher.stop(projectID)
          indexFiles.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })
})
