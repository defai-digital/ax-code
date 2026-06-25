import { execFileSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "path"
import { Incremental } from "../../src/debug-engine"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("debug-engine incremental file selection", () => {
  test("passes include globs as separate git pathspecs", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
})
