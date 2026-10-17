import { afterEach, expect, test, vi } from "vitest"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WorktreeCreateTool, WorktreeListTool, WorktreeRemoveTool } from "../../src/tool/worktree"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "../../src/tool/tool"

type Executed = Awaited<ReturnType<Tool.Info["init"]>>["execute"]

function ctxStub() {
  return {
    ask: vi.fn(async () => undefined),
    metadata: () => undefined,
    sessionID: "test" as never,
    messageID: "test" as never,
    agent: "test",
    abort: new AbortController().signal,
    messages: [],
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("worktree_list returns no worktrees on a fresh git project", async () => {
  // `Worktree.list` enumerates project sandboxes; the main checkout is
  // recorded as the project, not a sandbox, so a fresh project has count 0.
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const init = await WorktreeListTool.init()
      const result = await (init.execute as Executed)({}, ctxStub())
      expect(result.metadata).toMatchObject({ action: "list", count: 0 })
      expect(result.output).toBe("No worktrees.")
    },
  })
})

test("worktree_list reports notGit on a non-git project", async () => {
  await using tmp = await tmpdir({ config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const init = await WorktreeListTool.init()
      const result = await (init.execute as Executed)({}, ctxStub())
      expect(result.metadata).toMatchObject({ action: "list", notGit: true })
      expect(result.output).toContain("Worktrees are only supported for git projects")
    },
  })
})

test("worktree_create asks permission, returns directory/branch/name, and calls Worktree.createReady", async () => {
  // ADR-243: the tool calls `Worktree.createReady`. The sandbox cannot run
  // the start-scripts bootstrap (see test/tool/task-parallel-worktree.test.ts
  // for the same limitation), so the test stubs createReady to return a
  // hand-built Info and verifies the registered sandbox path independently.
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const fakeInfo: Worktree.Info = {
        name: "drafts",
        branch: "ax-code/drafts",
        directory: path.join(tmp.path, ".external-worktrees", "drafts"),
      }
      const createReady = vi.spyOn(Worktree, "createReady").mockResolvedValue(fakeInfo)
      const ctx = ctxStub()
      try {
        const init = await WorktreeCreateTool.init()
        const result = await (init.execute as Executed)({ name: "drafts" }, ctx)
        expect(result.metadata).toMatchObject({
          action: "create",
          name: "drafts",
          branch: "ax-code/drafts",
          directory: fakeInfo.directory,
        })
        expect(ctx.ask).toHaveBeenCalledOnce()
        expect(createReady).toHaveBeenCalledOnce()
      } finally {
        createReady.mockRestore()
      }
    },
  })
})

test("worktree_create reports notGit on a non-git project without asking", async () => {
  await using tmp = await tmpdir({ config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ctx = ctxStub()
      const init = await WorktreeCreateTool.init()
      const result = await (init.execute as Executed)({ name: "drafts" }, ctx)
      expect(result.metadata).toMatchObject({ action: "create", notGit: true })
      expect(ctx.ask).not.toHaveBeenCalled()
    },
  })
})

test("worktree_create propagates a non-git error from createReady as a notGit result", async () => {
  // Defensive: if `Worktree.createReady` ever throws the typed
  // `NotGitError` (e.g. vcs flips mid-call), the tool must surface the
  // standard notGit message rather than a raw error.
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const notGitError = Object.assign(new Error("Worktrees are only supported for git projects"), {
        name: "WorktreeNotGitError",
      })
      const createReady = vi.spyOn(Worktree, "createReady").mockRejectedValue(notGitError)
      const ctx = ctxStub()
      try {
        const init = await WorktreeCreateTool.init()
        const result = await (init.execute as Executed)({ name: "drafts" }, ctx)
        expect(result.metadata).toMatchObject({ action: "create", notGit: true })
        expect(result.output).toContain("Worktrees are only supported for git projects")
      } finally {
        createReady.mockRestore()
      }
    },
  })
})

test("worktree_remove refuses a directory that is not in the worktree list", async () => {
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ctx = ctxStub()
      const init = await WorktreeRemoveTool.init()
      const result = await (init.execute as Executed)({ directory: "/tmp/does-not-exist" }, ctx)
      expect(result.metadata).toMatchObject({ action: "remove", found: false })
      expect(ctx.ask).not.toHaveBeenCalled()
    },
  })
})

test("worktree_remove refuses the main worktree directory", async () => {
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ctx = ctxStub()
      const init = await WorktreeRemoveTool.init()
      const result = await (init.execute as Executed)({ directory: tmp.path }, ctx)
      expect(result.metadata).toMatchObject({ action: "remove", found: false })
      expect(ctx.ask).not.toHaveBeenCalled()
    },
  })
})

test("worktree_remove asks permission, calls Worktree.remove, and returns removed:true for a known worktree", async () => {
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Pre-populate the registry so the tool sees a match without
      // running the createReady bootstrap.
      const sandboxDir = path.join(tmp.path, ".external-worktrees", "throwaway")
      const listSpy = vi.spyOn(Worktree, "list").mockResolvedValue([
        {
          name: "throwaway",
          directory: sandboxDir,
          branch: "ax-code/throwaway",
        },
      ])
      const removeSpy = vi.spyOn(Worktree, "remove").mockResolvedValue(true as never)
      const ctx = ctxStub()
      try {
        const init = await WorktreeRemoveTool.init()
        const result = await (init.execute as Executed)({ directory: sandboxDir }, ctx)
        expect(result.metadata).toMatchObject({
          action: "remove",
          name: "throwaway",
          directory: sandboxDir,
          removed: true,
        })
        expect(ctx.ask).toHaveBeenCalledOnce()
        expect(removeSpy).toHaveBeenCalledWith({ directory: sandboxDir })
      } finally {
        listSpy.mockRestore()
        removeSpy.mockRestore()
      }
    },
  })
})

test("worktree_remove surfaces a remove failure as a typed result, not a thrown error", async () => {
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sandboxDir = path.join(tmp.path, ".external-worktrees", "throwaway")
      const listSpy = vi.spyOn(Worktree, "list").mockResolvedValue([
        {
          name: "throwaway",
          directory: sandboxDir,
          branch: "ax-code/throwaway",
        },
      ])
      const removeSpy = vi.spyOn(Worktree, "remove").mockRejectedValue(new Error("git worktree remove failed"))
      const ctx = ctxStub()
      try {
        const init = await WorktreeRemoveTool.init()
        const result = await (init.execute as Executed)({ directory: sandboxDir }, ctx)
        expect(result.metadata).toMatchObject({
          action: "remove",
          directory: sandboxDir,
          error: "git worktree remove failed",
        })
        expect(ctx.ask).toHaveBeenCalledOnce()
      } finally {
        listSpy.mockRestore()
        removeSpy.mockRestore()
      }
    },
  })
})

test("worktree_remove reports notGit on a non-git project without asking", async () => {
  await using tmp = await tmpdir({ config: { username: "testuser" } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ctx = ctxStub()
      const init = await WorktreeRemoveTool.init()
      const result = await (init.execute as Executed)({ directory: "/tmp/does-not-exist" }, ctx)
      expect(result.metadata).toMatchObject({ action: "remove", notGit: true })
      expect(ctx.ask).not.toHaveBeenCalled()
    },
  })
})
