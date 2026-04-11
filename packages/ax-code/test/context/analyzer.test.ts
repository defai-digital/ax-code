import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { analyze } from "../../src/context/analyzer"
import { tmpdir } from "../fixture/fixture"

describe("context.analyzer", () => {
  test("does not count failed reads as one line of code", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, "package.json"),
          JSON.stringify({ name: "fixture", version: "1.0.0" }),
        )
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "ok.ts"), "export const ok = true\n")
        await fs.writeFile(path.join(dir, "src", "denied.ts"), "export const denied = true\n")
        await fs.chmod(path.join(dir, "src", "denied.ts"), 0)
      },
      dispose: async (dir) => {
        await fs.chmod(path.join(dir, "src", "denied.ts"), 0o644).catch(() => undefined)
      },
    })

    const info = await analyze(tmp.path)

    expect(info.complexity?.fileCount).toBe(2)
    expect(info.complexity?.linesOfCode).toBe(1)
  })
})
