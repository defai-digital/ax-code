import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * A case-insensitive volume (the macOS default) resolves every casing of a
 * directory to the same physical directory. Instance.provide caches by the
 * resolved path, so a second spelling must reuse the first instance instead of
 * booting another one: otherwise a directory-only project gets a second
 * `dir-<sha1>` id and a git project sees its worktree in a different casing.
 */
describe.skipIf(process.platform !== "darwin")("case-insensitive paths", () => {
  test("a miscased directory reuses one instance and one project id", async () => {
    await using tmp = await tmpdir()
    const onDisk = path.join(tmp.path, "CaseTest", "MyProj")
    await fs.mkdir(onDisk, { recursive: true })
    const miscased = path.join(tmp.path, "casetest", "myproj")
    // A case-sensitive volume cannot address the directory through other casing.
    if (!(await Filesystem.exists(miscased))) return

    const canonical = Filesystem.resolve(onDisk)
    try {
      const first = await Instance.provide({
        directory: onDisk,
        fn: () => ({ directory: Instance.directory, worktree: Instance.worktree, projectID: Instance.project.id }),
      })
      const second = await Instance.provide({
        directory: miscased,
        fn: () => ({ directory: Instance.directory, worktree: Instance.worktree, projectID: Instance.project.id }),
      })

      expect(first.directory).toBe(canonical)
      expect(second.directory).toBe(canonical)
      expect(second.projectID).toBe(first.projectID)
      expect(second.worktree).toBe(canonical)
      expect(entriesFor(canonical)).toEqual([canonical])
    } finally {
      await Instance.provide({ directory: onDisk, fn: () => Instance.dispose() }).catch(() => undefined)
    }
  })

  test("a miscased subdirectory of a git repository keeps one worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const onDisk = path.join(tmp.path, "CaseTest")
    await fs.mkdir(onDisk)
    const miscased = path.join(tmp.path, "casetest")
    if (!(await Filesystem.exists(miscased))) return

    const canonical = Filesystem.resolve(onDisk)
    const repository = Filesystem.resolve(tmp.path)
    try {
      const first = await Instance.provide({
        directory: onDisk,
        fn: () => ({ directory: Instance.directory, worktree: Instance.worktree, projectID: Instance.project.id }),
      })
      const second = await Instance.provide({
        directory: miscased,
        fn: () => ({
          directory: Instance.directory,
          worktree: Instance.worktree,
          projectID: Instance.project.id,
          sandboxes: Instance.project.sandboxes,
        }),
      })

      expect(first.worktree).toBe(repository)
      expect(second.directory).toBe(canonical)
      expect(second.worktree).toBe(repository)
      expect(second.projectID).toBe(first.projectID)
      // The subdirectory is inside the worktree, so the repository must not
      // register a case-variant of itself as a sandbox.
      expect(second.sandboxes.filter((sandbox) => sandbox.toLowerCase() === canonical.toLowerCase())).toEqual([])
      expect(entriesFor(canonical)).toEqual([canonical])
    } finally {
      await Instance.provide({ directory: onDisk, fn: () => Instance.dispose() }).catch(() => undefined)
    }
  })
})

/** Instances cached for the same physical directory, compared case-insensitively. */
function entriesFor(directory: string) {
  return Instance.list().filter((entry) => entry.toLowerCase() === directory.toLowerCase())
}
