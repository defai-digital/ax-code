import { expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

test("non-Git snapshots restore exact bytes after a shell append and newline repair", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.vcs).toBeUndefined()
      const file = path.join(tmp.path, "TEST.txt")
      const original = Buffer.from("This is a test.\r\n/////////////")
      await fs.writeFile(file, original)
      const before = await Snapshot.track()
      expect(before).toMatch(/^[0-9a-f]{40}$/)
      execFileSync(process.execPath, [
        "-e",
        "require('node:fs').appendFileSync(process.argv[1], '\u4f60\u597d\uff01\\nHello!\\n\u3053\u3093\u306b\u3061\u306f\uff01\\n')",
        file,
      ])
      const appended = await Snapshot.patch(before!)
      await fs.writeFile(
        file,
        Buffer.concat([original, Buffer.from("\n\u4f60\u597d\uff01\nHello!\n\u3053\u3093\u306b\u3061\u306f\uff01\n")]),
      )
      const after = await Snapshot.track()
      await Snapshot.revert([appended])
      expect(await fs.readFile(file)).toEqual(original)
      await Snapshot.revert([{ hash: after!, files: appended.files }])
      expect(await fs.readFile(file, "utf8")).toBe(
        original.toString() + "\n\u4f60\u597d\uff01\nHello!\n\u3053\u3093\u306b\u3061\u306f\uff01\n",
      )
      await expect(fs.stat(path.join(tmp.path, ".git"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(await fs.stat(path.join(Global.Path.data, "snapshot", Instance.project.id, "HEAD"))).toBeTruthy()
    },
  })
})

test("non-Git snapshots respect ignore rules and revert added and deleted files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fs.writeFile(path.join(tmp.path, ".gitignore"), "ignored.txt\n")
      const deleted = path.join(tmp.path, "deleted.txt")
      const added = path.join(tmp.path, "added.txt")
      const ignored = path.join(tmp.path, "ignored.txt")
      await fs.writeFile(deleted, "original")
      await fs.writeFile(ignored, "ignored before")
      const before = await Snapshot.track()
      expect(before).toBeTruthy()
      await fs.unlink(deleted)
      await fs.writeFile(added, "new")
      await fs.writeFile(ignored, "ignored after")
      const patch = await Snapshot.patch(before!)
      expect(patch.files.map((file) => path.basename(file)).sort()).toEqual(["added.txt", "deleted.txt"])
      await Snapshot.revert([patch])
      expect(await fs.readFile(deleted, "utf8")).toBe("original")
      await expect(fs.stat(added)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await fs.readFile(ignored, "utf8")).toBe("ignored after")
    },
  })
})

test("non-Git snapshot stores are isolated by project directory", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()
  const capture = (directory: string, value: string) =>
    Instance.provide({
      directory,
      fn: async () => {
        await fs.writeFile(path.join(directory, "same.txt"), value)
        const hash = await Snapshot.track()
        expect(hash).toBeTruthy()
        return { id: Instance.project.id, hash: hash! }
      },
    })
  const a = await capture(first.path, "first")
  const b = await capture(second.path, "second")
  expect(a.id).not.toBe(b.id)
  await Instance.provide({
    directory: first.path,
    fn: async () => {
      await fs.writeFile(path.join(first.path, "same.txt"), "changed")
      await Snapshot.revert([await Snapshot.patch(a.hash)])
      expect(await fs.readFile(path.join(first.path, "same.txt"), "utf8")).toBe("first")
      expect(await fs.readFile(path.join(second.path, "same.txt"), "utf8")).toBe("second")
    },
  })
})

test("snapshot false still disables snapshots in a non-Git directory", async () => {
  await using tmp = await tmpdir({ config: { snapshot: false } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Snapshot.track()).toBeUndefined()
      await expect(fs.stat(path.join(Global.Path.data, "snapshot", Instance.project.id))).rejects.toMatchObject({
        code: "ENOENT",
      })
    },
  })
})
