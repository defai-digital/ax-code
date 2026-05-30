import { $ } from "bun"
import { afterEach, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("create removes the preallocated directory when git worktree add fails", async () => {
  await using tmp = await tmpdir()
  await $`git init`.cwd(tmp.path).quiet()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.create({ name: "orphan-cleanup" })).rejects.toThrow()

      const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
      await expect(fs.stat(path.join(projectRoot, "orphan-cleanup"))).rejects.toThrow()
    },
  })
})

test("create rolls back the git worktree when sandbox recording fails", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const addSandbox = spyOn(Project, "addSandbox").mockRejectedValue(new Error("db unavailable"))

      try {
        await expect(Worktree.create({ name: "db-fail" })).rejects.toThrow("WorktreeCreateFailedError")

        const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
        await expect(fs.stat(path.join(projectRoot, "db-fail"))).rejects.toThrow()

        const list = await $`git worktree list --porcelain`.cwd(tmp.path).text()
        expect(list).not.toContain("db-fail")
        const branches = await $`git branch --list`.cwd(tmp.path).text()
        expect(branches).not.toContain("db-fail")
      } finally {
        addSandbox.mockRestore()
      }
    },
  })
})

test("runStartScripts fails when the worktree start command fails", async () => {
  await using tmp = await tmpdir()
  const get = spyOn(Project, "get").mockReturnValue({
    id: "project",
    worktree: tmp.path,
    vcs: "git",
    time: { created: Date.now(), updated: Date.now() },
    sandboxes: [],
    commands: {},
  } as any)

  try {
    await expect(
      Worktree.runStartScripts(tmp.path, {
        projectID: "project" as any,
        extra: "exit 7",
      }),
    ).resolves.toBe(false)
  } finally {
    get.mockRestore()
  }
})

test("reset cancels pending bootstrap before queueing start scripts", async () => {
  await using tmp = await tmpdir({ git: true })
  await Bun.write(path.join(tmp.path, "tracked.txt"), "ready\n")
  await $`git add tracked.txt`.cwd(tmp.path).quiet()
  await $`git commit -m test`.cwd(tmp.path).quiet()

  const marker = path.join(tmp.path, "start-count.txt")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Project.update({
        projectID: Instance.project.id,
        commands: { start: `printf x >> ${JSON.stringify(marker)}` },
      })

      const info = await Worktree.create({ name: "reset-cancel" })
      await Worktree.reset({ directory: info.directory })
      await new Promise((resolve) => setTimeout(resolve, 500))

      const content = await fs.readFile(marker, "utf8").catch(() => "")
      expect(content).toBe("x")

      await Worktree.remove({ directory: info.directory })
    },
  })
})
