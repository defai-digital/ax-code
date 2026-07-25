import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { AutoIndex } from "../../src/code-intelligence/auto-index"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { Ripgrep } from "../../src/file/ripgrep"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { ProjectID } from "../../src/project/schema"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

let nativeIndexSpy: MockInstance | undefined
let countNodesSpy: MockInstance | undefined
let getCursorSpy: MockInstance | undefined
let filesSpy: MockInstance | undefined
let indexFilesSpy: MockInstance | undefined

afterEach(() => {
  nativeIndexSpy?.mockRestore()
  nativeIndexSpy = undefined
  countNodesSpy?.mockRestore()
  countNodesSpy = undefined
  getCursorSpy?.mockRestore()
  getCursorSpy = undefined
  filesSpy?.mockRestore()
  filesSpy = undefined
  indexFilesSpy?.mockRestore()
  indexFilesSpy = undefined
})

describe("AutoIndex.maybeStart", () => {
  test("runs with fallback concurrency when the native index addon is unavailable", async () => {
    await using tmp = await tmpdir()
    nativeIndexSpy = vi.spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = vi.spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    filesSpy = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "src/example.ts"
    })
    indexFilesSpy = vi.spyOn(CodeIntelligence, "indexFiles").mockResolvedValue({
      nodes: 1,
      edges: 0,
      files: 1,
      unchanged: 0,
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

    await Instance.reload({
      directory: tmp.path,
      worktree: tmp.path,
      project: {
        id: ProjectID.make("proj_auto_index_fallback"),
        worktree: tmp.path,
        name: "auto-index-fallback",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => AutoIndex.maybeStart(ProjectID.make("proj_auto_index_fallback")),
    })

    for (let i = 0; i < 20 && (indexFilesSpy?.mock.calls.length ?? 0) === 0; i++) {
      await sleep(10)
    }

    expect(countNodesSpy).toHaveBeenCalled()
    expect(indexFilesSpy).toHaveBeenCalledWith(
      ProjectID.make("proj_auto_index_fallback"),
      [expect.stringContaining("src/example.ts")],
      expect.objectContaining({
        concurrency: 1,
        lock: "try",
      }),
    )
  })

  test("marks the observable index state failed when every candidate file fails", async () => {
    await using tmp = await tmpdir()
    const projectID = ProjectID.make("proj_auto_index_all_failed")
    nativeIndexSpy = vi.spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = vi.spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    filesSpy = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "src/first.ts"
      yield "src/second.ts"
    })
    indexFilesSpy = vi.spyOn(CodeIntelligence, "indexFiles").mockResolvedValue({
      nodes: 0,
      edges: 0,
      files: 0,
      unchanged: 0,
      skipped: 0,
      failed: 2,
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

    await Instance.reload({
      directory: tmp.path,
      worktree: tmp.path,
      project: {
        id: projectID,
        worktree: tmp.path,
        name: "auto-index-all-failed",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => AutoIndex.maybeStart(projectID),
    })

    for (let i = 0; i < 20 && AutoIndex.getState(projectID).state === "indexing"; i++) {
      await sleep(10)
    }

    expect(AutoIndex.getState(projectID)).toMatchObject({
      state: "failed",
      completed: 2,
      total: 2,
      error: "Indexing failed for all 2 files.",
    })
  })

  test("keeps a visible status when auto-index skips because another process holds the lock", async () => {
    await using tmp = await tmpdir()
    const projectID = ProjectID.make("proj_auto_index_lock_held")
    nativeIndexSpy = vi.spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = vi.spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    filesSpy = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "src/example.ts"
    })
    indexFilesSpy = vi
      .spyOn(CodeIntelligence, "indexFiles")
      .mockRejectedValue(new CodeIntelligence.LockHeldError(projectID))

    await Instance.reload({
      directory: tmp.path,
      worktree: tmp.path,
      project: {
        id: projectID,
        worktree: tmp.path,
        name: "auto-index-lock-held",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => AutoIndex.maybeStart(projectID),
    })

    for (let i = 0; i < 20 && AutoIndex.getState(projectID).state === "indexing"; i++) {
      await sleep(10)
    }

    expect(AutoIndex.getState(projectID)).toMatchObject({
      state: "idle",
      completed: 1,
      total: 1,
      error: "Indexing is already running in another ax-code process.",
    })
  })

  test("does not rerun auto-index when a prior full pass completed with an empty graph", async () => {
    await using tmp = await tmpdir()
    const projectID = ProjectID.make("proj_auto_index_completed_empty")
    const indexedAt = Date.now() - 1_000
    nativeIndexSpy = vi.spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = vi.spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    getCursorSpy = vi.spyOn(CodeGraphQuery, "getCursor").mockReturnValue({
      project_id: projectID,
      commit_sha: null,
      node_count: 0,
      edge_count: 0,
      time_created: indexedAt,
      time_updated: indexedAt,
    })
    filesSpy = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "src/example.ts"
    })
    indexFilesSpy = vi.spyOn(CodeIntelligence, "indexFiles").mockResolvedValue({
      nodes: 1,
      edges: 0,
      files: 1,
      unchanged: 0,
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

    await Instance.reload({
      directory: tmp.path,
      worktree: tmp.path,
      project: {
        id: projectID,
        worktree: tmp.path,
        name: "auto-index-completed-empty",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => AutoIndex.maybeStart(projectID),
    })

    expect(filesSpy).not.toHaveBeenCalled()
    expect(indexFilesSpy).not.toHaveBeenCalled()
    expect(AutoIndex.getState(projectID)).toMatchObject({
      state: "idle",
      completed: 0,
      total: 0,
      finishedAt: indexedAt,
      error: null,
    })
  })

  // The desktop web UI launches its managed `ax-code serve` with cwd set to
  // the home directory. Bulk-indexing there walks the user's entire disk —
  // one observed database carried 2.57M code_node rows for worktree == $HOME.
  test("skips the home directory instead of bulk-indexing it", async () => {
    const projectID = ProjectID.make("proj_auto_index_home")
    countNodesSpy = vi.spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    filesSpy = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "never-scanned.ts"
    })
    indexFilesSpy = vi.spyOn(CodeIntelligence, "indexFiles").mockResolvedValue({
      nodes: 0,
      edges: 0,
      files: 0,
      unchanged: 0,
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

    await Instance.reload({
      directory: Global.Path.home,
      worktree: Global.Path.home,
      project: {
        id: projectID,
        worktree: Global.Path.home,
        name: "auto-index-home",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: Global.Path.home,
      fn: () => AutoIndex.maybeStart(projectID),
    })
    await sleep(30)

    // The guard fires before any graph or filesystem work happens.
    expect(countNodesSpy).not.toHaveBeenCalled()
    expect(filesSpy).not.toHaveBeenCalled()
    expect(indexFilesSpy).not.toHaveBeenCalled()
    expect(AutoIndex.getState(projectID)).toMatchObject({ state: "idle", completed: 0, total: 0 })
  })

  test("purgeHomeDirectoryGraphs clears only home-worktree projects that still hold graph rows", () => {
    const home = Global.Path.home
    const homeProject = { id: ProjectID.make("proj_home_graph"), worktree: home }
    const emptyHomeProject = { id: ProjectID.make("proj_home_graph_empty"), worktree: home }
    const realProject = { id: ProjectID.make("proj_real_graph"), worktree: "/workspace/repo" }
    const listSpy = vi.spyOn(Project, "list").mockReturnValue([homeProject, emptyHomeProject, realProject] as never)
    countNodesSpy = vi
      .spyOn(CodeGraphQuery, "countNodes")
      .mockImplementation((id) => (id === homeProject.id ? 2_574_301 : id === realProject.id ? 12 : 0))
    const clearSpy = vi.spyOn(CodeGraphQuery, "clearProject").mockImplementation(() => {})
    try {
      expect(AutoIndex.purgeHomeDirectoryGraphs()).toBe(1)
      // Only the populated home graph is purged: real projects keep their
      // graphs, and already-empty home projects need no delete.
      expect(clearSpy).toHaveBeenCalledTimes(1)
      expect(clearSpy).toHaveBeenCalledWith(homeProject.id)
    } finally {
      listSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })
})
