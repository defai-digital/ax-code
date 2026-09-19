import { afterEach, expect, test, vi } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "fs/promises"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema"
import { tmpdir } from "../fixture/fixture"
import * as Git from "../../src/util/git"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

async function initUnbornGit(dir: string) {
  await fs.mkdir(dir, { recursive: true })
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
}

test("skips snapshotting a multi-repo parent instead of staging nested checkouts", async () => {
  await using tmp = await tmpdir()
  await initUnbornGit(path.join(tmp.path, "one"))
  await initUnbornGit(path.join(tmp.path, "two"))
  const gitSpy = vi.spyOn(Git, "git")
  const projectID = ProjectID.make("proj_snapshot_multi_repo")

  await Instance.reload({
    directory: tmp.path,
    worktree: tmp.path,
    project: {
      id: projectID,
      worktree: tmp.path,
      name: "snapshot-multi-repo",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Snapshot.track()).toBeUndefined()
    },
  })

  expect(gitSpy).not.toHaveBeenCalled()
})

test("track excludes a nested unborn git repo instead of aborting", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "tracked.txt"), "ok", "utf-8")
  await initUnbornGit(path.join(tmp.path, "nested"))
  await fs.writeFile(path.join(tmp.path, "nested", "secret.txt"), "nested", "utf-8")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const hash = await Snapshot.track()
      expect(hash).toBeTruthy()
    },
  })
})

test("still snapshots a git worktree opened from a subdirectory of nested clones", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "tracked.txt"), "ok", "utf-8")
  const sub = path.join(tmp.path, "examples")
  await initUnbornGit(path.join(sub, "a"))
  await initUnbornGit(path.join(sub, "b"))

  await Instance.provide({
    directory: sub,
    fn: async () => {
      expect(Instance.worktree).toBe(tmp.path)
      const hash = await Snapshot.track()
      expect(hash).toBeTruthy()
    },
  })
})

test("track fail-opens when git add exits 128 instead of throwing", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "tracked.txt"), "ok", "utf-8")
  const original = Git.git
  vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
    if (args.includes("add")) {
      return {
        exitCode: 128,
        text: () => "",
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("fatal: adding files failed"),
      }
    }
    return original(args, opts)
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Snapshot.track()).resolves.toBeUndefined()
    },
  })
})
