import path from "node:path"
import { getNodeValue, parseTree } from "jsonc-parser"
import { expect, test } from "vitest"
import { editConfigFile } from "../../src/config/file-update"
import { addMcpToConfig, hasMcpName, McpConfigFileError, removeMcpFromConfig } from "../../src/config/mcp-file"
import type { Mcp } from "../../src/config/schema"
import { Filesystem } from "../../src/util/filesystem"
import { patchJsonc } from "../../src/util/jsonc"
import { tmpdir } from "../fixture/fixture"

const server: Mcp = { type: "local", command: ["node"] }

test("MCP and general config edits share one transaction without losing comments or raw references", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{\n // keep this comment\n "username": "{env:AX_TEST_CONFIG_SECRET}"\n}\n')
  await Promise.all([
    addMcpToConfig("local", { type: "local", command: ["node", "fixture.js"] }, file),
    addMcpToConfig("remote", { type: "remote", url: "https://example.com/mcp" }, file),
    editConfigFile(file, (text) => patchJsonc(text ?? "{}", { instructions: ["{file:/outside/instructions.md}"] })),
  ])
  const text = await Filesystem.readText(file)
  expect(text).toContain("// keep this comment")
  expect(getNodeValue(parseTree(text)!)).toMatchObject({
    username: "{env:AX_TEST_CONFIG_SECRET}",
    instructions: ["{file:/outside/instructions.md}"],
    mcp: {
      local: { type: "local", command: ["node", "fixture.js"] },
      remote: { type: "remote", url: "https://example.com/mcp" },
    },
  })
})

test("replacing one MCP entry drops stale transport fields and preserves unrelated schema-invalid settings", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(
    file,
    '{"model":123,"mcp":{"example":{"type":"local","command":["old"],"environment":{"KEY":"{env:KEY}"}},"keep":{"enabled":false}}}',
  )
  await expect(addMcpToConfig("example", { type: "remote", url: "https://example.com/mcp" }, file)).resolves.toBe(file)
  expect(getNodeValue(parseTree(await Filesystem.readText(file))!)).toEqual({
    model: 123,
    mcp: { example: { type: "remote", url: "https://example.com/mcp" }, keep: { enabled: false } },
  })
})

test("removal can repair invalid MCP entries without validating unrelated config fields", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await Filesystem.write(file, '{\n // repair\n "model":123,"mcp":{"broken":42,"keep":{"enabled":false}}\n}')
  await expect(removeMcpFromConfig("broken", file)).resolves.toBe(file)
  const text = await Filesystem.readText(file)
  expect(text).toContain("// repair")
  expect(getNodeValue(parseTree(text)!)).toEqual({ model: 123, mcp: { keep: { enabled: false } } })
})

test.each(['{"mcp":{},"broken":}', "[]", "null", "42"])(
  "invalid document %s remains byte-for-byte intact after add or remove",
  async (text) => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ax-code.jsonc")
    await Filesystem.write(file, text)
    await expect(addMcpToConfig("added", server, file)).rejects.toBeInstanceOf(McpConfigFileError)
    await expect(removeMcpFromConfig("added", file)).rejects.toBeInstanceOf(McpConfigFileError)
    expect(await Filesystem.readText(file)).toBe(text)
  },
)

test("invalid MCP maps and invalid new entries are rejected before writing", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  for (const original of ['{"mcp":[]}', '{"mcp":null}']) {
    await Filesystem.write(file, original)
    await expect(addMcpToConfig("added", server, file)).rejects.toBeInstanceOf(McpConfigFileError)
    expect(await Filesystem.readText(file)).toBe(original)
  }
  await Filesystem.write(file, "{}")
  await expect(addMcpToConfig("added", { type: "local", command: [] }, file)).rejects.toBeInstanceOf(McpConfigFileError)
  expect(await Filesystem.readText(file)).toBe("{}")
  await addMcpToConfig("retry", server, file)
  expect(hasMcpName(await Filesystem.readText(file), "retry", file)).toBe(true)
})

test("missing-file removal never creates a config; adding to a missing or empty file works", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  await expect(removeMcpFromConfig("missing", file)).rejects.toThrow("Config file not found")
  expect(await Filesystem.exists(file)).toBe(false)
  for (const text of [undefined, "", "// empty config\n"]) {
    if (text !== undefined) await Filesystem.write(file, text)
    await addMcpToConfig("added", server, file)
    expect(hasMcpName(await Filesystem.readText(file), "added", file)).toBe(true)
  }
  const before = await Filesystem.readText(file)
  await expect(removeMcpFromConfig("missing", file)).rejects.toThrow('MCP server "missing" is not configured')
  expect(await Filesystem.readText(file)).toBe(before)
})

test.each(["__proto__", "constructor", "toString"])("literal MCP name %s can be added and removed", async (name) => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ax-code.jsonc")
  expect(hasMcpName('{"mcp":{}}', name, file)).toBe(false)
  await addMcpToConfig(name, server, file)
  expect(hasMcpName(await Filesystem.readText(file), name, file)).toBe(true)
  await removeMcpFromConfig(name, file)
  expect(hasMcpName(await Filesystem.readText(file), name, file)).toBe(false)
})

test("a top-level __proto__ entry never supplies an inherited MCP map", () => {
  expect(hasMcpName('{"__proto__":{"mcp":{"inherited":{"enabled":false}}}}', "inherited", "config.json")).toBe(false)
})
