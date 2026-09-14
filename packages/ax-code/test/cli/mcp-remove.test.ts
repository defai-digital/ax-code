import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import yargs from "yargs"
import { McpRemoveCommand } from "../../src/cli/cmd/mcp-impl"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const originalExitCode = process.exitCode
const originalConfig = Global.Path.config
afterEach(() => {
  process.exitCode = originalExitCode
  Global.Path.config = originalConfig
  vi.restoreAllMocks()
})

async function remove(directory: string, globalDirectory: string, name: string, global = false) {
  vi.spyOn(process, "cwd").mockReturnValue(directory)
  Global.Path.config = globalDirectory
  vi.spyOn(process.stdout, "write").mockReturnValue(true)
  try {
    await yargs()
      .exitProcess(false)
      .command(McpRemoveCommand)
      .parseAsync(["remove", name, "--force", ...(global ? ["--global"] : [])])
  } finally {
    await Instance.disposeAll()
  }
}

test.each([false, true])("MCP removal does not cross the selected config scope (global=%s)", async (global) => {
  await using project = await tmpdir({ git: true })
  await using user = await tmpdir()
  const other = path.join(global ? project.path : user.path, "ax-code.json")
  const text = '{ "mcp": { "example": { "type": "local", "command": ["example"] } } }\n'
  await fs.writeFile(other, text)

  await remove(project.path, user.path, "example", global)

  expect(process.exitCode).toBe(1)
  expect(await fs.readFile(other, "utf8")).toBe(text)
})

test("MCP removal does not report inherited object properties as configured servers", async () => {
  await using project = await tmpdir({ git: true })
  await using user = await tmpdir()
  const file = path.join(project.path, "ax-code.json")
  const text = '{ "mcp": {} }\n'
  await fs.writeFile(file, text)

  await remove(project.path, user.path, "toString")

  expect(process.exitCode).toBe(1)
  expect(await fs.readFile(file, "utf8")).toBe(text)
})

test("MCP removal rejects malformed JSONC without rewriting it", async () => {
  await using project = await tmpdir({ git: true })
  await using user = await tmpdir()
  const file = path.join(project.path, "ax-code.jsonc")
  const text = '{ "mcp": { "example": { "enabled": false } }, "broken": }\n'
  await fs.writeFile(file, text)

  await expect(remove(project.path, user.path, "example")).rejects.toThrow("Invalid config file")
  expect(await fs.readFile(file, "utf8")).toBe(text)
})

test.each([false, true])("MCP removal preserves comments and unrelated entries (global=%s)", async (global) => {
  await using project = await tmpdir({ git: true })
  await using user = await tmpdir()
  const file = path.join(global ? user.path : project.path, "ax-code.jsonc")
  await fs.writeFile(
    file,
    '{\n  // User settings\n  "mcp": { "example": { "enabled": false }, "keep": { "enabled": false } }\n}\n',
  )

  await remove(project.path, user.path, "example", global)

  const result = await fs.readFile(file, "utf8")
  expect(result).toContain("// User settings")
  expect(result).toContain('"keep"')
  expect(result).not.toContain('"example"')
  expect(process.exitCode).not.toBe(1)
})
