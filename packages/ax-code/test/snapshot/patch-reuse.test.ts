import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import * as Git from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

const abs = (root: string, file: string) => path.join(root, file).split(path.sep).join("/")

test("patch fromTrack diffs the freshly tracked tree without restaging", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "kept.txt"), "kept\n")
      await fs.writeFile(path.join(dir, "changed.txt"), "before\n")
      await fs.writeFile(path.join(dir, "removed.txt"), "gone\n")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "changed.txt"), "after\n")
      await fs.writeFile(path.join(tmp.path, "created.txt"), "new\n")
      await fs.unlink(path.join(tmp.path, "removed.txt"))
      const tracked = (await Snapshot.track())!
      expect(tracked).not.toBe(baseline)
      const git = vi.spyOn(Git, "git")
      const patch = await Snapshot.patch(baseline, { fromTrack: tracked })
      expect([...patch.files].sort()).toEqual(
        [abs(tmp.path, "changed.txt"), abs(tmp.path, "created.txt"), abs(tmp.path, "removed.txt")].sort(),
      )
      // Exactly one git process: the tree-to-tree name diff. The staging pass
      // (untracked scan, diff-files, git add) track() just performed is not
      // repeated, where the staged path costs four.
      expect(git.mock.calls.length).toBe(1)
      expect(git.mock.calls.some(([args]) => args.includes("diff"))).toBe(true)
      expect(git.mock.calls.some(([args]) => args.includes("add") || args.includes("write-tree"))).toBe(false)
      expect(git.mock.calls.some(([args]) => args.includes("ls-files"))).toBe(false)
    },
  })
})

test("patch fromTrack matches the staged worktree diff for every change kind", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "changed.txt"), "before\n")
      await fs.writeFile(path.join(dir, "removed.txt"), "gone\n")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "changed.txt"), "after\n")
      await fs.writeFile(path.join(tmp.path, "created.txt"), "new\n")
      await fs.unlink(path.join(tmp.path, "removed.txt"))
      const tracked = (await Snapshot.track())!
      const fast = await Snapshot.patch(baseline, { fromTrack: tracked })
      const git = vi.spyOn(Git, "git")
      const full = await Snapshot.patch(baseline)
      expect(git.mock.calls.some(([args]) => args.includes("add"))).toBe(true)
      expect([...full.files].sort()).toEqual([...fast.files].sort())
    },
  })
})

test("paths the baseline excluded stay out of the fromTrack patch", async () => {
  vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "stable.txt"), "v1\n")
      await fs.writeFile(path.join(dir, "big.bin"), Buffer.alloc(8 * 1024, 1))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "stable.txt"), "v2\n")
      await fs.writeFile(path.join(tmp.path, "big.bin"), Buffer.alloc(8 * 1024, 7))
      const tracked = (await Snapshot.track())!
      const git = vi.spyOn(Git, "git")
      const fast = await Snapshot.patch(baseline, { fromTrack: tracked })
      expect(git.mock.calls.length).toBe(1)
      const full = await Snapshot.patch(baseline)
      expect(fast.files).toEqual([abs(tmp.path, "stable.txt")])
      expect([...full.files].sort()).toEqual([...fast.files].sort())
    },
  })
})

test("a path only the fresh capture excludes still reaches the fromTrack patch", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "grow.txt"), "small\n")
      await fs.writeFile(path.join(dir, "note.txt"), "v1\n")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      // grow.txt is admitted by the baseline at the default cap, then grows
      // past the stubbed cap so only the fresh capture excludes it.
      vi.stubEnv("AX_CODE_SNAPSHOT_MAX_FILE_MB", "0.001")
      await fs.writeFile(path.join(tmp.path, "grow.txt"), "x".repeat(8 * 1024))
      await fs.writeFile(path.join(tmp.path, "note.txt"), "v2\n")
      const tracked = (await Snapshot.track())!
      const git = vi.spyOn(Git, "git")
      const fast = await Snapshot.patch(baseline, { fromTrack: tracked })
      // Tree-to-tree diff plus one bounded worktree re-check of grow.txt.
      expect(git.mock.calls.length).toBe(2)
      const full = await Snapshot.patch(baseline)
      expect([...fast.files].sort()).toEqual([abs(tmp.path, "grow.txt"), abs(tmp.path, "note.txt")].sort())
      expect([...full.files].sort()).toEqual([...fast.files].sort())
    },
  })
})

test("a superseded fromTrack falls back to the staged worktree diff", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "first.txt"), "v1\n")
      await fs.writeFile(path.join(dir, "second.txt"), "v1\n")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "first.txt"), "v2\n")
      const first = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "second.txt"), "v2\n")
      await Snapshot.track()
      const git = vi.spyOn(Git, "git")
      const patch = await Snapshot.patch(baseline, { fromTrack: first })
      expect(git.mock.calls.some(([args]) => args.includes("add"))).toBe(true)
      expect([...patch.files].sort()).toEqual([abs(tmp.path, "first.txt"), abs(tmp.path, "second.txt")].sort())
    },
  })
})

test("fromTrack equal to the baseline keeps the live unchanged short-circuit", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: (dir) => fs.writeFile(path.join(dir, "sample.txt"), "Stable\n"),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      expect(await Snapshot.track()).toBe(baseline)
      const git = vi.spyOn(Git, "git")
      const patch = await Snapshot.patch(baseline, { fromTrack: baseline })
      expect(patch).toEqual({ hash: baseline, files: [] })
      expect(git.mock.calls.some(([args]) => args.includes("add") || args.includes("write-tree"))).toBe(false)
    },
  })
})

test("restore invalidates the fresh capture for fromTrack reuse", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: (dir) => fs.writeFile(path.join(dir, "file.txt"), "before\n"),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "file.txt"), "after\n")
      const tracked = (await Snapshot.track())!
      await Snapshot.restore(baseline)
      expect(await fs.readFile(path.join(tmp.path, "file.txt"), "utf8")).toBe("before\n")
      const git = vi.spyOn(Git, "git")
      const patch = await Snapshot.patch(baseline, { fromTrack: tracked })
      // The restored worktree matches the baseline; a stale tree diff would
      // still report file.txt, so this proves the fallback ran.
      expect(patch.files).toEqual([])
      expect(git.mock.calls.some(([args]) => args.includes("add"))).toBe(true)
    },
  })
})

test("revert invalidates the fresh capture for fromTrack reuse", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: (dir) => fs.writeFile(path.join(dir, "file.txt"), "before\n"),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "file.txt"), "after\n")
      const tracked = (await Snapshot.track())!
      await Snapshot.revert([{ hash: baseline, files: [abs(tmp.path, "file.txt")] }])
      expect(await fs.readFile(path.join(tmp.path, "file.txt"), "utf8")).toBe("before\n")
      const git = vi.spyOn(Git, "git")
      const patch = await Snapshot.patch(baseline, { fromTrack: tracked })
      expect(patch.files).toEqual([])
      expect(git.mock.calls.some(([args]) => args.includes("add"))).toBe(true)
    },
  })
})
