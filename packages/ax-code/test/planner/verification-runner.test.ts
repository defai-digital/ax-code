import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { resolveCommands, runCommand } from "../../src/planner/verification/runner"
import { tmpdir } from "../fixture/fixture"

async function writePackageJson(dir: string, scripts: Record<string, string>) {
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", scripts }, null, 2),
    "utf8",
  )
}

describe("resolveCommands", () => {
  test("returns all-null when no package.json exists", async () => {
    await using tmp = await tmpdir({ git: true })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("returns all-null when package.json exists but has no relevant scripts", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { build: "tsc" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("picks `bun run typecheck` when package.json has a typecheck script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.typecheck).toBe("bun run typecheck")
    expect(cmds.lint).toBeNull()
    expect(cmds.test).toBeNull()
  })

  test("picks `bun run lint` when package.json has a lint script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { lint: "eslint ." })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.lint).toBe("bun run lint")
  })

  test("picks `bun test` when package.json has a test script", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { test: "vitest" })
    const cmds = await resolveCommands(tmp.path)
    expect(cmds.test).toBe("bun test")
  })

  test("override.typecheck=null forces typecheck off even when script exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc --noEmit", lint: "eslint" })
    const cmds = await resolveCommands(tmp.path, { typecheck: null })
    expect(cmds.typecheck).toBeNull()
    // lint default still applies
    expect(cmds.lint).toBe("bun run lint")
  })

  test("override with a custom command string is used verbatim", async () => {
    await using tmp = await tmpdir({ git: true })
    await writePackageJson(tmp.path, { typecheck: "tsc" })
    const cmds = await resolveCommands(tmp.path, {
      typecheck: "pnpm exec tsc --strict",
      lint: "pnpm exec eslint --max-warnings 0 .",
      test: "pnpm exec vitest run",
    })
    expect(cmds.typecheck).toBe("pnpm exec tsc --strict")
    expect(cmds.lint).toBe("pnpm exec eslint --max-warnings 0 .")
    expect(cmds.test).toBe("pnpm exec vitest run")
  })

  test("malformed package.json is treated as no scripts (does not throw)", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "package.json"), "{ not json", "utf8")
    const cmds = await resolveCommands(tmp.path)
    expect(cmds).toEqual({ typecheck: null, lint: null, test: null })
  })

  test("runCommand sanitizes secret-like parent environment variables", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "secret-from-parent"
    try {
      const result = await runCommand(`bun -e "console.log(process.env.OPENAI_API_KEY ?? 'missing')"`, tmp.path)
      expect(result.ok).toBe(true)
      expect(result.stdout.trim()).toBe("missing")
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previous
      }
    }
  })
})
