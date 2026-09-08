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

test("diffFull preserves order, statuses and contents for mixed changes", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      for (const name of ["a.txt", "b.txt", "c.txt"]) await fs.writeFile(path.join(dir, name), `${name} v1\n`)
      await fs.writeFile(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const from = (await Snapshot.track())!
      await fs.writeFile(path.join(tmp.path, "a.txt"), "a.txt v2\nsecond line\n")
      await fs.rm(path.join(tmp.path, "b.txt"))
      await fs.writeFile(path.join(tmp.path, "e.txt"), "e.txt new\n")
      await fs.writeFile(path.join(tmp.path, "bin.dat"), Buffer.from([9, 9, 9]))
      const to = (await Snapshot.track())!
      const diffs = await Snapshot.diffFull(from, to)
      expect(diffs.length).toBe(4)
      const byFile = new Map(diffs.map((item) => [item.file, item]))
      expect(byFile.get("a.txt")).toMatchObject({
        status: "modified",
        before: "a.txt v1\n",
        after: "a.txt v2\nsecond line\n",
        additions: 2,
        deletions: 1,
      })
      expect(byFile.get("b.txt")).toMatchObject({ status: "deleted", before: "b.txt v1\n", after: "" })
      expect(byFile.get("c.txt")).toBeUndefined()
      expect(byFile.get("e.txt")).toMatchObject({ status: "added", before: "", after: "e.txt new\n" })
      expect(byFile.get("bin.dat")).toMatchObject({ status: "modified", before: "", after: "" })
    },
  })
})

test("diffFull fetches per-file content with bounded concurrency", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      for (let i = 0; i < 8; i++) await fs.writeFile(path.join(dir, `f${i}.txt`), `f${i} v1\n`)
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const from = (await Snapshot.track())!
      for (let i = 0; i < 8; i++) await fs.writeFile(path.join(tmp.path, `f${i}.txt`), `f${i} v2\n`)
      const to = (await Snapshot.track())!

      // The per-file fetch runs show(from) and show(to) as a pair; a fully
      // sequential loop peaks at 2 concurrent git calls. File-level bounded
      // concurrency must exceed that peak.
      const real = Git.git
      let active = 0
      let peak = 0
      vi.spyOn(Git, "git").mockImplementation(async (args, options) => {
        active++
        peak = Math.max(peak, active)
        try {
          return await real(args, options)
        } finally {
          active--
        }
      })
      const diffs = await Snapshot.diffFull(from, to)
      expect(diffs.length).toBe(8)
      expect(diffs.every((item) => item.status === "modified")).toBe(true)
      expect(peak).toBeGreaterThan(2)
    },
  })
})
