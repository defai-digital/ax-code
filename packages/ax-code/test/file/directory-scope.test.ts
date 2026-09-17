import { afterEach, describe, test, expect } from "vitest"
import fs from "fs/promises"
import path from "path"
import { DirectoryScope } from "../../src/file/directory-scope"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

function withTestHome(home: string, fn: () => Promise<void>) {
  const previous = process.env.AX_CODE_TEST_HOME
  process.env.AX_CODE_TEST_HOME = home
  return fn().finally(() => {
    if (previous === undefined) delete process.env.AX_CODE_TEST_HOME
    else process.env.AX_CODE_TEST_HOME = previous
  })
}

afterEach(() => {
  delete process.env.AX_CODE_TEST_HOME
})

describe("DirectoryScope.isFilesystemRoot", () => {
  test("true for the filesystem root", () => {
    const root = path.parse(process.cwd()).root
    expect(DirectoryScope.isFilesystemRoot(root)).toBe(true)
  })

  test("false for a nested directory", () => {
    expect(DirectoryScope.isFilesystemRoot(process.cwd())).toBe(false)
  })
})

describe("DirectoryScope.wellKnownBroadPaths", () => {
  test("includes home and its Desktop/Downloads/Documents subfolders", async () => {
    await using tmp = await tmpdir()
    await withTestHome(tmp.path, async () => {
      const paths = DirectoryScope.wellKnownBroadPaths()
      expect(paths).toContain(tmp.path)
      expect(paths).toContain(path.join(tmp.path, "Desktop"))
      expect(paths).toContain(path.join(tmp.path, "Downloads"))
      expect(paths).toContain(path.join(tmp.path, "Documents"))
    })
  })
})

describe("DirectoryScope.isKnownBroadDirectory", () => {
  test("matches a resolved home directory", async () => {
    await using tmp = await tmpdir()
    await withTestHome(tmp.path, async () => {
      expect(DirectoryScope.isKnownBroadDirectory(Filesystem.resolve(tmp.path))).toBe(true)
    })
  })

  test("does not match an unrelated project directory", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      expect(DirectoryScope.isKnownBroadDirectory(Filesystem.resolve(tmp.path))).toBe(false)
    })
  })
})

describe("DirectoryScope.assess", () => {
  test("flags the filesystem root", async () => {
    const root = path.parse(process.cwd()).root
    const result = await DirectoryScope.assess(root)
    expect(result.broad).toBe(true)
    expect(result.reason).toMatch(/filesystem root/)
  })

  test("flags the home directory", async () => {
    await using tmp = await tmpdir()
    await withTestHome(tmp.path, async () => {
      const result = await DirectoryScope.assess(tmp.path)
      expect(result.broad).toBe(true)
      expect(result.reason).toMatch(/home directory/)
    })
  })

  test("flags a Desktop-style home subfolder even though it isn't home itself", async () => {
    await using tmp = await tmpdir()
    await withTestHome(tmp.path, async () => {
      const desktop = path.join(tmp.path, "Desktop")
      await fs.mkdir(desktop, { recursive: true })
      const result = await DirectoryScope.assess(desktop)
      expect(result.broad).toBe(true)
      expect(result.reason).toMatch(/Desktop/)
    })
  })

  test("flags a configured extra denylist entry", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      const result = await DirectoryScope.assess(tmp.path, { extraDenylist: [tmp.path] })
      expect(result.broad).toBe(true)
      expect(result.reason).toMatch(/denylist/)
    })
  })

  test("flags a directory with an unusually large top-level listing", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      for (let i = 0; i < 5; i++) {
        await fs.mkdir(path.join(tmp.path, `entry-${i}`))
      }
      const result = await DirectoryScope.assess(tmp.path, { maxTopLevelEntries: 3 })
      expect(result.broad).toBe(true)
      expect(result.reason).toMatch(/5 top-level entries/)
    })
  })

  test("does not flag an ordinary small project directory", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await fs.writeFile(path.join(tmp.path, "index.ts"), "export {}", "utf-8")
      const result = await DirectoryScope.assess(tmp.path)
      expect(result.broad).toBe(false)
      expect(result.reason).toBeUndefined()
    })
  })
})
