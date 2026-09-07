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
})

test("unchanged snapshot trees bypass staging even with an unborn HEAD", async () => {
  await using tmp = await tmpdir({ git: true, init: (dir) => fs.writeFile(path.join(dir, "sample.txt"), "Stable\n") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = await Snapshot.track()
      const git = vi.spyOn(Git, "git")
      expect(await Snapshot.track()).toBe(baseline)
      expect(git.mock.calls.some(([args]) => args.includes("add") || args.includes("write-tree"))).toBe(false)
    },
  })
})

test.each(["diff", "ls-files"])("a failed %s check cannot return an unverified unchanged tree", async (command) => {
  await using tmp = await tmpdir({ git: true, init: (dir) => fs.writeFile(path.join(dir, "sample.txt"), "Stable\n") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const runGit = Git.git
      vi.spyOn(Git, "git").mockImplementation(async (args, options) =>
        args.includes(command)
          ? { exitCode: 128, text: () => "", stdout: Buffer.alloc(0), stderr: Buffer.from("Injected Git failure") }
          : runGit(args, options),
      )
      await expect(Snapshot.track()).rejects.toThrow(
        command === "diff" ? "Snapshot diff failed" : "Snapshot untracked check failed",
      )
    },
  })
})

test("capture sees new files and changes already staged by patch", async () => {
  await using tmp = await tmpdir({ git: true, init: (dir) => fs.writeFile(path.join(dir, "sample.txt"), "Before\n") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "After\n")
      await Snapshot.patch(baseline)
      const changed = await Snapshot.track()
      expect(changed).not.toBe(baseline)
      await fs.writeFile(path.join(tmp.path, "new.txt"), "New\n")
      const added = await Snapshot.track()
      expect(added).not.toBe(changed)
      await Snapshot.restore(baseline)
      expect(await fs.readFile(path.join(tmp.path, "sample.txt"), "utf8")).toBe("Before\n")
      // Restore keeps files that did not exist in the baseline; capture must see them.
      expect(await fs.readFile(path.join(tmp.path, "new.txt"), "utf8")).toBe("New\n")
      expect(await Snapshot.track()).not.toBe(added)
      expect((await Snapshot.patch(baseline)).files).toEqual([path.join(tmp.path, "new.txt").replaceAll("\\", "/")])
      await fs.unlink(path.join(tmp.path, "new.txt"))
      expect(await Snapshot.track()).toBe(baseline)
    },
  })
})

test("capture refreshes worktree excludes before admitting untracked files", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "sample.txt"), "Stable\n")
      await fs.writeFile(path.join(dir, "hidden.txt"), "Hidden\n")
      await fs.writeFile(path.join(dir, ".git", "info", "exclude"), "hidden.txt\n")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, ".git", "info", "exclude"), "")
      const admitted = await Snapshot.track()
      expect(admitted).not.toBe(baseline)
      expect((await Snapshot.patch(baseline)).files).toContain(path.join(tmp.path, "hidden.txt").replaceAll("\\", "/"))
    },
  })
})

test("subdirectory captures keep external edits, deletions and ignore changes visible", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "nested"))
      await fs.writeFile(path.join(dir, "sibling.txt"), "Before\n")
      await fs.writeFile(path.join(dir, ".gitignore"), "ignored.txt\n")
      await fs.writeFile(path.join(dir, "ignored.txt"), "Ignored\n")
    },
  })
  await Instance.provide({
    directory: path.join(tmp.path, "nested"),
    fn: async () => {
      const baseline = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "sibling.txt"), "External edit\n")
      const external = await Snapshot.track()
      expect(external).not.toBe(baseline)
      await fs.unlink(path.join(tmp.path, "sibling.txt"))
      const removed = await Snapshot.track()
      expect(removed).not.toBe(external)
      await fs.writeFile(path.join(tmp.path, ".gitignore"), "")
      expect(await Snapshot.track()).not.toBe(removed)
      const files = (await Snapshot.patch(baseline)).files
      expect(files).toContain(path.join(tmp.path, "ignored.txt").replaceAll("\\", "/"))
      expect(files).toContain(path.join(tmp.path, "sibling.txt").replaceAll("\\", "/"))
    },
  })
})
