import { execFileSync } from "child_process"
import { afterEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function waitForStableFileContent(file: string, expected: string) {
  const deadline = Date.now() + 7_500
  let last = ""
  let expectedSince = 0

  while (Date.now() < deadline) {
    last = await fs.readFile(file, "utf8").catch(() => "")
    if (last === expected) {
      expectedSince ||= Date.now()
      if (Date.now() - expectedSince >= 1_000) return last
    } else {
      expectedSince = 0
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return last
}

test("create removes the preallocated directory when git worktree add fails", async () => {
  await using tmp = await tmpdir()
  execFileSync("git", ["init"], { cwd: tmp.path, stdio: "pipe" })

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
      const addSandbox = vi.spyOn(Project, "addSandbox").mockRejectedValue(new Error("db unavailable"))

      try {
        await expect(Worktree.create({ name: "db-fail" })).rejects.toThrow("WorktreeCreateFailedError")

        const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
        await expect(fs.stat(path.join(projectRoot, "db-fail"))).rejects.toThrow()

        const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: tmp.path, encoding: "utf-8" })
        expect(list).not.toContain("db-fail")
        const branches = execFileSync("git", ["branch", "--list"], { cwd: tmp.path, encoding: "utf-8" })
        expect(branches).not.toContain("db-fail")
      } finally {
        addSandbox.mockRestore()
      }
    },
  })
})

test("remove surfaces inaccessible target directories", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir({ git: true })
  const locked = path.join(tmp.path, "locked")
  const target = path.join(locked, "sandbox")
  await fs.mkdir(locked)
  await fs.chmod(locked, 0)

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Worktree.remove({ directory: target })).rejects.toMatchObject({ code: "EACCES" })
      },
    })
  } finally {
    await fs.chmod(locked, 0o700)
  }
})

test("runStartScripts fails when the worktree start command fails", async () => {
  await using tmp = await tmpdir()
  const get = vi.spyOn(Project, "get").mockReturnValue({
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
  await fs.writeFile(path.join(tmp.path, "tracked.txt"), "ready\n")
  execFileSync("git", ["add", "tracked.txt"], { cwd: tmp.path, stdio: "pipe" })
  execFileSync("git", ["commit", "-m", "test"], { cwd: tmp.path, stdio: "pipe" })

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

      const content = await waitForStableFileContent(marker, "x")
      expect(content).toBe("x")

      await Worktree.remove({ directory: info.directory })
    },
  })
})
