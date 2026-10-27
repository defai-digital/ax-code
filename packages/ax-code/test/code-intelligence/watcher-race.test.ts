import { afterEach, describe, expect, test, vi } from "vitest"
import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { CodeGraphWatcher } from "../../src/code-intelligence/watcher"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphBuilder } from "../../src/code-intelligence/builder"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { LSP } from "@ax-code/ax-code-intel"
import { hash as bunCompatHash } from "../../src/bun/node-compat"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// Regression tests for the watcher/builder graph-mutation races:
//
//   1. delete-during-reindex — a purge for a file whose reindex was
//      still committing used to be undone when the commit landed,
//      leaving rows (a code_file row + nodes) for a deleted file.
//   2. overlapping change batches — two reindexes for the same file
//      could interleave so the OLDER content committed last.
//
// The builder-layer tests below drive the real indexFiles →
// prepareIndexFile → commitPreparedIndex pipeline with LSP mocked and
// parked on a gate, so the interleaving is deterministic. The
// watcher-layer tests pin the job ordering itself (same path
// serializes, different paths stay concurrent).

afterEach(async () => {
  try {
    await Instance.disposeAll()
  } finally {
    vi.restoreAllMocks()
  }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Yield to the event loop long enough for promise-only chains (the
// watcher's serial queue, job bookkeeping) to settle without relying
// on timers. setImmediate is a macrotask, so every microtask queued
// before it runs first.
async function flushAsync() {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function lspRange(startLine: number, startChar: number, endLine: number, endChar: number) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  }
}

// Mock the documentSymbol/references LSP entry points prepareIndexFile
// uses. documentSymbolEnvelope names its single symbol after whichever
// content is on disk at call time, so commits from different runs are
// identifiable. touchFile is mocked per test — it is where the parked
// LSP wait (the real race window) is simulated.
function mockLspSymbols() {
  const documentSymbol = vi.spyOn(LSP, "documentSymbolEnvelope").mockImplementation(async (uri) => {
    const absPath = new URL(uri).pathname
    const text = await readFile(absPath, "utf-8")
    const name = text.includes("alpha") ? "alpha" : "doomed"
    return {
      data: [
        {
          name,
          kind: 12,
          range: lspRange(0, 0, 0, 30),
          selectionRange: lspRange(0, 15, 0, 21),
        } as any,
      ],
      source: "lsp",
      completeness: "full",
      timestamp: Date.now(),
      serverIDs: ["test-lsp"],
    } as Awaited<ReturnType<typeof LSP.documentSymbolEnvelope>>
  })
  const references = vi.spyOn(LSP, "referencesEnvelope").mockResolvedValue({
    data: [],
    source: "lsp",
    completeness: "full",
    timestamp: Date.now(),
    serverIDs: ["test-lsp"],
  } as Awaited<ReturnType<typeof LSP.referencesEnvelope>>)
  return {
    restore: () => {
      documentSymbol.mockRestore()
      references.mockRestore()
    },
  }
}

function zeroTimings() {
  return {
    readFile: 0,
    lspTouch: 0,
    lspDocumentSymbol: 0,
    symbolWalk: 0,
    lspReferences: 0,
    edgeResolve: 0,
    dbTransaction: 0,
    total: 0,
  }
}

function indexFilesResult() {
  return {
    nodes: 0,
    edges: 0,
    files: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    pruned: { files: 0, nodes: 0, edges: 0 },
    timings: zeroTimings(),
  }
}

describe("builder graph-mutation races", () => {
  test("reindex commit is skipped when the file is deleted mid-index", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = path.join(tmp.path, "doomed.ts")
        await writeFile(file, "export function doomed() {}\n")

        const started = deferred()
        const gate = deferred()
        const touch = vi.spyOn(LSP, "touchFile").mockImplementation(async () => {
          started.resolve()
          await gate.promise
          return 1
        })
        const mocks = mockLspSymbols()

        try {
          // Watcher-style reindex: indexFiles prepares OUTSIDE the
          // project lock, so the delete + purge below interleave with
          // the parked prepare exactly like a real unlink event would.
          const run = CodeGraphBuilder.indexFiles(projectID, [file], { lock: "none", concurrency: 1 })
          await started.promise
          await rm(file)
          await CodeGraphBuilder.purgeFile(projectID, file)
          gate.resolve()
          await run

          // The commit that follows the purge must not resurrect rows
          // for the deleted file.
          expect(CodeGraphQuery.getFile(projectID, file)).toBeUndefined()
          expect(CodeGraphQuery.countNodes(projectID)).toBe(0)
        } finally {
          touch.mockRestore()
          mocks.restore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })

  test("an older overlapping reindex does not overwrite newer content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const file = path.join(tmp.path, "flip.ts")
        const v1 = "export const alpha = 1\n"
        const v2 = "export const beta = 2\n"
        await writeFile(file, v1)

        const started = deferred()
        const gate = deferred()
        let first = true
        const touch = vi.spyOn(LSP, "touchFile").mockImplementation(async () => {
          if (first) {
            first = false
            started.resolve()
            await gate.promise
          }
          return 1
        })
        const mocks = mockLspSymbols()

        try {
          // Run 1 reads v1 and parks in its (mocked) LSP phase.
          const run1 = CodeGraphBuilder.indexFiles(projectID, [file], { lock: "none", concurrency: 1 })
          await started.promise

          // The file is rewritten and a second, overlapping reindex
          // picks the newer content up and commits it first.
          await writeFile(file, v2)
          const run2 = CodeGraphBuilder.indexFiles(projectID, [file], { lock: "none", concurrency: 1 })
          await run2

          // Run 1 finally resumes with its stale content and commits
          // LAST — that commit must be skipped.
          gate.resolve()
          await run1

          const row = CodeGraphQuery.getFile(projectID, file)
          expect(row).toBeDefined()
          // Load-bearing: the stored sha must reflect the NEWER
          // content. Pre-fix, the older run's sha landed last.
          expect(row!.sha).toBe(bunCompatHash(v2).toString())
        } finally {
          touch.mockRestore()
          mocks.restore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })
})

describe("CodeGraphWatcher per-file serialization", () => {
  test("purge for a file waits for that file's in-flight reindex", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const file = path.join(tmp.path, "order.ts")
        await writeFile(file, "export const order = 1\n")

        const order: string[] = []
        const gate = deferred()
        const index = vi.spyOn(CodeGraphBuilder, "indexFiles").mockImplementation(async () => {
          order.push("index:start")
          await gate.promise
          order.push("index:end")
          return indexFilesResult()
        })
        const purge = vi.spyOn(CodeGraphBuilder, "purgeFile").mockImplementation(async () => {
          order.push("purge")
        })

        // Fake only the timers the debounce/flush use; keep Date and
        // performance real for the DB layer.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        try {
          CodeGraphWatcher.start(projectID)

          // Batch 1: change → reindex job parks inside indexFiles.
          await Bus.publish(FileWatcher.Event.Updated, { file, event: "change" })
          await vi.advanceTimersByTimeAsync(1100)
          expect(order).toEqual(["index:start"])

          // Batch 2: the file is deleted while its reindex is parked.
          await Bus.publish(FileWatcher.Event.Updated, { file, event: "unlink" })
          await vi.advanceTimersByTimeAsync(1100)

          // The purge must NOT have run yet: the file's lane is held
          // by the in-flight reindex. Pre-fix the purge job ran in a
          // parallel queue slot and completed while indexFiles was
          // still parked.
          expect(order).toEqual(["index:start"])

          gate.resolve()
          await flushAsync()
          expect(order).toEqual(["index:start", "index:end", "purge"])
        } finally {
          vi.useRealTimers()
          CodeGraphWatcher.stop(projectID)
          index.mockRestore()
          purge.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })

  test("purge for a different file does not wait for an in-flight reindex", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const busy = path.join(tmp.path, "busy.ts")
        const other = path.join(tmp.path, "other.ts")
        await writeFile(busy, "export const busy = 1\n")

        const order: string[] = []
        const gate = deferred()
        const index = vi.spyOn(CodeGraphBuilder, "indexFiles").mockImplementation(async () => {
          order.push("index:start")
          await gate.promise
          order.push("index:end")
          return indexFilesResult()
        })
        const purge = vi
          .spyOn(CodeGraphBuilder, "purgeFile")
          .mockImplementation(async (_projectID: ProjectID, absPath: string) => {
            order.push(`purge:${path.basename(absPath)}`)
          })

        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        try {
          CodeGraphWatcher.start(projectID)

          await Bus.publish(FileWatcher.Event.Updated, { file: busy, event: "change" })
          await vi.advanceTimersByTimeAsync(1100)
          expect(order).toEqual(["index:start"])

          // An unlink for a DIFFERENT file must run immediately —
          // per-file serialization must not degrade into serializing
          // the whole project.
          await Bus.publish(FileWatcher.Event.Updated, { file: other, event: "unlink" })
          await vi.advanceTimersByTimeAsync(1100)
          expect(order).toEqual(["index:start", "purge:other.ts"])

          gate.resolve()
          await flushAsync()
          expect(order).toEqual(["index:start", "purge:other.ts", "index:end"])
        } finally {
          vi.useRealTimers()
          CodeGraphWatcher.stop(projectID)
          index.mockRestore()
          purge.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })
})
