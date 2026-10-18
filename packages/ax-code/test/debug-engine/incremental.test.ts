import { execFileSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { writeFile, mkdir } from "node:fs/promises"
import path from "path"
import { Incremental } from "@ax-code/ax-code-reason"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("debug-engine incremental file selection", () => {
  test("passes include globs as separate git pathspecs", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await mkdir(path.join(dir, "scripts"), { recursive: true })
        await writeFile(path.join(dir, "src", "app.ts"), "export const app = 1\n")
        await writeFile(path.join(dir, "scripts", "tool.js"), "export const tool = 1\n")
        await writeFile(path.join(dir, "README.md"), "# demo\n")
      },
    })
    execFileSync("git", ["add", "."], { cwd: tmp.path, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "seed files"], { cwd: tmp.path, stdio: "ignore" })

    await writeFile(path.join(tmp.path, "src", "app.ts"), "export const app = 2\n")
    await writeFile(path.join(tmp.path, "scripts", "tool.js"), "export const tool = 2\n")
    await writeFile(path.join(tmp.path, "README.md"), "# changed\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Incremental.changedFilesSince("HEAD", {
          include: ["src/*.ts", "scripts/*.js"],
        })

        expect(result.files.sort()).toEqual([
          path.join(tmp.path, "scripts", "tool.js"),
          path.join(tmp.path, "src", "app.ts"),
        ])
      },
    })
  })

  test("deduplicates changed files with transitive importers", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await writeFile(path.join(dir, "src", "app.ts"), "import { value } from './util'\nexport const app = value\n")
        await writeFile(path.join(dir, "src", "util.ts"), "export const value = 1\n")
      },
    })
    execFileSync("git", ["add", "."], { cwd: tmp.path, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "seed files"], { cwd: tmp.path, stdio: "ignore" })

    await writeFile(path.join(tmp.path, "src", "util.ts"), "export const value = 2\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Incremental.filesToScan("HEAD", {
          include: ["src/*.ts"],
          transitive: true,
        })

        expect(result.files.sort()).toEqual([
          path.join(tmp.path, "src", "app.ts"),
          path.join(tmp.path, "src", "util.ts"),
        ])
      },
    })
  })

  test("reports the root commit's files inside a window that starts at it", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await writeFile(path.join(dir, "src", "only-file.ts"), "export const only = 1\n")
      },
    })
    execFileSync("git", ["add", "."], { cwd: tmp.path, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "root commit"], { cwd: tmp.path, stdio: "ignore" })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // `root^` does not exist; the window used to come back empty.
        const result = await Incremental.changedFilesInWindow(60 * 60)
        expect(result.files).toEqual([path.join(tmp.path, "src", "only-file.ts")])
      },
    })
  })

  test("handles non-ASCII paths without git quoting", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "原始"), { recursive: true })
        await writeFile(path.join(dir, "原始", "檔案.ts"), "export const v = 1\n")
      },
    })
    execFileSync("git", ["add", "."], { cwd: tmp.path, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "seed"], { cwd: tmp.path, stdio: "ignore" })
    await writeFile(path.join(tmp.path, "原始", "檔案.ts"), "export const v = 2\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Incremental.changedFilesSince("HEAD")
        expect(result.files).toEqual([path.join(tmp.path, "原始", "檔案.ts")])
      },
    })
  })

  test("finds .mjs importers of a changed module", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await writeFile(path.join(dir, "src", "util.ts"), "export const value = 1\n")
        await writeFile(path.join(dir, "src", "run.mjs"), "import { value } from './util.js'\nconsole.log(value)\n")
      },
    })
    execFileSync("git", ["add", "."], { cwd: tmp.path, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "seed"], { cwd: tmp.path, stdio: "ignore" })
    await writeFile(path.join(tmp.path, "src", "util.ts"), "export const value = 2\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Incremental.filesToScan("HEAD", { transitive: true })
        expect(result.files).toContain(path.join(tmp.path, "src", "run.mjs"))
      },
    })
  })
})
