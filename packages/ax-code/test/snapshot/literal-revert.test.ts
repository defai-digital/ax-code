import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

test.each([
  ["route[1].txt", "route1.txt"],
  ["routes/[id]/page.ts", "routes/i/page.ts"],
])("reverting %s preserves a neighboring path matched by Git wildcards", async (target, neighbor) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const write = async (name: string, content: string) => {
        const file = path.join(tmp.path, name)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, content)
      }
      await write(target, "target before\n")
      await write(neighbor, "neighbor before\n")
      const baseline = await Snapshot.track()
      expect(baseline).toBeDefined()
      await write(target, "target after\n")
      await write(neighbor, "manual neighbor edit\n")
      const patches = [{ hash: baseline!, files: [path.join(tmp.path, target)] }]

      expect((await Snapshot.previewRevert(patches)).map((diff) => diff.file)).toEqual([target])
      await Snapshot.revert(patches)

      expect(await fs.readFile(path.join(tmp.path, target), "utf8")).toBe("target before\n")
      expect(await fs.readFile(path.join(tmp.path, neighbor), "utf8")).toBe("manual neighbor edit\n")
    },
  })
})

test("reverting a newly added wildcard path removes it without checking out a neighboring file", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const neighbor = path.join(tmp.path, "route1.txt")
      const target = path.join(tmp.path, "route[1].txt")
      await fs.writeFile(neighbor, "neighbor before\n")
      const baseline = await Snapshot.track()
      expect(baseline).toBeDefined()
      await fs.writeFile(target, "new target\n")
      await fs.writeFile(neighbor, "manual neighbor edit\n")

      await Snapshot.revert([{ hash: baseline!, files: [target] }])

      await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await fs.readFile(neighbor, "utf8")).toBe("manual neighbor edit\n")
    },
  })
})

test.skipIf(process.platform === "win32").each([":(glob)*.txt", "odd*name?.txt"])(
  "reverting the Unix path %s treats it literally",
  async (name) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const target = path.join(tmp.path, name)
        const neighbor = path.join(tmp.path, "oddxname1.txt")
        await fs.writeFile(target, "target before\n")
        await fs.writeFile(neighbor, "neighbor before\n")
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        await fs.writeFile(target, "target after\n")
        await fs.writeFile(neighbor, "manual neighbor edit\n")

        await Snapshot.revert([{ hash: baseline!, files: [target] }])

        expect(await fs.readFile(target, "utf8")).toBe("target before\n")
        expect(await fs.readFile(neighbor, "utf8")).toBe("manual neighbor edit\n")
      },
    })
  },
)

test("a mixed patch restores existing literal paths and removes added paths without changing neighbors", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = ["route[1].txt", "route[9].txt", "route1.txt", "route9.txt"]
      const files = names.map((name) => path.join(tmp.path, name))
      await fs.writeFile(files[0]!, "target before\n")
      for (const file of files.slice(2)) await fs.writeFile(file, "neighbor before\n")
      const baseline = await Snapshot.track()
      expect(baseline).toBeDefined()
      for (const file of files.slice(0, 2)) await fs.writeFile(file, "target after\n")
      for (const file of files.slice(2)) await fs.writeFile(file, "manual neighbor edit\n")

      await Snapshot.revert([{ hash: baseline!, files: files.slice(0, 2) }])

      expect(await fs.readFile(files[0]!, "utf8")).toBe("target before\n")
      await expect(fs.access(files[1]!)).rejects.toMatchObject({ code: "ENOENT" })
      for (const file of files.slice(2)) expect(await fs.readFile(file, "utf8")).toBe("manual neighbor edit\n")
      const tracked = await Snapshot.track()
      expect(tracked).toBeDefined()
      expect((await Snapshot.patch(tracked!)).files).toEqual([])
    },
  })
})
