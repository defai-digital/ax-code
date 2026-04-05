import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { CodeGraphWatcher } from "../../src/code-intelligence/watcher"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests exercise the Bus-driven debounce + queue logic in
// CodeGraphWatcher directly. They do not require a running LSP server
// because we publish FileWatcher.Event.Updated manually and assert on
// the queue/state behavior. Real end-to-end integration (LSP answers
// → indexFile → DB writes) is covered by the builder tests.

function seedNode(
  projectID: ProjectID,
  opts: { name: string; file: string },
) {
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
})
