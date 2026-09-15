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
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test("snapshot initialization recovers an empty directory left by an interrupted attempt", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const store = path.join(Global.Path.data, "snapshot", Instance.project.id)
      await fs.mkdir(store, { recursive: true })
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "Before\n")
      const baseline = (await Snapshot.track())!
      expect(baseline).toMatch(/^[0-9a-f]{40}$/)
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "After\n")
      await Snapshot.revert([await Snapshot.patch(baseline)])
      expect(await fs.readFile(path.join(tmp.path, "sample.txt"), "utf8")).toBe("Before\n")
    },
  })
})

test("snapshot stores retain the SHA-1 contract when Git defaults to SHA-256", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const runGit = Git.git
      vi.spyOn(Git, "git").mockImplementation((args, options) =>
        runGit(args.includes("init") ? ["-c", "init.defaultObjectFormat=sha256", ...args] : args, options),
      )
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "Before\n")
      const baseline = (await Snapshot.track())!
      expect(baseline).toMatch(/^[0-9a-f]{40}$/)
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "After\n")
      await Snapshot.revert([await Snapshot.patch(baseline)])
      expect(await fs.readFile(path.join(tmp.path, "sample.txt"), "utf8")).toBe("Before\n")
    },
  })
})

test("failed Git initialization reports its cause and allows the next capture to retry", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fs.writeFile(path.join(tmp.path, "sample.txt"), "Before\n")
      const runGit = Git.git
      const spy = vi
        .spyOn(Git, "git")
        .mockImplementation(async (args, options) =>
          args.includes("init")
            ? { exitCode: 128, text: () => "", stdout: Buffer.alloc(0), stderr: Buffer.from("Injected init failure") }
            : runGit(args, options),
        )
      await expect(Snapshot.track()).rejects.toThrow("Snapshot initialization failed: git init exited with code 128")
      spy.mockRestore()
      expect(await Snapshot.track()).toMatch(/^[0-9a-f]{40}$/)
    },
  })
})
