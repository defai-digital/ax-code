import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { doctorProjectContext } from "../../src/cli/cmd/doctor"
import { tmpdir } from "../fixture/fixture"

describe("cli doctor", () => {
  test("finds project context when launched from a package subdirectory", async () => {
    await using tmp = await tmpdir()
    const packageDir = path.join(tmp.path, "packages", "ax-code")

    await mkdir(path.join(tmp.path, ".git"), { recursive: true })
    await mkdir(path.join(tmp.path, ".ax-code"), { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await Bun.write(path.join(tmp.path, ".git", "HEAD"), "ref: refs/heads/main\n")
    await Bun.write(path.join(tmp.path, "AGENTS.md"), "# Project instructions\n")
    await Bun.write(path.join(tmp.path, ".ax-code", "ax-code.json"), "{}\n")

    const context = await doctorProjectContext(packageDir)

    expect(context.projectRoot).toBe(tmp.path)
    expect(context.agentsPath).toBe(tmp.path)
    expect(context.configPath).toBe(tmp.path)
  })
})
