import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import * as Git from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

const gitdirFor = () => path.join(Global.Path.data, "snapshot", Instance.project.id)

async function tree(gitdir: string, hash: string, cwd: string) {
  const result = await Git.git(["--git-dir", gitdir, "ls-tree", "-r", "--name-only", hash], { cwd })
  expect(result.exitCode).toBe(0)
  return result.text().split("\n").filter(Boolean)
}

test("staging leaves files above the size cap out of the snapshot", async () => {
  // 0.001 MB is ~1 KB; keeps the fixture tiny while exercising the real cap.
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fs.writeFile(path.join(tmp.path, "small.txt"), "small")
      await fs.writeFile(path.join(tmp.path, "big.bin"), Buffer.alloc(8 * 1024, 1))
      await fs.writeFile(path.join(tmp.path, "odd name 'q'.bin"), Buffer.alloc(8 * 1024, 2))
      const hash = (await Snapshot.track())!
      expect(hash).toBeTruthy()
      const files = await tree(gitdirFor(), hash, tmp.path)
      expect(files).toContain("small.txt")
      expect(files).not.toContain("big.bin")
      expect(files).not.toContain("odd name 'q'.bin")
    },
  })
})

test("a tracked file that grows past the cap keeps its last snapshotted content", async () => {
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "grow.txt")
      await fs.writeFile(file, "small")
      const first = (await Snapshot.track())!
      await fs.writeFile(file, "x".repeat(8 * 1024))
      await fs.writeFile(path.join(tmp.path, "other.txt"), "other")
      const second = (await Snapshot.track())!
      expect(second).toBeTruthy()
      const blob = await Git.git(["--git-dir", gitdirFor(), "cat-file", "blob", `${second}:grow.txt`], {
        cwd: tmp.path,
      })
      expect(blob.text()).toBe("small")
      expect(await tree(gitdirFor(), second, tmp.path)).toContain("other.txt")
      // Rolling back to the first snapshot still restores the original content.
      await Snapshot.revert([{ hash: first, files: [file] }])
      expect(await fs.readFile(file, "utf8")).toBe("small")
    },
  })
})

test("files under the default cap are still snapshotted", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fs.writeFile(path.join(tmp.path, "medium.bin"), Buffer.alloc(2 * 1024 * 1024, 3))
      const hash = (await Snapshot.track())!
      expect(await tree(gitdirFor(), hash, tmp.path)).toContain("medium.bin")
    },
  })
})

test("scheduled cleanup removes stale stranded pack temporaries but keeps fresh ones", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const pack = path.join(gitdirFor(), "objects", "pack")
      await fs.mkdir(pack, { recursive: true })
      const stale = path.join(pack, "tmp_pack_stale1")
      const fresh = path.join(pack, "tmp_pack_fresh1")
      await fs.writeFile(stale, "stranded")
      await fs.writeFile(fresh, "in progress")
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      await fs.utimes(stale, old, old)
      await Snapshot.cleanupScheduled()
      await expect(fs.stat(stale)).rejects.toMatchObject({ code: "ENOENT" })
      await expect(fs.stat(fresh)).resolves.toBeTruthy()
    },
  })
}, 60_000)

test("scheduled cleanup repacks when snapshot refs expire", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "state.txt")
      await fs.writeFile(file, "one")
      const expired = (await Snapshot.track())!
      await fs.writeFile(file, "two")
      await Snapshot.track()
      const gitdir = gitdirFor()
      const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      await fs.writeFile(path.join(gitdir, "ax-code", "snapshots", expired), String(stale.getTime()))
      const original = Git.git
      const commands: string[][] = []
      vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
        commands.push(args)
        return original(args, opts)
      })
      await Snapshot.cleanupScheduled()
      const gc = commands.find((args) => args.includes("gc"))
      expect(gc).toBeTruthy()
      // An expired ref makes its objects reclaimable, so the full gc runs.
      expect(gc).not.toContain("--auto")
      expect(commands.some((args) => args.includes("prune"))).toBe(true)
    },
  })
}, 60_000)

test("scheduled cleanup stays on gc --auto when nothing expired", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const original = Git.git
      const commands: string[][] = []
      vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
        commands.push(args)
        return original(args, opts)
      })
      await Snapshot.cleanupScheduled()
      const gc = commands.find((args) => args.includes("gc"))
      expect(gc).toContain("--auto")
      expect(gc).toContain("gc.auto=1000")
    },
  })
}, 60_000)

test("a new snapshot store carries no sample hooks", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      await expect(fs.stat(path.join(gitdirFor(), "hooks"))).rejects.toMatchObject({ code: "ENOENT" })
    },
  })
})

test("one staging pass admits the smallest files first and defers the rest to the next pass", async () => {
  // 0.003 MB is ~3 KB: room for the two 1 KB files, not the 2 KB one.
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_ADD_MB", "0.003")
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fs.writeFile(path.join(tmp.path, "a.txt"), Buffer.alloc(1024, 1))
      await fs.writeFile(path.join(tmp.path, "b.txt"), Buffer.alloc(1024, 2))
      await fs.writeFile(path.join(tmp.path, "c.txt"), Buffer.alloc(2048, 3))
      const first = (await Snapshot.track())!
      const files = await tree(gitdirFor(), first, tmp.path)
      expect(files).toContain("a.txt")
      expect(files).toContain("b.txt")
      expect(files).not.toContain("c.txt")
      // Already staged files no longer count, so the deferred file is admitted next.
      const second = (await Snapshot.track())!
      expect(await tree(gitdirFor(), second, tmp.path)).toContain("c.txt")
    },
  })
})

test("patch omits a file the turn's baseline excluded from staging, and revert preserves it", async () => {
  // 0.001 MB is ~1 KB: an 8 KB grow.txt is excluded from every staging pass
  // once it grows, so the turn's baseline tree keeps the stale small content.
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
  // The sandbox test runner may have no passwd entry for its uid; an explicit
  // username keeps Config.loadState off the os.userInfo() fallback.
  await using tmp = await tmpdir({ git: true, config: { username: "test" } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "grow.txt")
      await fs.writeFile(file, "small")
      await Snapshot.track()
      const grown = "x".repeat(8 * 1024)
      await fs.writeFile(file, grown)
      // The turn's baseline: staging leaves the oversized file out.
      const before = (await Snapshot.track())!
      expect(before).toBeTruthy()
      // The turn itself only creates a.txt.
      await fs.writeFile(path.join(tmp.path, "a.txt"), "edited")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toEqual([path.join(tmp.path, "a.txt").split(path.sep).join("/")])

      await Snapshot.revert([patch])
      expect(await fs.readFile(file, "utf8")).toBe(grown)
      await expect(fs.access(path.join(tmp.path, "a.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    },
  })
})

test("revert leaves a baseline-excluded file at its current content", async () => {
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
  await using tmp = await tmpdir({ git: true, config: { username: "test" } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "grow.txt")
      await fs.writeFile(file, "small")
      await Snapshot.track()
      const grown = "x".repeat(8 * 1024)
      await fs.writeFile(file, grown)
      const before = (await Snapshot.track())!
      expect(before).toBeTruthy()

      // Even a patch that still names the excluded path must not restore the
      // stale last-staged content over the file's current bytes.
      await Snapshot.revert([{ hash: before!, files: [file] }])

      expect(await fs.readFile(file, "utf8")).toBe(grown)
    },
  })
})

test("patch omits a file the turn's baseline left out of the per-pass budget", async () => {
  // 0.002 MB is ~2 KB: the 8 KB file alone exceeds one staging-pass budget.
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_ADD_MB", "0.002")
  await using tmp = await tmpdir({ git: true, config: { username: "test" } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "grow.txt")
      await fs.writeFile(file, "small")
      await Snapshot.track()
      const grown = "y".repeat(8 * 1024)
      await fs.writeFile(file, grown)
      const before = (await Snapshot.track())!
      expect(before).toBeTruthy()
      await fs.writeFile(path.join(tmp.path, "a.txt"), "edited")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toEqual([path.join(tmp.path, "a.txt").split(path.sep).join("/")])

      await Snapshot.revert([patch])
      expect(await fs.readFile(file, "utf8")).toBe(grown)
    },
  })
})

test("cleanup removes sample hooks from older stores but keeps a hooks directory with real hooks", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const hooks = path.join(gitdirFor(), "hooks")
      await fs.mkdir(hooks, { recursive: true })
      await fs.writeFile(path.join(hooks, "pre-commit.sample"), "#!/bin/sh\n")
      await Snapshot.cleanupScheduled()
      await expect(fs.stat(hooks)).rejects.toMatchObject({ code: "ENOENT" })

      await fs.mkdir(hooks, { recursive: true })
      await fs.writeFile(path.join(hooks, "pre-commit.sample"), "#!/bin/sh\n")
      await fs.writeFile(path.join(hooks, "post-commit"), "#!/bin/sh\n")
      await Snapshot.cleanupScheduled()
      await expect(fs.stat(path.join(hooks, "post-commit"))).resolves.toBeTruthy()
    },
  })
}, 60_000)
