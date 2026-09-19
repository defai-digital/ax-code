import { afterEach, describe, test, expect } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "fs/promises"
import path from "path"
import { DirectoryScope } from "../../src/file/directory-scope"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function initUnbornGit(dir: string) {
  await fs.mkdir(dir, { recursive: true })
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
}

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

  test("does not flag a multi-repo parent as broad", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "one"))
      await initUnbornGit(path.join(tmp.path, "two"))
      const result = await DirectoryScope.assess(tmp.path)
      expect(result.broad).toBe(false)
    })
  })
})

describe("DirectoryScope.isMultiRepoParent", () => {
  test("true when two nested git children exist and the directory is not a repo", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "one"))
      await initUnbornGit(path.join(tmp.path, "two"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(true)
      expect(await DirectoryScope.nestedGitChildren(tmp.path)).toEqual(expect.arrayContaining(["one", "two"]))
      expect((await DirectoryScope.nestedGitChildren(tmp.path)).length).toBe(2)
    })
  })

  test("counts second-level checkouts such as grouped worktrees", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "_worktrees", "alpha"))
      await initUnbornGit(path.join(tmp.path, "_worktrees", "beta"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(true)
      const nested = await DirectoryScope.nestedGitChildren(tmp.path)
      expect(nested).toEqual(expect.arrayContaining(["_worktrees/alpha", "_worktrees/beta"]))
      expect(nested).toHaveLength(2)
    })
  })

  test("false for a single nested git child", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "only"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(false)
    })
  })

  test("false when the directory itself is a git checkout", async () => {
    await using tmp = await tmpdir({ git: true })
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "one"))
      await initUnbornGit(path.join(tmp.path, "two"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(false)
    })
  })

  test("classification skips dot-directories; staging includes them", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, ".internal", "one"))
      await initUnbornGit(path.join(tmp.path, ".internal", "two"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(false)
      expect(await DirectoryScope.nestedGitChildren(tmp.path)).toEqual([])
      const staging = await DirectoryScope.nestedGitChildren(tmp.path, { includeDotDirs: true })
      expect(staging).toEqual(expect.arrayContaining([".internal/one", ".internal/two"]))
      expect(staging).toHaveLength(2)
    })
  })

  test("ignores nested git under node_modules", async () => {
    await using tmp = await tmpdir()
    await using home = await tmpdir()
    await withTestHome(home.path, async () => {
      await initUnbornGit(path.join(tmp.path, "node_modules", "pkg-a"))
      await initUnbornGit(path.join(tmp.path, "node_modules", "pkg-b"))
      expect(await DirectoryScope.isMultiRepoParent(tmp.path)).toBe(false)
      expect(await DirectoryScope.nestedGitChildren(tmp.path)).toEqual([])
    })
  })
})
